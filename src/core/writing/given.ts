// Once per chat: the rules stay in a chat's context, so they are not sent to it again.
import { readJson } from "../json";
import { airbandFile, writeFileAtomic } from "../paths";
import type { WritingKind } from "./settings";

const seenFile = () => airbandFile("writing-seen.json");
const SEEN_MAX = 400;

/** The kinds not yet given to this chat; marks them given. */
export function notYetGiven(sessionId: string | undefined, kinds: WritingKind[]): WritingKind[] {
  if (!sessionId || !kinds.length) return kinds;
  const seen = readJson<Record<string, string[]>>(seenFile(), {});
  const had = new Set(seen[sessionId] ?? []);
  const fresh = kinds.filter((k) => !had.has(k));
  if (!fresh.length) return [];
  delete seen[sessionId];
  seen[sessionId] = [...had, ...fresh];
  const ids = Object.keys(seen);
  for (const id of ids.slice(0, Math.max(0, ids.length - SEEN_MAX))) delete seen[id];
  try {
    writeFileAtomic(seenFile(), JSON.stringify(seen));
  } catch {
    // Only a saving: the rules go again next time.
  }
  return fresh;
}

/** A chat whose context was cleared or compacted gets the rules again when it needs them. */
export function forgetGiven(sessionId: string | undefined): void {
  if (!sessionId) return;
  const seen = readJson<Record<string, string[]>>(seenFile(), {});
  if (!(sessionId in seen)) return;
  delete seen[sessionId];
  try {
    writeFileAtomic(seenFile(), JSON.stringify(seen));
  } catch {
    // Nothing to keep.
  }
}
