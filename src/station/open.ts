// "Open chat" from the companion or the phone: the chat's own folder in VS Code, where Airband's extension
// opens that exact chat (the same request the board's "Open in its folder" makes). Without VS Code,
// the chat is resumed in a terminal window.
import { spawn } from "node:child_process";
import { addOpenRequest } from "../core/folders";
import { findCommand } from "../core/hooks";
import { toolName } from "../core/record";
import type { LiveChat } from "./chats";

const RESUME: Record<LiveChat["agent"], (id: string) => string> = {
  claude: (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  gemini: (id) => `gemini --resume ${id}`,
};

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function run(cmd: string, args: string[]): boolean {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Opens the chat where it lives; says where, in a few words. */
export function openChat(chat: Pick<LiveChat, "id" | "agent" | "cwd" | "title">, now = Date.now()): string {
  const code = findCommand("code");
  if (code && chat.cwd) {
    addOpenRequest({ id: chat.id, tool: toolName(chat.agent), cwd: chat.cwd, at: now, title: chat.title });
    if (run(code, [chat.cwd])) return "Opening it in VS Code.";
  }
  const resume = RESUME[chat.agent](chat.id);
  const line = chat.cwd ? `cd ${quote(chat.cwd)} && ${resume}` : resume;
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script ${JSON.stringify(line)}\ntell application "Terminal" to activate`;
    if (run("osascript", ["-e", script])) return "Opening it in Terminal.";
  } else if (process.platform === "win32") {
    if (run("cmd.exe", ["/c", "start", "cmd.exe", "/k", chat.cwd ? `cd /d "${chat.cwd}" && ${resume}` : resume])) return "Opening it in a terminal.";
  } else if (run("x-terminal-emulator", ["-e", "sh", "-c", line])) return "Opening it in a terminal.";
  return `Run this to open it: ${line}`;
}
