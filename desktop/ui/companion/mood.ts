// What the companion shows, from what is going on. Pure, so it can be tested on its own.
import type { StationState } from "../../../src/station";
import type { Mood } from "./types";

/** Nothing for you this long (no request, nothing finished, no touch): the companion falls asleep,
 *  even while chats work. Asleep, nothing on it moves or redraws. */
export const SLEEP_AFTER_MS = 2 * 60_000;

export function moodOf(s: StationState | undefined, x: { dizzy: boolean; asking: boolean; talking: boolean; hello: boolean; cheering: boolean; asleep: boolean }): Mood {
  if (x.dizzy) return "dizzy";
  if (x.asking) return "thinking";
  if (x.talking) return "talking";
  if (x.hello) return "hello";
  if (!s) return "idle";
  // What needs you always wakes it; a chat that only works does not keep it awake.
  if (s.pending.length || s.chats.some((c) => c.status === "waiting")) return "needs";
  if (x.cheering) return "done";
  if (x.asleep) return "resting";
  if (s.chats.some((c) => c.status === "working")) return "working";
  return "idle";
}

/** `keepAwake`: the person is looking (its panel is open): it stays awake, and the quiet starts after. */
