// The extension's centre: keeps the list of chats (from every tool) current,
// answers the webviews, and turns their requests (connect, branch, open) into
// connections, context and chats.
import * as vscode from "vscode";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import type { Adapter } from "../adapters/adapter";
import { ClaudeAdapter } from "../adapters/claude";
import { CodexAdapter } from "../adapters/codex";
import { GeminiAdapter } from "../adapters/gemini";
import { claudeProjectFolder, claudeProjectsDir, airbandFile, airbandHome, statusDir } from "../core/paths";
import type { BoardTab, ConnectionView, FromWebview, ToWebview, ToolTotals, ViewState } from "../core/protocol";
import { CodeMap } from "../codemap/index";
import { libraryView, shortTitle } from "./pages";
import { BoardStore } from "../core/state";
import { readHookStatus, resolveStatus } from "../sessions/status";
import { addConnection, readConnections, removeConnection, setPaused, setLevel } from "../sharing/connections";
import { addPending } from "../sharing/pending";
import { appendInbox, readInbox, takeInbox } from "../sharing/inbox";
import { getCursor, setCursor } from "../sharing/cursors";
import { logDelivery, readDeliveries } from "../sharing/deliveries";
import { addUsage } from "../core/types";
import type { ChatDigest, ChatRef, ChatSession, Connection, Status } from "../core/types";
import type { Tool } from "../core/agents";
import { NO_USAGE } from "../core/types";
import { isTempFolder, pickElsewhere, unregisterWindow } from "../core/folders";
import { CONTEXT_BUDGET } from "../core/config";
import { buildContext, buildUpdate, formatDelivery } from "../sharing/delivery";
import { sameFolder } from "../core/paths";
import { HOOK_START_MAX, HOOK_STEP_MAX, readHead, readAsks, setRecordTitle } from "../sessions/record/store";
import { catchUpRecord, recordBehind } from "../sessions/record/update";
import { readAsksFrom } from "../sessions/record/extract";
import { recordContext, recordPointer, renderAsks, type LinkLevel } from "../sessions/record/render";
import { agentOf } from "../core/agents";
import { setClaudeAiCredit } from "../install/agent-hooks";
import { claudeExtensionInstalled, openClaude } from "./open";
import { webviewHtml } from "./webview-html";
import { PlansService } from "./plans-service";
import { SetupService } from "./setup-service";
import { libraryMessage } from "./library-page";
import { MapPageService } from "./map-page";
import { ChatOpener } from "./chat-opener";
import { contextSize, setWriting, syncConfig, writingView } from "./settings";

const POLL_MS = 10_000;
const PER_TOOL = 60;
/** Chats from every folder: read again at most every 30 s (see pickElsewhere for which are shown). */
const ELSEWHERE_PER_TOOL = 400;
const ELSEWHERE_MS = 30_000;
/**
 * A chat file with more than this not yet counted is counted in the background, a slice at a time,
 * so the list shows at once and the extension never stops answering (one chat file can be a gigabyte).
 */
const QUICK_BYTES = 2 * 1024 * 1024;
const SLICE_BYTES = 4 * 1024 * 1024;
/** A non-Claude chat quiet this long has finished its reply: its update can go out. */
const QUIET_MS = 15_000;

export class Controller implements vscode.Disposable {
  readonly adapters: Adapter[] = [new ClaudeAdapter(), new CodexAdapter(), new GeminiAdapter()];
  private readonly views = new Set<vscode.Webview>();
  private board: vscode.WebviewPanel | undefined;
  state: ViewState = {
    tools: [],
    sessions: [],
    connections: [],
    inbox: {},
    board: { members: [], positions: {} },
    totals: {},
    hooksOn: false,
    claudeExtension: false,
    loading: true,
  };
  byId = new Map<string, ChatSession>();
  private readonly lastStatus = new Map<string, Status>();
  private readonly digests = new Map<string, ChatDigest>();
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: fs.FSWatcher[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  /** Chats whose files are still being counted, a slice at a time. */
  private readonly uncounted = new Set<string>();
  private counting = false;
  private again = false;
  private firstLoad = true;

  readonly setup = new SetupService(this);
  readonly plansService = new PlansService(this);
  readonly mapPage = new MapPageService(this);
  readonly opener = new ChatOpener(this);

  constructor(readonly ctx: vscode.ExtensionContext) {
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => (this.rewatch(), this.opener.noteWindow())));
    // A note of this window's folders, so the desktop app opens a chat here when its folder is open.
    this.opener.noteWindow();
    const note = setInterval(() => this.opener.noteWindow(), 60_000);
    this.disposables.push({ dispose: () => (clearInterval(note), unregisterWindow()) });
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("airband") && syncConfig()));
    this.setup.moveFromOldNames();
    this.setup.keepHookCurrent();
    this.setup.tidyStorage();
    syncConfig();
    this.rewatch();
    // A window opened to show a Claude chat opens it now, not after every folder's chats are read.
    void this.opener.takeOpens();
    // A window brought forward by another one ("open in its folder") looks for the chat it was
    // asked to open, whether or not the file watcher fired.
    const w = vscode.window as unknown as { onDidChangeWindowState?: vscode.Event<{ focused: boolean }> };
    const focus = w.onDidChangeWindowState?.((st) => st.focused && void this.opener.takeOpens());
    if (focus) this.disposables.push(focus);
    // Last, so nothing above can leave a timer running if it throws.
    const poll = setInterval(() => this.refresh(), POLL_MS);
    this.disposables.push({ dispose: () => clearInterval(poll) });
  }

  get root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  // ---- views ----

  attach(webview: vscode.Webview, view: "sidebar" | "board"): vscode.Disposable {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "dist")] };
    webview.html = webviewHtml(webview, this.ctx.extensionUri, view);
    this.views.add(webview);
    const sub = webview.onDidReceiveMessage((m: FromWebview) => this.handle(m, webview));
    return { dispose: () => (this.views.delete(webview), sub.dispose()) };
  }

  openBoard(tab: BoardTab = "board"): void {
    if (this.board) {
      this.board.reveal();
      void this.board.webview.postMessage({ type: "tab", tab } satisfies ToWebview);
      return;
    }
    const panel = vscode.window.createWebviewPanel("airband.board", "Airband", vscode.ViewColumn.Active, { retainContextWhenHidden: true });
    // The a with its orange light: a light a on dark themes, a dark a on light ones.
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.ctx.extensionUri, "media", "airband-color-light.svg"),
      dark: vscode.Uri.joinPath(this.ctx.extensionUri, "media", "airband-color-dark.svg"),
    };
    const detach = this.attach(panel.webview, "board");
    panel.onDidDispose(() => {
      detach.dispose();
      this.board = undefined;
    });
    this.board = panel;
    if (tab !== "board") setTimeout(() => void panel.webview.postMessage({ type: "tab", tab } satisfies ToWebview), 400);
  }

  post(msg: ToWebview, to?: vscode.Webview): void {
    for (const v of to ? [to] : this.views) void v.postMessage(msg);
  }

  toast(text: string, tone: "ok" | "warn" = "ok", to?: vscode.Webview, extra: { title?: string; icon?: Extract<ToWebview, { type: "toast" }>["icon"]; undo?: FromWebview } = {}): void {
    this.post({ type: "toast", text, tone, ...extra }, to);
  }

  /** Unlinks, tells both chats (with their next message), and offers Undo. */
  private unlink(ids: string[], view: vscode.Webview, quiet = false): Connection[] {
    const gone: Connection[] = [];
    for (const id of ids) {
      const c = removeConnection(id);
      if (!c) continue;
      gone.push(c);
      this.notice(c.to.id, c.from, `Channel from “${c.from.title}” closed: no more updates will come from it.`, `${c.from.id}>${c.to.id}`);
      this.notice(c.from.id, c.to, `No longer sharing this chat’s work with “${c.to.title}”.`, `${c.from.id}>${c.to.id}`);
    }
    if (gone.length && !quiet) {
      const names = [...new Set(gone.flatMap((c) => [this.ref(c.from).title, this.ref(c.to).title]))];
      this.toast(
        names.length === 2 ? `${shortTitle(names[0])} · ${shortTitle(names[1])}` : `${gone.length} channels`,
        "ok",
        view,
        { title: "Channel closed", icon: "unlink", undo: { type: "connectMany", pairs: gone.map((c) => [c.from.id, c.to.id]) } },
      );
    }
    return gone;
  }

  /** Sets which way two linked chats share: both ways, a → b, or b → a. */
  private async direction(a: string, b: string, want: "both" | "ab" | "ba", view: vscode.Webview): Promise<void> {
    const all = readConnections();
    const ab = all.find((c) => c.from.id === a && c.to.id === b);
    const ba = all.find((c) => c.from.id === b && c.to.id === a);
    const add: [string, string][] = [];
    if ((want === "both" || want === "ab") && !ab) add.push([a, b]);
    if ((want === "both" || want === "ba") && !ba) add.push([b, a]);
    const remove = [want === "ba" ? ab?.id : undefined, want === "ab" ? ba?.id : undefined].filter((x): x is string => !!x);
    if (add.length) await this.connectMany(add, view, true);
    if (remove.length) this.unlink(remove, view, true);
    const A = this.session(a).title;
    const B = this.session(b).title;
    const text = want === "both" ? `${shortTitle(A)} ⇄ ${shortTitle(B)}` : want === "ab" ? `${shortTitle(A)} → ${shortTitle(B)}` : `${shortTitle(B)} → ${shortTitle(A)}`;
    this.toast(text, "ok", view, { title: want === "both" ? "Both ways" : "One way", icon: "link" });
    await this.refresh();
  }

  // ---- the list of chats ----

  refreshSoon(ms = 300): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), ms);
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      await this.load();
    } catch (err) {
      this.state = { ...this.state, loading: false, error: `Airband couldn't read the chats: ${String(err)}` };
      this.post({ type: "state", state: this.state });
    } finally {
      this.refreshing = false;
      if (this.again) {
        this.again = false;
        this.refreshSoon(50);
      }
    }
  }

  private async load(): Promise<void> {
    const root = this.root;
    const claudeExtension = await claudeExtensionInstalled();
    const hooks = this.setup.hookState();
    // "On" means every installed agent has Airband's hook.
    const hooksOn = Object.values(hooks).every(Boolean);
    if (!root) {
      this.state = { ...this.state, root: undefined, sessions: [], connections: [], inbox: {}, hooksOn, claudeExtension, loading: false, error: "Open a folder to see the AI chats you had in it." };
      this.post({ type: "state", state: this.state });
      return;
    }

    const present = this.adapters.filter((a) => a.tool === "Claude" || a.present());
    const errors: string[] = [];
    const lists = await Promise.all(
      present.map((a) =>
        a.list(root, PER_TOOL).catch((err) => {
          errors.push(`${a.tool}: ${String(err)}`);
          return [] as ChatSession[];
        }),
      ),
    );
    // This folder's chats, then the newest chats of every other folder (for "All folders" and for
    // links that reach another folder).
    const mine = lists.flat();
    const seen = new Set(mine.map((s) => s.id));
    const elsewhere = pickElsewhere(
      (await this.elsewhere(present)).filter((s) => !seen.has(s.id)),
      // Linked chats and the board's cards always show, however old.
      new Set([...readConnections().flatMap((c) => [c.from.id, c.to.id]), ...new BoardStore(root).read().members]),
    ).map((s) => ({ ...s, away: !s.cwd || !sameFolder(s.cwd, root) }));
    const sessions = [...mine, ...elsewhere].sort((a, b) => b.lastModified - a.lastModified);
    const totals: ViewState["totals"] = {};
    for (const s of sessions) {
      // Every agent with Airband's hook records its own status.
      const { status, line } = resolveStatus(s.lastModified, readHookStatus(s.id));
      s.status = status;
      s.lastLine = line;
      try {
        if (s.away) {
          // Another folder's history can run to a gigabyte: only its end is read, for the model and context.
          const l = this.adapter(s.tool).latest(s);
          s.model = l?.model;
          s.context = l?.context;
          continue;
        }
        const a = this.adapter(s.tool);
        if ((a.pendingBytes?.(s) ?? 0) > QUICK_BYTES) {
          // Big and not counted yet: the list shows now, with the model and context from the file's
          // end; its tokens follow once counted in the background.
          const l = a.latest(s);
          s.model = l?.model;
          s.context = l?.context;
          this.uncounted.add(s.id);
        } else {
          const u = a.usage(s);
          s.usage = u?.total;
          s.usageToday = u?.today;
          s.model = u?.model;
          s.context = u?.context;
        }
      } catch {
        // Usage is a nicety; a file it can't read just shows none.
        if (s.away) continue;
      }
      const t: ToolTotals = (totals[s.tool] ??= { chats: 0, today: NO_USAGE, total: NO_USAGE });
      t.chats++;
      if (s.usage) t.total = addUsage(t.total, s.usage);
      if (s.usageToday) t.today = addUsage(t.today, s.usageToday);
    }
    this.byId = new Map(sessions.map((s) => [s.id, s]));

    this.pumpQuietSources();

    const deliveries = readDeliveries();
    const connections: ConnectionView[] = readConnections()
      .filter((c) => this.byId.has(c.from.id) || this.byId.has(c.to.id))
      .map((c) => {
        // Only what this link has sent: not what an earlier link between the same chats sent.
        const mine = deliveries.filter((d) => d.at >= c.createdAt && (d.connectionId === c.id || (!d.connectionId && d.from === c.from.id && d.to === c.to.id)));
        return {
          ...c,
          from: this.ref(c.from),
          to: this.ref(c.to),
          updates: mine.length,
          chars: mine.reduce((n, d) => n + d.chars, 0),
          lastAt: mine.length ? mine[mine.length - 1].at : undefined,
        };
      });

    const inbox: ViewState["inbox"] = {};
    for (const s of sessions) {
      const items = readInbox(s.id).filter((i) => i.kind !== "notice");
      if (items.length) inbox[s.id] = { count: items.length, chars: items.reduce((n, i) => n + i.text.length, 0), from: [...new Set(items.map((i) => this.ref(i.from).title))] };
    }

    const store = new BoardStore(root);
    let board = store.read();
    // A new board starts with the chats that matter (linked, busy, the newest few) — once. An empty
    // board after that is one the person cleared, and stays empty until they add chats.
    if (!board.seeded && !board.members.length && sessions.length) {
      const linked = connections.flatMap((c) => [c.from.id, c.to.id]);
      const busy = mine.filter((s) => s.status === "working" || s.status === "waiting").map((s) => s.id);
      const recent = mine.slice(0, 5).map((s) => s.id);
      store.add([...linked, ...busy, ...recent].filter((id) => this.byId.has(id)));
      board = store.update((b) => (b.seeded = true));
    } else if (!board.seeded && board.members.length) {
      board = store.update((b) => (b.seeded = true));
    }

    this.notifyWaiting(sessions);
    this.plansService.follow();
    void this.plansService.refresh();
    this.state = {
      root,
      tools: present.map((a) => a.tool),
      sessions,
      connections,
      inbox,
      board,
      totals,
      hooksOn,
      hooks,
      claudeExtension,
      focus: this.focusOn,
      plans: this.plansService.plans,
      plansLoading: this.plansService.loading,
      loading: false,
      error: errors.length ? `Some chats couldn't be read (${errors.join("; ")})` : undefined,
    };
    this.post({ type: "state", state: this.state });
    void this.opener.takeOpens();
    if (this.uncounted.size) void this.countInBackground();
    else {
      for (const a of this.adapters) a.saveCache?.();
      void this.recordInBackground();
    }
  }

  private recording = false;

  /**
   * Session records for this folder's chats and every linked chat, so any of them can be picked up
   * from its record. The hook keeps a record current after each reply; here, only what the hook
   * leaves alone: a quiet chat with no record yet, a big one, or one far behind. A slice at a time, after the
   * token counting, never two at once.
   */
  private async recordInBackground(): Promise<void> {
    if (this.recording || this.counting) return;
    this.recording = true;
    try {
      const linked = new Set(readConnections().flatMap((c) => [c.from.id, c.to.id]));
      const wanted = [...this.byId.values()].filter((s) => s.file && (!s.away || linked.has(s.id)));
      for (const s of wanted) {
        const tool = agentOf(s.tool);
        const behind = recordBehind(s.id, tool, s.file!);
        // A chat replying now is the hook's (it records the ask as the reply ends); a quiet one
        // with no record yet, or a record far behind, is caught up here.
        const quiet = Date.now() - s.lastModified > 120_000;
        const hookWont = readHead(s.id) ? behind > HOOK_STEP_MAX : behind > HOOK_START_MAX || (quiet && behind > 0);
        if (hookWont) await this.ensureRecord(s);
      }
    } catch {
      // A record is a nicety; it is tried again on the next refresh.
    } finally {
      this.recording = false;
    }
  }

  /**
   * Counts the big chat files a slice at a time, letting everything else run between slices, then
   * shows the totals. What is counted is kept, so the next window starts from it.
   */
  private async countInBackground(): Promise<void> {
    if (this.counting) return;
    this.counting = true;
    let lastShown = Date.now();
    try {
      while (this.uncounted.size) {
        const id = this.uncounted.values().next().value!;
        this.uncounted.delete(id);
        const s = this.byId.get(id);
        if (!s) continue;
        const a = this.adapter(s.tool);
        if (a.usageStep) {
          while ((a.pendingBytes?.(s) ?? 0) > 0) {
            a.usageStep(s, SLICE_BYTES);
            await new Promise((r) => setImmediate(r));
          }
        } else {
          a.usage(s);
          await new Promise((r) => setImmediate(r));
        }
        if (Date.now() - lastShown > 2000) {
          lastShown = Date.now();
          this.refreshSoon(0);
        }
      }
    } finally {
      this.counting = false;
      for (const a of this.adapters) a.saveCache?.();
      this.refreshSoon(0);
    }
  }

  private elsewhereCache: { at: number; list: ChatSession[] } | undefined;

  /** The newest chats of every folder, from every tool; listed again at most every 30 seconds. */
  private async elsewhere(present: Adapter[]): Promise<ChatSession[]> {
    const hit = this.elsewhereCache;
    if (hit && Date.now() - hit.at < ELSEWHERE_MS) return hit.list.map((s) => ({ ...s }));
    const lists = await Promise.all(present.map((a) => a.list(undefined, ELSEWHERE_PER_TOOL).catch(() => [] as ChatSession[])));
    // A chat without a folder, or whose folder is gone, can't be opened; one in a temp folder is a
    // throwaway (a test, a scratch run): all left out.
    const list = lists.flat().filter((s) => s.cwd && fs.existsSync(s.cwd) && !isTempFolder(s.cwd));
    this.elsewhereCache = { at: Date.now(), list };
    return list.map((s) => ({ ...s }));
  }

  adapter(tool: Tool): Adapter {
    return this.adapters.find((a) => a.tool === tool)!;
  }

  /** A connection's chat as it is called now (titles change as chats go on). */
  private ref(r: ChatRef): ChatRef {
    const s = this.byId.get(r.id);
    return s ? { id: s.id, tool: s.tool, title: s.title, cwd: s.cwd ?? r.cwd } : r;
  }

  /**
   * Claude chats send their updates from the hook when a reply ends. Other tools
   * have no hook, so their updates go out from here once the chat has gone quiet.
   */
  private pumpQuietSources(): void {
    const now = Date.now();
    const bySource = new Map<string, ReturnType<typeof readConnections>>();
    for (const c of readConnections()) {
      // An agent with Airband's hook sends its own updates when a reply ends; the rest are read here.
      if (c.paused || this.setup.hooked(c.from.tool)) continue;
      bySource.set(c.from.id, [...(bySource.get(c.from.id) ?? []), c]);
    }
    for (const [id, conns] of bySource) {
      const s = this.byId.get(id);
      if (!s) continue;
      const a = this.adapter(s.tool);
      const cursor = getCursor(id);
      if (cursor === undefined) {
        setCursor(id, a.end(s));
        continue;
      }
      if (a.end(s) === cursor || now - s.lastModified < QUIET_MS) continue;
      // Hundreds of MB since the bookmark (sharing was off for long): skip ahead rather than read it
      // all on the extension host, which would freeze every extension. The flightlog has it.
      if (s.file && agentOf(s.tool) !== "gemini" && a.end(s) - cursor > HOOK_STEP_MAX) {
        setCursor(id, a.end(s));
        continue;
      }
      const words = conns.some((c) => c.level === "full") || !s.file ? a.since(s, cursor) : undefined;
      const read = s.file ? readAsksFrom(agentOf(s.tool), s.file, cursor, 1) : undefined;
      setCursor(id, words?.next ?? read!.next);
      const root = s.cwd ?? this.root;
      for (const c of conns) {
        const to = this.byId.get(c.to.id)?.cwd ?? c.to.cwd;
        const elsewhere = !!(to && root && !sameFolder(to, root));
        const text =
          c.level === "full" || !read
            ? words && buildUpdate(words.messages, words.files, root, s.tool, elsewhere)
            : read.asks.length
              ? renderAsks(read.asks, c.level ?? "ping", { root, absolute: elsewhere })
              : undefined;
        if (text) appendInbox(c.to.id, { connectionId: c.id, from: this.ref(c.from), at: now, kind: "update", text });
      }
    }
  }

  private notifyWaiting(sessions: ChatSession[]): void {
    for (const s of sessions) {
      const before = this.lastStatus.get(s.id);
      this.lastStatus.set(s.id, s.status);
      if (this.firstLoad || s.status !== "waiting" || before === "waiting") continue;
      void vscode.window.showInformationMessage(`“${s.title}” is waiting for you${s.lastLine ? `: ${s.lastLine}` : ""}`, "Open").then((pick) => {
        if (pick) void this.opener.open(s.id);
      });
    }
    this.firstLoad = false;
  }

  /** Watches the folders chats are written to, so cards change as the chats do. */
  private rewatch(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    const root = this.root;
    const targets = [statusDir(), airbandFile("inbox")];
    if (root) targets.push(fs.existsSync(claudeProjectFolder(root)) ? claudeProjectFolder(root) : claudeProjectsDir());
    for (const dir of targets) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        this.watchers.push(fs.watch(dir, () => this.refreshSoon()));
      } catch {
        // The poll still keeps the list current.
      }
    }
    // Another window asking this one to open a chat of this folder.
    try {
      fs.mkdirSync(airbandHome(), { recursive: true });
      this.watchers.push(fs.watch(airbandHome(), (_e, name) => name === "open-requests.json" && void this.opener.takeOpens()));
    } catch {
      // Requests are also checked after every refresh.
    }
    this.refreshSoon(0);
  }

  // ---- requests from the views ----

  private async handle(m: FromWebview, from: vscode.Webview): Promise<void> {
    try {
      switch (m.type) {
        case "ready":
          this.post({ type: "state", state: this.state }, from);
          this.refreshSoon(0);
          return;
        case "refresh":
          return this.refresh();
        case "open":
          return this.opener.open(m.id);
        case "openInFolder":
          return this.opener.openInFolder(m.id);
        case "openInTerminal":
          return this.opener.openTerminal(m.id);
        case "newChat":
          return this.opener.newChat(m.tool);
        case "openBoard":
          return this.openBoard(m.tab);
        case "setup":
          return this.turnOn();
        case "connect":
          return this.connect(m.from, m.to, !!m.both, from);
        case "connectMany":
          if (m.handles) this.boardStore().update((b) => (b.handles = { ...(b.handles ?? {}), ...m.handles }));
          return this.connectMany(m.pairs, from);
        case "disconnect":
          this.unlink([m.connectionId], from);
          return this.refresh();
        case "disconnectMany":
          this.unlink(m.ids, from);
          return this.refresh();
        case "direction":
          return this.direction(m.a, m.b, m.want, from);
        case "pause": {
          setPaused(m.connectionId, m.paused);
          const c = readConnections().find((x) => x.id === m.connectionId);
          if (c) {
            this.notice(c.to.id, c.from, m.paused ? `Paused: updates from “${c.from.title}” stop until resumed.` : `Resumed: updates from “${c.from.title}” come again.`, `pause:${c.id}`);
            this.toast(`${shortTitle(this.ref(c.from).title)} → ${shortTitle(this.ref(c.to).title)}`, "ok", from, {
              title: m.paused ? "Paused" : "Resumed",
              icon: m.paused ? "pause" : "play",
              undo: { type: "pause", connectionId: c.id, paused: !m.paused },
            });
          }
          return this.refresh();
        }
        case "syncNow":
          return this.syncNow(m.id);
        case "plans":
          return void this.plansService.refresh(true);
        case "codeMap":
          return void this.mapPage.send(from, m.rebuild, m.root);
        case "codeMapFolder":
          return void this.mapPage.mapAnotherFolder(from);
        case "codeFind":
          return this.mapPage.find(m.q, m.root, from);
        case "codeModule":
          return this.mapPage.module(m.id, m.root, from);
        case "openFile":
          return this.mapPage.openFile(m.path, m.line, m.root);
        case "moduleDoc":
          return void this.mapPage.moduleDoc(m.id, m.action, from, m.root);
        case "library":
        case "librarySuggest":
        case "libraryRun":
        case "libraryCopy":
        case "libraryOpen":
        case "libraryNew":
          return libraryMessage(m, (msg) => this.post(msg, from));
        case "setUpToolkit":
          await this.setup.setUpToolkit();
          return this.post({ type: "library", data: libraryView() }, from);
        case "writing":
          return this.post({ type: "writing", data: writingView() }, from);
        case "writingSet": {
          await setWriting(m.key, m.on);
          return this.post({ type: "writing", data: writingView() }, from);
        }
        case "writingAiCredit":
          setClaudeAiCredit(m.show);
          return this.post({ type: "writing", data: writingView() }, from);
        case "fullscreen":
          return this.fullscreen();
        case "askBranch":
          return this.askBranch(m.id, from);
        case "branch":
          return this.branch(m, from);
        case "peek":
          return this.peek(m.id, from);
        case "boardAdd":
          this.boardStore().update((b) => {
            if (!b.members.includes(m.id)) b.members.push(m.id);
            if (m.x !== undefined && m.y !== undefined) b.positions[m.id] = { x: Math.round(m.x), y: Math.round(m.y) };
          });
          // From the sidebar, show the board with the chat on it.
          if (m.open) this.openBoard("board");
          return this.refresh();
        case "boardRemove":
          this.boardStore().update((b) => (b.members = b.members.filter((id) => id !== m.id)));
          return this.refresh();
        case "move":
          this.boardStore().update((b) => (b.positions[m.id] = { x: Math.round(m.x), y: Math.round(m.y) }));
          this.state.board.positions[m.id] = { x: m.x, y: m.y };
          return;
        case "boardClear": {
          const before = this.boardStore().read();
          if (!before.members.length) return;
          this.boardStore().update((b) => {
            b.members = [];
            b.positions = {};
            b.seeded = true;
          });
          this.toast(`${before.members.length} card${before.members.length === 1 ? "" : "s"} taken off. Add chats back from the list, a folder at a time or one by one.`, "ok", from, {
            title: "Tower cleared",
            icon: "info",
            undo: { type: "boardRestore", members: before.members, positions: before.positions },
          });
          return this.refresh();
        }
        case "boardRestore":
          this.boardStore().update((b) => {
            b.members = [...new Set([...m.members, ...b.members])];
            b.positions = { ...m.positions, ...b.positions };
          });
          return this.refresh();
        case "linkLevel":
          setLevel(m.ids, m.level);
          return this.refresh();
        case "viewport":
          // Kept quietly: nothing else on screen depends on it.
          this.boardStore().update((b) => (b.viewport = m.viewport));
          this.state.board.viewport = m.viewport;
          return;
        case "boardArrange":
          this.boardStore().update((b) => (b.arrange = m.arrange));
          return this.refresh();
        case "scope":
          // Every folder in the sidebar: the board groups by folder too; back to this folder: by links.
          this.boardStore().update((b) => (b.arrange = m.scope === "all" ? "folder" : "links"));
          return this.refresh();
        case "arrange":
          // Every card placed stays on the board (a drag in "By time" keeps all the chats it showed).
          this.boardStore().update((b) => {
            Object.assign(b.positions, m.positions);
            for (const id of Object.keys(m.positions)) if (!b.members.includes(id)) b.members.push(id);
          });
          return this.refresh();
      }
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), "warn", from);
    }
  }

  session(id: string): ChatSession {
    const s = this.byId.get(id);
    if (!s) throw new Error("That chat isn't in the list any more. Refresh and try again.");
    return s;
  }

  private boardStore(): BoardStore {
    return new BoardStore(this.requireRoot());
  }

  private async digest(s: ChatSession): Promise<ChatDigest> {
    const d = await this.adapter(s.tool).read(s, this.requireRoot());
    this.digests.set(s.id, d);
    return d;
  }

  takeForPaste(id: string): string | undefined {
    const items = takeInbox(id);
    if (!items.length) return undefined;
    const now = Date.now();
    for (const i of items) logDelivery({ at: now, connectionId: i.connectionId, from: i.from.id, to: id, chars: i.text.length });
    this.refreshSoon();
    return formatDelivery(items, undefined, this.byId.get(id)?.cwd);
  }

  private async connect(fromId: string, toId: string, both: boolean, view: vscode.Webview): Promise<void> {
    const pairs: [string, string][] = both ? [[fromId, toId], [toId, fromId]] : [[fromId, toId]];
    return this.connectMany(pairs, view);
  }

  /** Links every pair (from → to): one-to-one, one-to-many, many-to-one or every way. */
  private async connectMany(pairs: [string, string][], view: vscode.Webview, quiet = false): Promise<void> {
    const wanted = pairs.filter(([a, b]) => a !== b && this.byId.has(a) && this.byId.has(b));
    if (!wanted.length) return;
    // The link is saved and drawn at once. What the other chat has done so far (which can mean
    // reading a conversation of a gigabyte) follows in the background, before its next message.
    const fresh: { from: ChatSession; to: ChatSession; connectionId: string }[] = [];
    for (const [a, b] of wanted) {
      const from = this.session(a);
      const to = this.session(b);
      const isNew = !readConnections().some((c) => c.from.id === from.id && c.to.id === to.id);
      const { connection } = addConnection(this.ref(from), this.ref(to));
      if (isNew) fresh.push({ from, to, connectionId: connection.id });
      // Updates start from now: the past goes in the context. (A chat already sharing elsewhere keeps
      // its bookmark, so what it owes those chats isn't skipped.)
      const sharingElsewhere = readConnections().some((c) => c.from.id === from.id && c.to.id !== to.id && !c.paused);
      if (getCursor(from.id) === undefined || (isNew && !sharingElsewhere)) setCursor(from.id, this.adapter(from.tool).end(from));
    }
    this.boardStore().add([...new Set(wanted.flat())]);
    // Started once the line is drawn: reading a big chat's record must not hold up the board.
    if (fresh.length) setTimeout(() => void this.sendContexts(fresh, wanted), 250);
    // A link only works by itself with auto-sharing on: ask now, rather than leave a hint.
    if (wanted.some(([, b]) => !this.setup.hooked(this.session(b).tool))) {
      await this.turnOn();
      this.state.hooksOn = Object.values(this.setup.hookState()).every(Boolean);
    }
    if (!quiet) {
      const [[a0, b0]] = wanted;
      const from = this.session(a0);
      const to = this.session(b0);
      const twoWay = wanted.length === 2 && wanted[1][0] === b0 && wanted[1][1] === a0;
      const what = wanted.length === 1 ? `${shortTitle(from.title)} → ${shortTitle(to.title)}` : twoWay ? `${shortTitle(from.title)} ⇄ ${shortTitle(to.title)}` : `${fresh.length || wanted.length} chats`;
      const created = readConnections().filter((c) => wanted.some(([x, y]) => c.from.id === x && c.to.id === y));
      this.toast(what, "ok", view, { title: twoWay ? "Channel open both ways" : wanted.length > 2 ? "Channels open" : "Channel open", icon: "link", undo: { type: "disconnectMany", ids: created.map((c) => c.id) } });
      // Quietly, the caller has more to change first and shows the result once.
      await this.refresh();
    }
  }

  /** A chat's record, caught up (a big chat is read a slice at a time, without holding anything up). */
  private async ensureRecord(s: ChatSession): Promise<void> {
    if (!s.file) return;
    await catchUpRecord(s.id, agentOf(s.tool), s.file, { cwd: s.cwd, title: s.title });
    setRecordTitle(s.id, s.title, s.cwd);
  }

  private async sendContexts(fresh: { from: ChatSession; to: ChatSession; connectionId: string }[], wanted: [string, string][]): Promise<void> {
    for (const { from, to, connectionId } of fresh) {
      try {
        const link = readConnections().find((c) => c.id === connectionId);
        if (!link) continue;
        // Linked before: only what is new since it last reached that chat.
        const last = readDeliveries().filter((d) => d.from === from.id && d.to === to.id).pop();
        const text = await this.contextFor(from, { forFolder: to.cwd, level: link.level ?? "ping", since: last?.at });
        if (!readConnections().some((c) => c.id === connectionId)) continue;
        appendInbox(to.id, { connectionId, from: this.ref(from), at: Date.now(), kind: "context", text });
        // The sharing chat is told too, unless the other way already gives it the full context.
        if (!wanted.some(([x, y]) => x === to.id && y === from.id)) this.notice(from.id, this.ref(to), `Channel open: this chat’s work now goes to “${to.title}” after each reply.`, `${from.id}>${to.id}`);
      } catch {
        // The link works without it: updates still flow from the next reply.
      }
    }
    this.refreshSoon(0);
  }

  private async askBranch(id: string, view: vscode.Webview): Promise<void> {
    const s = this.session(id);
    await this.ensureRecord(s);
    // The asks to bring along come from the chat's record: no need to read its whole conversation.
    const asks = readAsks(s.id, 25)
      .reverse()
      .map((a) => ({ id: String(a.n), text: a.ask.replace(/\s+/g, " ").trim().slice(0, 180) }));
    const contextChars = (await this.contextFor(s)).length;
    this.post({ type: "branchInfo", id, title: s.title, tool: s.tool, asks, contextChars }, view);
  }

  private async branch(m: Extract<FromWebview, { type: "branch" }>, view: vscode.Webview): Promise<void> {
    const root = this.requireRoot();
    const s = this.session(m.from);
    const task = m.task.trim();
    if (!task) throw new Error("Say what the new chat should do.");
    const parts: string[] = [];
    if (m.withContext) parts.push(await this.contextFor(s));
    const wanted = new Set(m.askIds);
    const brought = readAsks(s.id)
      .filter((a) => wanted.has(String(a.n)))
      .map((a) => `• Asked: ${a.ask.replace(/\s+/g, " ").trim()}\n  Done: ${a.did}${a.open ? `\n  Open: ${a.open}` : ""}`);
    if (brought.length) parts.push(`Earlier in that chat:\n${brought.join("\n")}`);
    const context = parts.join("\n\n");

    if (m.keepConnected && getCursor(s.id) === undefined) setCursor(s.id, this.adapter(s.tool).end(s));
    const title = task.split("\n")[0].slice(0, 60);
    // The new chat is a Claude Code chat: what matters is Claude's hook.
    if (this.setup.hooked("Claude")) {
      // The new chat opens in this window's folder, wherever the old one lives.
      addPending({ id: randomBytes(6).toString("hex"), from: this.ref(s), title, cwd: root, at: Date.now(), taskStart: task, context, keepConnected: m.keepConnected });
      await openClaude(undefined, task);
      this.toast(`New chat opened with your task. Press Send and it gets “${s.title}”’s context with it.`, "ok", view);
    } else {
      const prompt = context ? `${task}\n\n---\n${formatDelivery([{ from: this.ref(s), at: Date.now(), kind: "context", text: context }])}` : task;
      await openClaude(undefined, prompt);
      this.toast("New chat opened with your task and the context. Turn on auto-sharing to keep them connected.", "warn", view);
    }
  }

  /** A chat's conversation for another chat, and a readable copy of all of it in ~/.airband/chats. */
  /**
   * What a chat is told about another, on linking or when a new chat starts from it: that chat's
   * record (what it set out to do and its latest asks), or at "full" its own words up to the size
   * setting. `since`: a link made again only tells what is new.
   */
  private async contextFor(s: ChatSession, opts: { forFolder?: string; level?: LinkLevel; since?: number } = {}): Promise<string> {
    const root = s.cwd ?? this.root;
    const absolute = !!(opts.forFolder && root && !sameFolder(opts.forFolder, root));
    if (opts.level !== "full") {
      await this.ensureRecord(s);
      const text = recordContext(s.id, s.title, { root, absolute, since: opts.since });
      if (text) return text;
    }
    const d = await this.digest(s);
    const budget = CONTEXT_BUDGET[opts.level === "full" ? contextSize() : "compact"];
    return buildContext({ from: this.ref(s), digest: d, root, absolute, budget, pointer: s.file ? recordPointer(s.id, s.title) : undefined });
  }

  /** A short note about a link change, delivered with the chat's next message. */
  private notice(chatId: string, about: ChatRef, text: string, topic?: string): void {
    appendInbox(chatId, { from: this.ref(about), at: Date.now(), kind: "notice", text, topic });
  }

  /** One click: open the chat ready to catch up; its next message brings everything waiting. */
  private async syncNow(id: string): Promise<void> {
    const s = this.session(id);
    const ask = "Catch up on what my connected chats did, then tell me in a few lines what changed.";
    if (s.tool !== "Claude" || s.away) return this.opener.open(id);
    if (this.setup.hooked("Claude")) {
      await openClaude(id, ask);
      this.toast(`Press Send in ${shortTitle(s.title)}`, "ok", undefined, { title: "Ready to sync", icon: "sync" });
    } else {
      const waiting = this.takeForPaste(id);
      await openClaude(id, waiting ? `${ask}\n\n${waiting}` : ask);
    }
  }

  private focusOn = false;

  /** Focus: the board gets the whole window (side panels hidden); again to bring them back. */
  private async fullscreen(): Promise<void> {
    this.openBoard("board");
    const run = async (...ids: string[]) => {
      for (const id of ids) {
        try {
          await vscode.commands.executeCommand(id);
        } catch {
          // A command this VS Code lacks is skipped.
        }
      }
    };
    if (!this.focusOn) {
      await run("workbench.action.closeSidebar", "workbench.action.closeAuxiliaryBar", "workbench.action.closePanel");
      this.focusOn = true;
    } else {
      await run("workbench.action.toggleSidebarVisibility", "workbench.action.toggleAuxiliaryBar");
      this.focusOn = false;
    }
    this.board?.reveal();
    this.state.focus = this.focusOn;
    this.post({ type: "state", state: this.state });
  }

  private peek(id: string, view: vscode.Webview): void {
    const s = this.session(id);
    const items = readInbox(id);
    const text = items.length ? formatDelivery(items, undefined, this.byId.get(id)?.cwd) : "Nothing is on its way to this chat.";
    this.post({ type: "peek", id, title: s.title, text }, view);
  }

  private requireRoot(): string {
    if (!this.root) throw new Error("Open a folder first.");
    return this.root;
  }

    /** Offers auto-sharing once, the first time Airband runs without it. */
  offerSetupOnce(): Promise<void> {
    return this.setup.offerOnce();
  }

  turnOn(): Promise<void> {
    return this.setup.turnOn();
  }

  turnOff(): void {
    this.setup.turnOff();
  }

  /** The code map service from the extension, shared so the folder is mapped once. */
  useCodeMaps(service: { mapFor(root: string): CodeMap | undefined }): void {
    this.mapPage.useCodeMaps(service);
  }

  setUpToolkit(): Promise<void> {
    return this.setup.setUpToolkit();
  }

  removeToolkit(): Promise<void> {
    return this.setup.removeToolkit();
  }

  addNotesTools(): Promise<void> {
    return this.setup.setUpToolkit();
  }

  newChatCommand(): Promise<void> {
    return this.opener.newChat("Claude");
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    for (const w of this.watchers) w.close();
    for (const d of this.disposables) d.dispose();
    this.board?.dispose();
  }
}
