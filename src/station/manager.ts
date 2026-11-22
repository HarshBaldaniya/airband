// The companion's answers and the things it does when asked: what is going on across every chat,
// what was done today, a message passed to a chat, a chat opened, a request allowed or denied.
// The common asks are answered from Airband's own records, with no AI call and no cost.
//
// Privacy: the companion sees only Airband's records of the person's chats. It never reads files,
// folders, the screen or the clipboard. Open questions go to Claude Code only while "Look things up"
// is on, in one of two locked rooms that never meet: a question about the chats gets Airband's
// read-only flightlog and nothing else (no web), and a general question gets web search and nothing
// else (no chats, no files). So nothing from the chats can leave in a search.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { airbandFile } from "../core/paths";
import { findClaude, findNode } from "../core/hooks";
import { matchChats, plain, type LiveChat } from "./chats";
import { DEFAULT_COMPANION } from "./companion";
import { knowledge } from "./knowledge";
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

/** Today in a few short lines: how much happened, then the busiest projects, one line each. */
export async function today(now = Date.now()): Promise<string> {
  // Loaded only when someone asks: the worklog reads chats through Claude's SDK, which the app
  // otherwise never needs, so it never takes memory for it.
  const { sinceDays, workSince } = await import("../core/worklog");
  const work = workSince(sinceDays(1, now));
  if (!work.length) return "Nothing yet today.";
  const asks = work.reduce((n, w) => n + w.asks.length, 0);
  const byProject = new Map<string, typeof work>();
  for (const w of work) byProject.set(w.project, [...(byProject.get(w.project) ?? []), w]);
  const lines = [`Today: ${plural(asks, "ask")} in ${plural(work.length, "chat")}, ${plural(byProject.size, "project")}.`];
  const top = [...byProject.entries()].sort((a, b) => b[1].reduce((n, w) => n + w.asks.length, 0) - a[1].reduce((n, w) => n + w.asks.length, 0)).slice(0, 3);
  for (const [project, chats] of top) {
    const busiest = [...chats].sort((a, b) => b.asks.length - a.asks.length)[0];
    const did = plain(busiest.asks[busiest.asks.length - 1]?.did ?? "");
    lines.push(`${project}: ${did ? (did.length > 90 ? `${did.slice(0, 89)}…` : did) : busiest.title}`);
  }
  return lines.join("\n");
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
  /** Airband's version, for "which version are you?". */
  version?: string;
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
  via: "records" | "claude" | "web" | "action";
}

const TELL = /^(?:please\s+)?(?:tell|message|send|remind)\s+(?:the\s+)?(.+?)\s+(?:chat\s+|session\s+)?(?:that|to|:|-)\s+([\s\S]+)$/i;
const OPEN = /^(?:please\s+)?(?:open|show me|go to|jump to|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:chat|session))?\s*$/i;
const DECIDE = /^(allow|approve|yes|ok|okay|go ahead|deny|reject|no|stop)\b(?:\s+(?:it|that|this|the request))?(?:\s+([\w-]{8,}))?\s*[.!]?$/i;
const STATUS = /\b(what'?s|what is)\s+(happening|up|going on|new)\b|^(status|update|news|anything|who needs me|what needs me|what now)\b|\bneeds? (me|you)\b/i;
const TODAY = /\b(today|standup|stand-up|what did (i|we) do|summary|summarise|summarize|recap|this morning)\b/i;
const TUCK = /^(?:please\s+)?(?:hide|tuck|minimi[sz]e|go away|get small|sleep)\b/i;
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

  const known = knowledge(q, { name, version: ctx.version ?? "", headline: headline(ctx.chats, ctx.pending, now) });
  if (known) return known;
  if (TODAY.test(q)) return { text: await today(now), via: "records" };
  if (!ctx.lookups) return { text: `I can answer that with Claude Code. Turn on "Look things up" in my settings if that's OK.`, action: "settings", via: "records" };
  const claude = ctx.claude === undefined ? findClaude() : ctx.claude;
  if (!claude) return { text: "For questions like that I need Claude Code on this computer.", via: "records" };
  const mode = lookupMode(q, ctx.chats);
  const text = await askClaude(claude, q, whatsHappening(ctx.chats, ctx.pending, now), name, mode);
  return text ? { text: ownVoice(text, name), via: mode === "web" ? "web" : "claude" } : { text: "I couldn't get an answer just now. Try again in a moment.", via: "records" };
}

/** Which locked room a question goes to: the person's chats, or the web. */
export type LookupMode = "chats" | "web";

const ABOUT_CHATS = /\b(chats?|sessions?|PRs?|pull requests?|tickets?|issues?|commits?|branch(es)?|projects?|repos?|repository|code|bug|fix(ed)?|tests?|deploy(ed)?|did|worked|working on|yesterday|today|this week|decid(e|ed)|agents?|claude|codex|gemini|my|we|our)\b/i;

export function lookupMode(question: string, chats: LiveChat[]): LookupMode {
  if (ABOUT_CHATS.test(question)) return "chats";
  // A chat's own name (its title or project) in the question: about that chat.
  return matchChats(chats, question).some((m) => m.score >= 3) ? "chats" : "web";
}

/** The arguments that lock Claude Code in one room. "chats": no built-in tools (no files, shell or
 *  web) and no MCP server but Airband's read-only flightlog. "web": web search alone, no MCP server
 *  at all. Both: no claude.ai connections, nothing saved as a chat. */
export function lookupArgs(prompt: string, mcpConfig: string, mode: LookupMode = "chats"): string[] {
  if (mode === "web")
    return ["-p", prompt, "--output-format", "text", "--model", process.env.AIRBAND_COMPANION_MODEL || "haiku", "--max-turns", "6", "--tools", "WebSearch", "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }), "--allowedTools", "WebSearch", "--no-session-persistence"];
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

/** Who the look-up speaks as: the person's own helper, never the model behind it. */
export function persona(name: string): string {
  return [
    `You are ${name}, the friendly helper in the Airband app on the person's Mac. Harsh Baldaniya built you and Airband (github.com/HarshBaldaniya/airband).`,
    `Always speak as ${name}. Never say you are Claude, ChatGPT, Gemini or any AI model, and never say a company such as Anthropic or OpenAI made you or runs you. If asked what you are or what powers you, say you are Airband's helper, built by Harsh Baldaniya.`,
  ].join(" ");
}

const NOT_ME = /\b(I'?m|I am|I was|this is) (Claude|ChatGPT|Gemini|an AI (model|assistant)( made| created| built| developed)? by)\b|\b(made|created|built|developed|trained|run|powered) by (Anthropic|OpenAI|Google DeepMind)\b|\bClaude (Haiku|Sonnet|Opus)\b|\b(Anthropic|OpenAI)'s (cloud )?servers\b/i;

/**
 * The companion's own voice, always: a sentence that slipped into another identity ("I'm Claude,
 * made by Anthropic") is replaced by who it really is. Answers about those subjects keep their words.
 */
export function ownVoice(text: string, name: string): string {
  if (!NOT_ME.test(text)) return text;
  const kept = text.split(/(?<=[.!?])\s+/).filter((sentence) => !NOT_ME.test(sentence));
  return [`I'm ${name}, Airband's helper, built by Harsh Baldaniya.`, ...kept].join(" ");
}

/** An open question, answered by Claude Code in one locked room, in a few lines. */
export function askClaude(claude: string, question: string, state: string, name: string, mode: LookupMode = "chats", timeoutMs = 120_000): Promise<string | undefined> {
  const prompt = mode === "web" ? [
    persona(name),
    "The person asks a general question.",
    "Answer in 1 to 3 short, plain sentences, the answer first. Search the web when you need to be current or sure. No greeting, no list unless asked, no mention of tools.",
    `If the question is about their own chats or work, say they can ask you "what's happening?" or name the chat.`,
    "",
    `Their question: ${question}`,
  ].join("\n") : [
    persona(name),
    "They run several AI coding chats (Claude Code, Codex, Gemini CLI) and ask you about them.",
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
      lookupArgs(prompt, mcp, mode),
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
