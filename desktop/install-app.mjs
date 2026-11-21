// Builds the app and puts it in Applications on this Mac, then opens it: the one step for running it
// from source. (The release build on GitHub does the same for everyone, signed.)
//   npm run desktop:install      (from the repository root)
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (process.platform !== "darwin") {
  console.error("This installs the Mac app. On Windows, build it with: npm run desktop:dist");
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: here, stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("node", ["build.mjs"]);
run(join(here, "node_modules", ".bin", "electron-builder"), ["--dir", "--mac", `--${process.arch}`]);
const out = join(here, "release");
const folder = readdirSync(out).find((d) => d.startsWith("mac") && existsSync(join(out, d, "Airband.app")));
if (!folder) {
  console.error("The build made no Airband.app.");
  process.exit(1);
}
const built = join(out, folder, "Airband.app");
// Not signed by a developer account: sign it for this Mac only, so macOS runs it.
execFileSync("codesign", ["--force", "--deep", "--sign", "-", built], { stdio: "inherit" });
// Quit a running copy first, so the new one starts.
spawnSync("osascript", ["-e", 'tell application "Airband" to quit'], { stdio: "ignore" });
spawnSync("pkill", ["-f", "Airband.app/Contents/MacOS/Airband"], { stdio: "ignore" });
const apps = existsSync("/Applications") && spawnSync("test", ["-w", "/Applications"]).status === 0 ? "/Applications" : join(homedir(), "Applications");
const dest = join(apps, "Airband.app");
rmSync(dest, { recursive: true, force: true });
cpSync(built, dest, { recursive: true, verbatimSymlinks: true });
console.log(`\nInstalled ${dest}. Opening it…`);
spawnSync("open", [dest], { stdio: "inherit" });
