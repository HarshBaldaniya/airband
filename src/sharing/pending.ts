// Branches waiting for their new chat: a task Airband opened in a new chat, matched by its first message.
import * as path from "node:path";
import type { PendingBranch } from "../core/types";
import { airbandFile, writeFileAtomic } from "../core/paths";
import { readJson } from "../core/json";

/** A branch waits this long for its chat's first message. */
const PENDING_MS = 30 * 60_000;

function readPending(now = Date.now()): PendingBranch[] {
  return readJson<PendingBranch[]>(airbandFile("pending.json"), []).filter((p) => now - p.at < PENDING_MS);
}

export function addPending(p: PendingBranch): void {
  writeFileAtomic(airbandFile("pending.json"), JSON.stringify([...readPending(), p], null, 2));
}

export function removePending(id: string): void {
  writeFileAtomic(airbandFile("pending.json"), JSON.stringify(readPending().filter((p) => p.id !== id), null, 2));
}

/** The branch a new chat's first message belongs to, if any: matched on the start of the task text. */
export function matchPending(prompt: string, cwd: string | undefined, now = Date.now()): PendingBranch | undefined {
  const said = normalise(prompt);
  if (!said) return undefined;
  return readPending(now).find((p) => {
    const start = normalise(p.taskStart).slice(0, 60);
    return start.length > 0 && said.startsWith(start) && (!p.cwd || !cwd || path.resolve(p.cwd) === path.resolve(cwd));
  });
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
