// What the companion shows, from what is going on. Pure, so it can be tested on its own.
import type { StationState } from "../../src/station";
import type { Mood } from "./types";

/** Every chat done (none working, none waiting) for this long, and no touch: the companion falls
 *  asleep. Never while a chat still works: asleep on the way would look like nothing is running. */
export const SLEEP_AFTER_MS = 2 * 60_000;

export function moodOf(s: StationState | undefined, x: { dizzy: boolean; asking: boolean; talking: boolean; hello: boolean; cheering: boolean; asleep: boolean }): Mood {
  if (x.dizzy) return "dizzy";
  if (x.asking) return "thinking";
  if (x.talking) return "talking";
  if (x.hello) return "hello";
  if (!s) return "idle";
  // What needs you, and a chat that works, keep it awake: it sleeps only when all is done.
  if (s.pending.length || s.chats.some((c) => c.status === "waiting")) return "needs";
  if (x.cheering) return "done";
  if (s.chats.some((c) => c.status === "working")) return "working";
  if (x.asleep) return "resting";
  return "idle";
}

/** `keepAwake`: the person is looking (its panel is open): it stays awake, and the quiet starts after. */
