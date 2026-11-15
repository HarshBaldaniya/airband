// Airband's skills: short instructions agents pick up by themselves when a task matches their
// description (only the description sits in every chat; the rest loads when a skill is used).
// The same files ship in the Claude Code plugin and the Gemini CLI extension (skills/ at the repo
// root); here they are written where Claude Code and Codex look for a person's own skills.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import findCode from "../../skills/airband-find-code/SKILL.md";
import recall from "../../skills/airband-recall/SKILL.md";
import catchup from "../../skills/airband-catchup/SKILL.md";
import { guardRealHome, writeFileAtomic } from "./paths";

export const SKILLS: { name: string; text: string }[] = [
  { name: "airband-find-code", text: findCode },
  { name: "airband-recall", text: recall },
  { name: "airband-catchup", text: catchup },
];

/** A file in each skill folder Airband wrote, so it only ever replaces or removes its own. */
const MARK = ".airband";
/** Skills Airband wrote under its earlier name: removed wherever Airband's are written or removed,
 *  and only when their folder carries that name's mark (so a person's own folder is never touched). */
const OLD_SKILLS = [
  { names: ["crosstalk-find-code", "crosstalk-recall", "crosstalk-catchup"], mark: ".crosstalk" },
];

function retireOldSkills(agents: SkillAgent[]): number {
  let n = 0;
  for (const a of agents) {
    for (const old of OLD_SKILLS) {
      for (const name of old.names) {
        const dir = path.join(skillsDir(a), name);
        if (!fs.existsSync(path.join(dir, old.mark))) continue;
        guardRealHome(dir);
        fs.rmSync(dir, { recursive: true, force: true });
        n++;
      }
    }
  }
  return n;
}

export type SkillAgent = "claude" | "codex";

/** Where each agent reads a person's own skills. */
export function skillsDir(agent: SkillAgent): string {
  if (agent === "claude") return process.env.AIRBAND_CLAUDE_SKILLS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "skills");
  // Codex reads $HOME/.agents/skills, the shared folder for agent skills.
  return process.env.AIRBAND_AGENTS_SKILLS || path.join(os.homedir(), ".agents", "skills");
}

/** Writes (or refreshes) every Airband skill for these agents. A folder of the same name that is
 *  not Airband's is left alone. Returns how many were written. */
export function installSkills(agents: SkillAgent[]): number {
  retireOldSkills(agents);
  let n = 0;
  for (const a of agents) {
    for (const s of SKILLS) {
      const dir = path.join(skillsDir(a), s.name);
      if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MARK))) continue;
      writeFileAtomic(path.join(dir, "SKILL.md"), s.text);
      writeFileAtomic(path.join(dir, MARK), `Written by Airband ${__AIRBAND_VERSION__}. "airband remove" takes it away.\n`);
      n++;
    }
  }
  return n;
}

export function removeSkills(agents: SkillAgent[]): number {
  let n = retireOldSkills(agents);
  for (const a of agents) {
    for (const s of SKILLS) {
      const dir = path.join(skillsDir(a), s.name);
      if (!fs.existsSync(path.join(dir, MARK))) continue;
      guardRealHome(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      n++;
    }
  }
  return n;
}

/** Airband's skills present for an agent, and whether each matches this version's text. */
export function skillsState(agent: SkillAgent): { installed: number; current: number } {
  let installed = 0;
  let current = 0;
  for (const s of SKILLS) {
    const file = path.join(skillsDir(agent), s.name, "SKILL.md");
    if (!fs.existsSync(path.join(skillsDir(agent), s.name, MARK))) continue;
    installed++;
    try {
      if (fs.readFileSync(file, "utf8") === s.text) current++;
    } catch {
      // Missing file: not current.
    }
  }
  return { installed, current };
}
