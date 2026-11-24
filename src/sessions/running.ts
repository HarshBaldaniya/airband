// Claude Code's record of the chats it runs now: one file per agent process,
// <config>/sessions/<pid>.json, naming the chat (`sessionId`) and, in the Claude app, the app's own
// id for it (`hostSessionId`). A process that ended without a word can leave its file behind, so
// whether it still runs is asked of the system.
import * as fs from "node:fs";
import * as path from "node:path";
import { claudeHome } from "../core/paths";

export interface RunningClaude {
  pid: number;
  sessionId: string;
  hostSessionId?: string;
}

export const claudeSessionsDir = () => path.join(claudeHome(), "sessions");

/** Every record in the folder, alive or not; a file being written is left for the next look. */
export function readClaudeSessions(dir = claudeSessionsDir()): RunningClaude[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    // An older Claude Code keeps no such record.
    return [];
  }
  const out: RunningClaude[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { pid?: unknown; sessionId?: unknown; hostSessionId?: unknown };
      if (typeof j.pid !== "number" || typeof j.sessionId !== "string") continue;
      out.push({ pid: j.pid, sessionId: j.sessionId, ...(typeof j.hostSessionId === "string" ? { hostSessionId: j.hostSessionId } : {}) });
    } catch {
      // A file being written.
    }
  }
  return out;
}

/** Whether a process runs: one of another user's counts too (the system refuses to signal it). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The chats a Claude Code process runs now, by chat id. */
export function claudeRunningChats(dir = claudeSessionsDir()): Set<string> {
  return new Set(readClaudeSessions(dir).filter((s) => processAlive(s.pid)).map((s) => s.sessionId));
}
