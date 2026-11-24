// Channels between chats: opening and closing them, which way they share, what a chat is told about
// another on connecting, the notes about a change, and the updates sent from chats that have no
// hook. Also New task: a new chat that starts with another's context.
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { agentOf } from "../core/agents";
import { CONTEXT_BUDGET } from "../core/config";
import { sameFolder } from "../core/paths";
import type { FromWebview } from "../core/protocol";
import type { ChatDigest, ChatRef, ChatSession, Connection } from "../core/types";
import { HOOK_STEP_MAX, readAsks } from "../sessions/record/store";
import { readAsksFrom } from "../sessions/record/extract";
import { recordContext, recordPointer, renderAsks, type LinkLevel } from "../sessions/record/render";
import { addConnection, readConnections, removeConnection } from "../sharing/connections";
import { getCursor, setCursor } from "../sharing/cursors";
import { logDelivery, readDeliveries } from "../sharing/deliveries";
import { buildContext, buildUpdate, formatDelivery } from "../sharing/delivery";
import { appendInbox, readInbox, takeInbox } from "../sharing/inbox";
import { addPending } from "../sharing/pending";
import type { Controller } from "./controller";
import { openClaude } from "./open";
import { shortTitle } from "./pages";
import { contextSize } from "./settings";

/** A non-Claude chat quiet this long has finished its reply: its update can go out. */
const QUIET_MS = 15_000;
/** A new channel's context is read once its line is drawn: a big chat's record must not hold up the board. */
const CONTEXT_AFTER_MS = 250;

export class Sharing {
  private readonly digests = new Map<string, ChatDigest>();

  constructor(private readonly app: Controller) {}

  async connect(fromId: string, toId: string, both: boolean, view: vscode.Webview): Promise<void> {
    const pairs: [string, string][] = both ? [[fromId, toId], [toId, fromId]] : [[fromId, toId]];
    return this.connectMany(pairs, view);
  }

  /** Links every pair (from → to): one-to-one, one-to-many, many-to-one or every way. */
  async connectMany(pairs: [string, string][], view: vscode.Webview, quiet = false): Promise<void> {
    const wanted = pairs.filter(([a, b]) => a !== b && this.app.chats.byId.has(a) && this.app.chats.byId.has(b));
    if (!wanted.length) return;
    // The link is saved and drawn at once. What the other chat has done so far (which can mean
    // reading a conversation of a gigabyte) follows in the background, before its next message.
    const fresh: { from: ChatSession; to: ChatSession; connectionId: string }[] = [];
    for (const [a, b] of wanted) {
      const from = this.app.chats.session(a);
      const to = this.app.chats.session(b);
      const isNew = !readConnections().some((c) => c.from.id === from.id && c.to.id === to.id);
      const { connection } = addConnection(this.app.chats.ref(from), this.app.chats.ref(to));
      if (isNew) fresh.push({ from, to, connectionId: connection.id });
      // Updates start from now: the past goes in the context. (A chat already sharing elsewhere keeps
      // its bookmark, so what it owes those chats isn't skipped.)
      const sharingElsewhere = readConnections().some((c) => c.from.id === from.id && c.to.id !== to.id && !c.paused);
      if (getCursor(from.id) === undefined || (isNew && !sharingElsewhere)) setCursor(from.id, this.app.chats.adapter(from.tool).end(from));
    }
    this.app.boardStore().add([...new Set(wanted.flat())]);
    // Started once the line is drawn: reading a big chat's record must not hold up the board.
    if (fresh.length) setTimeout(() => void this.sendContexts(fresh, wanted), CONTEXT_AFTER_MS);
    // A link only works by itself with auto-sharing on: ask now, rather than leave a hint.
    if (wanted.some(([, b]) => !this.app.setup.hooked(this.app.chats.session(b).tool))) {
      await this.app.setup.turnOn();
      this.app.state.hooksOn = Object.values(this.app.setup.hookState()).every(Boolean);
    }
    if (!quiet) {
      const [[a0, b0]] = wanted;
      const from = this.app.chats.session(a0);
      const to = this.app.chats.session(b0);
      const twoWay = wanted.length === 2 && wanted[1][0] === b0 && wanted[1][1] === a0;
      const what = wanted.length === 1 ? `${shortTitle(from.title)} → ${shortTitle(to.title)}` : twoWay ? `${shortTitle(from.title)} ⇄ ${shortTitle(to.title)}` : `${fresh.length || wanted.length} chats`;
      const created = readConnections().filter((c) => wanted.some(([x, y]) => c.from.id === x && c.to.id === y));
      this.app.toast(what, "ok", view, { title: twoWay ? "Channel open both ways" : wanted.length > 2 ? "Channels open" : "Channel open", icon: "link", undo: { type: "disconnectMany", ids: created.map((c) => c.id) } });
      // Quietly, the caller has more to change first and shows the result once.
      await this.app.refresh();
    }
  }

  /**
   * What each newly linked chat has done so far, for the chat it now shares with: read one chat at a
   * time, and only delivered if the link is still there (it may have been undone meanwhile).
   */
  private async sendContexts(fresh: { from: ChatSession; to: ChatSession; connectionId: string }[], wanted: [string, string][]): Promise<void> {
    for (const { from, to, connectionId } of fresh) {
      try {
        const link = readConnections().find((c) => c.id === connectionId);
        if (!link) continue;
        // Linked before: only what is new since it last reached that chat.
        const last = readDeliveries().filter((d) => d.from === from.id && d.to === to.id).pop();
        const text = await this.contextFor(from, { forFolder: to.cwd, level: link.level ?? "ping", since: last?.at });
        if (!readConnections().some((c) => c.id === connectionId)) continue;
        appendInbox(to.id, { connectionId, from: this.app.chats.ref(from), at: Date.now(), kind: "context", text });
        // The sharing chat is told too, unless the other way already gives it the full context.
        if (!wanted.some(([x, y]) => x === to.id && y === from.id)) this.notice(from.id, this.app.chats.ref(to), `Channel open: this chat’s work now goes to “${to.title}” after each reply.`, `${from.id}>${to.id}`);
      } catch {
        // The link works without it: updates still flow from the next reply.
      }
    }
    this.app.refreshSoon(0);
  }

  /** Unlinks, tells both chats (with their next message), and offers Undo. */
  unlink(ids: string[], view: vscode.Webview, quiet = false): Connection[] {
    const gone: Connection[] = [];
    for (const id of ids) {
      const c = removeConnection(id);
      if (!c) continue;
      gone.push(c);
      this.notice(c.to.id, c.from, `Channel from “${c.from.title}” closed: no more updates will come from it.`, `${c.from.id}>${c.to.id}`);
      this.notice(c.from.id, c.to, `No longer sharing this chat’s work with “${c.to.title}”.`, `${c.from.id}>${c.to.id}`);
    }
    if (gone.length && !quiet) {
      const names = [...new Set(gone.flatMap((c) => [this.app.chats.ref(c.from).title, this.app.chats.ref(c.to).title]))];
      this.app.toast(
        names.length === 2 ? `${shortTitle(names[0])} · ${shortTitle(names[1])}` : `${gone.length} channels`,
        "ok",
        view,
        { title: "Channel closed", icon: "unlink", undo: { type: "connectMany", pairs: gone.map((c) => [c.from.id, c.to.id]) } },
      );
    }
    return gone;
  }

  /** Sets which way two linked chats share: both ways, a → b, or b → a. */
  async direction(a: string, b: string, want: "both" | "ab" | "ba", view: vscode.Webview): Promise<void> {
    const all = readConnections();
    const ab = all.find((c) => c.from.id === a && c.to.id === b);
    const ba = all.find((c) => c.from.id === b && c.to.id === a);
    const add: [string, string][] = [];
    if ((want === "both" || want === "ab") && !ab) add.push([a, b]);
    if ((want === "both" || want === "ba") && !ba) add.push([b, a]);
    const remove = [want === "ba" ? ab?.id : undefined, want === "ab" ? ba?.id : undefined].filter((x): x is string => !!x);
    if (add.length) await this.connectMany(add, view, true);
    if (remove.length) this.unlink(remove, view, true);
    const A = this.app.chats.session(a).title;
    const B = this.app.chats.session(b).title;
    const text = want === "both" ? `${shortTitle(A)} ⇄ ${shortTitle(B)}` : want === "ab" ? `${shortTitle(A)} → ${shortTitle(B)}` : `${shortTitle(B)} → ${shortTitle(A)}`;
    this.app.toast(text, "ok", view, { title: want === "both" ? "Both ways" : "One way", icon: "link" });
    await this.app.refresh();
  }

  /** A chat's conversation for another chat, and a readable copy of all of it in ~/.airband/chats. */
  /**
   * What a chat is told about another, on linking or when a new chat starts from it: that chat's
   * record (what it set out to do and its latest asks), or at "full" its own words up to the size
   * setting. `since`: a link made again only tells what is new.
   */
  async contextFor(s: ChatSession, opts: { forFolder?: string; level?: LinkLevel; since?: number } = {}): Promise<string> {
    const root = s.cwd ?? this.app.root;
    const absolute = !!(opts.forFolder && root && !sameFolder(opts.forFolder, root));
    if (opts.level !== "full") {
      await this.app.chats.ensureRecord(s);
      const text = recordContext(s.id, s.title, { root, absolute, since: opts.since });
      if (text) return text;
    }
    const d = await this.digest(s);
    const budget = CONTEXT_BUDGET[opts.level === "full" ? contextSize() : "compact"];
    return buildContext({ from: this.app.chats.ref(s), digest: d, root, absolute, budget, pointer: s.file ? recordPointer(s.id, s.title) : undefined });
  }

  private async digest(s: ChatSession): Promise<ChatDigest> {
    const d = await this.app.chats.adapter(s.tool).read(s, this.app.requireRoot());
    this.digests.set(s.id, d);
    return d;
  }

  /** A short note about a link change, delivered with the chat's next message. */
  notice(chatId: string, about: ChatRef, text: string, topic?: string): void {
    appendInbox(chatId, { from: this.app.chats.ref(about), at: Date.now(), kind: "notice", text, topic });
  }

  takeForPaste(id: string): string | undefined {
    const items = takeInbox(id);
    if (!items.length) return undefined;
    const now = Date.now();
    for (const i of items) logDelivery({ at: now, connectionId: i.connectionId, from: i.from.id, to: id, chars: i.text.length });
    this.app.refreshSoon();
    return formatDelivery(items, undefined, this.app.chats.byId.get(id)?.cwd);
  }

  /** One click: open the chat ready to catch up; its next message brings everything waiting. */
  async syncNow(id: string): Promise<void> {
    const s = this.app.chats.session(id);
    const ask = "Catch up on what my connected chats did, then tell me in a few lines what changed.";
    if (s.tool !== "Claude" || s.away) return this.app.opener.open(id);
    if (this.app.setup.hooked("Claude")) {
      await openClaude(id, ask);
      this.app.toast(`Press Send in ${shortTitle(s.title)}`, "ok", undefined, { title: "Ready to sync", icon: "sync" });
    } else {
      const waiting = this.takeForPaste(id);
      await openClaude(id, waiting ? `${ask}\n\n${waiting}` : ask);
    }
  }

  peek(id: string, view: vscode.Webview): void {
    const s = this.app.chats.session(id);
    const items = readInbox(id);
    const text = items.length ? formatDelivery(items, undefined, this.app.chats.byId.get(id)?.cwd) : "Nothing is on its way to this chat.";
    this.app.post({ type: "peek", id, title: s.title, text }, view);
  }

  async askBranch(id: string, view: vscode.Webview): Promise<void> {
    const s = this.app.chats.session(id);
    await this.app.chats.ensureRecord(s);
    // The asks to bring along come from the chat's record: no need to read its whole conversation.
    const asks = readAsks(s.id, 25)
      .reverse()
      .map((a) => ({ id: String(a.n), text: a.ask.replace(/\s+/g, " ").trim().slice(0, 180) }));
    const contextChars = (await this.contextFor(s)).length;
    this.app.post({ type: "branchInfo", id, title: s.title, tool: s.tool, asks, contextChars }, view);
  }

  async branch(m: Extract<FromWebview, { type: "branch" }>, view: vscode.Webview): Promise<void> {
    const root = this.app.requireRoot();
    const s = this.app.chats.session(m.from);
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

    if (m.keepConnected && getCursor(s.id) === undefined) setCursor(s.id, this.app.chats.adapter(s.tool).end(s));
    const title = task.split("\n")[0].slice(0, 60);
    // The new chat is a Claude Code chat: what matters is Claude's hook.
    if (this.app.setup.hooked("Claude")) {
      // The new chat opens in this window's folder, wherever the old one lives.
      addPending({ id: randomBytes(6).toString("hex"), from: this.app.chats.ref(s), title, cwd: root, at: Date.now(), taskStart: task, context, keepConnected: m.keepConnected });
      await openClaude(undefined, task);
      this.app.toast(`New chat opened with your task. Press Send and it gets “${s.title}”’s context with it.`, "ok", view);
    } else {
      const prompt = context ? `${task}\n\n---\n${formatDelivery([{ from: this.app.chats.ref(s), at: Date.now(), kind: "context", text: context }])}` : task;
      await openClaude(undefined, prompt);
      this.app.toast("New chat opened with your task and the context. Turn on auto-sharing to keep them connected.", "warn", view);
    }
  }

  /**
   * Claude chats send their updates from the hook when a reply ends. Other tools
   * have no hook, so their updates go out from here once the chat has gone quiet.
   */
  pumpQuietSources(): void {
    const now = Date.now();
    const bySource = new Map<string, ReturnType<typeof readConnections>>();
    for (const c of readConnections()) {
      // An agent with Airband's hook sends its own updates when a reply ends; the rest are read here.
      if (c.paused || this.app.setup.hooked(c.from.tool)) continue;
      bySource.set(c.from.id, [...(bySource.get(c.from.id) ?? []), c]);
    }
    for (const [id, conns] of bySource) {
      const s = this.app.chats.byId.get(id);
      if (!s) continue;
      const a = this.app.chats.adapter(s.tool);
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
      const root = s.cwd ?? this.app.root;
      for (const c of conns) {
        const to = this.app.chats.byId.get(c.to.id)?.cwd ?? c.to.cwd;
        const elsewhere = !!(to && root && !sameFolder(to, root));
        const text =
          c.level === "full" || !read
            ? words && buildUpdate(words.messages, words.files, root, s.tool, elsewhere)
            : read.asks.length
              ? renderAsks(read.asks, c.level ?? "ping", { root, absolute: elsewhere })
              : undefined;
        if (text) appendInbox(c.to.id, { connectionId: c.id, from: this.app.chats.ref(c.from), at: now, kind: "update", text });
      }
    }
  }
}
