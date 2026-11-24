// The backup for chats whose hook doesn't run. Roger hears about a chat from its hook: a status the
// moment it works, needs you or finishes. An app that saves its chats where Airband looks but
// doesn't run the hooks (the Codex app may not), or a hook that broke, would leave the chat
// unheard. So the Station also watches the chat folders themselves (Claude Code's
// ~/.claude/projects and Codex's ~/.codex/sessions). When a chat with no hook status writes a
// reply, it counts as working; when its file shows the turn ended, its record is caught up and it
// counts as done, so Roger says it finished like any other. Its status says "Watched": the hook's
// own status, whenever there is one, always wins.
import * as fs from "node:fs";
import * as path from "node:path";
import { claudeProjectsDir, codexSessionsDir, safeId, statusDir, writeFileAtomic } from "../core/paths";
import type { AgentId } from "../core/agents";
import { catchUpRecord, readHead } from "../core/record";
import { readHookStatus } from "../core/status";
import type { HookStatus, Status } from "../core/types";
import { parseJsonLine } from "../core/json";

/** The event name on a status the watcher wrote. */
export const WATCHED = "Watched";
/** How much of a file's new part is read to see what was written (a reply's line is far smaller). */
const READ_MAX = 512 * 1024;
/** A chat file made this recently is read from its start when first seen. */
const NEW_MS = 10 * 60_000;
/** A file not looked at again for this long is forgotten. */
const FORGET_MS = 30 * 60_000;

interface Seen {
  tool: AgentId;
  id: string;
  /** Bytes looked at so far. */
  size: number;
  /** A reply was written since the turn last ended. */
  working: boolean;
  cwd?: string;
  at: number;
}

/** The chat a changed file belongs to, or undefined for anything else in those folders. */
export function chatOfFile(file: string, claudeDir = claudeProjectsDir(), codexDir = codexSessionsDir()): { tool: AgentId; id: string } | undefined {
  if (!file.endsWith(".jsonl")) return undefined;
  const inside = (dir: string) => {
    const rel = path.relative(dir, file);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(/[\\/]+/) : undefined;
  };
  // ~/.claude/projects/<project>/<chat id>.jsonl (a subagent's file sits a folder deeper).
  const c = inside(claudeDir);
  if (c) return c.length === 2 && safeId(path.basename(file, ".jsonl")) ? { tool: "claude", id: path.basename(file, ".jsonl") } : undefined;
  // ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<chat id>.jsonl
  if (inside(codexDir)) {
    const m = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path.basename(file));
    return m ? { tool: "codex", id: m[1] } : undefined;
  }
  return undefined;
}

/** What the newly written part of a chat file says: a reply was written, the turn ended, its folder. */
export function readWritten(tool: AgentId, text: string): { replied: boolean; ended: boolean; cwd?: string } {
  let replied = false;
  let ended = false;
  let cwd: string | undefined;
  for (const raw of text.split("\n")) {
    // A line cut at the start, or still being written, reads as nothing.
    const o = parseJsonLine<any>(raw);
    if (!o) continue;
    if (tool === "codex") {
      const p = o?.payload ?? {};
      if (o?.type === "session_meta" && typeof p.cwd === "string") cwd = p.cwd;
      if (o?.type === "response_item" && p.type === "message" && p.role === "assistant") replied = true;
      if (o?.type === "event_msg" && p.type === "task_started") ended = false;
      if (o?.type === "event_msg" && (p.type === "task_complete" || p.type === "turn_aborted")) ended = true;
      continue;
    }
    if (typeof o?.cwd === "string") cwd = o.cwd;
    // Claude Code: the turn ends with a reply that asks for no tool. A tool's answer comes back as
    // a "user" line, and Claude carries on.
    if (o?.type === "assistant" && !o.isSidechain) {
      replied = true;
      const content = o.message?.content;
      ended = !(Array.isArray(content) && content.some((b: { type?: string }) => b?.type === "tool_use"));
    } else if (o?.type === "user" && !o.isSidechain) ended = false;
  }
  return { replied, ended, ...(cwd ? { cwd } : {}) };
}

function readFrom(file: string, from: number, to: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const start = Math.max(from, to - READ_MAX);
    const buf = Buffer.alloc(to - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export class ChatWatch {
  private readonly seen = new Map<string, Seen>();
  private readonly changed = new Set<string>();
  private watchers: fs.FSWatcher[] = [];
  private busy = false;

  /** `onChange` runs after a chat's status changed (the Station reads its chats again). */
  constructor(
    private readonly onChange: () => void,
    private readonly dirs = { claude: claudeProjectsDir(), codex: codexSessionsDir() },
  ) {}

  /** Watches both folders as they change. Where a folder can't be watched, nothing is. */
  start(): void {
    for (const dir of [this.dirs.claude, this.dirs.codex]) {
      try {
        if (!fs.existsSync(dir)) continue;
        const w = fs.watch(dir, { recursive: true }, (_e, name) => {
          if (name) this.changed.add(path.join(dir, name.toString()));
        });
        w.on("error", () => undefined);
        this.watchers.push(w);
      } catch {
        // Recursive watching isn't offered here (an old Linux): the hook is all there is.
      }
    }
  }

  stop(): void {
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
  }

  /** A file changed (the folder watch calls this; tests call it directly). */
  touched(file: string): void {
    this.changed.add(file);
  }

  /** Looks at the files that changed since the last look. Runs every few seconds. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let moved = false;
    try {
      const files = [...this.changed];
      this.changed.clear();
      for (const file of files) if (await this.look(file, now)) moved = true;
      for (const [file, s] of this.seen) if (now - s.at > FORGET_MS) this.seen.delete(file);
    } finally {
      this.busy = false;
    }
    if (moved) this.onChange();
  }

  /** One changed file. True when the chat's status changed. */
  private async look(file: string, now: number): Promise<boolean> {
    const chat = chatOfFile(file, this.dirs.claude, this.dirs.codex);
    if (!chat) return false;
    // Its hook speaks for it: nothing to do, now or later.
    const hook = readHookStatus(chat.id);
    if (hook && hook.event !== WATCHED) {
      this.seen.delete(file);
      return false;
    }
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat) return false;
    const size = stat.size;
    let s = this.seen.get(file);
    if (!s) {
      // First seen now. Read from where its record ends (a reply may have landed before this first
      // look); a chat started in the last few minutes from its start; any other from now on (the
      // record's catch-up reads its past).
      const cursor = readHead(chat.id)?.cursor;
      const fresh = stat.birthtimeMs > 0 && now - stat.birthtimeMs < NEW_MS;
      const from = cursor !== undefined && cursor <= size ? cursor : fresh ? 0 : size;
      s = { ...chat, size: from, working: hook?.status === "working", at: now };
      this.seen.set(file, s);
    }
    s.at = now;
    if (size <= s.size) {
      s.size = size;
      return false;
    }
    const said = readWritten(chat.tool, readFrom(file, s.size, size));
    s.size = size;
    if (said.cwd) s.cwd = said.cwd;
    if (!s.cwd && chat.tool === "claude") s.cwd = readWritten("claude", readFrom(file, 0, Math.min(size, 64 * 1024))).cwd;
    if (!s.cwd && chat.tool === "codex") s.cwd = readWritten("codex", readFrom(file, 0, Math.min(size, 64 * 1024))).cwd;
    // Lines after the turn ended (a title, the cost): still done. The status keeps up with the file,
    // so the Station never takes the write for new work.
    if (!said.replied && !s.working && hook?.event === WATCHED && hook.status === "done") {
      this.write(chat.id, "done", now, s.cwd);
      return false;
    }
    // Only a reply counts: a title, a summary or an app taking over a chat write lines too.
    if (said.replied && !said.ended && !s.working) {
      s.working = true;
      // Roger lists chats that have a record: a new one gets its record now, its ask held open.
      try {
        if (!readHead(chat.id)) await catchUpRecord(chat.id, chat.tool, file, { cwd: s.cwd });
      } catch {
        // Listed once the turn ends instead.
      }
      this.write(chat.id, "working", now, s.cwd);
      return true;
    }
    if (said.ended && (s.working || said.replied)) {
      s.working = false;
      try {
        await catchUpRecord(chat.id, chat.tool, file, { cwd: s.cwd, quietMs: 0 });
      } catch {
        // The record is a nicety: the status still says it finished.
      }
      this.write(chat.id, "done", Date.now(), s.cwd);
      return true;
    }
    return false;
  }

  private write(id: string, status: Status, at: number, cwd: string | undefined): void {
    // The hook may have spoken in the meantime: its word stands.
    const hook = readHookStatus(id);
    if (hook && hook.event !== WATCHED) return;
    const entry: HookStatus = { status, at, event: WATCHED, ...(cwd ? { cwd } : {}) };
    try {
      writeFileAtomic(path.join(statusDir(), `${id}.json`), JSON.stringify(entry));
    } catch {
      // Only a status.
    }
  }
}
