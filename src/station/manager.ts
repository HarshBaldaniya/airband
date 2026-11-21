// The companion's answers and the things it does when asked: what is going on across every chat,
// what was done today, a message passed to a chat, a chat opened, a request allowed or denied.
// The common asks are answered from Airband's own records, with no AI call and no cost.
//
// Privacy: the companion sees only Airband's records of the person's chats. It never reads files,
// folders, the screen or the clipboard. An open question goes to Claude Code only when the person
// has said yes to that, and even then Claude Code gets no file, shell or web tools and none of the
// person's other connections: only Airband's read-only flightlog.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { airbandFile } from "../core/paths";
import { findClaude, findNode } from "../core/hooks";
import { renderWork, sinceDays, workSince } from "../core/worklog";
import { matchChats, type LiveChat } from "./chats";
import { DEFAULT_COMPANION } from "./companion";
import type { Decision } from "./reply";

export interface PendingBrief {
  id?: string;
  chatId?: string;
  chatTitle: string;
  project: string;
  title: string;
  detail?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const HOUR = 3600e3;

/** One line for the top of the companion's panel. */
export function headline(chats: LiveChat[], pending: PendingBrief[], now = Date.now()): string {
  const needs = new Set([...chats.filter((c) => c.status === "waiting").map((c) => c.title), ...pending.map((p) => p.chatTitle)]).size;
  const working = chats.filter((c) => c.status === "working").length;
  const finished = chats.filter((c) => c.status === "done" && now - c.since < HOUR).length;
  const parts: string[] = [];
  if (needs) parts.push(`${plural(needs, "chat needs", "chats need")} you.`);
  if (working) parts.push(needs ? `${working} ${working === 1 ? "is" : "are"} working.` : `${plural(working, "chat is", "chats are")} working.`);
  if (finished) parts.push(`${finished} finished in the last hour.`);
  if (!parts.length) return chats.length ? "All quiet. Nothing needs you." : "All quiet. No chats today yet.";
  if (!needs) parts.unshift("Nothing needs you.");
  return parts.join(" ");
}

/** "What's happening?": who needs you and why, what is working, what just finished. */
export function whatsHappening(chats: LiveChat[], pending: PendingBrief[], now = Date.now()): string {
  const lines = [headline(chats, pending, now)];
  for (const p of pending.slice(0, 3)) lines.push(`${p.chatTitle} (${p.project}): ${p.title.toLowerCase()}${p.detail ? `: ${p.detail.slice(0, 80)}` : ""}.`);
  const waiting = chats.filter((c) => c.status === "waiting" && !pending.some((p) => p.chatTitle === c.title));
  for (const c of waiting.slice(0, 3)) lines.push(`${c.title} (${c.project}) waits${c.line ? `: ${c.line}` : " for your answer"}.`);
  const working = chats.filter((c) => c.status === "working");
  if (working.length) lines.push(`Working: ${working.slice(0, 4).map((c) => c.title).join(", ")}${working.length > 4 ? ` and ${working.length - 4} more` : ""}.`);
  const done = chats.filter((c) => c.status === "done" && now - c.since < 3 * HOUR);
  for (const c of done.slice(0, 2)) lines.push(`${c.title} finished${c.lastDid ? `: ${c.lastDid.slice(0, 120)}` : "."}`);
  return lines.join("\n");
}

/** What the person's chats did today, as Airband's standup writes it. */
export function today(now = Date.now()): string {
  const since = sinceDays(1, now);
  const work = workSince(since);
  if (!work.length) return "No chat has done anything today yet.";
  const text = renderWork(work, since, 3);
  return text.length > 1800 ? `${text.slice(0, 1790)}…` : text;
}

export interface AskContext {
  chats: LiveChat[];
  pending: PendingBrief[];
  /** Passes a message to a chat; resolves to the chat's title. */
  tell: (chatId: string, text: string) => Promise<string> | string;
  /** Opens a chat; says where. */
  open?: (chatId: string) => string;
  /** Answers a waiting request. */
  decide?: (id: string, decision: Decision) => boolean;
  /** The person said yes to open questions going to Claude Code. */
  lookups?: boolean;
  /** Claude Code's command (null: none, in tests). */
  claude?: string | null;
  /** What the companion is called, for Claude Code's instructions. */
  name?: string;
  now?: number;
}

/** A button under an answer: pressing it asks this, so the person never has to type it. */
export interface AnswerChoice {
  label: string;
  ask: string;
}

export interface CompanionAnswer {
  text: string;
  /** The chat it is about, so the panel can offer to open it. */
  chatId?: string;
  /** When the ask could mean more than one thing: pick one. */
  choices?: AnswerChoice[];
  /** Something for the screen to do: tuck the companion away, open the settings. */
  action?: "tuck" | "settings";
  via: "records" | "claude" | "action";
}

const TELL = /^(?:please\s+)?(?:tell|message|send|remind)\s+(?:the\s+)?(.+?)\s+(?:chat\s+|session\s+)?(?:that|to|:|-)\s+([\s\S]+)$/i;
const OPEN = /^(?:please\s+)?(?:open|show me|go to|jump to|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:chat|session))?\s*$/i;
const DECIDE = /^(allow|approve|yes|ok|okay|go ahead|deny|reject|no|stop)\b(?:\s+(?:it|that|this|the request))?(?:\s+([\w-]{8,}))?\s*[.!]?$/i;
const STATUS = /\b(what'?s|what is)\s+(happening|up|going on|new)\b|^(status|update|news|anything|who needs me|what needs me|what now)\b|\bneeds? (me|you)\b/i;
const TODAY = /\b(today|standup|stand-up|what did (i|we) do|summary|summarise|summarize|recap|this morning)\b/i;
const TUCK = /^(?:please\s+)?(?:hide|tuck|minimi[sz]e|go away|get small|sleep)\b/i;
const HELP = /^(help|what can you do|how do (i|you) .*use you)\b/i;
/** Asks about the person's own files and folders: never the companion's to read. */
const PRIVATE = /\b(check|read|open|look (?:at|in|into|through)|scan|search|go through|list|clean)\b.*\b(downloads?|desktop|documents|my files|files on|photos|pictures|disk|drive|folder|keychain|passwords?|clipboard|screen|emails?|inbox|messages app)\b/i;

const NO_FILES = "I can't look at your files or folders. I only see your chats' records in Airband. Tell me which chat you mean and I'll look there.";

/** Which chat the person means. One clear match, or the few that could be it. */
function pickChat(chats: LiveChat[], words: string): { chat?: LiveChat; maybe: LiveChat[] } {
  const ranked = matchChats(chats, words);
  if (!ranked.length) return { maybe: [] };
  if (ranked.length === 1 || ranked[0].score > ranked[1].score) return { chat: ranked[0].chat, maybe: [] };
  return { maybe: ranked.filter((r) => r.score === ranked[0].score).slice(0, 4).map((r) => r.chat) };
}

const which = (cs: LiveChat[], build: (c: LiveChat) => string): AnswerChoice[] => cs.map((c) => ({ label: `${c.title} · ${c.project}`, ask: build(c) }));

export async function ask(question: string, ctx: AskContext): Promise<CompanionAnswer> {
  const q = question.trim();
  const now = ctx.now ?? Date.now();
  const name = ctx.name ?? DEFAULT_COMPANION.name;
  if (!q || STATUS.test(q)) return { text: whatsHappening(ctx.chats, ctx.pending, now), via: "records" };
  if (HELP.test(q)) return { text: `Ask me what's happening, what you did today, or say "open the billing chat", "tell the API chat that the route changed", "allow it" or "hide".`, via: "records" };
  if (PRIVATE.test(q)) return { text: NO_FILES, via: "records" };
  if (TUCK.test(q)) return { text: "I'll stay small. Click me when you need me.", action: "tuck", via: "action" };

  const tell = TELL.exec(q);
  if (tell) {
    const { chat, maybe } = pickChat(ctx.chats, tell[1]);
    if (maybe.length) return { text: "Which chat do you mean?", choices: which(maybe, (c) => `tell ${c.id} that ${tell[2].trim()}`), via: "action" };
    if (!chat) return { text: `I couldn't find a chat called "${tell[1]}". Which one do you mean?`, choices: which(ctx.chats.slice(0, 4), (c) => `tell ${c.id} that ${tell[2].trim()}`), via: "action" };
    const title = await ctx.tell(chat.id, tell[2].trim());
    return { text: `Sent to "${title}". It gets your message with its next turn.`, chatId: chat.id, via: "action" };
  }

  const decide = DECIDE.exec(q);
  if (decide && ctx.decide) {
    const yes = /^(allow|approve|yes|ok|okay|go ahead)/i.test(decide[1]);
    const target = decide[2] ? ctx.pending.filter((p) => p.id === decide[2]) : ctx.pending;
    if (!ctx.pending.length) return { text: "Nothing is waiting for an answer.", via: "records" };
    if (target.length !== 1) return { text: `Which request should I ${yes ? "allow" : "deny"}?`, choices: ctx.pending.slice(0, 4).map((p) => ({ label: `${p.chatTitle}: ${p.title.toLowerCase()}`, ask: `${yes ? "allow" : "deny"} ${p.id}` })), via: "action" };
    const p = target[0];
    ctx.decide(p.id!, yes ? "allow" : "deny");
    return { text: yes ? `Allowed. ${p.chatTitle} carries on.` : `Denied. ${p.chatTitle} was told no.`, via: "action" };
  }

  const open = OPEN.exec(q);
  if (open && ctx.open) {
    const { chat, maybe } = pickChat(ctx.chats, open[1]);
    if (maybe.length) return { text: "Which chat should I open?", choices: which(maybe, (c) => `open ${c.id}`), via: "action" };
    if (chat) return { text: ctx.open(chat.id), chatId: chat.id, via: "action" };
  }

  if (TODAY.test(q)) return { text: today(now), via: "records" };
  if (!ctx.lookups) return { text: `${whatsHappening(ctx.chats, ctx.pending, now)}\n\nFor other questions I'd ask Claude Code to read your chats' records. Turn on "Look things up" in my settings if that's OK.`, action: "settings", via: "records" };
  const claude = ctx.claude === undefined ? findClaude() : ctx.claude;
  if (!claude) return { text: `${whatsHappening(ctx.chats, ctx.pending, now)}\n\nFor other questions I need Claude Code on this computer.`, via: "records" };
  const text = await askClaude(claude, q, whatsHappening(ctx.chats, ctx.pending, now), name);
  return text ? { text, via: "claude" } : { text: `I couldn't get an answer just now. Here's what I know:\n${whatsHappening(ctx.chats, ctx.pending, now)}`, via: "records" };
}

/** The arguments that keep Claude Code to Airband's records: no built-in tools (no files, shell or
 *  web), no MCP server but Airband's, no claude.ai connections, nothing saved as a chat. */
export function lookupArgs(prompt: string, mcpConfig: string): string[] {
  return [
    "-p",
    prompt,
    "--output-format",
    "text",
    // A quick model: these are lookups. AIRBAND_COMPANION_MODEL picks another.
    "--model",
    process.env.AIRBAND_COMPANION_MODEL || "haiku",
    "--max-turns",
    "8",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--allowedTools",
    "mcp__airband__airband_flightlog",
    "--disallowedTools",
    "mcp__airband__airband_map,mcp__airband__airband_notes",
    "--no-session-persistence",
  ];
}

/** An open question, answered by Claude Code from Airband's flightlog alone, in a few lines. */
export function askClaude(claude: string, question: string, state: string, name: string, timeoutMs = 120_000): Promise<string | undefined> {
  const prompt = [
    `You are ${name}, the small helper in the Airband app on the person's computer. They run several AI coding chats (Claude Code, Codex, Gemini CLI) and ask you about them.`,
    "Answer in 1 to 4 short, plain sentences. The answer comes first. No greeting, no list unless they ask for one, no mention of tools.",
    "Look things up with the airband_flightlog tool (query to search every chat, chat to read one). You have no other tools: if the question needs the person's files or anything outside these records, say you can't see that and ask which chat to look in.",
    "",
    "What Airband sees right now:",
    state,
    "",
    `Their question: ${question}`,
  ].join("\n");
  const mcp = JSON.stringify({ mcpServers: { airband: { type: "stdio", command: findNode(), args: [airbandFile("airband-mcp.js")] } } });
  // An empty working folder: nothing of any project is in reach.
  const cwd = airbandFile("companion-lookups");
  fs.mkdirSync(cwd, { recursive: true });
  return new Promise((resolve) => {
    execFile(
      claude,
      lookupArgs(prompt, mcp),
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { ...process.env, AIRBAND_COMPANION: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" }, windowsHide: true },
      (err, stdout) => {
        const text = String(stdout ?? "").trim();
        resolve(err && !text ? undefined : text || undefined);
      },
    );
  });
}

/** The words a chat reads when the Airband app passes it a message from the person. */
export function tellText(text: string): string {
  return `A message from the person, passed on by the Airband app: ${text}`;
}
