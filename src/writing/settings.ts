// Writing rules that switch on by themselves: when a chat is asked for a doc (a PRD, a spec, a
// README) Airband adds its docs rules, when it is asked for a message (Slack, email, a PR comment)
// its message rules, and on request short replies for the chat itself. Each is a few lines added
// once per chat, only when needed; the full rules are skills. After an agent writes a doc file,
// the checker here reads what it wrote and names what breaks the rules.
//
// The settings are the person's (config.json) and, when a project has one, the team's: an
// `.airband.json` at the project's root, committed with the code, wins where it says something.
import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig } from "../core/config";
import { readJson } from "../core/json";
import { writeFileAtomic } from "../core/paths";

export type WritingKind = "docs" | "messages" | "replies";
export const WRITING_KINDS: WritingKind[] = ["docs", "messages", "replies"];

export interface WritingSettings {
  docs: boolean;
  messages: boolean;
  replies: boolean;
  /** Check a message, PR or commit before it goes out, and hold it once to fix */
  beforeSend: boolean;
  /** The team's own extra rules, from the project file */
  rules: string[];
  /** The project file the settings came from, when there is one */
  project?: string;
}

/** The project's settings file, at its root (found from any folder inside it). */
export const PROJECT_FILE = ".airband.json";

interface ProjectFile {
  writing?: Partial<Record<WritingKind | "beforeSend", boolean>> & { rules?: unknown };
}

/** The nearest `.airband.json` from this folder up to the repository's root. */
export function projectFile(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 12; i++) {
    const f = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(f)) return f;
    if (fs.existsSync(path.join(dir, ".git"))) return undefined;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
}

/** Where the project's settings file goes: the repository's root, else this folder. */
function projectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, PROJECT_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(cwd);
}

export function writingSettings(cwd?: string): WritingSettings {
  const mine = readConfig().writing;
  const file = projectFile(cwd);
  const team = file ? readJson<ProjectFile>(file, {}).writing ?? {} : {};
  const pick = (k: WritingKind) => (typeof team[k] === "boolean" ? (team[k] as boolean) : mine[k]);
  const rules = Array.isArray(team.rules) ? team.rules.filter((r): r is string => typeof r === "string" && !!r.trim()).map((r) => r.trim().slice(0, 300)).slice(0, 12) : [];
  const beforeSend = typeof team.beforeSend === "boolean" ? team.beforeSend : mine.beforeSend;
  return { docs: pick("docs"), messages: pick("messages"), replies: pick("replies"), beforeSend, rules, ...(file ? { project: file } : {}) };
}

/** Sets one kind on or off in the project's file (made when missing), keeping the rest of it. */
export function setProjectWriting(cwd: string, kind: WritingKind | "beforeSend", on: boolean): string {
  const file = projectFile(cwd) ?? path.join(projectRoot(cwd), PROJECT_FILE);
  const now = readJson<ProjectFile & Record<string, unknown>>(file, {});
  now.writing = { ...(now.writing ?? {}), [kind]: on };
  writeFileAtomic(file, `${JSON.stringify(now, null, 2)}\n`);
  return file;
}
