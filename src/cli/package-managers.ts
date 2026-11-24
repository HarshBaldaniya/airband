// npm, pnpm, yarn and bun: which one started Airband, which one owns the `airband` command, and
// how to run each without a shell where one isn't needed. The same on macOS, Windows and Linux.
import * as fs from "node:fs";
import * as path from "node:path";
import { findCommand } from "../core/process";
import { npmCommand, NPM_PACKAGE, OLD_PACKAGES } from "../core/setup";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** The package manager that started this run (`pnpm dlx airband`, `bunx airband` ...):
 *  each sets npm_config_user_agent to "<name>/<version> ...". */
export function startedBy(ua = process.env.npm_config_user_agent ?? ""): PackageManager {
  const name = ua.split("/")[0];
  return name === "pnpm" || name === "yarn" || name === "bun" ? name : "npm";
}

const yarnClassic = (ua = process.env.npm_config_user_agent ?? "") => /^yarn\/1\./.test(ua);

/** How to run Airband once, without installing it, with this package manager. */
export function oneOff(pm: PackageManager, ua?: string): string {
  if (pm === "pnpm") return `pnpm dlx ${NPM_PACKAGE}`;
  if (pm === "bun") return `bunx ${NPM_PACKAGE}`;
  if (pm === "yarn" && !yarnClassic(ua)) return `yarn dlx ${NPM_PACKAGE}`;
  return `npx ${NPM_PACKAGE}`;
}

/** How each package manager takes a global package out again. */
export function globalUninstall(pm: PackageManager, name: string, ua?: string): { bin: PackageManager; args: string[] } {
  if (pm === "pnpm") return { bin: "pnpm", args: ["remove", "--global", name] };
  if (pm === "bun") return { bin: "bun", args: ["remove", "--global", name] };
  if (pm === "yarn" && yarnClassic(ua)) return { bin: "yarn", args: ["global", "remove", name] };
  return { bin: "npm", args: ["uninstall", "--global", "--loglevel=error", name] };
}

/** How each package manager adds a command for good. Yarn 2+ has no global installs: npm does it. */
export function globalInstall(pm: PackageManager, spec: string, ua?: string): { bin: PackageManager; args: string[] } {
  if (pm === "pnpm") return { bin: "pnpm", args: ["add", "--global", spec] };
  if (pm === "bun") return { bin: "bun", args: ["add", "--global", spec] };
  if (pm === "yarn" && yarnClassic(ua)) return { bin: "yarn", args: ["global", "add", spec] };
  return { bin: "npm", args: ["install", "--global", "--no-fund", "--no-audit", "--loglevel=error", spec] };
}

/** A package manager's command, ready for spawn. npm goes through the npm beside this Node.js; on
 *  Windows the others are .cmd files only a shell can start, so they get one quoted line. */
export function pmCommand(bin: PackageManager | "npx", args: string[]): { cmd: string; args: string[]; shell: boolean } {
  if (bin === "npm" || bin === "npx") return npmCommand(bin, args);
  if (process.platform !== "win32") return { cmd: bin, args, shell: false };
  return { cmd: [bin, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" "), args: [], shell: true };
}

/** A `airband` that only exists for one run: `npm create airband`, npx, pnpm dlx, yarn dlx and
 *  bunx put the package's own node_modules/.bin (with Airband's command in it) at the front of
 *  the PATH while they run. That one is gone afterwards, so it doesn't count as installed. */
export function temporary(file: string): boolean {
  return /[\\/]node_modules[\\/]\.bin[\\/]|[\\/]_npx[\\/]|[\\/]dlx[\\/-]|[\\/]bunx-|[\\/]xfs-/i.test(file);
}

export interface OurCommand {
  /** Where `airband` is on the PATH. */
  path: string;
  /** Which package manager installed it, so `airband update` uses the same one. */
  by: PackageManager;
  /** The package it came from: NPM_PACKAGE, or an older name that is replaced on the next setup. */
  pkg: string;
}

/** Airband's own `airband` command on the PATH, if there is one (another program could use the
 *  name). npm, yarn and bun link it into the package; pnpm, and every manager on Windows, write a
 *  small script that names the package. */
/** The first real command of this name on the PATH, looking past the temporary ones npx and
 *  friends put in front while they run (stopping at the first match would never see the installed
 *  one behind it). Falls back to the login shell's PATH for a process started with a short one. */
export function findOnPath(name: string, env = process.env, platform = process.platform): string | undefined {
  const names = platform === "win32" ? [`${name}.cmd`, `${name}.exe`, `${name}.ps1`, name] : [name];
  for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      if (temporary(p)) continue;
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        // Not in this folder.
      }
    }
  }
  const viaShell = findCommand(name);
  return viaShell && !temporary(viaShell) ? viaShell : undefined;
}

/** A command, if it was installed from one of these packages: where it is, which package and which
 *  package manager (another program could use the same name). npm, yarn and bun link it into the
 *  package; pnpm, and every manager on Windows, write a small script that names the package. */
function commandFrom(found: string | undefined, packages: string[]): OurCommand | undefined {
  if (!found || temporary(found)) return undefined;
  let where = "";
  try {
    where = fs.realpathSync(found);
  } catch {
    return undefined;
  }
  const inPath = (name: string, t: string) => new RegExp(`[\\\\/]node_modules[\\\\/]${name.replace("/", "[\\\\/]")}[\\\\/]`).test(t);
  let text = where;
  let pkg = packages.find((n) => inPath(n, where));
  if (!pkg) {
    try {
      if (fs.statSync(where).size > 64 * 1024) return undefined;
      text = fs.readFileSync(where, "utf8");
    } catch {
      return undefined;
    }
    pkg = packages.find((n) => inPath(n, text) || fs.existsSync(path.join(path.dirname(found), "node_modules", ...n.split("/"))));
    if (!pkg) return undefined;
  }
  const by: PackageManager = /pnpm/i.test(text) ? "pnpm" : /[\\/]\.bun[\\/]/.test(text) ? "bun" : /yarn/i.test(text) ? "yarn" : "npm";
  return { path: found, by, pkg };
}

/** The `airband` command, when it is Airband's. */
export function ourCommand(found = findOnPath("airband")): OurCommand | undefined {
  return commandFrom(found, [NPM_PACKAGE]);
}

/** The `crosstalk` command from Airband's earlier name (the crosstalk-ai package): uninstalled by
 *  setup and update, since `airband` takes its place. */
export function oldCommand(found = findOnPath("crosstalk")): OurCommand | undefined {
  return commandFrom(found, OLD_PACKAGES);
}
