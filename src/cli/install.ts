// Installing Airband itself: setting every agent up, adding and updating the `airband` command with
// the package manager that installed it, and Tab completion.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { isAgentId } from "../core/agents";
import { airbandHome } from "../core/paths";
import { agentSummary, installedVersion, latestVersion, NPM_PACKAGE, setup, type AgentSummary } from "../core/setup";
import { newer, VERSION } from "../core/version";
import { CHANGELOG } from "./about";
import { changesSince } from "./changes";
import { commandInstalled, json, option, self, theCommand } from "./context";
import { globalInstall, globalUninstall, oldCommand, pmCommand, startedBy, type OurCommand, type PackageManager } from "./package-managers";
import { completionOn, currentShell, refreshCompletion, turnCompletionOn } from "./shell";
import { out, paint } from "./ui";

/** How long a global install and an uninstall may take: npm on a slow network is slow. */
const INSTALL_MS = 3 * 60_000;
const UNINSTALL_MS = 2 * 60_000;

/** `airband update`: the newest version from npm, then every agent set up again with it. */
export async function update(checkOnly: boolean): Promise<number> {
  const latest = await latestVersion({ force: true, timeoutMs: 6000 });
  if (!latest) {
    out(`  Couldn't reach npm. Try again when you are online.`);
    return 1;
  }
  const current = !newer(latest, VERSION);
  if (checkOnly) {
    out(current ? `Airband ${VERSION} is the newest.` : `Airband ${latest} is out (you have ${VERSION}). Run: ${self()} update  ${paint.dim(CHANGELOG)}`);
    return 0;
  }
  if (current) {
    // Already the newest: refresh every agent from this copy, in case anything drifted.
    await setup({ fromDir: __dirname });
    out(`\n  ${paint.ok("✓")} Airband ${VERSION} is the newest, and every agent is refreshed.\n`);
    return 0;
  }
  out(`\n  Updating Airband ${VERSION} → ${latest} ...\n`);
  const spec = `${NPM_PACKAGE}@${latest}`;
  const c = theCommand();
  if (c) {
    // The airband command: update it with the package manager that installed it, then let the
    // new version set every agent up.
    const g = globalInstall(c.by, spec);
    const code = run(pmCommand(g.bin, g.args));
    if (code !== 0) {
      out(`\n  ${paint.bad("✗")} ${g.bin} couldn't update it. Try: ${[g.bin, ...g.args].join(" ")}`);
      return code;
    }
    const win = process.platform === "win32";
    return run(win ? { cmd: `"${c.path}" setup --no-command`, args: [], shell: true } : { cmd: c.path, args: ["setup", "--no-command"], shell: false });
  }
  const pm = startedBy();
  const once: [PackageManager | "npx", string[]] =
    pm === "pnpm" ? ["pnpm", ["dlx", spec, "setup"]] : pm === "bun" ? ["bun", ["x", spec, "setup"]] : pm === "yarn" && !/^yarn\/1\./.test(process.env.npm_config_user_agent ?? "") ? ["yarn", ["dlx", spec, "setup"]] : ["npx", ["-y", spec, "setup"]];
  return run(pmCommand(...once));
}

export async function runSetup(rest: string[], all: string[]): Promise<number> {
  const agents = option(rest, "--agents")?.split(",").map((a) => a.trim().toLowerCase()).filter(isAgentId);
  if (!all.includes("--json")) out(`\n  ${paint.bold(`Airband ${VERSION}`)}  ${paint.dim("setting up your agents")}`);
  // The version that was set up before this one, to say what changed once it's done.
  const before = installedVersion();
  // `--node <path>`: the Node the hook and tools run with (the desktop app's own, when the computer has none).
  const node = option(rest, "--node");
  const r = await setup({ fromDir: __dirname, agents, sharing: !all.includes("--no-sharing"), skills: !all.includes("--no-skills"), ...(node ? { node } : {}) });
  // `--json`: what the desktop app's setup tour reads.
  if (all.includes("--json")) {
    json({ version: VERSION, agents: r.agents, codexTrust: r.codexTrust, lines: r.lines, list: agentSummary(), command: r.agents.length ? appCommand(all, node) : null });
    return r.agents.length ? 0 : 1;
  }
  if (!r.agents.length) {
    out(`\n  No Claude Code, Codex or Gemini CLI found on this computer. Install one, then run: ${self()}\n`);
    return 1;
  }
  // The details (what changed, which files were backed up) only when asked, or when something failed.
  const details = all.includes("--verbose") ? r.lines : r.lines.filter((l) => /couldn't|failed|error/i.test(l));
  if (details.length) out(`\n${details.map((l) => `  ${paint.dim(l)}`).join("\n")}`);
  const list = agentSummary();
  printAgents(list);
  // Like pip: after the first `npm create airband`, plain `airband` works in any terminal.
  if (!all.includes("--no-command")) {
    const c = addCommand();
    const pad = Math.max(...list.map((a) => a.name.length)) + 3;
    if (c === true) out(`  ${paint.ok("✓")} ${"airband".padEnd(pad)}the command, in any new terminal`);
    else if (c) out(`  ${paint.warn("!")} ${"airband".padEnd(pad)}${paint.dim(`couldn't add the command (${c}); ${self()} does the same`)}`);
  }
  if (retireOldCommand()) out(`  ${paint.ok("✓")} ${"crosstalk".padEnd(Math.max(...list.map((a) => a.name.length)) + 3)}${paint.dim("the old command, replaced by airband")}`);
  await completionStep(all, Math.max(...list.map((a) => a.name.length)) + 3);
  if (r.codexTrust) out(`\n  ${paint.warn("!")} One step left for Codex: type /hooks in Codex and trust Airband's hook.`);
  const news = before && newer(VERSION, before) ? changesSince(before, VERSION) : [];
  if (news.length) {
    out(`\n  ${paint.bold(`What's new since ${before}`)}`);
    for (const n of news) out(`\n  ${paint.accent(n.version)}\n${n.notes.split("\n").map((l) => `  ${l}`).join("\n")}`);
  }
  out(`\n  Done. Restart open agent chats to pick it up.`);
  out(`  ${paint.dim(`Check any time: ${self()} doctor · every command: ${self()} help`)}\n`);
  return list.every((a) => a.tools) ? 0 : 1;
}

/** Tab completion: kept current where it is on; offered once, with a question, where it isn't.
 *  --completion turns it on without asking, --no-completion leaves it alone; no terminal, no question. */
async function completionStep(all: string[], pad: number): Promise<void> {
  if (all.includes("--no-completion")) return;
  refreshCompletion();
  const shell = currentShell();
  if (!shell || completionOn(shell)) return;
  let yes = all.includes("--completion");
  if (!yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const a = (await rl.question(`  ? ${"Tab".padEnd(pad)}complete airband commands in ${shell}? ${paint.dim("(Y/n)")} `)).trim().toLowerCase();
      yes = a === "" || a === "y" || a === "yes";
    } finally {
      rl.close();
    }
  }
  if (!yes) return;
  try {
    turnCompletionOn(shell);
    out(`  ${paint.ok("✓")} ${"Tab".padEnd(pad)}completion in ${shell}, in any new terminal`);
  } catch (err) {
    out(`  ${paint.warn("!")} ${"Tab".padEnd(pad)}${paint.dim(`couldn't turn on completion (${err instanceof Error ? err.message : String(err)})`)}`);
  }
}

export function printAgents(list: AgentSummary[]): void {
  if (!list.length) {
    out(`\n  No Claude Code, Codex or Gemini CLI found. Install one, then run: ${self()}`);
    return;
  }
  const width = Math.max(...list.map((a) => a.name.length)) + 3;
  out("");
  for (const a of list) {
    const has = [a.plugin ? "tools and skills (plugin)" : a.tools ? "tools" : "", a.skills ? "skills" : "", a.sharing ? "auto-sharing" : ""].filter(Boolean);
    const off = [!a.tools ? "tools missing" : "", a.skills === false ? "no skills" : "", !a.sharing ? "auto-sharing off" : ""].filter(Boolean);
    out(`  ${a.tools ? paint.ok("✓") : paint.bad("✗")} ${a.name.padEnd(width)}${has.join(" · ")}${off.length ? paint.dim(`${has.length ? " · " : ""}${off.join(" · ")}`) : ""}`);
  }
}

/** The desktop app's tour adds the `airband` command too, as `npx airband` does: "added" or
 *  "there", a reason when it couldn't, or "own-node" when the app runs on the Node.js it fetched
 *  for itself (a command installed with that one wouldn't be on the terminal's PATH). */
function appCommand(all: string[], node: string | undefined): string | null {
  if (all.includes("--no-command")) return null;
  if (node && path.resolve(node).startsWith(path.join(airbandHome(), "runtime") + path.sep)) return "own-node";
  // One already there is kept when it is this version, and updated when it is older (the app
  // updates its engine by itself, and the command follows it).
  const have = theCommand();
  if (have && commandVersion(have.path) === VERSION) return "there";
  const c = addCommand(!!have);
  return c === true ? (have ? "updated" : "added") : c === undefined ? "there" : c;
}

/** The version of the airband package a command on the PATH runs, when it can be read. */
function commandVersion(file: string): string | undefined {
  try {
    let dir = path.dirname(fs.realpathSync(file));
    for (let i = 0; i < 4; i++) {
      const pkg = path.join(dir, "package.json");
      if (fs.existsSync(pkg)) {
        const p = JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string; version?: string };
        if (p.name === NPM_PACKAGE) return p.version;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // A script that names the package (pnpm, Windows): its version can't be read.
  }
  return undefined;
}

/** Installs this version as the `airband` command, with the package manager that started this
 *  run (npm when that one can't: Yarn 2+, or pnpm without a global folder). True when added, a
 *  reason when it couldn't be, undefined when it was already there. `replace`: install this
 *  version over the one there. */
function addCommand(replace = false): true | string | undefined {
  const have = theCommand();
  if (have && !replace) return undefined;
  const spec = process.env.AIRBAND_PACKAGE_SPEC || `${NPM_PACKAGE}@${VERSION}`;
  // Replacing one: with the package manager that installed it, so it stays in the same place.
  const tries = [have && replace ? have.by : startedBy(), "npm" as const].filter((pm, i, all) => all.indexOf(pm) === i);
  let why = "";
  for (const pm of tries) {
    const g = globalInstall(pm, spec);
    const c = pmCommand(g.bin, g.args);
    const r = spawnSync(c.cmd, c.args, { encoding: "utf8", shell: c.shell, windowsHide: true, timeout: INSTALL_MS });
    if (r.status === 0) {
      // Installed: from now on it is `airband` (this run's PATH may still show the temporary one first).
      commandInstalled({ path: "airband", by: g.bin === "npm" ? "npm" : pm, pkg: NPM_PACKAGE });
      return true;
    }
    why = `${r.stderr ?? ""}${r.stdout ?? ""}`;
  }
  return /EEXIST/.test(why)
    ? "another airband command is in the way"
    : /EACCES|EPERM|permission/i.test(why)
      ? "global installs need admin rights here"
      : /E404|404/.test(why)
        ? "not on npm yet"
        : "the install failed";
}

/** Uninstalls the command left by Airband's earlier name (legacy.ts), with the package manager
 *  that installed it. True when one was removed. */
function retireOldCommand(): boolean {
  const old = oldCommand();
  if (!old) return false;
  const u = globalUninstall(old.by, old.pkg);
  const c = pmCommand(u.bin, u.args);
  return spawnSync(c.cmd, c.args, { encoding: "utf8", shell: c.shell, windowsHide: true, timeout: UNINSTALL_MS }).status === 0;
}

/** Uninstalls the `airband` command with the package manager that installed it. */
export function retireCommand(c: OurCommand): boolean {
  const u = globalUninstall(c.by, c.pkg);
  const r = pmCommand(u.bin, u.args);
  return spawnSync(r.cmd, r.args, { encoding: "utf8", shell: r.shell, windowsHide: true, timeout: UNINSTALL_MS }).status === 0;
}

function run(c: { cmd: string; args: string[]; shell: boolean }): number {
  return spawnSync(c.cmd, c.args, { stdio: "inherit", shell: c.shell, windowsHide: true }).status ?? 1;
}
