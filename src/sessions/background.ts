// A Claude Code chat can end its turn while agents it started in the background still work: the
// chat says "1 agent" and is not done. Each such agent has its own file beside the chat's
// (<chat>/subagents/agent-<id>.jsonl) and a small description (agent-<id>.meta.json) that Claude
// Code marks `finished` when the agent ends. An agent whose chat was closed is never marked, so it
// counts only while its chat's process runs and its own file moved lately.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonLine } from "../core/json";

/** An agent quiet this long is taken for gone, even unmarked: a tool waits at most minutes. */
export const AGENT_QUIET_MS = 30 * 60_000;

const META = /^agent-[A-Za-z0-9_-]+\.meta\.json$/;

export interface BackgroundAgents {
  /** How many run now. */
  count: number;
  /** When the latest of them last wrote. */
  at: number;
}

/** Per chat folder: the descriptions not marked finished when the folder was last listed. */
const open = new Map<string, { listed: number; metas: string[] }>();

function unfinished(dir: string): string[] {
  let listed: number;
  try {
    listed = fs.statSync(dir).mtimeMs;
  } catch {
    return [];
  }
  const hit = open.get(dir);
  // A new agent adds files to the folder; an agent that ends only rewrites its description, so the
  // ones open last time are read again each look, and the folder is listed again when it changes.
  let metas = hit && hit.listed === listed ? hit.metas : undefined;
  if (!metas) {
    try {
      metas = fs.readdirSync(dir).filter((f) => META.test(f));
    } catch {
      metas = [];
    }
  }
  metas = metas.filter((f) => {
    try {
      const m = parseJsonLine<{ finished?: boolean; requestShape?: string }>(fs.readFileSync(path.join(dir, f), "utf8"));
      // An agent the turn waited for ends with the turn: only one sent to the background outlives it.
      return !!m && m.finished !== true && m.requestShape === "background";
    } catch {
      return false;
    }
  });
  open.set(dir, { listed, metas });
  return metas;
}

/** The agents a Claude Code chat runs in the background now, or undefined when none do. `running`
 *  is the chats a Claude Code process runs now (claudeRunningChats), read once for every chat. */
export function backgroundAgents(id: string, file: string | undefined, running: Set<string>, now = Date.now()): BackgroundAgents | undefined {
  if (!running.has(id) || !file?.endsWith(".jsonl")) return undefined;
  const dir = path.join(file.slice(0, -".jsonl".length), "subagents");
  let count = 0;
  let at = 0;
  for (const meta of unfinished(dir)) {
    let wrote: number;
    try {
      wrote = fs.statSync(path.join(dir, meta.replace(/\.meta\.json$/, ".jsonl"))).mtimeMs;
    } catch {
      continue;
    }
    if (now - wrote > AGENT_QUIET_MS) continue;
    count++;
    at = Math.max(at, wrote);
  }
  if (!count) return undefined;
  return { count, at };
}

/** Forget what was read (tests). */
export function forgetAgents(): void {
  open.clear();
}
