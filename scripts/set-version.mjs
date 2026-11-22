// One version everywhere: `node scripts/set-version.mjs 0.1.0` sets it in the extension, the npm
// package (built from package.json), the Claude Code plugin, the Gemini CLI extension and both
// desktop apps (desktop/, and the small one in desktop-lite/, whose installers carry it). The two
// start bin/mcp.cjs, which runs the airband version in package.json. A plugin's version is what
// tells Claude Code there's an update.
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v ?? "")) {
  console.error("Usage: node scripts/set-version.mjs <x.y.z>");
  process.exit(2);
}
const edit = (file, change) => {
  const json = JSON.parse(readFileSync(file, "utf8"));
  change(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${file} → ${v}`);
};
edit("package.json", (j) => (j.version = v));
edit(".claude-plugin/plugin.json", (j) => (j.version = v));
edit("gemini-extension.json", (j) => (j.version = v));
edit("desktop/package.json", (j) => (j.version = v));
edit("desktop-lite/package.json", (j) => (j.version = v));
edit("desktop-lite/src-tauri/tauri.conf.json", (j) => (j.version = v));
// Cargo's files are TOML: only the app's own package line changes.
const cargo = (file, re) => {
  const text = readFileSync(file, "utf8");
  if (!re.test(text)) return console.log(`${file}: no version line found, set it by hand`);
  writeFileSync(file, text.replace(re, (_, head) => `${head}"${v}"`));
  console.log(`${file} → ${v}`);
};
cargo("desktop-lite/src-tauri/Cargo.toml", /^(\[package\][^[]*?\nversion = )"[^"]*"/m);
cargo("desktop-lite/src-tauri/Cargo.lock", /^(name = "airband"\nversion = )"[^"]*"/m);
// The notes written under "## Unreleased" become this version's: `airband changelog` and the
// "What's new" after an update read them from here.
const log = readFileSync("CHANGELOG.md", "utf8");
if (/^## Unreleased\s*$/m.test(log)) {
  writeFileSync("CHANGELOG.md", log.replace(/^## Unreleased\s*$/m, `## ${v}`));
  console.log(`CHANGELOG.md: Unreleased → ${v}`);
} else console.log(`CHANGELOG.md has no "## Unreleased" section: add the notes for ${v} by hand.`);
console.log("Then: npm test, npm run publish:npm, commit, tag v" + v + " (git tag -a) and push with --follow-tags.");
