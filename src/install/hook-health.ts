// Whether each agent really runs Airband's hook. Being in the agent's settings is not enough: Codex
// runs a hook only once the person has reviewed and trusted it in Codex, and asks again whenever
// it changes, and until then it skips it without a word. Then nothing is shared and no status is
// written. So the hook notes each run here, and setup and the doctor compare that with the agent's
// own chats: a chat begun with no run of the hook since means the agent skips it.
import * as fs from "node:fs";
import type { AgentId } from "../core/agents";
import { readJson } from "../core/json";
import { airbandFile, codexSessionsDir, writeFileAtomic } from "../core/paths";
import { recentRollouts } from "../adapters/codex";

const FILE = "hooks-ran.json";
/** A run is noted at most this often per agent: the hook runs on every step. */
const NOTE_EVERY_MS = 60_000;
/** A chat begun this soon after the hook was set up may have begun before it. */
const SETUP_GRACE_MS = 30_000;

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

/** When the agent's newest chat began, where Airband can tell (Codex: one file per chat). */
function newestChatBegan(tool: AgentId): number | undefined {
  if (tool !== "codex") return undefined;
  try {
    const newest = recentRollouts(codexSessionsDir(), 1)[0];
    return newest ? fs.statSync(newest.file).birthtimeMs || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** Whether an agent whose settings have Airband's hook (`settingsFile`) skips it: a chat began
 *  after the hook was set up, and the hook has not run since it began. */
export function hookSkipped(tool: AgentId, settingsFile: string): boolean {
  const began = newestChatBegan(tool);
  if (!began) return false;
  let connectedAt: number;
  try {
    connectedAt = fs.statSync(settingsFile).mtimeMs;
  } catch {
    return false;
  }
  return began > connectedAt + SETUP_GRACE_MS && (hookLastRan(tool) ?? 0) < began;
}

/** What to do about it, in the agent's own words. */
export const SKIPPED_FIX: Partial<Record<AgentId, string>> = {
  codex: "Open Codex in a terminal and type /hooks. Trust Airband's hooks if they wait for review, then start a new chat.",
};
