// Checks what a release depends on agreeing, without building anything:
//   - one version: package.json's, in every file that keeps a copy (scripts/set-version.mjs sets
//     them all), and tauri.conf.json reading it from package.json;
//   - one set of download names: desktop/downloads.json, which the release scripts, the site and
//     the app read, and which the two install scripts spell out (they run on their own, from the
//     site, so they can't read it).
// Run: node scripts/check-release.mjs (CI runs it in .github/workflows/test.yml).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { download, VERSION } from "./release-names.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const read = (f) => readFileSync(f, "utf8");
const json = (f) => JSON.parse(read(f));
const problems = [];

// ---- the version ----
const copies = {
  ".claude-plugin/plugin.json": json(".claude-plugin/plugin.json").version,
  "gemini-extension.json": json("gemini-extension.json").version,
  "desktop/src-tauri/Cargo.toml": /^\[package\][^[]*?\nversion = "([^"]*)"/m.exec(read("desktop/src-tauri/Cargo.toml"))?.[1],
  "desktop/src-tauri/Cargo.lock": /^name = "airband"\nversion = "([^"]*)"/m.exec(read("desktop/src-tauri/Cargo.lock"))?.[1],
};
for (const [file, v] of Object.entries(copies)) {
  if (v !== VERSION) problems.push(`${file} has version ${v ?? "(none)"}, package.json ${VERSION}: run node scripts/set-version.mjs ${VERSION}`);
}
if (json("desktop/src-tauri/tauri.conf.json").version !== "../../package.json") {
  problems.push(`desktop/src-tauri/tauri.conf.json's "version" should be "../../package.json", so the app has package.json's`);
}
if ("version" in json("desktop/package.json")) problems.push("desktop/package.json has a version: nothing reads it, so it only goes stale");

// ---- the download names ----
const mustSay = (file, text, why) => {
  if (!read(file).includes(text)) problems.push(`${file} doesn't say ${text} (${why})`);
};
// install.sh picks Apple-Silicon or Intel, then looks for the release file ending -<kind>.dmg, or
// names it Airband-$v-$kind.dmg.
const kinds = { "mac-arm": "Apple-Silicon", "mac-intel": "Intel" };
for (const [key, kind] of Object.entries(kinds)) {
  const name = download(key, "$v");
  if (!name.endsWith(`-${kind}.dmg`)) problems.push(`desktop/downloads.json's ${key} no longer ends -${kind}.dmg, as install.sh expects`);
  mustSay("site/public/install.sh", `kind=${kind}`, `the ${key} download`);
  mustSay("site/public/install.sh", name.replace(kind, "$kind"), `the ${key} download, by name`);
}
mustSay("site/public/install.sh", "a.name.endsWith(`-${argv[1]}.dmg`)", "how it finds the Mac download on a release");
mustSay("site/public/install.ps1", download("windows", "$version"), "the Windows installer, by name");
mustSay("site/public/install.ps1", download("windows", "*"), "how it finds the Windows installer on a release");
mustSay("site/lib/release.ts", "downloads.json", "the site's download buttons read the names from it");

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ version ${VERSION} everywhere, and one set of download names`);
