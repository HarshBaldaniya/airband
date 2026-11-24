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
import { airbandFile, writeFileAtomic } from "./paths";
import { readJson } from "./json";
import { readConfig } from "./config";

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
const PROJECT_FILE = ".airband.json";

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

// ---- the rules, short: what a chat gets, once, when it needs them ----

export const DOCS_BRIEF = [
  "Airband's writing rules for docs (PRDs, specs, READMEs, guides, PR descriptions, changelogs, error and UI text). The project's or the person's own writing rules come first.",
  "- One idea per sentence: at most 20 words for an instruction, 25 for a description.",
  "- Active voice: say who does what. Simple tenses (\"the job failed\", not \"the job has been failing\").",
  "- One name for one thing, every time. Define a term the reader may not know, once.",
  "- Plain verbs: \"start\", not \"kick off\". \"Check\", not \"perform a check of\".",
  "- No semicolons. No hype words (\"seamless\", \"robust\", \"powerful\"): give the number or the fact instead.",
  "- Write as the person, for people: no \"Generated with\" or \"Co-Authored-By\" lines naming an AI tool, no robot emoji, no \"As an AI\".",
  "- Steps are a numbered list, one action per step. One topic per paragraph.",
  "- Keep every fact, condition, number and hedge (\"may\", \"can\"). Add no claim the source does not make.",
  "Full rules: the airband-write-docs skill.",
].join("\n");

export const MESSAGES_BRIEF = [
  "Airband's writing rules for messages (Slack, email, PR and ticket comments, announcements). The project's or the person's own rules come first.",
  "- The first line is the point or the ask. Then one line of context, if needed.",
  "- Say who does what by when: a name and a date for each action.",
  "- Steps are a numbered list. At most 5 items in a list, the most important first.",
  "- One topic per message; details go in a thread or behind a link.",
  "- No greetings or sign-offs that say nothing (\"Hope you're well\", \"Let me know if you need anything\"), no \"by the way\" sidebars, no idioms.",
  "- Write as the person: no \"Generated with\" lines or other credit to an AI tool, no robot emoji, nothing that says an AI wrote it.",
  "- Show the person the draft before you send or post it.",
  "Full rules: the airband-write-messages skill.",
].join("\n");

export const REPLIES_BRIEF = [
  "The person asked Airband for short replies they can act on. For every reply in this chat (their own instructions win where they differ):",
  "1. Start with the answer or the next action. No preamble (\"Great question\", \"Let me …\").",
  "2. Number steps, one action each.",
  "3. Say where things stand: \"Step 2 of 4 done: … Next: …\".",
  "4. Give times in real units (\"about 10 minutes\"), not \"a bit of work\".",
  "5. At most 5 items per list, the most important first; offer the rest.",
  "6. Finish the task first; name a side issue at the end, as one question.",
  "7. No recap of what you did and no closing offer (\"Hope this helps\").",
  "When asked to explain, explain in full, with headings. Before anything that deletes or overwrites, ask.",
].join("\n");

const DOCS_ASK = /\b(prds?|specs?|specifications?|readmes?|docs?|documentation|documents?|design docs?|rfcs?|adrs?|changelogs?|release notes|write-?ups?|guides?|runbooks?|playbooks?|how-?tos?|proposals?|one-?pagers?|pr (description|body)|wiki|faq)\b/i;
const MESSAGES_ASK = /\b(slack|emails?|e-mails?|mails?|messages?|dms?|reply to|respond to|announce(ment)?|post (it |this )?(in|on|to)|tell (the )?team|standup|stand-up|status update|comment on|pr comments?|review comments?|tweet|linkedin post|whatsapp|teams message)\b/i;

/** Which rules an ask needs, among those switched on. */
export function writingFor(prompt: string | undefined, s: WritingSettings): ("docs" | "messages")[] {
  if (!prompt) return [];
  const p = prompt.slice(0, 4000);
  const out: ("docs" | "messages")[] = [];
  if (s.docs && DOCS_ASK.test(p)) out.push("docs");
  if (s.messages && MESSAGES_ASK.test(p)) out.push("messages");
  return out;
}

/** The text a chat gets for these kinds, with the team's own rules after them. */
export function briefFor(kinds: WritingKind[], s: WritingSettings): string {
  const parts = kinds.map((k) => (k === "docs" ? DOCS_BRIEF : k === "messages" ? MESSAGES_BRIEF : REPLIES_BRIEF));
  if (s.rules.length && kinds.some((k) => k !== "replies")) parts.push(`This team's own writing rules (from ${PROJECT_FILE}):\n${s.rules.map((r) => `- ${r}`).join("\n")}`);
  return parts.join("\n\n");
}

// ---- once per chat: the rules stay in its context, so they are not sent again ----

const seenFile = () => airbandFile("writing-seen.json");
const SEEN_MAX = 400;

/** The kinds not yet given to this chat; marks them given. */
export function notYetGiven(sessionId: string | undefined, kinds: WritingKind[]): WritingKind[] {
  if (!sessionId || !kinds.length) return kinds;
  const seen = readJson<Record<string, string[]>>(seenFile(), {});
  const had = new Set(seen[sessionId] ?? []);
  const fresh = kinds.filter((k) => !had.has(k));
  if (!fresh.length) return [];
  delete seen[sessionId];
  seen[sessionId] = [...had, ...fresh];
  const ids = Object.keys(seen);
  for (const id of ids.slice(0, Math.max(0, ids.length - SEEN_MAX))) delete seen[id];
  try {
    writeFileAtomic(seenFile(), JSON.stringify(seen));
  } catch {
    // Only a saving: the rules go again next time.
  }
  return fresh;
}

/** A chat whose context was cleared or compacted gets the rules again when it needs them. */
export function forgetGiven(sessionId: string | undefined): void {
  if (!sessionId) return;
  const seen = readJson<Record<string, string[]>>(seenFile(), {});
  if (!(sessionId in seen)) return;
  delete seen[sessionId];
  try {
    writeFileAtomic(seenFile(), JSON.stringify(seen));
  } catch {
    // Nothing to keep.
  }
}

// ---- the checker: what in a text breaks the rules, by line ----

export interface WritingFinding {
  line: number;
  rule: "long" | "semicolon" | "hype" | "phrasal" | "filler" | "pleasantry" | "list" | "ai";
  text: string;
  /** What to write instead, when there is one plain answer */
  fix?: string;
}

const HYPE = /\b(seamless(ly)?|robust|powerful|cutting[- ]edge|effortless(ly)?|blazing(ly)?[- ]fast|world[- ]class|best[- ]in[- ]class|state[- ]of[- ]the[- ]art|revolutionary|game[- ]chang(ing|er)|next[- ]gen(eration)?|supercharge[ds]?|unleash(es|ed)?|synerg(y|ies))\b/gi;
const PHRASAL: [RegExp, string][] = [
  [/\bspin(s|ning)? up\b/gi, "start"],
  [/\breach(es|ing)? out( to)?\b/gi, "contact"],
  [/\bdive[sd]? into\b|\bdiving into\b|\bdeep[- ]dive\b/gi, "read, study"],
  [/\bkick(s|ed|ing)? off\b/gi, "start"],
  [/\bcircle back\b/gi, "return to"],
  [/\btouch base\b/gi, "talk"],
  [/\bloop(ed)? in\b/gi, "add, tell"],
  [/\bfollow(ed)? up on\b/gi, "check"],
  [/\bset(ting)? up\b(?= the\b| a\b| an\b)/gi, "configure, make"],
];
const FILLER: [RegExp, string][] = [
  [/\bit is (important|worth) (to note|noting) that\b/gi, "(delete)"],
  [/\bplease note that\b/gi, "(delete)"],
  [/\bit should be noted that\b/gi, "(delete)"],
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bat this point in time\b/gi, "now"],
  [/\bperform(s|ed)? an? (analysis|check|review|update|test) of\b/gi, "the verb: analyse, check, review"],
  [/\bprovide(s|d)? assistance\b/gi, "help"],
  [/\bmake(s)? a decision\b/gi, "decide"],
  [/\bin the event that\b/gi, "if"],
];
const PLEASANTRY = /^(hi|hey|hello|dear)\b[^.!?\n]*\b(hope|trust)\b[^.!?\n]*(well|good|great)|\bhope (this|that) helps\b|\blet me know if (you (need|have)|there'?s) (anything|any questions)\b|\bfeel free to (reach out|ask|let me know)\b|\bhappy to (help|clarify)\b|\bgreat question\b|\bthanks in advance\b/i;

/** A line that credits an AI tool, or says an AI wrote the text. */
const AI_MARK = /🤖|\b(generated|written|created|drafted|made) (with|by|using) (\[?(claude|chatgpt|gpt-?\d*|codex|gemini|copilot|cursor|an? ai|ai)\b)|\bco-authored-by:[^\n]*\b(claude|codex|gemini|copilot|chatgpt|cursor|openai|anthropic)\b|\bas an ai( language model)?\b/i;

const LIMIT: Record<"docs" | "messages", number> = { docs: 25, messages: 30 };

/** Prose blocks of a markdown or plain text: code, tables, front matter and headings are left out. */
function blocks(text: string): { line: number; text: string; item: boolean; indent: number }[] {
  const lines = text.split("\n");
  const out: { line: number; text: string; item: boolean; indent: number }[] = [];
  let fence: string | undefined;
  let cur: (typeof out)[number] | undefined;
  let i = 0;
  if (/^---\s*$/.test(lines[0] ?? "")) {
    const end = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let comment = false;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (f) {
      fence = f[1];
      cur = undefined;
      continue;
    }
    if (comment) {
      if (t.includes("-->")) comment = false;
      continue;
    }
    if (t.startsWith("<!--")) {
      comment = !t.includes("-->");
      continue;
    }
    if (!t || t.startsWith("|") || /^#{1,6}\s/.test(t) || /^(\s{4,}|\t)/.test(raw) && !cur || /^<\/?[a-z]/i.test(t) || /^[-*_]{3,}$/.test(t)) {
      cur = undefined;
      continue;
    }
    const item = /^([-*+]|\d+[.)])\s+/.exec(t);
    const indent = raw.length - raw.trimStart().length;
    if (item || !cur) {
      cur = { line: i + 1, text: item ? t.slice(item[0].length) : t.replace(/^>\s?/, ""), item: !!item, indent };
      out.push(cur);
    } else cur.text += ` ${t.replace(/^>\s?/, "")}`;
  }
  return out;
}

/** A block's words as read: code, links and emphasis marks taken out. */
function prose(t: string): string {
  return t
    // Code keeps its words (they are read) but not its punctuation (it is not a sentence's).
    .replace(/`([^`]*)`/g, (_, c: string) => c.replace(/[;.!?]/g, " ").trim() || "code")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<https?:[^>]+>|https?:\/\/\S+/g, "link")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");
}

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Sentences of a block, split where a sentence ends and the next begins. */
function sentences(t: string): string[] {
  // A new sentence can start with code (lowercase once its marks are gone), so any word counts.
  return t.split(/(?<=[^.\s][.!?]["”’')\]]*)\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
}

/** What in a text breaks the docs or the message rules. Lines are the text's own. */
export function checkWriting(text: string, kind: "docs" | "messages" = "docs"): WritingFinding[] {
  const out: WritingFinding[] = [];
  // Read line by line, outside code: a footer, a trailer or a link credit is not a sentence.
  let inFence = false;
  text.split("\n").forEach((l, i) => {
    if (/^\s*(`{3,}|~{3,})/.test(l)) inFence = !inFence;
    const used = l.replace(/`[^`]*`/g, "").replace(/"[^"\n]*"|“[^”\n]*”/g, '""');
    if (!inFence && AI_MARK.test(used)) out.push({ line: i + 1, rule: "ai", text: `"${l.trim().slice(0, 60)}"`, fix: "(delete: write as the person)" });
  });
  const bs = blocks(text);
  for (const b of bs) {
    const p = prose(b.text);
    for (const s of sentences(p)) {
      const n = words(s);
      if (n > LIMIT[kind]) out.push({ line: b.line, rule: "long", text: `${n} words: "${s.split(/\s+/).slice(0, 8).join(" ")} …"` });
    }
    // Words in quotes are named, not used ("avoid \"seamless\""): only the rest is read for them.
    const used = p.replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g, '""');
    if (kind === "docs" && /;\s/.test(used)) out.push({ line: b.line, rule: "semicolon", text: "a semicolon", fix: "two sentences" });
    for (const m of used.matchAll(HYPE)) out.push({ line: b.line, rule: "hype", text: `"${m[0]}"`, fix: "the fact or number it stands for" });
    for (const [re, fix] of PHRASAL) for (const m of used.matchAll(re)) out.push({ line: b.line, rule: "phrasal", text: `"${m[0]}"`, fix });
    for (const [re, fix] of FILLER) for (const m of used.matchAll(re)) out.push({ line: b.line, rule: "filler", text: `"${m[0]}"`, fix });
    if (kind === "messages") for (const m of used.matchAll(new RegExp(PLEASANTRY.source, "gi"))) out.push({ line: b.line, rule: "pleasantry", text: `"${m[0].trim()}"`, fix: "(delete)" });
  }
  if (kind === "messages") {
    // A list longer than five, at one level.
    let run = 0;
    let start = 0;
    let indent = -1;
    const flush = () => {
      if (run > 5) out.push({ line: start, rule: "list", text: `a list of ${run} items`, fix: "the 5 that matter most, the rest in a thread" });
      run = 0;
    };
    let prev = -2;
    for (const b of bs) {
      if (b.item && (run === 0 || (b.indent === indent && b.line <= prev + 3))) {
        if (run === 0) {
          start = b.line;
          indent = b.indent;
        }
        run++;
        prev = b.line;
      } else if (!(b.item && b.indent > indent)) {
        flush();
        if (b.item) {
          start = b.line;
          indent = b.indent;
          run = 1;
          prev = b.line;
        }
      }
    }
    flush();
  }
  return out.sort((a, b) => a.line - b.line);
}

const RULE_NAME: Record<WritingFinding["rule"], [string, string]> = {
  long: ["long sentence", "long sentences"],
  ai: ["line crediting an AI tool", "lines crediting an AI tool"],
  semicolon: ["semicolon", "semicolons"],
  hype: ["hype word", "hype words"],
  phrasal: ["two-word verb", "two-word verbs"],
  filler: ["filler phrase", "filler phrases"],
  pleasantry: ["empty greeting or sign-off", "empty greetings or sign-offs"],
  list: ["list over 5 items", "lists over 5 items"],
};

/** "2 long sentences (lines 4, 9), 1 semicolon (line 7)". */
export function summarise(found: WritingFinding[], max = 4): string {
  const by = new Map<WritingFinding["rule"], number[]>();
  for (const f of found) by.set(f.rule, [...(by.get(f.rule) ?? []), f.line]);
  const parts = [...by].map(([rule, lines]) => {
    const u = [...new Set(lines)];
    const [one, many] = RULE_NAME[rule];
    return `${lines.length} ${lines.length === 1 ? one : many} (line${u.length === 1 ? "" : "s"} ${u.slice(0, 4).join(", ")}${u.length > 4 ? " …" : ""})`;
  });
  return parts.slice(0, max).join(", ") + (parts.length > max ? `, and ${parts.length - max} more kinds` : "");
}

/** Every finding on its own line, for the agent (or a terminal). */
export function renderFindings(found: WritingFinding[], file?: string): string {
  return found.map((f) => `${file ? `${file}:` : "line "}${f.line}  ${RULE_NAME[f.rule][0]}: ${f.text}${f.fix ? ` → ${f.fix}` : ""}`).join("\n");
}

// ---- after an agent writes a doc: check what it wrote ----

const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const NOT_DOCS = /(^|[\\/])(node_modules|\.git|dist|build|vendor)[\\/]|(^|[\\/])(LICEN[CS]E|NOTICE|CODEOWNERS)(\.\w+)?$|\.(lock|min)\./i;

/** What an agent's write or edit put in a doc file: the file and the new text. */
export function writtenDoc(toolName: string | undefined, input: unknown): { file: string; text: string } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const file = typeof i.file_path === "string" ? i.file_path : typeof i.absolute_path === "string" ? i.absolute_path : typeof i.path === "string" ? i.path : undefined;
  if (!file || !DOC_FILE.test(file) || NOT_DOCS.test(file)) return undefined;
  const name = toolName ?? "";
  let text: string | undefined;
  if (/^(Write|write_file)$/.test(name)) text = typeof i.content === "string" ? i.content : undefined;
  else if (/^(Edit|replace)$/.test(name)) text = typeof i.new_string === "string" ? i.new_string : undefined;
  else if (name === "MultiEdit" && Array.isArray(i.edits)) text = (i.edits as { new_string?: unknown }[]).map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n\n");
  return text?.trim() ? { file, text } : undefined;
}

/** The check of a doc just written, with lines counted in the file itself where the text is found. */
export function checkWrittenDoc(doc: { file: string; text: string }): WritingFinding[] {
  const found = checkWriting(doc.text, "docs");
  if (!found.length) return found;
  let offset = 0;
  try {
    const whole = fs.readFileSync(doc.file, "utf8");
    const at = whole.indexOf(doc.text.split("\n").find((l) => l.trim().length > 8) ?? doc.text);
    const firstLong = doc.text.split("\n").findIndex((l) => l.trim().length > 8);
    if (at >= 0) offset = whole.slice(0, at).split("\n").length - 1 - Math.max(0, firstLong);
  } catch {
    // The file is gone already: lines of the text itself.
  }
  return found.map((f) => ({ ...f, line: f.line + offset }));
}

// ---- before it goes out: a message, a PR or a commit an agent is about to send ----

export interface Outgoing {
  /** What it is, as the person would say it: "Slack message", "PR description", "commit message" */
  where: string;
  /** Which rules it gets: a commit only the AI-credit rule */
  kind: "docs" | "messages" | "commit";
  text: string;
}

const SHELL_TOOL = /^(Bash|run_shell_command|shell|exec_command|local_shell)$/;
/** An MCP tool that sends or posts words for people to read. */
const SENDS = /(send|post|reply|forward|schedule|draft|comment|review|create_?(issue|pull|pr)|update_?(issue|pull|pr)|save_?(comment|issue)|message|announce)/i;
const NOT_SENDS = /(reaction|label|read|get|list|search|find|delete|remove|upload|download|mark|status|query|fetch)/i;
const TEXT_FIELD = /^(text|message|body|content|markdown|comment|description|reply|draft|html_?body|note)$/i;

/** The words after a flag in a shell command: a quoted value, a heredoc, or a file named by it. */
function shellValues(command: string, flags: string[], cwd?: string): string[] {
  const out: string[] = [];
  const names = flags.map((f) => f.replace(/[-]/g, "\\-")).join("|");
  // A heredoc anywhere in the command ("$(cat <<'EOF' … EOF)") is the body: agents write long ones so.
  const here = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/.exec(command);
  if (here) out.push(here[2]);
  else {
    const re = new RegExp(`(?:^|\\s)(?:${names})(?:=|\\s+)(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`, "g");
    for (const m of command.matchAll(re)) {
      const v = m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, "$1") : (m[2] ?? m[3] ?? "");
      if (v) out.push(v);
    }
  }
  const file = new RegExp(`(?:^|\\s)(?:--body-file|-F|--file)(?:=|\\s+)("([^"]+)"|'([^']+)'|(\\S+))`).exec(command);
  const name = file && (file[2] ?? file[3] ?? file[4]);
  if (name && name !== "-") {
    try {
      out.push(fs.readFileSync(path.resolve(cwd ?? ".", name), "utf8").slice(0, BODY_FILE_MAX));
    } catch {
      // A file not there yet: nothing to read.
    }
  }
  return out;
}

/** How much of a file a command sends (gh pr create --body-file) is read to check its words. */
const BODY_FILE_MAX = 64_000;

/** What an agent is about to send, read from the tool call; nothing for anything else. */
export function outgoingText(toolName: string | undefined, input: unknown, cwd?: string): Outgoing | undefined {
  if (!input || typeof input !== "object" || !toolName) return undefined;
  const i = input as Record<string, unknown>;
  if (SHELL_TOOL.test(toolName)) {
    const raw = i.command;
    const command = Array.isArray(raw) ? raw.join(" ") : typeof raw === "string" ? raw : "";
    if (!command) return undefined;
    // Only what runs: "git commit" or "gh pr create" as a command of its own, not words inside a
    // quoted string (a prompt handed to another tool, an echo).
    const bare = command.replace(/<<-?\s*['"]?([A-Za-z_]\w*)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, "").replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    const at = (re: string) => new RegExp(`(?:^|[;&|(\\n]|\\$\\()\\s*(?:\\w+=\\S*\\s+)*${re}`).test(bare);
    let where: string | undefined;
    let kind: Outgoing["kind"] = "messages";
    let flags = ["--body", "-b"];
    if (at("git\\s+(?:-C\\s+\\S+\\s+)?commit\\b")) {
      where = "commit message";
      kind = "commit";
      flags = ["-m", "--message"];
    } else if (at("gh\\s+pr\\s+(?:create|edit)\\b")) [where, kind] = ["PR description", "docs"];
    else if (at("gh\\s+issue\\s+(?:create|edit)\\b")) [where, kind] = ["issue", "docs"];
    else if (at("gh\\s+(?:pr|issue)\\s+comment\\b")) where = "comment";
    else if (at("gh\\s+pr\\s+review\\b")) where = "review";
    else if (at("gh\\s+release\\s+(?:create|edit)\\b")) [where, kind, flags] = ["release notes", "docs", ["--notes", "-n"]];
    if (!where) return undefined;
    const text = shellValues(command, flags, cwd).join("\n\n").trim();
    return text ? { where, kind, text } : undefined;
  }
  // Another tool, from an MCP server: Slack, email, GitHub, Linear and the like.
  if (/airband/i.test(toolName) || !/__|^mcp/i.test(toolName)) return undefined;
  const verb = toolName.split(/__/).pop() ?? toolName;
  if (!SENDS.test(verb) || NOT_SENDS.test(verb)) return undefined;
  const text = Object.entries(i)
    .filter(([k, v]) => TEXT_FIELD.test(k) && typeof v === "string")
    .map(([, v]) => v as string)
    .join("\n\n")
    .trim();
  if (!text) return undefined;
  const kind: Outgoing["kind"] = /create_?(issue|pull|pr)|update_?(issue|pull|pr)|save_?issue|document/i.test(verb) ? "docs" : "messages";
  const where = /slack/i.test(toolName)
    ? "Slack message"
    : /gmail|mail|outlook/i.test(toolName)
      ? "email"
      : /teams/i.test(toolName)
        ? "Teams message"
        : /comment|review/i.test(verb)
          ? "comment"
          : kind === "docs"
            ? /issue/i.test(verb)
              ? "issue"
              : "PR description"
            : "message";
  return { where, kind, text };
}

/** What in an outgoing text breaks its rules. A commit is held only for a line crediting an AI tool. */
export function checkOutgoing(o: Outgoing): WritingFinding[] {
  if (o.kind === "commit") return checkWriting(o.text, "docs").filter((f) => f.rule === "ai");
  return checkWriting(o.text, o.kind);
}

const heldFile = () => airbandFile("writing-held.json");

/** djb2, enough to know the same text again. */
function hashText(t: string): string {
  let h = 5381;
  for (let k = 0; k < t.length; k++) h = ((h << 5) + h + t.charCodeAt(k)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Hold this text once: true the first time it is seen, false when it comes again unchanged (the
 * agent was told it may send it as it is, when the person asked for that wording).
 */
export function holdOnce(sessionId: string | undefined, text: string, now = Date.now()): boolean {
  const key = `${sessionId ?? "-"}:${hashText(text)}`;
  const held = readJson<Record<string, number>>(heldFile(), {});
  if (held[key]) return false;
  held[key] = now;
  const keys = Object.keys(held);
  for (const k of keys.slice(0, Math.max(0, keys.length - SEEN_MAX))) delete held[k];
  try {
    writeFileAtomic(heldFile(), JSON.stringify(held));
  } catch {
    // Not kept: the next try is held again, which is only one more round.
  }
  return true;
}
