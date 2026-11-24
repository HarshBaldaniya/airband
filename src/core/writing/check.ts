// The checker: what in a text breaks the writing rules, line by line. No AI: patterns and counts.

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
