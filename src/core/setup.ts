// One place that sets Airband up for every agent on this computer, checks it, keeps it current and
// takes it away again. The command line (`airband setup | update | doctor | remove`) and the VS
// Code extension both use it, so the two always do the same thing.
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { airbandFile, airbandHome, guardRealHome, writeFileAtomic } from "./paths";
import { moveOldHome } from "./migrate";
import { connect, disconnect, findClaude, findNode, hookCommandFor, hookTargets, installedHookPath, isToolConnected, staleHookTargets } from "./hooks";
import { agentStates, installToolkit, removeToolkit, type AgentId } from "./toolkit";
import { installSkills, removeSkills, SKILLS, skillsState, type SkillAgent } from "./skills";

export const VERSION = __AIRBAND_VERSION__;
/** The npm package: `npx airband` sets everything up; `npm i -g airband` installs the
 *  `airband` command. */
export const NPM_PACKAGE = "airband";
/** The name Airband was first published under (0.0.1 and 0.0.2). An install of it is replaced by
 *  NPM_PACKAGE: both give the `airband` command, and npm won't let two packages own one command. */
export const OLD_PACKAGES = ["crosstalk-ai"];

const FILES = ["airband-mcp.js", "airband-hook.js", "airband.js"];

/** The Claude Code plugins installed under a name (`airband`, or `crosstalk` from Airband's earlier name). */
function claudePlugins(name: string): boolean {
  try {
    const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "plugins", "installed_plugins.json");
    const plugins = (JSON.parse(fs.readFileSync(file, "utf8")) as { plugins?: Record<string, unknown> }).plugins ?? {};
    return Object.keys(plugins).some((k) => k.split("@")[0] === name);
  } catch {
    return false;
  }
}

/** The Airband plugin is installed in Claude Code: it brings the tools and skills there itself. */
export function claudePluginInstalled(): boolean {
  return claudePlugins("airband");
}

/** The Crosstalk plugin is still installed in Claude Code; its repository is gone, so it no longer works. */
function oldClaudePluginInstalled(): boolean {
  return claudePlugins("crosstalk");
}

/** Copies Airband's runnable pieces into ~/.airband, where every agent's settings point, so an
 *  npx cache or an extension update never leaves an agent pointing at a file that moved. */
export function installFiles(fromDir: string): number {
  const home = airbandHome();
  guardRealHome(home);
  fs.mkdirSync(path.join(home, "wasm"), { recursive: true });
  let n = 0;
  if (path.resolve(fromDir) !== path.resolve(home)) {
    for (const f of FILES) {
      const src = path.join(fromDir, f);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(home, f));
      n++;
    }
    const wasm = path.join(fromDir, "wasm");
    for (const f of fs.existsSync(wasm) ? fs.readdirSync(wasm) : []) fs.copyFileSync(path.join(wasm, f), path.join(home, "wasm", f));
    // The companion's screen, which `airband station` serves (to a browser or a phone).
    const screen = path.join(fromDir, "companion");
    if (fs.existsSync(screen)) {
      fs.mkdirSync(path.join(home, "companion"), { recursive: true });
      for (const f of fs.readdirSync(screen)) fs.copyFileSync(path.join(screen, f), path.join(home, "companion", f));
    }
  }
  writeFileAtomic(airbandFile("version.json"), `${JSON.stringify({ version: VERSION, at: new Date().toISOString() }, null, 2)}\n`);
  return n;
}

/** The version the files in ~/.airband came from, if they were installed by a version that records it. */
export function installedVersion(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(airbandFile("version.json"), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

export interface SetupOptions {
  /** Where airband-mcp.js, airband-hook.js and wasm/ are: the npm package or the extension's dist. */
  fromDir: string;
  /** Only these agents; default: every one installed on this computer. */
  agents?: AgentId[];
  /** Turn on auto-sharing (the hook). Default: on. */
  sharing?: boolean;
  /** Write the skills. Default: on. */
  skills?: boolean;
  /** Claude Code's command; `null` writes its settings file directly (tests never run the real one). */
  claudeCli?: string | null;
  /** The program that runs the hook and the tools. Default: the person's own `node`. */
  node?: string;
}

export interface SetupResult {
  lines: string[];
  agents: AgentId[];
  codexTrust: boolean;
}

/** Everything, for every agent found: files, tools and commands, skills, and the hook. Safe to run
 *  again at any time: each step replaces only Airband's own entries. */
export async function setup(o: SetupOptions): Promise<SetupResult> {
  const lines: string[] = [];
  // A computer that had Airband under an earlier name (Relay, Crosstalk): its data moves over first,
  // then everything below replaces the old entries in each agent. Tests use their own home.
  if (!process.env.AIRBAND_HOME) moveOldHome(airbandHome());
  installFiles(o.fromDir);
  lines.push(`Airband ${VERSION} is in ${airbandHome()}`);
  const present = agentStates().filter((a) => a.present).map((a) => a.id);
  const agents = (o.agents ?? present).filter((a) => present.includes(a));
  if (!agents.length) {
    lines.push("No Claude Code, Codex or Gemini CLI found on this computer. Install one, then run this again.");
    return { lines, agents, codexTrust: false };
  }
  const node = o.node ?? findNode();
  // With the Claude Code plugin, Claude already has the tools and skills: adding them again would
  // give it every tool twice.
  const viaPlugin = agents.includes("claude") && claudePluginInstalled();
  if (viaPlugin) lines.push("Claude Code: the Airband plugin already gives it the tools and skills.");
  lines.push(...(await installToolkit(viaPlugin ? agents.filter((a) => a !== "claude") : agents, { node, claudeCli: o.claudeCli === null ? undefined : (o.claudeCli ?? findClaude()) })));
  if (o.skills !== false) {
    const skillAgents = agents.filter((a): a is SkillAgent => (a === "claude" && !viaPlugin) || a === "codex");
    if (skillAgents.length) {
      installSkills(skillAgents);
      lines.push(`Skills: ${SKILLS.map((k) => k.name).join(", ")} for ${skillAgents.map(agentName).join(" and ")}.`);
    }
  }
  let codexTrust = false;
  if (o.sharing !== false) {
    const want = new Set(agents.map(agentName));
    for (const t of hookTargets()) {
      if (!t.present() || !want.has(agentName(t.tool.toLowerCase() as AgentId))) continue;
      const was = isToolConnected(t);
      connect(hookCommandFor(node, t.tool), t.file, t.events, t.timeout, t.timeouts);
      if (t.tool === "Codex" && !was) codexTrust = true;
    }
    lines.push(`Auto-sharing on for ${[...want].join(", ")}.`);
  }
  return { lines, agents, codexTrust };
}

/** Takes Airband out of every agent's settings. Its own data stays unless `purge`. */
export async function remove(o: { purge?: boolean; claudeCli?: string | null } = {}): Promise<string[]> {
  const lines: string[] = [];
  for (const t of hookTargets()) if (t.present()) disconnect(t.file);
  lines.push("Auto-sharing off.");
  const present = agentStates().filter((a) => a.present).map((a) => a.id);
  lines.push(...(await removeToolkit(present, { claudeCli: o.claudeCli === null ? undefined : (o.claudeCli ?? findClaude()) })));
  lines.push(`Skills removed: ${removeSkills(["claude", "codex"])}.`);
  if (o.purge) {
    guardRealHome(airbandHome());
    fs.rmSync(airbandHome(), { recursive: true, force: true });
    lines.push(`Deleted ${airbandHome()} (flightlogs, the Map, your own commands).`);
  } else lines.push(`Your data stays in ${airbandHome()}; add --purge to delete it.`);
  return lines;
}

/** A path as people read it: ~ for the home folder. */
const tilde = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);

const agentName = (a: AgentId) => (a === "claude" ? "Claude" : a === "codex" ? "Codex" : "Gemini");

// ---------------------------------------------------------------- doctor

export interface Check {
  ok: boolean | "warn";
  what: string;
  /** What to do about it, when it isn't fine. */
  fix?: string;
}

/** Everything that has to be true for Airband to work, each with the fix when it isn't. */
export function doctor(latest?: string, self = "airband"): Check[] {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(major >= 20 ? { ok: true, what: `Node.js ${process.versions.node}` } : { ok: false, what: `Node.js ${process.versions.node} is too old`, fix: "Install Node.js 20 or newer." });

  const missing = ["airband-mcp.js", "airband-hook.js", "airband.js", "wasm/tree-sitter.wasm"].filter((f) => !fs.existsSync(airbandFile(f)));
  const iv = installedVersion();
  checks.push(
    missing.length
      ? { ok: false, what: `Missing in ${tilde(airbandHome())}: ${missing.join(", ")}`, fix: `Run: ${self}` }
      : { ok: true, what: `Airband ${iv ?? "(version unknown)"} installed in ${tilde(airbandHome())}` },
  );
  if (latest && newer(latest, iv ?? VERSION)) checks.push({ ok: "warn", what: `Airband ${latest} is out (you have ${iv ?? VERSION})`, fix: `Run: ${self} update` });

  if (oldClaudePluginInstalled()) checks.push({ ok: "warn", what: "Claude Code: the old Crosstalk plugin is still installed", fix: "In Claude Code, type: /plugin uninstall crosstalk" });
  const states = agentStates();
  const present = states.filter((a) => a.present);
  if (!present.length) checks.push({ ok: false, what: "No Claude Code, Codex or Gemini CLI found", fix: `Install one of them, then run: ${self}` });
  const stale = new Set(staleHookTargets().map((t) => t.tool));
  const plugin = claudePluginInstalled();
  for (const a of present) {
    const name = a.name;
    if (a.id === "claude" && plugin) {
      checks.push(
        a.tools
          ? { ok: "warn", what: "Claude Code: has Airband twice (the plugin and a setup entry)", fix: `Run: ${self} remove, then ${self} (the plugin stays)` }
          : { ok: true, what: "Claude Code: tools and skills from the Airband plugin" },
      );
    } else {
      checks.push(
        !a.tools
          ? { ok: false, what: `${name}: tools not connected`, fix: `Run: ${self} setup --agents ${a.id}` }
          : !a.allowed
            ? { ok: "warn", what: `${name}: tools connected, but it asks before each use`, fix: `Run: ${self} (agents then use the Map and past chats without stopping to ask)` }
            : { ok: true, what: `${name}: tools connected (airband_map, airband_flightlog, airband_notes)` },
      );
    }
    if (a.id === "codex" || (a.id === "claude" && !plugin)) {
      const s = skillsState(a.id);
      checks.push(
        s.installed === 0
          ? { ok: "warn", what: `${name}: no Airband skills`, fix: `Run: ${self} (agents then use the Map and past chats by themselves)` }
          : s.current < s.installed
            ? { ok: "warn", what: `${name}: skills from an older version`, fix: `Run: ${self}` }
            : { ok: true, what: `${name}: ${s.installed} skills` },
      );
    }
    const t = hookTargets().find((h) => h.tool === agentName(a.id));
    if (t) {
      const on = isToolConnected(t);
      checks.push(
        !on
          ? { ok: "warn", what: `${name}: auto-sharing off`, fix: `Run: ${self} setup --agents ${a.id} (connected chats then update each other)` }
          : stale.has(t.tool)
            ? { ok: false, what: `${name}: auto-sharing hook points at a Node.js that is gone`, fix: `Run: ${self}` }
            : { ok: true, what: `${name}: auto-sharing on` },
      );
    }
  }
  if (!fs.existsSync(installedHookPath()) && present.length) checks.push({ ok: false, what: "The hook script is missing", fix: `Run: ${self}` });
  return checks;
}

// ---------------------------------------------------------------- updates

/** A plain version number, as npm publishes them: 1.2.3 or 1.2.3-beta.1. */
export const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(-[0-9A-Za-z.]{1,40})?$/;

/** a > b, for plain x.y.z versions. */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Update checks are off in CI and when asked (AIRBAND_NO_UPDATE_CHECK=1, or the common
 *  NO_UPDATE_NOTIFIER). `airband update` still asks, since that is what it is for. */
export function updateChecksOff(): boolean {
  const on = (v?: string) => !!v && v !== "0" && v.toLowerCase() !== "false";
  return on(process.env.AIRBAND_NO_UPDATE_CHECK) || on(process.env.AIRBAND_OFFLINE) || on(process.env.NO_UPDATE_NOTIFIER) || on(process.env.CI);
}

/** The newest version on npm, asked at most once a day (the answer is kept in ~/.airband). Never
 *  slows anything down by more than `timeoutMs`, and says nothing when offline. */
export async function latestVersion(o: { force?: boolean; timeoutMs?: number } = {}): Promise<string | undefined> {
  if (!o.force && updateChecksOff()) return undefined;
  const cache = airbandFile("update-check.json");
  if (!o.force) {
    try {
      const c = JSON.parse(fs.readFileSync(cache, "utf8")) as { at: number; latest?: string };
      if (Date.now() - c.at < 24 * 3600e3) return c.latest;
    } catch {
      // No answer kept yet.
    }
  }
  const latest = await new Promise<string | undefined>((resolve) => {
    // One deadline for the whole answer (not just between bytes), at most 64 KB read, and only a
    // plain version number accepted: the answer ends up in an npm command line.
    const limit = o.timeoutMs ?? 1500;
    const req = https.get(`https://registry.npmjs.org/${NPM_PACKAGE.replace("/", "%2F")}/latest`, { headers: { accept: "application/json" }, timeout: limit }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        body += d;
        if (body.length > 64 * 1024) req.destroy();
      });
      res.on("end", () => {
        try {
          const v = res.statusCode === 200 ? (JSON.parse(body) as { version?: unknown }).version : undefined;
          resolve(typeof v === "string" && VERSION_RE.test(v) ? v : undefined);
        } catch {
          resolve(undefined);
        }
      });
      res.on("error", () => resolve(undefined));
    });
    const deadline = setTimeout(() => req.destroy(), limit);
    deadline.unref();
    req.on("close", () => {
      clearTimeout(deadline);
      resolve(undefined);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
  });
  try {
    writeFileAtomic(cache, JSON.stringify({ at: Date.now(), latest }));
  } catch {
    // A read-only home folder: ask again next time.
  }
  return latest;
}

// ---------------------------------------------------------------- status

export interface AgentSummary {
  id: AgentId;
  name: string;
  tools: boolean;
  /** Through the Claude Code plugin rather than setup. */
  plugin: boolean;
  /** null: this agent takes no skills from setup (Gemini CLI, or Claude through the plugin). */
  skills: boolean | null;
  sharing: boolean;
}

/** One line's worth per agent found: what Airband gives it right now. */
export function agentSummary(): AgentSummary[] {
  const plugin = claudePluginInstalled();
  return agentStates()
    .filter((a) => a.present)
    .map((a) => {
      const viaPlugin = a.id === "claude" && plugin;
      const t = hookTargets().find((h) => h.tool === agentName(a.id));
      const skills = a.id === "gemini" || viaPlugin ? null : skillsState(a.id).installed > 0;
      return { id: a.id, name: a.name, tools: a.tools || viaPlugin, plugin: viaPlugin, skills, sharing: !!t && isToolConnected(t) };
    });
}

/** Whether running setup would change anything that matters: files missing or from an older
 *  version, an agent without the tools, skills out of date, or a hook pointing at a gone Node.js.
 *  Choices the person made (auto-sharing off, no skills) are not things to fix. */
export function needsSetup(): boolean {
  const iv = installedVersion();
  if (!iv || newer(VERSION, iv)) return true;
  if (FILES.some((f) => !fs.existsSync(airbandFile(f)))) return true;
  const plugin = claudePluginInstalled();
  for (const a of agentStates().filter((x) => x.present)) {
    if (!a.tools && !(a.id === "claude" && plugin)) return true;
    // Set up by an older version: the agent asks before every tool use.
    if (a.tools && !a.allowed) return true;
    if (a.id !== "gemini" && !(a.id === "claude" && plugin)) {
      const s = skillsState(a.id);
      if (s.current < s.installed) return true;
    }
  }
  return staleHookTargets().length > 0;
}

// ---------------------------------------------------------------- npm, the same on every system

/** How to run npm or npx without a shell: through the npm that ships next to this Node.js (an
 *  .cmd can't be started directly on Windows). Falls back to the command on the PATH. */
export function npmCommand(bin: "npm" | "npx", args: string[]): { cmd: string; args: string[]; shell: boolean } {
  const dir = path.dirname(process.execPath);
  const cli = `${bin}-cli.js`;
  for (const p of [path.join(dir, "node_modules", "npm", "bin", cli), path.join(dir, "..", "lib", "node_modules", "npm", "bin", cli)]) {
    if (fs.existsSync(p)) return { cmd: process.execPath, args: [p, ...args], shell: false };
  }
  const win = process.platform === "win32";
  // On Windows the PATH has npx.cmd, which only a shell can start: pass one line, already quoted.
  return win ? { cmd: [bin, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" "), args: [], shell: true } : { cmd: bin, args, shell: false };
}
