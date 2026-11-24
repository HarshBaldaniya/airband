// Adds Airband's status hook to Claude Code's user settings (~/.claude/settings.json),
// and takes it out again. Only ever called from the Connect / Disconnect commands,
// which the person runs themselves. Other settings and hooks are left as they are,
// and the file is backed up before the first change.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { airbandHome, guardRealHome, writeFileAtomic } from "../core/paths";
import { OLD_HOOK_PROGRAMS } from "../core/legacy";

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop", "SessionEnd"] as const;
/** A permission request may wait for a click in the Airband app (110 s at most), so Claude Code
 *  gives that one hook longer than the rest. With no app running it ends at once. */
export const CLAUDE_TIMEOUTS: Partial<Record<string, number>> = { PermissionRequest: 120 };
/** Tools a before-tool hook runs for: shell commands (commits, PRs) and MCP tools (Slack, email).
 *  Not file reads and edits, so most tool calls start no process at all. */
const PRE_TOOL_MATCHER: Record<string, string> = { claude: "Bash|mcp__.*", gemini: "run_shell_command|.*__.*|mcp_.*" };
const MARK = "airband-hook.js";
/** A hook Airband wrote, under its name or an earlier one (legacy.ts). An old one is replaced, never
 *  doubled: staleHookTargets reports it, since it doesn't name airband-hook.js. */
const ours = (command: string | undefined) => !!command && (command.includes(MARK) || OLD_HOOK_PROGRAMS.some((m) => command.includes(m)));

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

export function claudeSettingsPath(): string {
  if (process.env.AIRBAND_CLAUDE_SETTINGS) return process.env.AIRBAND_CLAUDE_SETTINGS;
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
}

/** Where the hook script is copied, so the command survives extension updates. */
export function installedHookPath(): string {
  return path.join(airbandHome(), "airband-hook.js");
}

/**
 * A `node` made from an app that carries its own (the desktop app is Electron, which runs as plain
 * Node when ELECTRON_RUN_AS_NODE=1): a small script in ~/.airband/bin that starts that app as Node.
 * For a computer with no Node of its own, which many have: Claude Code and Codex install without
 * it. Written again at every start of the app, so it follows the app when it moves or updates.
 */
export function appNode(appBinary: string, dir: string, platform: NodeJS.Platform = process.platform): string {
  fs.mkdirSync(dir, { recursive: true });
  if (platform === "win32") {
    const file = path.join(dir, "node.cmd");
    fs.writeFileSync(file, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${appBinary}" %*\r\n`);
    return file;
  }
  const file = path.join(dir, "node");
  fs.writeFileSync(file, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${appBinary.replace(/'/g, `'\\''`)}' "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function readSettings(file: string): Settings {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return text.trim() ? (JSON.parse(text) as Settings) : {};
}

export function isConnected(file = claudeSettingsPath(), events: readonly string[] = HOOK_EVENTS): boolean {
  try {
    const hooks = readSettings(file).hooks ?? {};
    return events.every((e) => (hooks[e] ?? []).some((g) => g.hooks?.some((h) => h.command.includes(MARK))));
  } catch {
    return false;
  }
}

export function connect(command: string, file = claudeSettingsPath(), events: readonly string[] = HOOK_EVENTS, timeout = 5, timeouts: Partial<Record<string, number>> = {}): void {
  const settings = readSettings(file);
  const backup = `${file}.airband-backup`;
  guardRealHome(file);
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const hooks = settings.hooks ?? {};
  for (const event of events) {
    const groups = (hooks[event] ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ours(h.command)) }));
    const kept = groups.filter((g) => g.hooks.length > 0);
    const entry: HookGroup = { hooks: [{ type: "command", command, timeout: timeouts[event] ?? timeout }] };
    if (event === "PostToolUse" && file === claudeSettingsPath()) entry.matcher = "*";
    if (event === "PreToolUse") entry.matcher = PRE_TOOL_MATCHER.claude;
    if (event === "BeforeTool") entry.matcher = PRE_TOOL_MATCHER.gemini;
    kept.push(entry);
    hooks[event] = kept;
  }
  settings.hooks = hooks;
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

export function disconnect(file = claudeSettingsPath()): void {
  if (!fs.existsSync(file)) return;
  const settings = readSettings(file);
  if (!settings.hooks) return;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ours(h.command)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}


// ---- every agent Airband can hook into ----

/** One agent's hook settings: where they live, which of its events Airband uses, and its timeout unit. */
export interface HookTarget {
  tool: "Claude" | "Codex" | "Gemini";
  file: string;
  events: readonly string[];
  timeout: number;
  /** An event the agent allows less time for than `timeout`. */
  timeouts?: Partial<Record<string, number>>;
  /** The agent is installed (it has a home folder). */
  present(): boolean;
  /** Extra step the agent asks for before new hooks run. */
  note?: string;
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function geminiHome(): string {
  return process.env.AIRBAND_GEMINI_HOME || path.join(os.homedir(), ".gemini");
}

export function hookTargets(): HookTarget[] {
  return [
    { tool: "Claude", file: claudeSettingsPath(), events: HOOK_EVENTS, timeout: 5, timeouts: CLAUDE_TIMEOUTS, present: () => true },
    {
      tool: "Codex",
      file: path.join(codexHome(), "hooks.json"),
      // Codex's hooks match Claude Code's; PermissionRequest is its "needs you".
      events: ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd"],
      timeout: 5,
      // Codex gives a SessionEnd hook at most 3 seconds (and warns about anything longer).
      timeouts: { SessionEnd: 3 },
      present: () => fs.existsSync(codexHome()),
      note: "Codex runs new hooks only once you trust them: type /hooks in Codex and trust Airband's.",
    },
    {
      tool: "Gemini",
      file: path.join(geminiHome(), "settings.json"),
      // Gemini CLI's names: BeforeAgent = a prompt arrives, AfterAgent = a reply ended. Timeouts are in ms.
      events: ["SessionStart", "BeforeAgent", "BeforeTool", "AfterAgent", "AfterTool", "Notification", "SessionEnd"],
      timeout: 5000,
      // ~/.gemini alone is not enough: Antigravity makes it too. Gemini CLI leaves these behind.
      present: () => ["settings.json", "tmp", "projects.json", "oauth_creds.json"].some((n) => fs.existsSync(path.join(geminiHome(), n))),
    },
  ];
}

/** The hook command for one agent: the script, told which agent is calling it. */
export function hookCommandFor(node: string, tool: HookTarget["tool"]): string {
  // `|| true`: should node or the script ever go missing (an nvm version removed, ~/.airband
  // deleted), the hook still ends cleanly. Gemini CLI treats a failed BeforeAgent hook as
  // "block" and would refuse every message.
  return `"${node}" "${installedHookPath()}" ${tool.toLowerCase()}${process.platform === "win32" ? "" : " || true"}`;
}

/** Airband's command in a settings file, if there is one. */
function ourCommand(file: string): string | undefined {
  try {
    for (const groups of Object.values(readSettings(file).hooks ?? {}))
      for (const g of groups) for (const h of g.hooks ?? []) if (ours(h.command)) return h.command;
  } catch {
    // Unreadable: nothing to repair.
  }
  return undefined;
}

/** Agents whose Airband hook names a node that is gone, or was written before the clean ending. */
export function staleHookTargets(): HookTarget[] {
  return hookTargets().filter((t) => {
    if (!t.present()) return false;
    const cmd = ourCommand(t.file);
    if (!cmd) return false;
    const node = /^"([^"]+)"/.exec(cmd)?.[1];
    const gone = !!node && node !== "node" && !fs.existsSync(node);
    return gone || !cmd.includes(MARK) || (process.platform !== "win32" && !cmd.endsWith("|| true"));
  });
}

export function isToolConnected(t: HookTarget): boolean {
  return t.present() && isConnected(t.file, t.events);
}

// ---- Claude Code's own AI-credit lines ----

/** Claude Code's setting that leaves out "Co-Authored-By: Claude" in commits, "Generated with Claude
 *  Code" in PRs, and the session link: empty strings, in the object form every version reads. */
const NO_AI_CREDIT = { commit: "", pr: "", sessionUrl: false };

/** Whether Claude Code adds its AI-credit lines to commits and PRs (its default). */
export function claudeAiCreditShown(file = claudeSettingsPath()): boolean {
  try {
    const a = readSettings(file).attribution as { commit?: unknown; pr?: unknown } | undefined;
    return !(a && a.commit === "" && a.pr === "");
  } catch {
    return true;
  }
}

/** Turns Claude Code's AI-credit lines off (or back on), changing only that setting, after a backup.
 *  A person's own attribution is kept aside while they are off, and put back when they are on again. */
export function setClaudeAiCredit(show: boolean, file = claudeSettingsPath()): void {
  const settings = readSettings(file);
  const a = settings.attribution as Record<string, unknown> | undefined;
  const hidden = !!a && a.commit === "" && a.pr === "";
  const kept = path.join(airbandHome(), "claude-attribution.json");
  if (show === !hidden) return;
  if (show) {
    let before: unknown;
    try {
      before = JSON.parse(fs.readFileSync(kept, "utf8")).attribution;
    } catch {
      before = undefined;
    }
    if (before === undefined) delete settings.attribution;
    else settings.attribution = before;
    fs.rmSync(kept, { force: true });
  } else {
    if (a !== undefined) writeFileAtomic(kept, JSON.stringify({ attribution: a }));
    settings.attribution = { ...NO_AI_CREDIT };
  }
  guardRealHome(file);
  const backup = `${file}.airband-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}
