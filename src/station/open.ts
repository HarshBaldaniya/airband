// "Open chat" (and Review) from Roger or the phone. Terminal first: most people run their agents
// there, and a terminal costs far less than an editor. VS Code only when the chat's folder is already
// open in a VS Code window; no other editor is ever opened for a chat, and no new window either.
//   1. The chat runs now in a terminal: that very tab comes forward (Terminal, iTerm), no second copy.
//   2. It runs now in VS Code (Claude's panel, or its terminal): that window; Claude Code's own link
//      shows the very chat. An editor it already runs in (Cursor, say) only comes forward: a second
//      copy in Terminal would fight over the same chat.
//   3. It is not running, its folder is open in VS Code, and it is a Claude Code chat: that same
//      window, and the link shows the chat there. (Codex and Gemini have no VS Code panel to show.)
//   4. Otherwise it is resumed in a new Terminal window.
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { addOpenRequest, windowFor } from "../core/folders";
import { findCommand } from "../core/hooks";
import { claudeHome } from "../core/paths";
import { toolName } from "../core/record";
import type { LiveChat } from "./chats";

const RESUME: Record<LiveChat["agent"], (id: string) => string> = {
  claude: (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  gemini: (id) => `gemini --resume ${id}`,
};
const BINARY: Record<LiveChat["agent"], RegExp> = { claude: /(^|\/)claude$/, codex: /(^|\/)codex$/, gemini: /(^|\/)gemini$/ };

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Windows: a .cmd (VS Code's `code`, Cursor's `cursor`) starts only through cmd.exe. */
const isScript = (cmd: string) => /\.(cmd|bat)$/i.test(cmd);

function run(cmd: string, args: string[]): boolean {
  try {
    const child = isScript(cmd)
      ? spawn("cmd.exe", ["/d", "/s", "/c", `"${[cmd, ...args].map((a) => `"${a}"`).join(" ")}"`], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true })
      : spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sh(cmd: string, args: string[], timeout = 3000): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? "");
  }
}

type Proc = { ppid: number; tty: string; comm: string; args: string };

function processes(): Map<number, Proc> {
  const procs = new Map<number, Proc>();
  for (const line of sh("ps", ["-axo", "pid=,ppid=,tty=,comm=,args="]).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), tty: m[3], comm: m[4], args: m[5] });
  }
  return procs;
}

/** Where this chat runs now: the app that holds it (Terminal, iTerm, Warp, VS Code …) and, in a
 *  terminal, its terminal device (/dev/ttys003), which names the very tab. macOS only. */
export function runningIn(chat: Pick<LiveChat, "id" | "agent" | "cwd">, procs = processes()): { app: string; vscode: boolean; tty?: string } | undefined {
  if (process.platform !== "darwin" || !chat.cwd) return undefined;
  const agents = [...procs.entries()].filter(([, p]) => BINARY[chat.agent].test(p.comm) || BINARY[chat.agent].test(p.args.split(" ")[0] ?? "") || (chat.agent !== "claude" && p.args.includes(`/${chat.agent}`)));
  if (!agents.length) return undefined;
  // The one for this chat: Claude Code's own record of which process runs which chat, or started
  // with its id. Only an agent that says neither is matched by its folder.
  const claims = chat.agent === "claude" ? claudeSessions() : new Map<number, string>();
  let pid = agents.find(([p]) => claims.get(p) === chat.id)?.[0] ?? agents.find(([, p]) => p.args.includes(chat.id))?.[0];
  const unclaimed = agents.filter(([p]) => !claims.has(p));
  if (!pid && unclaimed.length) {
    const cwds = sh("lsof", ["-a", "-d", "cwd", "-Fn", "-p", unclaimed.map(([p]) => p).join(",")]);
    let current = 0;
    for (const line of cwds.split("\n")) {
      if (line.startsWith("p")) current = Number(line.slice(1));
      else if (line.startsWith("n") && path.resolve(line.slice(1)) === path.resolve(chat.cwd)) {
        pid = current;
        break;
      }
    }
  }
  const tty = pid && /^ttys?\d+$/.test(procs.get(pid)?.tty ?? "") ? `/dev/${procs.get(pid)!.tty}` : undefined;
  // Up the parents to the app that holds it.
  for (let at = pid, hops = 0; at && hops < 20; hops++) {
    const p = procs.get(at);
    if (!p) break;
    const app = /^(.*?\.app)\/Contents\/MacOS\//.exec(p.comm)?.[1] ?? /^(.*?\.app)\/Contents\/MacOS\//.exec(p.args)?.[1];
    if (app && !/Helper/.test(path.basename(app))) return { app, vscode: /Visual Studio Code|VSCodium|Cursor|Windsurf/.test(app), ...(tty ? { tty } : {}) };
    at = p.ppid;
  }
  return undefined;
}

/** Claude Code's record of its running chats: process id to chat id (<config>/sessions/<pid>.json). */
function claudeSessions(): Map<number, string> {
  const out = new Map<number, string>();
  const dir = path.join(claudeHome(), "sessions");
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d+\.json$/.test(f)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { pid?: number; sessionId?: string };
        if (typeof j.pid === "number" && typeof j.sessionId === "string") out.set(j.pid, j.sessionId);
      } catch {
        // A file being written: the next open reads it.
      }
    }
  } catch {
    // An older Claude Code keeps no such record: the folder match stands in.
  }
  return out;
}

/** VS Code itself (stable or Insiders), not an editor built on it. */
export const isVSCode = (app: string | undefined) => /Visual Studio Code/.test(app ?? "");

/** The AppleScript that brings forward the Terminal or iTerm tab on this terminal device, or
 *  undefined for any other app. The device goes in as an argument, never as part of the script. */
export function tabScript(app: string): string | undefined {
  const name = path.basename(app, ".app");
  if (name === "Terminal")
    return [
      "on run argv",
      'tell application "Terminal"',
      "repeat with w in windows",
      "repeat with t in tabs of w",
      "if tty of t is item 1 of argv then",
      "set selected of t to true",
      "set index of w to 1",
      "activate",
      'return "ok"',
      "end if",
      "end repeat",
      "end repeat",
      "end tell",
      "end run",
    ].join("\n");
  if (/^iTerm/.test(name))
    return [
      "on run argv",
      'tell application "iTerm2"',
      "repeat with w in windows",
      "repeat with t in tabs of w",
      "repeat with s in sessions of t",
      "if tty of s is item 1 of argv then",
      "select w",
      "select t",
      "select s",
      "activate",
      'return "ok"',
      "end if",
      "end repeat",
      "end repeat",
      "end repeat",
      "end tell",
      "end run",
    ].join("\n");
  return undefined;
}

const VSCODE_APPS = ["/Applications/Visual Studio Code.app", "/Applications/Visual Studio Code - Insiders.app"];
let vsFolders: { at: number; app: string; names: string[] } | undefined;

/** The folder names VS Code's open windows show (`code --status`: "Folder (shop-frontend): …"),
 *  asked only while VS Code runs (the command would start it otherwise), and kept a few seconds. */
function vscodeWindows(procs: Map<number, Proc>, now: number): { app: string; names: string[] } | undefined {
  if (vsFolders && now - vsFolders.at < 8000) return vsFolders.names.length ? vsFolders : undefined;
  const running = VSCODE_APPS.find((app) => [...procs.values()].some((p) => p.comm.startsWith(`${app}/Contents/MacOS/`)));
  const names = running ? folderNames(sh(path.join(running, "Contents/Resources/app/bin/code"), ["--status"], 5000)) : [];
  vsFolders = { at: now, app: running ?? "", names };
  return names.length ? vsFolders : undefined;
}

/** The folder names in `code --status` output. */
export function folderNames(status: string): string[] {
  return [...status.matchAll(/Folder \((.+?)\):/g)].map((m) => m[1]);
}

/** The folder of a VS Code window that holds this chat's folder (its repository for a worktree),
 *  matched by name from the chat's folder up. */
export function vscodeFolderFor(cwd: string, names: string[]): string | undefined {
  for (let at = editorFolder(cwd).replace(/[\\/]+$/, ""); at && at !== path.dirname(at); at = path.dirname(at)) if (names.includes(path.basename(at))) return at;
  return undefined;
}

const appName = (app: string) => path.basename(app, ".app");

/** The folder an editor has open for a chat: for an agent's git worktree
 *  (<repo>/.claude/worktrees/<name>), the repository, so its own window comes forward rather than a
 *  new one for the worktree. */
export function editorFolder(cwd: string): string {
  const m = /^(.*?)[\\/]\.(?:claude|codex|gemini)[\\/]worktrees[\\/][^\\/]+/.exec(cwd);
  return m ? m[1] : cwd;
}

/** The link that opens one Claude Code chat in an editor's Claude Code panel (the extension's own
 *  handler: /open?session=<id>), for VS Code and the editors built on it. */
export function claudeChatLink(app: string, id: string): string | undefined {
  const name = appName(app).toLowerCase();
  const scheme = name.includes("insiders") ? "vscode-insiders" : name.includes("cursor") ? "cursor" : name.includes("windsurf") ? "windsurf" : name.includes("vscodium") ? "vscodium" : name.includes("visual studio code") ? "vscode" : undefined;
  return scheme && /^[0-9a-f-]{36}$/i.test(id) ? `${scheme}://anthropic.claude-code/open?session=${id}` : undefined;
}

/**
 * Windows: what a new console window runs to resume the chat. `/s /k "..."` keeps the whole line
 * for the new window (a plain `start ... && claude` would run the second half in the hidden one).
 */
export function windowsResumeLine(cwd: string | undefined, resume: string): string {
  const line = cwd ? `cd /d "${cwd.replace(/"/g, "")}" && ${resume}` : resume;
  return `/d /s /k "${line}"`;
}

/** The editor's own command: Cursor's is `cursor`, every VS Code's is `code`. */
export const editorCommand = (app: string | undefined) => (/cursor/i.test(app ?? "") ? "cursor" : "code");

/** Opens the chat where it lives; says where, in a few words. */
export function openChat(chat: Pick<LiveChat, "id" | "agent" | "cwd" | "title">, now = Date.now()): string {
  const procs = process.platform === "darwin" ? processes() : new Map<number, Proc>();
  const live = runningIn(chat, procs);
  const showIn = (app: string, folder: string, withLink = true) => {
    // The folder's window first; then Claude Code's own link shows this very chat in it. One shell,
    // so the link waits for the window; the values go in as arguments, never as part of the command.
    addOpenRequest({ id: chat.id, tool: toolName(chat.agent), cwd: chat.cwd!, at: now, title: chat.title, app: appName(app) });
    const link = withLink && chat.agent === "claude" ? claudeChatLink(app, chat.id) : undefined;
    return link ? run("sh", ["-c", 'open -a "$1" "$2" && sleep 0.4 && open "$3"', "airband-open", app, folder, link]) : run("open", ["-a", app, folder]);
  };
  // 1. It runs now in a terminal: that very tab.
  if (live && !live.vscode) {
    const script = live.tty ? tabScript(live.app) : undefined;
    if (script && /ok/.test(sh("osascript", ["-e", script, live.tty!]))) return `Showing it in ${appName(live.app)}.`;
    if (run("open", ["-a", live.app])) return `Showing it in ${appName(live.app)}.`;
  }
  // 2. It runs now in VS Code (or the editor it was started in): that window.
  if (live?.vscode && chat.cwd) {
    const folder = windowFor(chat.cwd, now)?.root ?? (isVSCode(live.app) ? vscodeFolderFor(chat.cwd, vscodeWindows(procs, now)?.names ?? []) : undefined) ?? editorFolder(chat.cwd);
    // In the editor's own terminal (it has a terminal device) the window alone: Claude's panel link
    // would start a second copy of the chat beside it.
    if (showIn(live.app, folder, !live.tty)) return `Showing it in ${appName(live.app)}.`;
  }
  // 3. Not running, a Claude Code chat, and its folder is open in VS Code: that same window.
  if (!live && chat.cwd && chat.agent === "claude") {
    if (process.platform === "darwin") {
      const win = windowFor(chat.cwd, now);
      const vs = isVSCode(win?.app) ? undefined : vscodeWindows(procs, now);
      const folder = isVSCode(win?.app) ? win!.root : vs && vscodeFolderFor(chat.cwd, vs.names);
      const app = isVSCode(win?.app) ? VSCODE_APPS.find((a) => appName(a) === win!.app) ?? VSCODE_APPS[0] : vs?.app;
      if (folder && app && showIn(app, folder)) return `Showing it in ${appName(app)}.`;
    } else {
      // Windows and Linux: a VS Code window that Airband's extension says has the folder.
      const win = windowFor(chat.cwd, now);
      const cli = win && !/cursor|windsurf/i.test(win.app ?? "") ? findCommand("code") : undefined;
      if (cli && win) {
        addOpenRequest({ id: chat.id, tool: toolName(chat.agent), cwd: chat.cwd, at: now, title: chat.title, ...(win.app ? { app: win.app } : {}) });
        if (run(cli, [win.root])) return `Showing it in ${win.app ?? "VS Code"}.`;
      }
    }
  }
  // 4. Resume it in a new terminal window: the lightest way to see it.
  const resume = RESUME[chat.agent](chat.id);
  const line = chat.cwd ? `cd ${quote(chat.cwd)} && ${resume}` : resume;
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script ${JSON.stringify(line)}\ntell application "Terminal" to activate`;
    if (run("osascript", ["-e", script])) return "Opened it in Terminal.";
  } else if (process.platform === "win32") {
    try {
      // Its own console window: detached, and not hidden.
      const child = spawn("cmd.exe", [windowsResumeLine(chat.cwd, resume)], { detached: true, stdio: "ignore", windowsVerbatimArguments: true });
      child.on("error", () => undefined);
      child.unref();
      return "Opened it in a terminal.";
    } catch {
      // Falls through to the line to run.
    }
  } else if (run("x-terminal-emulator", ["-e", "sh", "-c", line])) return "Opened it in a terminal.";
  return `Run this to open it: ${line}`;
}
