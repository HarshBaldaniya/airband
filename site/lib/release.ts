// What the site says about releases comes from the repository and GitHub at build time, never
// typed in: the version (package.json), the notes (CHANGELOG.md) and each download's size and
// fingerprint (the release on GitHub). If GitHub can't be reached, the links still follow the
// version, without sizes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "./site";
import type { Download } from "./download";

export type { Download } from "./download";
export { mb } from "./download";

const repo = join(process.cwd(), "..");

export const VERSION: string = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;

const FILES: Omit<Download, "url">[] = [
  { platform: "mac-arm", label: "Mac with Apple silicon", detail: "M1 or later", file: `Airband-${VERSION}-Apple-Silicon.dmg` },
  { platform: "mac-intel", label: "Mac with Intel", detail: "macOS 11 or later", file: `Airband-${VERSION}-Intel.dmg` },
  { platform: "windows", label: "Windows", detail: "Windows 10 or 11, 64-bit", file: `Airband-Setup-${VERSION}.exe` },
];

/** When this version was published on GitHub, if GitHub answers. */
export async function publishedAt(): Promise<string | undefined> {
  try {
    const r = await fetch(`https://api.github.com/repos/HarshBaldaniya/airband/releases/tags/v${VERSION}`, { headers: { accept: "application/vnd.github+json" } });
    if (r.ok) return (await r.json()).published_at;
  } catch {
    // Offline build.
  }
  return undefined;
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
  const base = `${SITE.repo}/releases/download/v${VERSION}`;
  let assets: { name: string; size: number; digest?: string }[] = [];
  try {
    const r = await fetch(`https://api.github.com/repos/HarshBaldaniya/airband/releases/tags/v${VERSION}`, { headers: { accept: "application/vnd.github+json" } });
    if (r.ok) assets = (await r.json()).assets ?? [];
  } catch {
    // Offline build: links without sizes.
  }
  return FILES.map((f) => {
    const a = assets.find((x) => x.name === f.file);
    return { ...f, url: `${base}/${f.file}`, size: a?.size, digest: a?.digest };
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
