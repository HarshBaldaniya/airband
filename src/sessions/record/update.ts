// Keeping a record current: the hook brings it up to date after each reply, and a big chat is
// caught up in the background, a slice at a time.
import * as fs from "node:fs";
import type { AgentId } from "../../core/agents";
import { safeId } from "../../core/paths";
import { shorten } from "../../core/text";
import { fileSize } from "../../core/file-lines";
import { MINUTE_MS, MiB } from "../../core/units";
import { readAsksFrom } from "./extract";
import { appendAsks, clearAsks, HOOK_START_MAX, readHead, writeHead, type RecordAsk } from "./store";

/** How much of a big chat's file the background catch-up reads between pauses. */
const CATCH_UP_SLICE = 8 * MiB;
/** A chat file written to this recently belongs to a chat still working. */
const STILL_WORKING_MS = 2 * MINUTE_MS;

/**
 * Brings a chat's record up to date and returns the asks added. Without a record yet, one is
 * started for a chat small enough to read now; a bigger one is left to `catchUpRecord`.
 */
export function updateRecord(
  id: string,
  tool: AgentId,
  file: string,
  opts: { cwd?: string; title?: string; maxBytes?: number; lastReply?: string; startMax?: number; now?: number; holdOpen?: boolean } = {},
): RecordAsk[] {
  if (!safeId(id) || !file) return [];
  const now = opts.now ?? Date.now();
  let head = readHead(id);
  if (!head) {
    if (tool !== "gemini" && fileSize(file) > (opts.startMax ?? HOOK_START_MAX)) return [];
    head = { id, tool, file, cursor: 0, n: 0, updatedAt: now, cwd: opts.cwd, title: opts.title };
  }
  if (tool !== "gemini" && head.cursor > fileSize(file)) {
    // The file was replaced: recorded again from the start.
    clearAsks(id);
    head = { ...head, cursor: 0, n: 0 };
  }
  const { asks, next, seen } = readAsksFrom(tool, file, head.cursor, head.n + 1, { maxBytes: opts.maxBytes, lastReply: opts.lastReply, now, holdOpen: opts.holdOpen, seen: head.seen });
  appendAsks(id, asks);
  const goal = head.goal ?? (asks[0] ? shorten(asks[0].ask, 240) : undefined);
  writeHead({ ...head, file, goal, cwd: opts.cwd ?? head.cwd, title: opts.title ?? head.title, cursor: next, n: head.n + asks.length, ...(seen ? { seen } : {}), updatedAt: asks.length || next !== head.cursor ? now : head.updatedAt });
  return asks;
}

/** How much of a chat's file the record hasn't read yet. */
export function recordBehind(id: string, tool: AgentId, file: string): number {
  if (tool === "gemini") return readHead(id) ? 0 : 1;
  const size = fileSize(file);
  const at = readHead(id)?.cursor ?? 0;
  return at > size ? size : size - at;
}

/** Reads a big chat's file into its record a slice at a time, letting everything else run between slices. */
export async function catchUpRecord(id: string, tool: AgentId, file: string, opts: { cwd?: string; title?: string; slice?: number; quietMs?: number } = {}): Promise<void> {
  const slice = opts.slice ?? CATCH_UP_SLICE;
  for (let i = 0; i < 100_000 && recordBehind(id, tool, file) > 0; i++) {
    const before = readHead(id)?.cursor;
    // A file written to in the last STILL_WORKING_MS belongs to a chat still working: its newest ask waits.
    // (The chat watcher knows a turn ended from the file itself, and says so with quietMs 0.)
    const quiet = opts.quietMs ?? STILL_WORKING_MS;
    const working = quiet > 0 && Date.now() - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) < quiet;
    updateRecord(id, tool, file, { cwd: opts.cwd, title: opts.title, maxBytes: slice, startMax: Infinity, holdOpen: working });
    if (readHead(id)?.cursor === before) break; // nothing more can be read (a line still being written)
    await new Promise((r) => setImmediate(r));
  }
}
