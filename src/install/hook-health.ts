// Whether each agent really runs Airband's hook. Being in the agent's settings is not enough: Codex
// runs a hook only once the person has reviewed and trusted it in Codex, and asks again whenever
// it changes, and until then it skips it without a word. Then nothing is shared and no status is
// written. So the hook notes each run here, and setup and the doctor compare that with the agent's
// own chats: chats newer than the hook's last run mean the agent skips it.
import * as fs from "node:fs";
import type { AgentId } from "../core/agents";
import { readJson } from "../core/json";
import { airbandFile, codexSessionsDir, writeFileAtomic } from "../core/paths";
import { recentRollouts } from "../adapters/codex";

const FILE = "hooks-ran.json";
/** A run is noted at most this often per agent: the hook runs on every step. */
const NOTE_EVERY_MS = 60_000;
/** An agent's chat this much newer than the hook's last run was not one the hook ran in. */
const SKIPPED_AFTER_MS = 5 * 60_000;

type Runs = Partial<Record<AgentId, number>>;

const read = (): Runs => readJson<Runs>(airbandFile(FILE), {});

/** The hook ran for `tool` now. */
export function noteHookRan(tool: AgentId, now = Date.now()): void {
  try {
    const runs = read();
    if (now - (runs[tool] ?? 0) < NOTE_EVERY_MS) return;
    writeFileAtomic(airbandFile(FILE), JSON.stringify({ ...runs, [tool]: now }));
  } catch {
    // Only a note.
  }
}

export const hookLastRan = (tool: AgentId): number | undefined => read()[tool];

/** When the agent's newest chat last moved, where Airband can tell (Codex). */
function newestChatAt(tool: AgentId): number | undefined {
  if (tool !== "codex") return undefined;
  try {
    return recentRollouts(codexSessionsDir(), 1)[0]?.mtime;
  } catch {
    return undefined;
  }
}

/** Whether an agent whose settings have Airband's hook (`settingsFile`) skips it: its chats moved
 *  well after the hook was set up, and the hook never ran in them. */
export function hookSkipped(tool: AgentId, settingsFile: string): boolean {
  const newest = newestChatAt(tool);
  if (!newest) return false;
  let connectedAt = 0;
  try {
    connectedAt = fs.statSync(settingsFile).mtimeMs;
  } catch {
    return false;
  }
  const since = Math.max(connectedAt, hookLastRan(tool) ?? 0);
  return newest - since > SKIPPED_AFTER_MS;
}

/** What to do about it, in the agent's own words. */
export const SKIPPED_FIX: Partial<Record<AgentId, string>> = {
  codex: "Open Codex in a terminal and type /hooks. Trust Airband's hooks if they wait for review, then start a new chat.",
};
