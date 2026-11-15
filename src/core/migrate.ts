// Airband was first called Relay, then Crosstalk. Its data moves to the new names once:
//   ~/.relay, ~/.crosstalk                → ~/.airband   (links, inboxes, status, flightlogs, the Map, settings)
//   <project>/.relay, <project>/.crosstalk → <project>/.airband  (the Tower's layout, notes)
//   sessions/                              → flightlogs/
// A window still running the old version may write to the old folder until it is reloaded, so
// both can exist: whatever the new folder doesn't have yet moves in, and the old folder goes.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Files an old version wrote that this one makes afresh: its programs, its version stamp (which
 *  would otherwise read as a newer install), its update check and its Tab-completion scripts. */
const OLD_ONLY = new Set([
  "relay-hook.js",
  "relay-mcp.js",
  "crosstalk-hook.js",
  "crosstalk-mcp.js",
  "crosstalk.js",
  "version.json",
  "update-check.json",
  "completion.zsh",
  "completion.bash",
]);

/** The folders Airband's data lived in under its earlier names, oldest first. */
export const OLD_HOME_NAMES = [".relay", ".crosstalk"];
const RENAMED: Record<string, string> = { sessions: "flightlogs" };

/** Moves one folder's contents into another, keeping whatever the new one already has. */
function merge(from: string, to: string): number {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let moved = 0;
  for (const name of fs.readdirSync(from)) {
    if (OLD_ONLY.has(name)) continue;
    const src = path.join(from, name);
    const dest = path.join(to, RENAMED[name] ?? name);
    if (!fs.existsSync(dest)) {
      fs.renameSync(src, dest);
      moved++;
    } else if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
      moved += merge(src, dest);
    }
    // A file both have: the new folder's copy is newer (written by this version), so it stays.
  }
  fs.rmSync(from, { recursive: true, force: true });
  return moved;
}

/** ~/.relay and ~/.crosstalk into Airband's home. Returns how many things moved. */
export function moveOldHome(home: string, olds = OLD_HOME_NAMES.map((n) => path.join(os.homedir(), n))): number {
  try {
    let moved = 0;
    for (const old of olds) moved += merge(old, home);
    // Records kept under their old folder name inside the new home, too.
    if (fs.existsSync(path.join(home, "sessions"))) merge(path.join(home, "sessions"), path.join(home, "flightlogs"));
    return moved;
  } catch {
    // Left for the next start.
    return 0;
  }
}

/** <project>/.relay and <project>/.crosstalk into <project>/.airband. */
export function moveOldWorkspace(root: string, to: string): number {
  try {
    let moved = 0;
    for (const n of OLD_HOME_NAMES) moved += merge(path.join(root, n), to);
    return moved;
  } catch {
    return 0;
  }
}
