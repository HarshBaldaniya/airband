// How often Airband was downloaded, as npm and GitHub count it, read when the site is built and
// never from a visitor's browser (the site sends nothing about visitors anywhere). These are
// downloads, not people: one person can download twice, and npm also counts automated installs
// and the desktop app fetching its engine. Every deploy refreshes them. A number that can't be read
// is left out, never guessed.

const PACKAGE = "airband";
/** npm's download counts start the day the package was first published. */
const FIRST_DAY = "2026-11-15";
/** npm answers at most about 18 months per request: a year a request is safe. */
const SPAN_DAYS = 365;
const DAY_MS = 86_400_000;
/** How many days the dial shows. */
const SHOWN_DAYS = 60;

export interface Stats {
  /** npm downloads since the first version: `npx airband`, installs, and the desktop app's engine. */
  npmTotal?: number;
  /** npm downloads in the last 7 days npm has counted, and the 7 days before them. */
  npmWeek?: number;
  npmWeekBefore?: number;
  /** npm downloads each day, the newest last: at most the last 60 days npm has counted. */
  npmDaily?: number[];
  /** The day `npmDaily` starts (YYYY-MM-DD). */
  npmFrom?: string;
  /** Downloads of the desktop app's installers from every GitHub release: the .dmg files for a
   *  Mac, the .exe for Windows. GitHub counts each time a file is fetched, from a browser or the
   *  install line alike. The update files installed apps fetch by themselves are not counted. */
  appDownloads?: number;
  macDownloads?: number;
  windowsDownloads?: number;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T | undefined> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    return r.ok ? ((await r.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Every day's npm downloads since the first version, oldest first. */
async function npmDays(): Promise<number[] | undefined> {
  const days: number[] = [];
  const end = Date.now();
  for (let from = Date.parse(FIRST_DAY); from <= end; from += SPAN_DAYS * DAY_MS) {
    const to = Math.min(end, from + (SPAN_DAYS - 1) * DAY_MS);
    const r = await json<{ downloads: { day: string; downloads: number }[] }>(`https://api.npmjs.org/downloads/range/${day(from)}:${day(to)}/${PACKAGE}`);
    if (!r) return undefined;
    days.push(...r.downloads.map((d) => d.downloads));
  }
  // npm counts a day only once it is over: today and yesterday may still read 0.
  while (days.length && days[days.length - 1] === 0) days.pop();
  return days;
}

async function appDownloads(): Promise<{ mac: number; windows: number } | undefined> {
  const rs = await json<{ assets: { name: string; download_count: number }[] }[]>("https://api.github.com/repos/HarshBaldaniya/airband/releases?per_page=100", { accept: "application/vnd.github+json" });
  if (!rs) return undefined;
  // The installers people download, not the update files installed apps fetch by themselves.
  const count = (end: RegExp) => rs.flatMap((r) => r.assets).filter((a) => end.test(a.name)).reduce((n, a) => n + a.download_count, 0);
  return { mac: count(/\.dmg$/), windows: count(/\.exe$/) };
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

export async function stats(): Promise<Stats> {
  const [days, app] = await Promise.all([npmDays(), appDownloads()]);
  const apps = app ? { appDownloads: app.mac + app.windows, macDownloads: app.mac, windowsDownloads: app.windows } : {};
  if (!days) return apps;
  return {
    npmTotal: sum(days),
    npmWeek: sum(days.slice(-7)),
    ...(days.length >= 14 ? { npmWeekBefore: sum(days.slice(-14, -7)) } : {}),
    npmDaily: days.slice(-SHOWN_DAYS),
    npmFrom: day(Date.parse(FIRST_DAY) + Math.max(0, days.length - SHOWN_DAYS) * DAY_MS),
    ...apps,
  };
}
