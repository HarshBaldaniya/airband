// The agents a Claude Code chat runs. A chat can end its turn while agents it sent to the
// background still work (the chat says "3 agents"), and it waits, writing nothing, while agents it
// waits for work: either way the chat works until they end. Each agent has its own file beside the
// chat's (<chat>/subagents/agent-<id>.jsonl) and a small description (agent-<id>.meta.json) that
// Claude Code marks `finished` when the agent ends. An agent whose chat was closed or stopped is
// never marked, so it counts only while its chat's process runs and its own file moved lately.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonLine } from "../core/json";

/** An agent quiet this long is taken for gone, even unmarked: a tool waits at most minutes. One the
 *  chat waits for is gone sooner: a chat stopped by the person leaves it unmarked. */
export const AGENT_QUIET_MS = 30 * 60_000;
export const WAITED_AGENT_QUIET_MS = 10 * 60_000;

const META = /^agent-[A-Za-z0-9_-]+\.meta\.json$/;

export interface RunningAgents {
  /** How many run now. */
  count: number;
  /** When the latest of them last wrote. */
  at: number;
}

/** Per chat folder: the descriptions not marked finished when the folder was last listed. */
const open = new Map<string, { listed: number; metas: Unfinished[] }>();

interface Unfinished {
  meta: string;
  /** Sent to the background: it may outlive the chat's turn. */
  background: boolean;
}

function unfinished(dir: string): Unfinished[] {
  let listed: number;
  try {
    listed = fs.statSync(dir).mtimeMs;
  } catch {
    return [];
  }
  const hit = open.get(dir);
  // A new agent adds files to the folder; an agent that ends only rewrites its description, so the
  // ones open last time are read again each look, and the folder is listed again when it changes.
  let names = hit && hit.listed === listed ? hit.metas.map((u) => u.meta) : undefined;
  if (!names) {
    try {
      names = fs.readdirSync(dir).filter((f) => META.test(f));
    } catch {
      names = [];
    }
  }
  const metas: Unfinished[] = [];
  for (const f of names) {
    try {
      const m = parseJsonLine<{ finished?: boolean; requestShape?: string }>(fs.readFileSync(path.join(dir, f), "utf8"));
      if (m && m.finished !== true) metas.push({ meta: f, background: m.requestShape === "background" });
    } catch {
      // Gone, or being written: the next look reads it.
    }
  }
  open.set(dir, { listed, metas });
  return metas;
}

/** The agents a Claude Code chat runs now, or undefined when none do. `running` is the chats a
 *  Claude Code process runs now (claudeRunningChats), read once for every chat. */
export function runningAgents(id: string, file: string | undefined, running: Set<string>, now = Date.now()): RunningAgents | undefined {
  if (!running.has(id) || !file?.endsWith(".jsonl")) return undefined;
  const dir = path.join(file.slice(0, -".jsonl".length), "subagents");
  let count = 0;
  let at = 0;
  for (const { meta, background } of unfinished(dir)) {
    let wrote: number;
    try {
      wrote = fs.statSync(path.join(dir, meta.replace(/\.meta\.json$/, ".jsonl"))).mtimeMs;
    } catch {
      continue;
    }
    if (now - wrote > (background ? AGENT_QUIET_MS : WAITED_AGENT_QUIET_MS)) continue;
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
