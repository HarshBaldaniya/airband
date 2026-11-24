// The extension's centre: keeps the list of chats (from every tool) current,
// answers the webviews, and turns their requests (connect, branch, open) into
// connections, context and chats.
import * as vscode from "vscode";
import * as fs from "node:fs";
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
import { readConnections, setPaused, setLevel } from "../sharing/connections";
import { readInbox } from "../sharing/inbox";
import { readDeliveries } from "../sharing/deliveries";
import { addUsage } from "../core/types";
import type { ChatRef, ChatSession, Status } from "../core/types";
import type { Tool } from "../core/agents";
import { NO_USAGE } from "../core/types";
import { isTempFolder, pickElsewhere, unregisterWindow } from "../core/folders";
import { sameFolder } from "../core/paths";
import { HOOK_START_MAX, HOOK_STEP_MAX, readHead, setRecordTitle } from "../sessions/record/store";
import { catchUpRecord, recordBehind } from "../sessions/record/update";
import { agentOf } from "../core/agents";
import { setClaudeAiCredit } from "../install/agent-hooks";
import { claudeExtensionInstalled } from "./open";
import { webviewHtml } from "./webview-html";
import { PlansService } from "./plans-service";
import { SetupService } from "./setup-service";
import { libraryMessage } from "./library-page";
import { MapPageService } from "./map-page";
import { ChatOpener } from "./chat-opener";
import { Sharing } from "./sharing";
import { setWriting, syncConfig, writingView } from "./settings";

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
  readonly sharing = new Sharing(this);

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

    this.sharing.pumpQuietSources();

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
  ref(r: ChatRef): ChatRef {
    const s = this.byId.get(r.id);
    return s ? { id: s.id, tool: s.tool, title: s.title, cwd: s.cwd ?? r.cwd } : r;
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
          return this.sharing.connect(m.from, m.to, !!m.both, from);
        case "connectMany":
          if (m.handles) this.boardStore().update((b) => (b.handles = { ...(b.handles ?? {}), ...m.handles }));
          return this.sharing.connectMany(m.pairs, from);
        case "disconnect":
          this.sharing.unlink([m.connectionId], from);
          return this.refresh();
        case "disconnectMany":
          this.sharing.unlink(m.ids, from);
          return this.refresh();
        case "direction":
          return this.sharing.direction(m.a, m.b, m.want, from);
        case "pause": {
          setPaused(m.connectionId, m.paused);
          const c = readConnections().find((x) => x.id === m.connectionId);
          if (c) {
            this.sharing.notice(c.to.id, c.from, m.paused ? `Paused: updates from “${c.from.title}” stop until resumed.` : `Resumed: updates from “${c.from.title}” come again.`, `pause:${c.id}`);
            this.toast(`${shortTitle(this.ref(c.from).title)} → ${shortTitle(this.ref(c.to).title)}`, "ok", from, {
              title: m.paused ? "Paused" : "Resumed",
              icon: m.paused ? "pause" : "play",
              undo: { type: "pause", connectionId: c.id, paused: !m.paused },
            });
          }
          return this.refresh();
        }
        case "syncNow":
          return this.sharing.syncNow(m.id);
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
          return this.sharing.askBranch(m.id, from);
        case "branch":
          return this.sharing.branch(m, from);
        case "peek":
          return this.sharing.peek(m.id, from);
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

  boardStore(): BoardStore {
    return new BoardStore(this.requireRoot());
  }

  /** A chat's record, caught up (a big chat is read a slice at a time, without holding anything up). */
  async ensureRecord(s: ChatSession): Promise<void> {
    if (!s.file) return;
    await catchUpRecord(s.id, agentOf(s.tool), s.file, { cwd: s.cwd, title: s.title });
    setRecordTitle(s.id, s.title, s.cwd);
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

  requireRoot(): string {
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
