// Writes desktop/release/latest.json: what an installed Airband app reads to know a newer one is
// out, where each computer's file is and its signature. The release workflow runs it once every
// build's files are in desktop/release, and attaches it to the release; the app asks for it at
// the updater's endpoint in tauri.conf.json (.../releases/latest/download/latest.json).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { download, RELEASES, VERSION } from "./release-names.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const dir = "desktop/release";
const base = `${RELEASES}/download/v${VERSION}`;
const files = {
  "darwin-aarch64": download("mac-arm-update"),
  "darwin-x86_64": download("mac-intel-update"),
  "windows-x86_64": download("windows"),
};
const platforms = {};
for (const [platform, file] of Object.entries(files)) {
  const sig = join(dir, `${file}.sig`);
  if (!existsSync(join(dir, file)) || !existsSync(sig)) {
    console.log(`${platform}: no signed file, left out`);
    continue;
  }
  platforms[platform] = { signature: readFileSync(sig, "utf8").trim(), url: `${base}/${file}` };
}
if (!Object.keys(platforms).length) {
  console.error("No signed update files in desktop/release.");
  process.exit(1);
}
// The notes: this version's lines in CHANGELOG.md, as plain text.
const log = readFileSync("CHANGELOG.md", "utf8").split("\n");
const at = log.indexOf(`## ${VERSION}`);
const notes = at < 0 ? "" : log.slice(at + 1, log.findIndex((l, i) => i > at && l.startsWith("## ")) >>> 0).join("\n").replace(/\*\*/g, "").trim();
writeFileSync(join(dir, "latest.json"), `${JSON.stringify({ version: VERSION, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);
console.log(`latest.json: ${VERSION} for ${Object.keys(platforms).join(", ")}`);
