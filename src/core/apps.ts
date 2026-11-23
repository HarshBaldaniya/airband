// Which app a chat runs in. Claude Code runs in a terminal, in VS Code and in the Claude app's Code
// tab, and every line it saves says which (`entrypoint`). Codex runs in a terminal, in VS Code and
// in the Codex app, and the start of its file says which (`originator`). Roger uses it to open a
// chat where it lives: a Claude app chat in the Claude app, a Codex app chat in the Codex app.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ChatApp = "claude-app" | "codex-app" | "vscode" | "terminal";

/** The app's name as people say it. */
export const APP_NAME: Record<ChatApp, string> = { "claude-app": "the Claude app", "codex-app": "the Codex app", vscode: "VS Code", terminal: "a terminal" };

function readPart(file: string, from: "start" | "end", bytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = from === "end" ? Math.max(0, size - bytes) : 0;
    const buf = Buffer.alloc(Math.min(bytes, size - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Claude Code's name for where it runs, as each line saves it. */
export function claudeAppOf(entrypoint: string | undefined): ChatApp | undefined {
  if (!entrypoint) return undefined;
  if (/desktop/i.test(entrypoint)) return "claude-app";
  if (/vscode|cursor|windsurf|jetbrains/i.test(entrypoint)) return "vscode";
  if (entrypoint === "cli") return "terminal";
  return undefined;
}

/** Codex's name for the program that started a chat. */
export function codexAppOf(originator: string | undefined): ChatApp | undefined {
  if (!originator) return undefined;
  if (/desktop|chatgpt|codex[ _-]?app/i.test(originator)) return "codex-app";
  if (/vscode/i.test(originator)) return "vscode";
  if (/tui|cli/i.test(originator)) return "terminal";
  return undefined;
}

const cache = new Map<string, { size: number; app: ChatApp | undefined }>();

/** Where a chat ran last: for Claude Code, the newest line that says (a chat can move from VS Code
 *  to the Claude app and back); for Codex, the program that started it. Read once per file size. */
export function chatApp(tool: "claude" | "codex" | "gemini", file: string | undefined): ChatApp | undefined {
  if (!file || tool === "gemini") return tool === "gemini" ? "terminal" : undefined;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return undefined;
  }
  const hit = cache.get(file);
  if (hit && hit.size === size) return hit.app;
  let app: ChatApp | undefined;
  if (tool === "claude") {
    const all = [...readPart(file, "end", 256 * 1024).matchAll(/"entrypoint":"([^"]+)"/g)];
    app = claudeAppOf(all[all.length - 1]?.[1]);
  } else {
    app = codexAppOf(/"originator":"([^"]+)"/.exec(readPart(file, "start", 16 * 1024))?.[1]);
  }
  cache.set(file, { size, app });
  return app;
}

/** The Claude app's own folder (its Code tab keeps one small file per chat there). */
export function claudeAppDir(): string {
  if (process.env.AIRBAND_CLAUDE_APP_DIR) return process.env.AIRBAND_CLAUDE_APP_DIR;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Claude");
}

/**
 * The chats in the Claude app's Code tab: Claude Code's chat id to the app's own id for it
 * (local_…), which its links take. A chat the app has archived is left out.
 */
export function claudeAppChats(dir = claudeAppDir()): Map<string, string> {
  const out = new Map<string, string>();
  const root = path.join(dir, "claude-code-sessions");
  const list = (d: string) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  // claude-code-sessions/<account>/<organisation>/local_<id>.json
  for (const a of list(root)) {
    if (!a.isDirectory()) continue;
    for (const o of list(path.join(root, a.name))) {
      if (!o.isDirectory()) continue;
      for (const f of list(path.join(root, a.name, o.name))) {
        if (!/^local_[A-Za-z0-9-]+\.json$/.test(f.name)) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(root, a.name, o.name, f.name), "utf8")) as { sessionId?: string; cliSessionId?: string; isArchived?: boolean };
          if (j.isArchived || typeof j.cliSessionId !== "string" || typeof j.sessionId !== "string" || !/^local_[A-Za-z0-9-]{1,64}$/.test(j.sessionId)) continue;
          out.set(j.cliSessionId, j.sessionId);
        } catch {
          // A file the app is writing: the next open reads it.
        }
      }
    }
  }
  return out;
}

/** The link that shows one chat in the Claude app's Code tab. */
export const claudeAppLink = (local: string) => `claude://code/continue?session=${encodeURIComponent(local)}`;

/** The link that shows one chat in the Codex app (its thread id is the chat's id). */
export const codexAppLink = (id: string) => `codex://threads/${encodeURIComponent(id)}`;

