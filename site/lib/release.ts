// What the site says about releases comes from the repository and GitHub at build time, never
// typed in: the version (package.json), the notes (CHANGELOG.md) and each download's size and
// fingerprint (the release on GitHub). Each button gets the newest release that has its file: while
// a new release is still being built (or one system's build failed), that system's button stays on
// the version before. If GitHub can't be reached, the links follow the version, without sizes.
// GitHub is asked again at every build: the build script clears Next's saved answers first, or a
// build after a release would still see the release as it was at an earlier build.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "./site";
import type { Download } from "./download";

const repo = join(process.cwd(), "..");

export const VERSION: string = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;

/** The release files' names, with {version} in them: desktop/downloads.json, which the release
 *  scripts and the app read too. */
const NAMES: Record<string, string> = JSON.parse(readFileSync(join(repo, "desktop", "downloads.json"), "utf8"));
const named = (key: string) => (v: string) => NAMES[key].split("{version}").join(v);

/** Each download, and its file's name in a release of version `v`. */
const FILES: (Omit<Download, "url" | "file" | "version"> & { name: (v: string) => string })[] = [
  { platform: "mac-arm", label: "Mac with Apple silicon", detail: "M1 or later", name: named("mac-arm") },
  { platform: "mac-intel", label: "Mac with Intel", detail: "macOS 11 or later", name: named("mac-intel") },
  { platform: "windows", label: "Windows", detail: "Windows 10 or 11, 64-bit", name: named("windows") },
];

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; size: number; digest?: string; browser_download_url: string }[];
}

/** When each version was published on GitHub ("0.1.1" → ISO date), as far as GitHub answers. */
export async function releaseDates(): Promise<Record<string, string>> {
  try {
    const r = await fetch("https://api.github.com/repos/HarshBaldaniya/airband/releases?per_page=100", { headers: { accept: "application/vnd.github+json" } });
    if (r.ok) return Object.fromEntries(((await r.json()) as { tag_name: string; published_at: string }[]).map((x) => [x.tag_name.replace(/^v/, ""), x.published_at]));
  } catch {
    // Offline build: versions without dates.
  }
  return {};
}

export async function downloads(): Promise<Download[]> {
  let releases: GitHubRelease[] = [];
  try {
    const r = await fetch("https://api.github.com/repos/HarshBaldaniya/airband/releases?per_page=20", { headers: { accept: "application/vnd.github+json" } });
    if (r.ok) releases = ((await r.json()) as GitHubRelease[]).filter((x) => !x.draft && !x.prerelease);
  } catch {
    // Offline build: links to this version, without sizes.
  }
  return FILES.map(({ name, ...f }) => {
    // GitHub lists the newest first.
    for (const rel of releases) {
      const v = rel.tag_name.replace(/^v/, "");
      const a = rel.assets.find((x) => x.name === name(v));
      if (a) return { ...f, file: a.name, version: v, url: a.browser_download_url, size: a.size, digest: a.digest };
    }
    return { ...f, file: name(VERSION), version: VERSION, url: `${SITE.repo}/releases/download/v${VERSION}/${name(VERSION)}` };
  });
}

// ---- the changelog ----

export interface Release {
  version: string;
  items: string[];
}

/** CHANGELOG.md as versions and their bullet points. Each bullet is one string, its wrapped lines
 *  joined. A bullet with points of its own keeps them on their own lines ("\n- point"), and a line
 *  after them on its own line too ("\nRoger never …"). */
export function changelog(): Release[] {
  const text = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
  const out: Release[] = [];
  for (const line of text.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      out.push({ version: h[1].trim(), items: [] });
      continue;
    }
    const cur = out.at(-1);
    if (!cur) continue;
    if (/^- /.test(line)) cur.items.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && cur.items.length) {
      const last = cur.items.length - 1;
      const indent = /^\s*/.exec(line)![0].length;
      const text = line.trim();
      // "  - a point", "    its wrapped line", "  a line after the points"
      if (indent < 4 && text.startsWith("- ")) cur.items[last] += `\n${text}`;
      else if (indent < 4 && cur.items[last].includes("\n- ")) cur.items[last] += `\n${text}`;
      else cur.items[last] += ` ${text}`;
    }
  }
  return out.filter((r) => r.version !== "Unreleased" && r.items.length);
}
