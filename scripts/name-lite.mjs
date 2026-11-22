// Gives the small app's downloads the names people expect, in desktop-lite/release/:
//   Airband-<version>-Apple-Silicon.dmg   (Macs with an M1 or later)
//   Airband-<version>-Intel.dmg           (older Macs)
//   Airband-Setup-<version>.exe           (Windows)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const version = JSON.parse(readFileSync("desktop-lite/src-tauri/tauri.conf.json", "utf8")).version;
const out = "desktop-lite/release";
mkdirSync(out, { recursive: true });
const target = "desktop-lite/src-tauri/target";
const kinds = [
  { dir: join(target, "aarch64-apple-darwin/release/bundle/dmg"), match: /\.dmg$/, to: `Airband-${version}-Apple-Silicon.dmg` },
  { dir: join(target, "x86_64-apple-darwin/release/bundle/dmg"), match: /\.dmg$/, to: `Airband-${version}-Intel.dmg` },
  // Built on Windows (CI), or from a Mac with cargo-xwin (npm run lite:build:windows-on-mac).
  { dir: [join(target, "release/bundle/nsis"), join(target, "x86_64-pc-windows-msvc/release/bundle/nsis")], match: /-setup\.exe$/i, to: `Airband-Setup-${version}.exe` },
];
// Names from an earlier way of building go, so the folder holds only what is current.
for (const f of existsSync(out) ? readdirSync(out) : []) if (!kinds.some((k) => k.to === f)) rmSync(join(out, f));
let any = false;
for (const k of kinds) {
  const dirs = [k.dir].flat().filter((d) => existsSync(d));
  const file = dirs.flatMap((d) => readdirSync(d).filter((f) => k.match.test(f)).map((f) => join(d, f))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!file) continue;
  copyFileSync(file, join(out, k.to));
  console.log(`${k.to}  ${(statSync(file).size / 1048576).toFixed(2)} MB`);
  any = true;
}
if (!any) console.log("No build found: run npm run lite:build first.");
