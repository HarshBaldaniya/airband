// Writes desktop/release/latest.json: what an installed Airband app reads to know a newer one is
// out, where each computer's file is and its signature. The release workflow runs it once every
// build's files are in desktop/release, and attaches it to the release; the app asks for it at
// https://github.com/HarshBaldaniya/airband/releases/latest/download/latest.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = JSON.parse(readFileSync("desktop/src-tauri/tauri.conf.json", "utf8")).version;
const dir = "desktop/release";
const base = `https://github.com/HarshBaldaniya/airband/releases/download/v${version}`;
const files = {
  "darwin-aarch64": `Airband-${version}-Apple-Silicon.app.tar.gz`,
  "darwin-x86_64": `Airband-${version}-Intel.app.tar.gz`,
  "windows-x86_64": `Airband-Setup-${version}.exe`,
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
const at = log.indexOf(`## ${version}`);
const notes = at < 0 ? "" : log.slice(at + 1, log.findIndex((l, i) => i > at && l.startsWith("## ")) >>> 0).join("\n").replace(/\*\*/g, "").trim();
writeFileSync(join(dir, "latest.json"), `${JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);
console.log(`latest.json: ${version} for ${Object.keys(platforms).join(", ")}`);
