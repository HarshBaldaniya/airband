// Gives the desktop app's downloads the names people expect, in desktop/release/ (the names are
// in desktop/downloads.json):
//   Airband-<version>-Apple-Silicon.dmg   (Macs with an M1 or later)
//   Airband-<version>-Intel.dmg           (older Macs)
//   Airband-Setup-<version>.exe           (Windows)
// and the files the installed app updates itself from (each with its signature, .sig):
//   Airband-<version>-Apple-Silicon.app.tar.gz, Airband-<version>-Intel.app.tar.gz
//   Airband-Setup-<version>.exe.sig       (Windows updates from the installer itself)
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { download, VERSION } from "./release-names.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const out = "desktop/release";
mkdirSync(out, { recursive: true });
const target = "desktop/src-tauri/target";
const mac = (arch, kind) => join(target, `${arch}-apple-darwin/release/bundle/${kind}`);
// Built on Windows (CI), or from a Mac with cargo-xwin (npm run app:build:windows-on-mac).
const nsis = [join(target, "release/bundle/nsis"), join(target, "x86_64-pc-windows-msvc/release/bundle/nsis")];
const kinds = [
  { dir: mac("aarch64", "dmg"), match: /\.dmg$/, to: download("mac-arm") },
  { dir: mac("x86_64", "dmg"), match: /\.dmg$/, to: download("mac-intel") },
  { dir: nsis, match: /-setup\.exe$/i, to: download("windows") },
  // For updates: the app bundle packed with its signature, and the Windows installer's signature.
  { dir: mac("aarch64", "macos"), match: /\.app\.tar\.gz$/, to: download("mac-arm-update") },
  { dir: mac("aarch64", "macos"), match: /\.app\.tar\.gz\.sig$/, to: `${download("mac-arm-update")}.sig` },
  { dir: mac("x86_64", "macos"), match: /\.app\.tar\.gz$/, to: download("mac-intel-update") },
  { dir: mac("x86_64", "macos"), match: /\.app\.tar\.gz\.sig$/, to: `${download("mac-intel-update")}.sig` },
  { dir: nsis, match: /-setup\.exe\.sig$/i, to: `${download("windows")}.sig` },
];
// Names from an earlier way of building go, so the folder holds only what is current (and the
// engine's signature, which scripts/sign-engine.mjs writes here).
const keep = (f) => kinds.some((k) => k.to === f) || f === download("engine-signature");
for (const f of existsSync(out) ? readdirSync(out) : []) if (!keep(f)) rmSync(join(out, f));
let any = false;
for (const k of kinds) {
  const dirs = [k.dir].flat().filter((d) => existsSync(d));
  const file = dirs.flatMap((d) => readdirSync(d).filter((f) => k.match.test(f)).map((f) => join(d, f))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!file) continue;
  copyFileSync(file, join(out, k.to));
  console.log(`${k.to}  ${(statSync(file).size / 1048576).toFixed(2)} MB`);
  any = true;
}
if (!any) console.log(`No build of ${VERSION} found: run npm run app:build first.`);
