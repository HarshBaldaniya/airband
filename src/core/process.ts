// Running other programs: finding one as the person's own shell would, reading what a command
// prints, and starting one that carries on by itself (a browser, an editor, a terminal).
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * What a command printed. A command that exits with an error still gives what it printed before;
 * undefined means it couldn't run at all (not there, or it ran out of `timeoutMs`).
 */
export function output(cmd: string, args: string[], timeoutMs = 3000): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    const printed = (e as { stdout?: unknown }).stdout;
    return typeof printed === "string" ? printed : undefined;
  }
}

/** Whether a command ran and ended without an error, within `timeoutMs`. */
export function succeeds(cmd: string, args: string[], timeoutMs = 3000): boolean {
  try {
    execFileSync(cmd, args, { stdio: "ignore", timeout: timeoutMs, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Windows: a .cmd (VS Code's `code`, Cursor's `cursor`) starts only through cmd.exe. */
const isScript = (cmd: string) => /\.(cmd|bat)$/i.test(cmd);

/**
 * Starts a program that carries on by itself, without waiting for it. False when it couldn't be
 * started. `visible` keeps its window on Windows (a console a chat resumes in); `verbatim` passes
 * the arguments to Windows exactly as written.
 */
export function launch(cmd: string, args: string[], o: { visible?: boolean; verbatim?: boolean } = {}): boolean {
  try {
    const child = isScript(cmd)
      ? spawn("cmd.exe", ["/d", "/s", "/c", `"${[cmd, ...args].map((a) => `"${a}"`).join(" ")}"`], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true })
      : spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: !o.visible, ...(o.verbatim ? { windowsVerbatimArguments: true } : {}) });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Opens a link in the person's browser. Says nothing if it can't (a server, a container). */
export function openUrl(url: string): void {
  if (process.platform === "darwin") launch("open", [url]);
  else if (process.platform === "win32") launch("rundll32", ["url.dll,FileProtocolHandler", url]);
  else launch("xdg-open", [url]);
}

/**
 * Where a command lives, as the person's own setup finds it: their login shell on macOS and Linux
 * (an editor started from the Dock or a desktop menu has a short PATH), `where` on Windows, then the
 * usual install places.
 */
export function findCommand(name: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const lines = (cmd: string, args: string[]) =>
    (output(cmd, args, 5000) ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  if (platform === "win32") {
    // `where` lists every match; an .exe or .cmd is what can actually be started.
    const found = lines("where", [name]).find((p) => /\.(exe|cmd|bat)$/i.test(p) && fs.existsSync(p));
    if (found) return found;
  } else {
    const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter((s): s is string => !!s && fs.existsSync(s));
    for (const shell of shells.slice(0, 2)) {
      const found = lines(shell, ["-lc", `command -v ${name}`]).pop();
      if (found && path.isAbsolute(found) && fs.existsSync(found)) return found;
    }
  }
  const home = os.homedir();
  const usual =
    platform === "win32"
      ? [
          path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm", `${name}.cmd`),
          path.join(home, ".local", "bin", `${name}.exe`),
          path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Microsoft", "WinGet", "Links", `${name}.exe`),
          path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", `${name}.exe`),
        ]
      : [path.join(home, ".local", "bin", name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`];
  return usual.find((p) => fs.existsSync(p));
}

/** The absolute path of `node` (falls back to "node" on the PATH at run time). */
export function findNode(): string {
  // The editor's own Node is not a choice: VS Code ships Electron, not a node the hook can run.
  return findCommand("node") ?? "node";
}

/** The person's own `claude`. */
export function findClaude(): string | undefined {
  return findCommand("claude");
}
