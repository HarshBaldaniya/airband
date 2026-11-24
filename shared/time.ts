// How long ago something happened, rounded the same way on every screen.

export type Elapsed = { n: number; unit: "m" | "h" | "d" | "mo" };

/** Whole minutes, hours, days or months since `ms`. Under 45 seconds is "now" (undefined). */
export function elapsed(ms: number, now = Date.now()): Elapsed | undefined {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return undefined;
  const m = Math.round(s / 60);
  if (m < 60) return { n: m, unit: "m" };
  const h = Math.round(m / 60);
  if (h < 24) return { n: h, unit: "h" };
  const d = Math.round(h / 24);
  return d < 30 ? { n: d, unit: "d" } : { n: Math.round(d / 30), unit: "mo" };
}
