// Plan limits, as each agent reports them. Nothing here is worked out by Airband: every number is
// the agent's own. These only pick which to show, and say when a limit resets.
import type { ViewState } from "../../../src/core/protocol";
import type { PlanUsage, PlanWindow } from "../../../src/core/types";
import type { Tool } from "../../../src/core/agents";

const ORDER: Tool[] = ["Claude", "Codex", "Gemini"];

function planList(state: ViewState): PlanUsage[] {
  return ORDER.map((t) => state.plans?.[t]).filter((p): p is PlanUsage => !!p);
}

/** Agents reporting limits: the foot of the sidebar is for numbers, not notes. */
export function limitedPlans(state: ViewState): PlanUsage[] {
  return planList(state).filter((p) => headline(p));
}

/** Agents with something to show: limits, or at least an account signed in. One not in use stays out of sight. */
export function shownPlans(state: ViewState): PlanUsage[] {
  return planList(state).filter((p) => p.windows.length > 0 || !!p.account?.email || !!p.account?.plan);
}

/** The limit nearest to running out: the one a person needs to watch. */
export function headline(p: PlanUsage): PlanWindow | undefined {
  return [...p.windows].filter((w) => w.pct != null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
}

/** To the nearest minute: a limit that resets at 02:59:59.98 resets at 3:00, as the agent's own panel says. */
const minute = (at: number) => Math.round(at / 60_000) * 60_000;

/** "8:30 AM", always with AM or PM, whatever language the editor is in. */
const clockOf = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

/** The time zone's short name: "IST", "PST", "BST"; "GMT+5:30" only when no name is known. */
function zoneOf(d: Date): string {
  let fallback = "";
  for (const locale of ["en-US", "en-IN", "en-GB", "en-AU"]) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
      if (name && !/^(GMT|UTC)[+-]/.test(name)) return name;
      fallback ||= name;
    } catch {
      // A locale this runtime lacks.
    }
  }
  return fallback;
}

function dayDiff(d: Date, now: number): number {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(d) - day(new Date(now))) / 86_400_000);
}

/** "Resets today · 7:43 PM IST", "Resets tomorrow · 9:00 AM IST", "Resets Sat, Nov 14 · 8:30 AM IST". */
export function resetText(at: number, now = Date.now()): string {
  const d = new Date(minute(at));
  const when = `${clockOf(d)} ${zoneOf(d)}`.trim();
  const diff = dayDiff(d, now);
  if (diff === 0) return `Resets today · ${when}`;
  if (diff === 1) return `Resets tomorrow · ${when}`;
  return `Resets ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${when}`;
}

/** For the sidebar: "today 7:43 PM IST", "tomorrow 9:00 AM IST", "Sat 8:30 AM IST" this week, "Nov 20" later. */
export function resetShort(at: number, now = Date.now()): string {
  const d = new Date(minute(at));
  const when = `${clockOf(d)} ${zoneOf(d)}`.trim();
  const diff = dayDiff(d, now);
  if (diff === 0) return `today ${when}`;
  if (diff === 1) return `tomorrow ${when}`;
  if (diff < 7) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${when}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const shortLabel = (l: string) => l.replace("Current session (5-hour)", "5-hour").replace("Weekly (7 day)", "Weekly");
