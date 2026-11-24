// Reading a chat's own file into asks: each thing the person asked, the reply, the files it
// changed and the commits, PRs, tickets and links it named. By code alone, from the agent's file.
import * as fs from "node:fs";
import * as path from "node:path";
import { geminiMessages, geminiSeen, geminiStart, loadGeminiChat } from "../../adapters/gemini";
import { toolOf, type AgentId } from "../agents";
import { parseJsonLine } from "../json";
import { OLD_NAMES } from "../legacy";
import { claudeProjectsDir, codexSessionsDir, geminiTmpDir } from "../paths";
import { redact } from "../redact";
import { shorten } from "../text";
import { lineMessages } from "../../adapters/transcripts";
import { fileSize, readLinesFrom } from "../file-lines";
import type { ChatMessage } from "../types";
import { MiB } from "../units";
import { readAsks, readHead, type RecordAsk } from "./store";
import { briefOf, YOURS } from "./summary";

const ASK_MAX = 600;
const DID_MAX = 400;
const OPEN_MAX = 200;
const REFS_MAX = 12;
/** The most one exchange is read at once: its tool output can be large. */
const RANGE_MAX = 64 * MiB;

/** One exchange as read: the ask, the reply, and what happened in between. */
interface Exchange {
  ask: string;
  /** Every message of the reply, in order: the last one is the answer, the rest progress notes. */
  reply: string;
  last: string;
  files: Set<string>;
  refs: Set<string>;
  at: number;
  start: number;
  end: number;
}

const PR_URL = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g;
const PR_WORD = /\b(?:PR|pull request) #(\d{1,6})\b/gi;
const ISSUE_URL = /github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/g;
const ISSUE_WORD = /\bissue #(\d{1,6})\b/gi;
/** A bare "#128" the person or the agent wrote: a pull request or issue. */
const HASH_NUMBER = /(?<![\w&/#])#(\d{2,6})(?![\w-])/g;
const COLOUR_NEAR = /colou?r|css|hex|rgb|background|fill|stroke|border|text-\[|bg-\[/i;
/** Linear and Jira tickets: ENG-142, ENG-42. */
const TICKET = /(?<![\w-])(([A-Z][A-Z0-9]{1,9})-\d{1,6})(?![\w-])/g;
/** Names that look like tickets but are standards and versions. */
const NOT_TICKETS = new Set("UTF SHA ISO ES GPT HTTP RFC CVE COVID MD AES RSA TLS SSL IPV ECMA PEP WCAG CSS HTML ARM UTC GMT IST PST CET EST ID OS AI TS JS UI UX API URL SQL NS IE PS RS XP UTF8 H2 R2 S3 EC2 K8S".split(" "));
const TICKET_URL = /(?:linear\.app\/[\w-]+\/issue|atlassian\.net\/browse)\/([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})/g;
const FIGMA_URL = /figma\.com\/(?:design|file|board|proto|make|slides)\/([A-Za-z0-9]{10,})(?:\/([^\s?#)\]"'`]+))?(?:\?[^\s)\]"'`]*?node-id=([\d]+[-:][\d]+))?/g;

function figmaRef(m: RegExpMatchArray): string {
  let name: string | undefined = m[2];
  try {
    name = name ? decodeURIComponent(name) : undefined;
  } catch {
    // Keep it as written.
  }
  const node = m[3] ? ` node ${m[3].replace("-", ":")}` : "";
  return `Figma ${(name ?? m[1]).slice(0, 40)}${node}`;
}
/**
 * What `git commit` prints: "[branch abc1234] message", then " 2 files changed". Both are needed,
 * so a file that merely contains "[branch abc1234]" (read by a command) doesn't count. In a raw chat
 * line the newline between them is written as "\n".
 */
const COMMIT_LINE = /\[[\w./-]+ ([0-9a-f]{7,12})\][^\[]{0,300}?(?:\n|\\n) ?\d+ files? changed/g;
/** A hash quoted in a reply: `87aa2f750`. */
const COMMIT_QUOTED = /`([0-9a-f]{7,12})`/g;

/**
 * Commits, PRs, issues, tickets (Linear, Jira) and Figma links: from the person's ask and the reply, as
 * they name them; from what a command printed (`raw`), only git's own commit output and links, since
 * printed text often just mentions other work.
 */
function refsIn(text: string, into: Set<string>, raw: boolean): void {
  for (const m of text.matchAll(PR_URL)) into.add(`PR #${m[1]}`);
  for (const m of text.matchAll(ISSUE_URL)) into.add(`issue #${m[1]}`);
  for (const m of text.matchAll(TICKET_URL)) into.add(m[1].toUpperCase());
  for (const m of text.matchAll(FIGMA_URL)) into.add(figmaRef(m));
  if (!raw) {
    for (const m of text.matchAll(PR_WORD)) into.add(`PR #${m[1]}`);
    for (const m of text.matchAll(ISSUE_WORD)) into.add(`issue #${m[1]}`);
    for (const m of text.matchAll(TICKET)) if (!NOT_TICKETS.has(m[2])) into.add(m[1]);
    for (const m of text.matchAll(HASH_NUMBER)) {
      const n = m[1];
      if (into.has(`PR #${n}`) || into.has(`issue #${n}`)) continue;
      // "#333" next to colour words is a colour, not a pull request.
      if (COLOUR_NEAR.test(text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 12))) continue;
      into.add(`#${n}`);
    }
  }
  for (const m of text.matchAll(raw ? COMMIT_LINE : COMMIT_QUOTED)) if (/\d/.test(m[1]) && /[a-f]/.test(m[1])) into.add(m[1].slice(0, 9));
}

/**
 * Messages the system sends in the person's place (a background task finishing, a hook's
 * feedback, another session's message, an interruption, a command's output): not asks.
 */
const SYSTEM_TURN = new RegExp(
  `^(<task-notification>|<agent-message|<local-command-|Stop hook feedback|Another Claude session sent a message|\\[Request interrupted|Caveat: The messages below|<system-reminder>|\\[(?:${["Airband", ...OLD_NAMES].join("|")})\\])`,
);

/** A slash command the person typed, as they typed it: "/pr-review 845". */
function slashCommand(text: string): string | undefined {
  const name = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1];
  if (!name) return undefined;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  return `${name.startsWith("/") ? name : `/${name}`}${args ? ` ${args}` : ""}`;
}

/** A slash command in a raw chat line (a damaged line is just not one). */
function commandIn(line: string): string | undefined {
  const content = parseJsonLine<{ message?: { content?: unknown } }>(line)?.message?.content;
  return typeof content === "string" ? slashCommand(content) : undefined;
}

/** The person's words in a message, or nothing for a message the system sent. */
function personSaid(text: string): string | undefined {
  const t = text.trim();
  const command = slashCommand(t);
  if (command) return command;
  if (!t || SYSTEM_TURN.test(t)) return undefined;
  return t;
}

function timeOf(line: string): number | undefined {
  const m = /"timestamp":"([^"]+)"/.exec(line);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

/**
 * The exchanges in a stretch of lines starting at byte `offset` (Claude Code and Codex). Each line
 * is read on its own, so every file and ref lands on the ask it belongs to. A reply with no ask
 * before it (the end of an ask already recorded) comes back with an empty ask.
 */
function exchangesInLines(tool: AgentId, lines: string[], offset: number, now: number): Exchange[] {
  const out: Exchange[] = [];
  let pos = offset;
  let cur: Exchange | undefined;
  for (const line of lines) {
    const start = pos;
    pos += Buffer.byteLength(line, "utf8") + 1;
    if (!line) continue;
    const { messages, files } = lineMessages(tool === "codex" ? "codex" : "claude", [line]);
    // A slash command's tags are cleaned out of the message: it is read from the line itself.
    const command = line.includes("<command-name>") ? commandIn(line) : undefined;
    const youText = command ?? messages.find((m) => m.who === "you")?.text;
    const said = youText !== undefined ? personSaid(youText) : undefined;
    if (said) {
      cur = { ask: said, reply: "", last: "", files: new Set(), refs: new Set(), at: timeOf(line) ?? now, start, end: pos };
      out.push(cur);
      continue;
    }
    cur ??= (out.push({ ask: "", reply: "", last: "", files: new Set(), refs: new Set(), at: timeOf(line) ?? now, start, end: pos }), out[out.length - 1]);
    for (const m of messages)
      if (m.who === "ai") {
        cur.reply = cur.reply ? `${cur.reply}\n\n${m.text}` : m.text;
        cur.last = m.text;
      }
    for (const f of files) cur.files.add(f);
    // What commands printed (a commit line, a PR link) counts too; what the agent wrote into files doesn't.
    if (line.includes('"tool_result"') || line.includes('"function_call_output"')) refsIn(line, cur.refs, true);
    cur.end = pos;
  }
  return out;
}

function exchangesInMessages(list: ChatMessage[], files: string[], from: number, now: number): Exchange[] {
  const out: Exchange[] = [];
  let cur: Exchange | undefined;
  list.forEach((m, i) => {
    const said = m.who === "you" ? personSaid(m.text) : undefined;
    if (said) {
      cur = { ask: said, reply: "", last: "", files: new Set(), refs: new Set(), at: now, start: from + i, end: from + i + 1 };
      out.push(cur);
    } else if (m.who === "ai") {
      cur ??= (out.push({ ask: "", reply: "", last: "", files: new Set(), refs: new Set(), at: now, start: from + i, end: from + i + 1 }), out[out.length - 1]);
      cur.reply = cur.reply ? `${cur.reply}\n\n${m.text}` : m.text;
      cur.last = m.text;
      cur.end = from + i + 1;
    }
  });
  // Gemini's file names its edits per range; they go with the last ask read.
  if (out.length) for (const f of files) out[out.length - 1].files.add(f);
  return out;
}

/** Shortens a long ask, saying how much is left out (a pasted log should not fill the record). */
function clipAsk(text: string): string {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= ASK_MAX) return t;
  return `${t.slice(0, ASK_MAX - 60).trimEnd()} … [+${(t.length - (ASK_MAX - 60)).toLocaleString("en-US")} characters]`;
}

/** The reply's first real paragraph: Airband's replies, and most agents', lead with the outcome. */
function firstParagraph(reply: string): string {
  for (const p of reply.split(/\n\s*\n/)) {
    const t = p.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^\|/.test(t) || /^```/.test(t)) continue;
    return shorten(t, DID_MAX);
  }
  return shorten(reply, DID_MAX);
}

/** A "Next:" line or a question the reply ended on: what is still open. */
function openItem(reply: string): string | undefined {
  const paras = reply.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paras[paras.length - 1];
  if (!last || paras.length < 2) return undefined;
  if (/^(\*\*)?next\b/i.test(last) || /\?\s*$/.test(last)) return shorten(last.replace(/^\*\*next:?\*\*:?\s*/i, "Next: "), OPEN_MAX);
  return undefined;
}

function toAsk(e: Exchange, n: number): RecordAsk {
  const refs = new Set<string>();
  // The ticket or PR the person names comes first.
  refsIn(e.ask, refs, false);
  refsIn(e.reply, refs, false);
  for (const r of e.refs) refs.add(r);
  const ask: RecordAsk = {
    n,
    at: e.at,
    ask: redact(clipAsk(e.ask)),
    did: redact(firstParagraph(e.last || e.reply)),
    files: [...e.files],
    refs: [...refs].slice(0, REFS_MAX),
    src: [e.start, e.end],
  };
  const open = openItem(e.last || e.reply);
  if (open && open !== ask.did) ask.open = redact(open);
  const reply = e.last || e.reply;
  if (open || YOURS.test(reply)) ask.yours = true;
  const brief = briefOf(reply, !!ask.yours);
  if (brief) ask.brief = redact(brief);
  return ask;
}

/**
 * The asks in a chat's file from `cursor`, and where reading stopped. `maxBytes` reads a slice
 * of a big file (Claude Code and Codex). `lastReply` is the reply that just ended, which the hook
 * gets before the agent has written it to the file.
 */
export function readAsksFrom(
  tool: AgentId,
  file: string,
  cursor: number,
  firstN: number,
  opts: { maxBytes?: number; lastReply?: string; now?: number; holdOpen?: boolean; seen?: string[] } = {},
): { asks: RecordAsk[]; next: number; trailing?: string; seen?: string[] } {
  const now = opts.now ?? Date.now();
  let ex: Exchange[];
  let next: number;
  let seen: string[] | undefined;
  if (tool === "gemini") {
    const all = loadGeminiChat(file)?.messages ?? [];
    const from = geminiStart(all, cursor, opts.seen);
    const { messages, files } = geminiMessages(all.slice(from));
    ex = exchangesInMessages(messages, files, from, now);
    next = all.length;
    seen = geminiSeen(all, next);
  } else {
    // Read in slices, an ask is only recorded once its whole reply is in: the last ask of a slice
    // is read again with the next one, and a slice holding a single huge ask grows until it ends.
    const size = fileSize(file);
    let max = opts.maxBytes ?? Infinity;
    for (;;) {
      const r = readLinesFrom(file, cursor, max);
      ex = exchangesInLines(tool, r.lines, cursor, now);
      next = r.next;
      const atEnd = next >= size;
      if (atEnd && opts.holdOpen && ex.length && ex[ex.length - 1].ask) {
        // A chat still working: its newest ask waits until the file has gone quiet.
        next = ex.pop()!.start;
      }
      if (atEnd || !Number.isFinite(max)) break;
      if (ex.length >= 2) {
        next = ex.pop()!.start;
        break;
      }
      max = Math.min(max * 2, size);
    }
  }  // A reply with no ask before it ends an ask already recorded (written after the hook last ran):
  // the record keeps the outcome it had.
  const lead = ex[0] && !ex[0].ask ? ex.shift() : undefined;
  const trailing = lead ? lead.last || lead.reply : undefined;
  const last = ex[ex.length - 1];
  if (last && opts.lastReply && !last.reply.includes(opts.lastReply.trim().slice(0, 200))) {
    last.reply = last.reply ? `${last.reply}\n\n${opts.lastReply}` : opts.lastReply;
    last.last = opts.lastReply;
  }
  return { asks: ex.map((e, i) => toAsk(e, firstN + i)), next, trailing, ...(seen ? { seen } : {}) };
}

/** Exactly the bytes [start, end) of a file, at most RANGE_MAX of them. */
function readRange(file: string, start: number, end: number): string {
  const len = Math.max(0, Math.min(end - start, RANGE_MAX));
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, start);
    return buf.subarray(0, got).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** A chat file inside Claude Code's, Codex's or Gemini CLI's own folders (after following links):
 *  ~/.claude, ~/.codex (sessions and archived ones) or ~/.gemini, wherever each is configured. */
function isAgentChatFile(file: string | undefined): boolean {
  if (!file) return false;
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return false;
  }
  return [claudeProjectsDir(), codexSessionsDir(), geminiTmpDir()].map((d) => path.dirname(d)).some((d) => {
    let base = d;
    try {
      base = fs.realpathSync(d);
    } catch {
      // Not there: nothing can be inside it.
    }
    return real.startsWith(base + path.sep);
  });
}

/** The exact words of one recorded ask, read again from the agent's own file. */
export function exchangeText(id: string, n: number, max = 20_000): string | undefined {
  const head = readHead(id);
  const ask = readAsks(id).find((a) => a.n === n);
  // A flightlog restored from a shared backup folder names its chat file: read it only when that
  // really is an agent's chat file on this computer, never any other path.
  if (!head || !ask || !isAgentChatFile(head.file)) return undefined;
  const [start, end] = ask.src;
  let messages: ChatMessage[];
  if (head.tool === "gemini") {
    messages = geminiMessages((loadGeminiChat(head.file)?.messages ?? []).slice(start, end)).messages;
  } else {
    const lines = readRange(head.file, start, end).split("\n");
    messages = lineMessages(head.tool, lines).messages;
  }
  const text = redact(messages.map((m) => `**${m.who === "you" ? "You" : toolOf(head.tool)}:** ${m.text.trim()}`).join("\n\n"));
  return text.length > max ? `${text.slice(0, max)}\n\n… (${(text.length - max).toLocaleString("en-US")} more characters)` : text;
}
