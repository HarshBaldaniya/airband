// Packages Airband and installs it into VS Code, on macOS, Windows or Linux, and into Cursor too
// when it is installed: every editor gets the same Airband, so none runs an older one.
// Each editor's own command is used, never a `code` on the PATH that may belong to another editor.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
// The package `vsce package` just made: name-version.vsix, from package.json (never an older file).
const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
const vsix = `${name}-${version}.vsix`;
const win = process.platform === "win32";
const candidates = process.env.AIRBAND_VSCODE_CLI
  ? [process.env.AIRBAND_VSCODE_CLI]
  : process.platform === "darwin"
    ? ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", join(home, "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")]
    : win
      ? [
          join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Programs", "Microsoft VS Code", "bin", "code.cmd"),
          join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft VS Code", "bin", "code.cmd"),
        ]
      : ["/usr/share/code/bin/code", "/usr/bin/code", "/snap/bin/code", "/opt/visual-studio-code/bin/code"];
const cli = candidates.find((c) => existsSync(c));
if (!cli) {
  console.error(`VS Code's command wasn't found. Looked in:\n  ${candidates.join("\n  ")}\nSet AIRBAND_VSCODE_CLI to its path and run again.`);
  process.exit(1);
}
const run = (args) => execFileSync(win ? `"${cli}"` : cli, args, { stdio: "inherit", shell: win });

// Airband under its earlier names (Relay, Crosstalk): taken out, so only one runs.
for (const old of ["relay-dev.relay", "crosstalk-dev.crosstalk"]) {
  try {
    run(["--uninstall-extension", old]);
  } catch {
    // Not installed: nothing to remove.
  }
}
run(["--install-extension", vsix, "--force"]);
// Cursor runs VS Code extensions too: an older Airband there would take requests meant for VS Code.
const cursor = process.platform === "darwin" ? ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor", join(home, "Applications/Cursor.app/Contents/Resources/app/bin/cursor")].find((c) => existsSync(c)) : undefined;
if (cursor) {
  try {
    execFileSync(cursor, ["--install-extension", vsix, "--force"], { stdio: "inherit" });
  } catch {
    console.log("Cursor is there, but Airband could not be installed into it.");
  }
}
mkdirSync(join(home, ".airband"), { recursive: true });
copyFileSync(join("dist", "airband-hook.js"), join(home, ".airband", "airband-hook.js"));
console.log(`Installed${cursor ? " in VS Code and Cursor" : ""}. Reload the editor windows to use it.`);
