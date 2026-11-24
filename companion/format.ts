// How times read on Roger's screens.
import { elapsed } from "../shared/time";

const UNIT = { m: "min", h: "h", d: "d" } as const;

/** "now", "12 min", "3 h", "40 d". */
export function ago(at: number, now = Date.now()): string {
  const e = elapsed(at, now);
  if (!e) return "now";
  return e.unit === "mo" ? `${Math.round((now - at) / 86_400_000)} d` : `${e.n} ${UNIT[e.unit]}`;
}
