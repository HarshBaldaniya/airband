// The extension's centre: it starts each service, owns the views (the sidebar and the board),
// and builds the state they show on every refresh. Each request from a view goes through the
// message router to the service that answers it.
import * as vscode from "vscode";
import type { BoardTab, ConnectionView, FromWebview, ToWebview, ViewState } from "./protocol";
import { CodeMap } from "../codemap/index";
import { BoardStore } from "../core/state";
import { readConnections } from "../sharing/connections";
import { readInbox } from "../sharing/inbox";
import { readDeliveries } from "../sharing/deliveries";
import { unregisterWindow } from "../core/folders";
import { claudeExtensionInstalled } from "./open";
import { webviewHtml } from "./webview-html";
import { PlansService } from "./plans-service";
import { SetupService } from "./setup-service";
import { MapPageService } from "./map-page";
import { ChatIndex } from "./chat-index";
import { ChatOpener } from "./chat-opener";
import { Sharing } from "./sharing";
import { route } from "./message-router";
import { syncConfig } from "./settings";

const POLL_MS = 10_000;

export class Controller implements vscode.Disposable {
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
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private again = false;

  readonly chats = new ChatIndex(this);
  readonly setup = new SetupService(this);
  readonly plans = new PlansService(this);
  readonly mapPage = new MapPageService(this);
  readonly opener = new ChatOpener(this);
  readonly sharing = new Sharing(this);

  constructor(readonly ctx: vscode.ExtensionContext) {
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => (this.chats.rewatch(), this.opener.noteWindow())));
    // A note of this window's folders, so the desktop app opens a chat here when its folder is open.
    this.opener.noteWindow();
    const note = setInterval(() => this.opener.noteWindow(), 60_000);
    this.disposables.push({ dispose: () => (clearInterval(note), unregisterWindow()) });
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("airband") && syncConfig()));
    this.setup.moveFromOldNames();
    this.setup.keepHookCurrent();
    this.setup.tidyStorage();
    syncConfig();
    this.chats.rewatch();
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
    const sub = webview.onDidReceiveMessage((m: FromWebview) => route(this, m, webview));
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

    const { present, mine, sessions, totals, errors } = await this.chats.list(root);

    this.sharing.pumpQuietSources();

    const deliveries = readDeliveries();
    const connections: ConnectionView[] = readConnections()
      .filter((c) => this.chats.byId.has(c.from.id) || this.chats.byId.has(c.to.id))
      .map((c) => {
        // Only what this link has sent: not what an earlier link between the same chats sent.
        const mine = deliveries.filter((d) => d.at >= c.createdAt && (d.connectionId === c.id || (!d.connectionId && d.from === c.from.id && d.to === c.to.id)));
        return {
          ...c,
          from: this.chats.ref(c.from),
          to: this.chats.ref(c.to),
          updates: mine.length,
          chars: mine.reduce((n, d) => n + d.chars, 0),
          lastAt: mine.length ? mine[mine.length - 1].at : undefined,
        };
      });

    const inbox: ViewState["inbox"] = {};
    for (const s of sessions) {
      const items = readInbox(s.id).filter((i) => i.kind !== "notice");
      if (items.length) inbox[s.id] = { count: items.length, chars: items.reduce((n, i) => n + i.text.length, 0), from: [...new Set(items.map((i) => this.chats.ref(i.from).title))] };
    }

    const store = new BoardStore(root);
    let board = store.read();
    // A new board starts with the chats that matter (linked, busy, the newest few) — once. An empty
    // board after that is one the person cleared, and stays empty until they add chats.
    if (!board.seeded && !board.members.length && sessions.length) {
      const linked = connections.flatMap((c) => [c.from.id, c.to.id]);
      const busy = mine.filter((s) => s.status === "working" || s.status === "waiting").map((s) => s.id);
      const recent = mine.slice(0, 5).map((s) => s.id);
      store.add([...linked, ...busy, ...recent].filter((id) => this.chats.byId.has(id)));
      board = store.update((b) => (b.seeded = true));
    } else if (!board.seeded && board.members.length) {
      board = store.update((b) => (b.seeded = true));
    }

    this.chats.notifyWaiting(sessions);
    this.plans.follow();
    void this.plans.refresh();
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
      plans: this.plans.current,
      plansLoading: this.plans.loading,
      loading: false,
      error: errors.length ? `Some chats couldn't be read (${errors.join("; ")})` : undefined,
    };
    this.post({ type: "state", state: this.state });
    void this.opener.takeOpens();
    this.chats.afterLoad();
  }

  boardStore(): BoardStore {
    return new BoardStore(this.requireRoot());
  }

  private focusOn = false;

  /** Focus: the board gets the whole window (side panels hidden); again to bring them back. */
  async fullscreen(): Promise<void> {
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
    this.chats.dispose();
    for (const d of this.disposables) d.dispose();
    this.board?.dispose();
  }
}
