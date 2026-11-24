// How many people fetched Airband, read when the site is built, never from a visitor's browser
// (the site sends nothing about visitors anywhere). Every deploy refreshes the numbers. A number
// that can't be read is left out, never guessed.

const PACKAGE = "airband";
/** npm's download counts start the day the package was first published. */
const FIRST_DAY = "2026-11-15";
/** npm answers at most about 18 months per request: a year a request is safe. */
const SPAN_DAYS = 365;
const DAY_MS = 86_400_000;

export interface Stats {
  /** npm downloads since the first version: `npx airband`, installs, and the desktop app's engine. */
  npmTotal?: number;
  /** npm downloads in the last 7 days npm has counted. */
  npmWeek?: number;
  /** Downloads of the desktop app's installers (.dmg, .exe) from every GitHub release. */
  appDownloads?: number;
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

async function npmTotal(): Promise<number | undefined> {
  let total = 0;
  const end = Date.now();
  for (let from = Date.parse(FIRST_DAY); from <= end; from += SPAN_DAYS * DAY_MS) {
    const to = Math.min(end, from + (SPAN_DAYS - 1) * DAY_MS);
    const r = await json<{ downloads: { downloads: number }[] }>(`https://api.npmjs.org/downloads/range/${day(from)}:${day(to)}/${PACKAGE}`);
    if (!r) return undefined;
    total += r.downloads.reduce((n, d) => n + d.downloads, 0);
  }
  return total;
}

async function appDownloads(): Promise<number | undefined> {
  const rs = await json<{ assets: { name: string; download_count: number }[] }[]>("https://api.github.com/repos/HarshBaldaniya/airband/releases?per_page=100", { accept: "application/vnd.github+json" });
  if (!rs) return undefined;
  // The installers people download, not the update files installed apps fetch by themselves.
  return rs.flatMap((r) => r.assets).filter((a) => /\.(dmg|exe)$/.test(a.name)).reduce((n, a) => n + a.download_count, 0);
}

export async function stats(): Promise<Stats> {
  const [total, week, app] = await Promise.all([npmTotal(), json<{ downloads: number }>(`https://api.npmjs.org/downloads/point/last-week/${PACKAGE}`), appDownloads()]);
  return { npmTotal: total, npmWeek: week?.downloads, appDownloads: app };
}
