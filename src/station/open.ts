// "Open chat" from the companion or the phone, the lightest way that finds the chat where it is:
//   1. its folder is open in a VS Code window: that window comes forward, and its Airband opens the
//      chat there (Claude's panel, or the chat's terminal);
//   2. the chat is running now in a terminal: that terminal app comes forward, no second copy;
//   3. otherwise the chat is resumed in a new Terminal window.
// VS Code is never started just to show a chat: a terminal costs far less.
import { execFileSync, spawn } from "node:child_process";
import * as path from "node:path";
import { addOpenRequest, windowFor } from "../core/folders";
import { findCommand } from "../core/hooks";
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

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? "");
  }
}

/** The app (Terminal, iTerm, Warp, VS Code …) that runs this chat now, found from its process. macOS only. */
export function runningIn(chat: Pick<LiveChat, "id" | "agent" | "cwd">): { app: string; vscode: boolean } | undefined {
  if (process.platform !== "darwin" || !chat.cwd) return undefined;
  const procs = new Map<number, { ppid: number; comm: string; args: string }>();
  for (const line of sh("ps", ["-axo", "pid=,ppid=,comm=,args="]).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3], args: m[4] });
  }
  const agents = [...procs.entries()].filter(([, p]) => BINARY[chat.agent].test(p.comm) || BINARY[chat.agent].test(p.args.split(" ")[0] ?? "") || (chat.agent !== "claude" && p.args.includes(`/${chat.agent}`)));
  if (!agents.length) return undefined;
  // The one for this chat: started with its id, or working in its folder.
  let pid = agents.find(([, p]) => p.args.includes(chat.id))?.[0];
  if (!pid) {
    const cwds = sh("lsof", ["-a", "-d", "cwd", "-Fn", "-p", agents.map(([p]) => p).join(",")]);
    let current = 0;
    for (const line of cwds.split("\n")) {
      if (line.startsWith("p")) current = Number(line.slice(1));
      else if (line.startsWith("n") && path.resolve(line.slice(1)) === path.resolve(chat.cwd)) {
        pid = current;
        break;
      }
    }
  }
  // Up the parents to the app that holds it.
  for (let at = pid, hops = 0; at && hops < 20; hops++) {
    const p = procs.get(at);
    if (!p) break;
    const app = /^(.*?\.app)\/Contents\/MacOS\//.exec(p.comm)?.[1] ?? /^(.*?\.app)\/Contents\/MacOS\//.exec(p.args)?.[1];
    if (app && !/Helper/.test(path.basename(app))) return { app, vscode: /Visual Studio Code|VSCodium|Cursor/.test(app) };
    at = p.ppid;
  }
  return undefined;
}

const appName = (app: string) => path.basename(app, ".app");

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
  const live = runningIn(chat);
  // 1. It runs in an editor now (its Claude panel, its terminal), or its folder is open in one:
  //    that exact editor, by name, and only that editor's Airband opens it. Never the `code`
  //    command: on many Macs it starts a different editor (Cursor's installs over VS Code's).
  const win = live?.vscode ? undefined : windowFor(chat.cwd, now);
  const editor = live?.vscode ? appName(live.app) : win?.app;
  if (chat.cwd && editor && process.platform === "darwin") {
    addOpenRequest({ id: chat.id, tool: toolName(chat.agent), cwd: chat.cwd, at: now, title: chat.title, app: editor });
    if (run("open", ["-a", live?.vscode ? live.app : editor, win?.root ?? chat.cwd])) return `Showing it in ${editor}.`;
  }
  if (chat.cwd && win && (!editor || process.platform !== "darwin")) {
    // Windows and Linux, or an editor that did not say its name (an older Airband): the folder's
    // own window, through that editor's command.
    const cli = findCommand(editorCommand(win.app));
    addOpenRequest({ id: chat.id, tool: toolName(chat.agent), cwd: chat.cwd, at: now, title: chat.title, ...(win.app ? { app: win.app } : {}) });
    if (cli && run(cli, [win.root])) return `Showing it in ${win.app ?? "your editor"}.`;
  }
  // 2. It runs now in a terminal: bring that forward rather than start a second copy.
  if (live && !live.vscode && run("open", ["-a", live.app])) return `Showing it in ${appName(live.app)}.`;
  // 3. Resume it in a new terminal window: the lightest way to see it.
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
