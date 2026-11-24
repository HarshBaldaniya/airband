// Tab completion, set up for the person's shell: the script is kept in ~/.airband and the shell's
// startup file loads it with one marked line (no Node.js start per terminal). fish reads its own
// completions folder, so it gets the file there instead. `airband remove` takes both out.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { airbandFile, writeFileAtomic } from "../core/paths";
import { completion, type Shell } from "./help";
import { OLD_COMPLETION_MARKS, OLD_FISH_FILES } from "../core/legacy";

const MARK = "# Airband: Tab completion for the airband command (airband remove takes this out)";

/** A startup file without a marked block: the mark, the line after it, and the blank line before it. */
function withoutBlock(text: string, mark: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(mark);
  if (at < 0) return text;
  const blank = at > 0 && lines[at - 1] === "";
  lines.splice(blank ? at - 1 : at, blank ? 3 : 2);
  return lines.join("\n");
}

/** The folder the shell's files live in (tests point it at a temporary one). */
const shellHome = () => process.env.AIRBAND_SHELL_HOME || os.homedir();

/** The person's shell, when it is one Airband can set completion up for by itself. */
export function currentShell(): "zsh" | "bash" | "fish" | undefined {
  if (process.platform === "win32") return undefined; // PowerShell's profile is set up by hand (airband help completion).
  const name = path.basename(process.env.SHELL ?? "");
  return name === "zsh" || name === "bash" || name === "fish" ? name : undefined;
}

function startupFile(shell: "zsh" | "bash"): string {
  if (shell === "zsh") return path.join(process.env.ZDOTDIR || shellHome(), ".zshrc");
  return path.join(shellHome(), ".bashrc");
}

const fishFile = () => path.join(shellHome(), ".config", "fish", "completions", "airband.fish");
const scriptFile = (shell: "zsh" | "bash") => airbandFile(`completion.${shell}`);

export function completionOn(shell: "zsh" | "bash" | "fish"): boolean {
  if (shell === "fish") return [fishFile(), ...OLD_FISH_FILES.map((n) => path.join(path.dirname(fishFile()), n))].some((f) => fs.existsSync(f));
  try {
    // On under the earlier name counts as on: the next refresh swaps it for Airband's.
    const text = fs.readFileSync(startupFile(shell), "utf8");
    return [MARK, ...OLD_COMPLETION_MARKS].some((m) => text.includes(m));
  } catch {
    return false;
  }
}

/** Turns completion on (or refreshes the script after an update, so new commands complete). */
export function turnCompletionOn(shell: "zsh" | "bash" | "fish"): string {
  if (shell === "fish") {
    for (const f of OLD_FISH_FILES) fs.rmSync(path.join(path.dirname(fishFile()), f), { force: true });
    writeFileAtomic(fishFile(), completion("fish"));
    return fishFile();
  }
  writeFileAtomic(scriptFile(shell), completion(shell as Shell));
  const rc = startupFile(shell);
  const before = fs.existsSync(rc) ? fs.readFileSync(rc, "utf8") : "";
  let text = OLD_COMPLETION_MARKS.reduce(withoutBlock, before);
  if (!text.includes(MARK)) {
    const line = `[ -f ${JSON.stringify(scriptFile(shell))} ] && source ${JSON.stringify(scriptFile(shell))}`;
    text = `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${MARK}\n${line}\n`;
  }
  if (text !== before) writeFileAtomic(rc, text);
  return rc;
}

/** Keeps the script in step with this version, where completion is already on. */
export function refreshCompletion(): void {
  for (const shell of ["zsh", "bash", "fish"] as const) if (completionOn(shell)) turnCompletionOn(shell);
}

/** Takes Airband's line out of every startup file and deletes its scripts. */
export function turnCompletionOff(): boolean {
  let changed = false;
  for (const shell of ["zsh", "bash"] as const) {
    const rc = startupFile(shell);
    try {
      const text = fs.readFileSync(rc, "utf8");
      const next = [MARK, ...OLD_COMPLETION_MARKS].reduce(withoutBlock, text);
      if (next === text) continue;
      writeFileAtomic(rc, next);
      changed = true;
    } catch {
      // No such file.
    }
    fs.rmSync(scriptFile(shell), { force: true });
  }
  for (const f of [fishFile(), ...OLD_FISH_FILES.map((n) => path.join(path.dirname(fishFile()), n))]) {
    if (!fs.existsSync(f)) continue;
    fs.rmSync(f, { force: true });
    changed = true;
  }
  return changed;
}
