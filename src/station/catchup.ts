// Every recent chat on this computer gets its record, in every folder and worktree, whether or not
// the editor's extension runs. The hook keeps a record current as each reply ends, but leaves alone
// what would slow a reply down: a big chat (one started before Airband, say), or a quiet one with no
// record yet. The extension used to read those in the background; the desktop app has no extension,
// so the Station does it here: a slice at a time, one chat at a time, chats that are working or need
// you first. Roger then lists them like any other.
import { ClaudeAdapter } from "../adapters/claude";
import { CodexAdapter } from "../adapters/codex";
import { GeminiAdapter } from "../adapters/gemini";
import type { Adapter } from "../adapters/adapter";
import { HOOK_START_MAX, HOOK_STEP_MAX, readHead, setRecordTitle } from "../sessions/record/store";
import { catchUpRecord, recordBehind } from "../sessions/record/update";
import { readHookStatus } from "../sessions/status";
import type { ChatSession } from "../core/types";
import { agentOf } from "../core/agents";
import { DAY_MS, MINUTE_MS } from "../core/units";

/** Chats active within this long are kept caught up. */
const CATCH_UP_WINDOW_MS = DAY_MS;

/** The chats whose record the hook won't write, most urgent first: working or needing you, then the newest. */
export function needsCatchUp(sessions: ChatSession[], now = Date.now(), windowMs = CATCH_UP_WINDOW_MS): ChatSession[] {
  const urgent = (s: ChatSession) => {
    const h = readHookStatus(s.id);
    return h && (h.status === "working" || h.status === "waiting") ? 0 : 1;
  };
  return sessions
    .filter((s) => {
      if (!s.file || now - s.lastModified > windowMs) return false;
      const behind = recordBehind(s.id, agentOf(s.tool), s.file);
      if (behind <= 0) return false;
      // A chat replying now records its own ask as the reply ends; a quiet one, a big one, or a
      // record far behind is ours.
      const quiet = now - s.lastModified > 2 * MINUTE_MS;
      return readHead(s.id) ? behind > HOOK_STEP_MAX : behind > HOOK_START_MAX || quiet;
    })
    .sort((a, b) => urgent(a) - urgent(b) || b.lastModified - a.lastModified);
}

export class CatchUp {
  private busy = false;
  constructor(private readonly adapters: Adapter[] = [new ClaudeAdapter(), new CodexAdapter(), new GeminiAdapter()]) {}

  /** One pass over every agent's recent chats. Returns how many records it caught up. */
  async sweep(now = Date.now()): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let done = 0;
    try {
      const sessions: ChatSession[] = [];
      for (const a of this.adapters) {
        if (!a.present()) continue;
        try {
          sessions.push(...(await a.list(undefined, 80)));
        } catch {
          // One agent's chats that can't be listed don't stop the others.
        }
      }
      for (const s of needsCatchUp(sessions, now)) {
        await catchUpRecord(s.id, agentOf(s.tool), s.file!, { cwd: s.cwd, title: s.title });
        setRecordTitle(s.id, s.title, s.cwd);
        done++;
      }
    } catch {
      // A record is a nicety: the next pass tries again.
    } finally {
      this.busy = false;
    }
    return done;
  }
}
