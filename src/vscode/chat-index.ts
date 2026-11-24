// The chats: every agent's chats in this folder and the newest of every other folder, with their
// status, model, context and tokens. Big chat files are counted and recorded in the background, a
// slice at a time, and the folders chats are written to are watched.
import * as fs from "node:fs";
import * as vscode from "vscode";
import type { Adapter } from "../adapters/adapter";
import { ClaudeAdapter } from "../adapters/claude";
import { CodexAdapter } from "../adapters/codex";
import { GeminiAdapter } from "../adapters/gemini";
import { agentOf, type Tool } from "../core/agents";
import { isTempFolder, pickElsewhere } from "../core/folders";
import { airbandFile, airbandHome, claudeProjectFolder, claudeProjectsDir, sameFolder, statusDir } from "../core/paths";
import type { ToolTotals, ViewState } from "./protocol";
import { BoardStore } from "../core/state";
import { addUsage, NO_USAGE, type ChatRef, type ChatSession, type Status } from "../core/types";
import { HOOK_START_MAX, HOOK_STEP_MAX, readHead, setRecordTitle } from "../sessions/record/store";
import { catchUpRecord, recordBehind } from "../sessions/record/update";
import { readHookStatus, resolveStatus } from "../sessions/status";
import { runningAgents } from "../sessions/subagents";
import { claudeRunningChats } from "../sessions/running";
import { readConnections } from "../sharing/connections";
import type { Controller } from "./controller";

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
/** A chat quiet this long is no longer replying: the hook won't catch its record up, so this does. */
const QUIET_FOR_RECORD_MS = 120_000;

export class ChatIndex implements vscode.Disposable {
  readonly adapters: Adapter[] = [new ClaudeAdapter(), new CodexAdapter(), new GeminiAdapter()];
  byId = new Map<string, ChatSession>();
  private readonly lastStatus = new Map<string, Status>();
  private watchers: fs.FSWatcher[] = [];
  /** Chats whose files are still being counted, a slice at a time. */
  private readonly uncounted = new Set<string>();
  private counting = false;
  private firstLoad = true;

  constructor(private readonly app: Controller) {}

  /** This folder's chats, then the newest chats of every other folder (for "All folders" and for
   *  links that reach another folder), each with its status, model, context and tokens. */
  async list(root: string) {
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
    const running = claudeRunningChats();
    for (const s of sessions) {
      // Every agent with Airband's hook records its own status. A Claude chat whose turn ended
      // while agents it started still work is working until they end.
      const { status, line } = resolveStatus(s.lastModified, readHookStatus(s.id));
      s.status = (status === "done" || status === "idle") && s.tool === "Claude" && runningAgents(s.id, s.file, running) ? "working" : status;
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
    return { present, mine, sessions, totals, errors };
  }

  /** Once the list is shown: the big files counted, or, with nothing left to count, the records caught up. */
  afterLoad(): void {
    if (this.uncounted.size) void this.countInBackground();
    else {
      for (const a of this.adapters) a.saveCache?.();
      void this.recordInBackground();
    }
  }

  private recording = false;

  private elsewhereCache: { at: number; list: ChatSession[] } | undefined;

  /** Watches the folders chats are written to, so cards change as the chats do. */
  rewatch(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    const root = this.app.root;
    const targets = [statusDir(), airbandFile("inbox")];
    if (root) targets.push(fs.existsSync(claudeProjectFolder(root)) ? claudeProjectFolder(root) : claudeProjectsDir());
    for (const dir of targets) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        this.watchers.push(fs.watch(dir, () => this.app.refreshSoon()));
      } catch {
        // The poll still keeps the list current.
      }
    }
    // Another window asking this one to open a chat of this folder.
    try {
      fs.mkdirSync(airbandHome(), { recursive: true });
      this.watchers.push(fs.watch(airbandHome(), (_e, name) => name === "open-requests.json" && void this.app.opener.takeOpens()));
    } catch {
      // Requests are also checked after every refresh.
    }
    this.app.refreshSoon(0);
  }

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
        const quiet = Date.now() - s.lastModified > QUIET_FOR_RECORD_MS;
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
          this.app.refreshSoon(0);
        }
      }
    } finally {
      this.counting = false;
      for (const a of this.adapters) a.saveCache?.();
      this.app.refreshSoon(0);
    }
  }

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

  session(id: string): ChatSession {
    const s = this.byId.get(id);
    if (!s) throw new Error("That chat isn't in the list any more. Refresh and try again.");
    return s;
  }

  /** A chat's record, caught up (a big chat is read a slice at a time, without holding anything up). */
  async ensureRecord(s: ChatSession): Promise<void> {
    if (!s.file) return;
    await catchUpRecord(s.id, agentOf(s.tool), s.file, { cwd: s.cwd, title: s.title });
    setRecordTitle(s.id, s.title, s.cwd);
  }

  notifyWaiting(sessions: ChatSession[]): void {
    for (const s of sessions) {
      const before = this.lastStatus.get(s.id);
      this.lastStatus.set(s.id, s.status);
      if (this.firstLoad || s.status !== "waiting" || before === "waiting") continue;
      void vscode.window.showInformationMessage(`“${s.title}” is waiting for you${s.lastLine ? `: ${s.lastLine}` : ""}`, "Open").then((pick) => {
        if (pick) void this.app.opener.open(s.id);
      });
    }
    this.firstLoad = false;
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
  }
}
