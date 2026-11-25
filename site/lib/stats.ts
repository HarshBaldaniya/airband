// How often Airband was downloaded from npm, as npm counts it, read when the site is built and
// never from a visitor's browser (the site sends nothing about visitors anywhere). These are
// downloads, not people: one person can download twice, and npm also counts automated installs
// and the desktop app fetching its engine. Every deploy refreshes them, and the site is deployed
// again every morning for that (.github/workflows/site-numbers.yml). A number that can't be read
// is left out, never guessed.

const PACKAGE = "airband";
/** npm's download counts start the day the package was first published. */
export const FIRST_DAY = "2026-11-15";
/** npm answers at most about 18 months per request: a year a request is safe. */
const SPAN_DAYS = 365;
const DAY_MS = 86_400_000;

export interface Stats {
  /** npm downloads since the first version: `npx airband`, installs, and the desktop app's engine. */
  total?: number;
  /** npm downloads in the last 7 days npm has counted. */
  week?: number;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every day's npm downloads since the first version, oldest first. */
async function npmDays(): Promise<number[] | undefined> {
  const days: number[] = [];
  const end = Date.now();
  for (let from = Date.parse(FIRST_DAY); from <= end; from += SPAN_DAYS * DAY_MS) {
    const to = Math.min(end, from + (SPAN_DAYS - 1) * DAY_MS);
    try {
      const r = await fetch(`https://api.npmjs.org/downloads/range/${day(from)}:${day(to)}/${PACKAGE}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return undefined;
      const body = (await r.json()) as { downloads: { downloads: number }[] };
      days.push(...body.downloads.map((d) => d.downloads));
    } catch {
      return undefined;
    }
  }
  // npm counts a day only once it is over: today and yesterday may still read 0.
  while (days.length && days[days.length - 1] === 0) days.pop();
  return days;
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

export async function stats(): Promise<Stats> {
  const days = await npmDays();
  return days?.length ? { total: sum(days), week: sum(days.slice(-7)) } : {};
}
