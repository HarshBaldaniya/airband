// The Toolkit install: gives each agent Airband's tools (code map, flightlogs, notes) and the
// Library's commands. Claude Code and Gemini CLI get the commands through MCP (as slash commands);
// Codex gets them as its own prompt files. Every file touched is backed up first, and removal takes
// out only what Airband added.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { airbandFile, guardRealHome, writeFileAtomic } from "../core/paths";
import { claudeSettingsPath } from "./agent-hooks";
import { builtinCommands, renderCommand, type LibraryCommand } from "../library/index";
import type { AgentId } from "../core/agents";
import { readJson } from "../core/json";
// The tool server and Codex command list under Airband's earlier name are taken out wherever
// Airband's are added or removed, so a computer that had Crosstalk never has both.
import { OLD_MCP_SERVERS, OLD_PROMPT_MANIFESTS } from "../core/legacy";


export interface AgentState {
  id: AgentId;
  name: string;
  /** The agent is installed on this computer (its home folder exists) */
  present: boolean;
  /** Airband's MCP server is registered with it */
  tools: boolean;
  /** It runs Airband's tools without asking each time */
  allowed: boolean;
  /** Library commands it has (Codex: prompt files; the others: through MCP) */
  commands: number;
}

const SERVER = "airband";

export const mcpServerPath = () => airbandFile("airband-mcp.js");
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const geminiHome = () => process.env.AIRBAND_GEMINI_HOME || path.join(os.homedir(), ".gemini");
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
/** Where Claude Code keeps user-scope MCP servers. */
const claudeJsonPath = () =>
  process.env.AIRBAND_CLAUDE_JSON || (process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(os.homedir(), ".claude.json"));
export const codexConfigPath = () => path.join(codexHome(), "config.toml");
export const codexPromptsDir = () => path.join(codexHome(), "prompts");
export const geminiSettingsPath = () => path.join(geminiHome(), "settings.json");
const MANIFEST = ".airband-manifest";

/** Two copies before Airband changes an agent's settings: the file as it was the first time
 *  (.airband-backup, kept for good) and as it was just before this change (.airband-last). */
function backup(file: string) {
  if (!fs.existsSync(file)) return;
  guardRealHome(file);
  const first = `${file}.airband-backup`;
  if (!fs.existsSync(first)) fs.copyFileSync(file, first);
  fs.copyFileSync(file, `${file}.airband-last`);
}

// ---------------------------------------------------------------- what each agent has

export function agentStates(): AgentState[] {
  const claudeServers = readJson<{ mcpServers?: Record<string, unknown> } | undefined>(claudeJsonPath(), undefined)?.mcpServers ?? {};
  const gemini = readJson<{ mcpServers?: Record<string, unknown> } | undefined>(geminiSettingsPath(), undefined)?.mcpServers ?? {};
  let codexToml = "";
  try {
    codexToml = fs.readFileSync(codexConfigPath(), "utf8");
  } catch {
    // No Codex config yet.
  }
  const lib = builtinCommands().length;
  const codexTools = new RegExp(`^\\[mcp_servers\\.${SERVER}\\]`, "m").test(codexToml);
  // The tools run without a question each time (setup allows them; older setups didn't).
  const codexBlockText = codexToml.split(new RegExp(`^\\[mcp_servers\\.${SERVER}\\]`, "m"))[1]?.split(/^\[/m)[0] ?? "";
  const claudeAllow = readJson<{ permissions?: { allow?: unknown } } | undefined>(claudeSettingsPath(), undefined)?.permissions?.allow;
  return [
    {
      id: "claude",
      name: "Claude Code",
      present: fs.existsSync(claudeHome()) || fs.existsSync(claudeJsonPath()),
      tools: SERVER in claudeServers,
      allowed: Array.isArray(claudeAllow) && claudeAllow.includes(CLAUDE_ALLOW),
      commands: SERVER in claudeServers ? lib : 0,
    },
    { id: "codex", name: "Codex", present: fs.existsSync(codexHome()), tools: codexTools, allowed: /^default_tools_approval_mode\s*=\s*"approve"/m.test(codexBlockText), commands: ownedPrompts().length },
    {
      id: "gemini",
      name: "Gemini CLI",
      present: fs.existsSync(geminiHome()),
      tools: SERVER in gemini,
      allowed: (gemini[SERVER] as { trust?: unknown } | undefined)?.trust === true,
      commands: SERVER in gemini ? lib : 0,
    },
  ];
}

// ---------------------------------------------------------------- Claude Code

export type Runner = (cmd: string, args: string[]) => Promise<{ ok: boolean; out: string }>;

/** Runs an agent's own command. On Windows a .cmd (as npm installs them) needs a shell to start. */
const runCli: Runner = (cmd, args) =>
  new Promise((resolve) => {
    // An agent's own command writes to the person's real settings: never from a test.
    if (process.env.NODE_TEST_CONTEXT) throw new Error(`A test tried to run ${cmd}. Pass claudeCli: null.`);
    const home = os.homedir();
    const extra = process.platform === "win32" ? [path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm")] : [path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
    const quote = (a: string) => (useShell && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    execFile(
      useShell ? quote(cmd) : cmd,
      args.map(quote),
      { timeout: 30_000, windowsHide: true, shell: useShell, env: { ...process.env, PATH: [process.env.PATH ?? "", ...extra].join(path.delimiter) } },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });

/** The rule that lets Claude Code use every Airband tool without asking (what "Yes, and don't ask
 *  again" writes). The tools only read the code map and chat records, or write a project note. */
const CLAUDE_ALLOW = `mcp__${SERVER}`;

/** Adds or takes out Airband's rule in Claude Code's permissions.allow; nothing else in the file
 *  changes, and a settings file that doesn't parse is left alone. */
function allowInClaude(on: boolean): void {
  const file = claudeSettingsPath();
  if (!fs.existsSync(file) && !on) return;
  const settings = fs.existsSync(file) ? readJson<Record<string, unknown> & { permissions?: { allow?: string[] } } | undefined>(file, undefined) : {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;
  const permissions = settings.permissions ?? {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  // The rule under Airband's earlier name goes either way; Airband's own is added or taken out.
  const old = OLD_MCP_SERVERS.map((n) => `mcp__${n}`);
  const kept = allow.filter((r) => r !== CLAUDE_ALLOW && !old.includes(r));
  const next = on ? [...kept, CLAUDE_ALLOW] : kept;
  if (next.length === allow.length && next.every((r, i) => r === allow[i])) return;
  backup(file);
  permissions.allow = next;
  settings.permissions = permissions;
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

async function addToClaude(node: string, claudeCli: string | undefined, run: Runner): Promise<string> {
  allowInClaude(true);
  if (!claudeCli) {
    // No `claude` on PATH (a desktop app or IDE install): write the same user-scope entry it would,
    // after a backup. Claude Code reads it when its next chat starts.
    editClaudeJson((servers) => {
      for (const old of OLD_MCP_SERVERS) delete servers[old];
      servers[SERVER] = { type: "stdio", command: node, args: [mcpServerPath()], env: {} };
    });
    return `Claude Code: tools and ${builtinCommands().length} commands added.`;
  }
  // Through Claude's own command: it owns ~/.claude.json and writes it safely while it runs.
  for (const name of [SERVER, ...OLD_MCP_SERVERS]) await run(claudeCli, ["mcp", "remove", name, "--scope", "user"]);
  const r = await run(claudeCli, ["mcp", "add", SERVER, "--scope", "user", "--", node, mcpServerPath()]);
  return r.ok ? `Claude Code: tools and ${builtinCommands().length} commands added (as /mcp__airband__review and so on).` : `Claude Code: couldn't add the tools (${r.out.slice(0, 200)}).`;
}

/** Changes Claude Code's user-scope MCP servers in ~/.claude.json, keeping everything else in it. */
function editClaudeJson(change: (servers: Record<string, unknown>) => void): void {
  const file = claudeJsonPath();
  // A file that doesn't read as JSON (Claude Code halfway through writing it) is left alone: writing
  // a fresh one would lose the person's projects, servers and sign-in state.
  const data = fs.existsSync(file) ? readJson<Record<string, unknown> & { mcpServers?: Record<string, unknown> } | undefined>(file, undefined) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file} couldn't be read, so it was left as it is. Try again in a moment.`);
  backup(file);
  const servers = { ...(data.mcpServers ?? {}) };
  change(servers);
  data.mcpServers = servers;
  writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function removeFromClaude(claudeCli: string | undefined, run: Runner): Promise<string> {
  allowInClaude(false);
  if (!claudeCli) {
    let had = false;
    editClaudeJson((servers) => {
      had = SERVER in servers;
      for (const name of [SERVER, ...OLD_MCP_SERVERS]) delete servers[name];
    });
    return had ? "Claude Code: tools removed." : "Claude Code: no Airband tools to remove.";
  }
  for (const old of OLD_MCP_SERVERS) await run(claudeCli, ["mcp", "remove", old, "--scope", "user"]);
  const r = await run(claudeCli, ["mcp", "remove", SERVER, "--scope", "user"]);
  return r.ok ? "Claude Code: tools removed." : "Claude Code: no Airband tools to remove.";
}

// ---------------------------------------------------------------- Codex

// Airband's tools only read the code map and chat records (a note is written inside the project's
// .airband/notes), so Codex runs them without asking each time, as "Allow and don't ask me again" would.
const codexBlock = (node: string) =>
  `[mcp_servers.${SERVER}]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(mcpServerPath())}]\ndefault_tools_approval_mode = "approve"\n`;

/** Takes Airband's table out of a config.toml, leaving everything else as it was. */
export function withoutCodexBlock(toml: string): string {
  const lines = toml.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      const h = header[1].trim();
      skipping = [SERVER, ...OLD_MCP_SERVERS].some((n) => h === `mcp_servers.${n}` || h.startsWith(`mcp_servers.${n}.`));
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function addToCodex(node: string): string {
  const file = codexConfigPath();
  let toml = "";
  try {
    toml = fs.readFileSync(file, "utf8");
  } catch {
    // A new config.
  }
  backup(file);
  const base = withoutCodexBlock(toml).replace(/\s*$/, "");
  writeFileAtomic(file, `${base ? `${base}\n\n` : ""}${codexBlock(node)}`);
  const n = writeCodexPrompts(builtinCommands());
  return `Codex: tools added, and ${n} commands as /prompts:review and so on.`;
}

function removeFromCodex(): string {
  const file = codexConfigPath();
  let removedTools = false;
  try {
    const toml = fs.readFileSync(file, "utf8");
    const next = withoutCodexBlock(toml);
    if (next !== toml) {
      backup(file);
      writeFileAtomic(file, next.replace(/\s*$/, "\n"));
      removedTools = true;
    }
  } catch {
    // No config.
  }
  const n = removeCodexPrompts();
  return `Codex: ${removedTools ? "tools removed" : "no tools to remove"}${n ? `, ${n} commands removed` : ""}.`;
}

/** The Codex command files Airband wrote (under its earlier name too, so they are replaced). */
function ownedPrompts(): string[] {
  const out = new Set<string>();
  for (const m of [MANIFEST, ...OLD_PROMPT_MANIFESTS]) {
    try {
      for (const n of fs.readFileSync(path.join(codexPromptsDir(), m), "utf8").split("\n")) {
        if (n && fs.existsSync(path.join(codexPromptsDir(), n))) out.add(n);
      }
    } catch {
      // No such list.
    }
  }
  return [...out];
}

/** A command as a Codex prompt file: what's typed after the command fills its main argument. */
export function codexPrompt(c: LibraryCommand): string {
  const main = c.args.find((a) => a.required) ?? c.args[0];
  const body = renderCommand(c, main ? { [main.name]: "$ARGUMENTS" } : {});
  const head = [`description: ${c.description.replace(/\n/g, " ")}`];
  if (main) head.push(`argument-hint: ${main.description.replace(/\s*\(default:[^)]*\)/i, "").replace(/\n/g, " ")}`);
  return `---\n${head.join("\n")}\n---\n${body}\n`;
}

function writeCodexPrompts(commands: LibraryCommand[]): number {
  const dir = codexPromptsDir();
  fs.mkdirSync(dir, { recursive: true });
  const owned = new Set(ownedPrompts());
  const written: string[] = [];
  for (const c of commands) {
    const file = `${c.name}.md`;
    // Never overwrite a prompt the person made themselves.
    if (fs.existsSync(path.join(dir, file)) && !owned.has(file)) continue;
    writeFileAtomic(path.join(dir, file), codexPrompt(c));
    written.push(file);
  }
  writeFileAtomic(path.join(dir, MANIFEST), `${written.join("\n")}\n`);
  // Files the earlier name wrote that this Library no longer has, and its list, go.
  for (const f of owned) if (!written.includes(f)) fs.rmSync(path.join(dir, f), { force: true });
  for (const m of OLD_PROMPT_MANIFESTS) fs.rmSync(path.join(dir, m), { force: true });
  return written.length;
}

/** After an update: Codex's command files follow the Library, if Airband put them there. */
export function refreshCodexPrompts(): number {
  return ownedPrompts().length ? writeCodexPrompts(builtinCommands()) : 0;
}

function removeCodexPrompts(): number {
  const owned = ownedPrompts();
  guardRealHome(codexPromptsDir());
  for (const f of owned) fs.rmSync(path.join(codexPromptsDir(), f), { force: true });
  for (const m of [MANIFEST, ...OLD_PROMPT_MANIFESTS]) fs.rmSync(path.join(codexPromptsDir(), m), { force: true });
  return owned.length;
}

// ---------------------------------------------------------------- Gemini CLI

function addToGemini(node: string): string {
  const file = geminiSettingsPath();
  const settings = readJson<Record<string, unknown> | undefined>(file, undefined) ?? {};
  if (fs.existsSync(file) && !readJson(file, undefined)) return "Gemini CLI: its settings.json couldn't be read, so it was left alone.";
  backup(file);
  const servers = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
  // trust: Gemini CLI runs the tools without a confirmation each time (they only read, see codexBlock).
  for (const old of OLD_MCP_SERVERS) delete servers[old];
  servers[SERVER] = { command: node, args: [mcpServerPath()], trust: true };
  settings.mcpServers = servers;
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  return `Gemini CLI: tools and ${builtinCommands().length} commands added (as /review and so on).`;
}

function removeFromGemini(): string {
  const file = geminiSettingsPath();
  const settings = readJson<Record<string, unknown> | undefined>(file, undefined);
  const servers = settings?.mcpServers as Record<string, unknown> | undefined;
  if (!settings || !servers || ![SERVER, ...OLD_MCP_SERVERS].some((n) => n in servers)) return "Gemini CLI: no tools to remove.";
  backup(file);
  for (const name of [SERVER, ...OLD_MCP_SERVERS]) delete servers[name];
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  return "Gemini CLI: tools removed.";
}

// ---------------------------------------------------------------- one call

export interface InstallOptions {
  node: string;
  claudeCli?: string;
  run?: Runner;
}

export async function installToolkit(agents: AgentId[], opts: InstallOptions): Promise<string[]> {
  const run = opts.run ?? runCli;
  const out: string[] = [];
  for (const a of agents) {
    try {
      if (a === "claude") out.push(await addToClaude(opts.node, opts.claudeCli, run));
      if (a === "codex") out.push(addToCodex(opts.node));
      if (a === "gemini") out.push(addToGemini(opts.node));
    } catch (err) {
      out.push(`${a}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

export async function removeToolkit(agents: AgentId[], opts: Omit<InstallOptions, "node">): Promise<string[]> {
  const run = opts.run ?? runCli;
  const out: string[] = [];
  for (const a of agents) {
    try {
      if (a === "claude") out.push(await removeFromClaude(opts.claudeCli, run));
      if (a === "codex") out.push(removeFromCodex());
      if (a === "gemini") out.push(removeFromGemini());
    } catch (err) {
      out.push(`${a}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
