// Every AI tool Airband links runs this on a few events, with the event as JSON
// on stdin and the tool's name as the first argument (claude, codex, gemini).
// It translates each tool's event names to one set, then:
//   1. records the chat's status (working / waiting / done) for the board;
//   2. when a chat finishes a reply, sends what it did to every chat it is
//      linked to, as an update in their inbox (read in that tool's own format);
//   3. when a chat gets a message or starts, hands it everything waiting in its
//      inbox as extra context, in the shape that tool expects;
//   4. when a chat finishes a reply while updates are waiting, asks it to read
//      them before it stops (each tool continues the turn with Airband's note);
//   5. when a chat is asked for a doc or a message, adds the writing rules once,
//      after it writes a doc file says what in it breaks them, and before it
//      sends a message, a PR or a commit, holds it once if it breaks them.
// It never blocks a chat: errors are swallowed, it always exits 0, and it
// prints nothing except the context it delivers.
import * as path from "node:path";
import type { ChatMessage, HookStatus, InboxItem, Status, Tool } from "../core/types";
import { safeId, statusDir, writeFileAtomic } from "../core/paths";
import {
  addConnection,
  appendInbox,
  getCursor,
  getSentReply,
  logDelivery,
  matchPending,
  readConnections,
  removePending,
  setCursor,
  setSentReply,
  takeInbox,
} from "../core/store";
import { claudeMessages, cleanText, fileSize, readLinesFrom } from "../core/transcript";
import { codexMessages } from "../adapters/codex";
import { geminiMessages, loadGeminiChat } from "../adapters/gemini";
import { AUTO_DELIVERY_ASK, buildUpdate, formatDelivery, readConfig, sameFolder } from "../core/updates";
import { deliveryNotice, noticesOn, startNotice, toolNotice } from "../core/notices";
import { HOOK_STEP_MAX, readAsksFrom, readHead, recordBehind, renderAsks, updateRecord } from "../core/record";
import { briefFor, checkOutgoing, checkWrittenDoc, forgetGiven, holdOnce, notYetGiven, outgoingText, renderFindings, summarise, writingFor, writingSettings, writtenDoc, type WritingKind } from "../core/writing";

export type HookTool = "claude" | "codex" | "gemini";

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  hook_event_name?: string;
  cwd?: string;
  message?: string;
  prompt?: string;
  /** Set when this reply was itself continued by a Stop hook (Claude Code, Codex, Gemini). */
  stop_hook_active?: boolean;
  /** The reply that just ended (Claude Code and Codex, on Stop): often not in the transcript yet. */
  last_assistant_message?: string | null;
  /** The same, as Gemini CLI names it (AfterAgent). */
  prompt_response?: string | null;
  /** SessionStart: why the chat is starting (startup, resume, clear, compact). */
  source?: string;
  /** PostToolUse: the tool that just ran, what it was asked and what it answered. */
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

/** Each tool's event names, as the one set Airband works with. */
const EVENT_ALIASES: Record<HookTool, Record<string, string>> = {
  claude: {},
  codex: { PermissionRequest: "Notification" },
  gemini: { BeforeAgent: "UserPromptSubmit", AfterAgent: "Stop", AfterTool: "PostToolUse", BeforeTool: "PreToolUse" },
};

const TOOL_NAME: Record<HookTool, Tool> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };

export function normalise(input: HookInput, tool: HookTool): HookInput {
  const name = input.hook_event_name ?? "";
  return { ...input, hook_event_name: EVENT_ALIASES[tool][name] ?? name };
}

export function statusFor(input: HookInput): Status | undefined {
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
    case "PostToolUse":
      return "working";
    case "Notification":
      return "waiting";
    case "Stop":
      return "done";
    case "SessionEnd":
      return "idle";
    default:
      return undefined;
  }
}

export function record(input: HookInput, now = Date.now()): void {
  const id = input.session_id;
  const status = statusFor(input);
  if (!id || !status || !safeId(id)) return;
  const entry: HookStatus = { status, at: now, event: input.hook_event_name!, cwd: input.cwd };
  if (status === "waiting" && input.message) entry.message = input.message.slice(0, 200);
  writeFileAtomic(path.join(statusDir(), `${id}.json`), JSON.stringify(entry));
}

/**
 * What a chat said since `cursor`, read in its tool's own format. Claude Code and
 * Codex append JSON lines (the cursor is a byte offset); Gemini CLI's file also
 * edits and rewinds earlier messages, so it is read whole (the cursor is a message count).
 */
export function readSince(tool: HookTool, file: string, cursor: number): { messages: ChatMessage[]; files: string[]; next: number } {
  if (tool === "gemini") {
    const chat = loadGeminiChat(file);
    if (!chat) return { messages: [], files: [], next: cursor };
    const all = chat.messages ?? [];
    return { ...geminiMessages(all.slice(Math.min(cursor, all.length))), next: all.length };
  }
  const { lines, next } = readLinesFrom(file, cursor);
  return { ...(tool === "codex" ? codexMessages(lines) : claudeMessages(lines)), next };
}

/** Where a chat's record ends now, in its tool's cursor units. */
/** Gemini CLI keeps a chat as one JSON file, read whole: past this size the hook leaves it to the extension. */
const GEMINI_HOOK_MAX = 32 * 1024 * 1024;

export function endOf(tool: HookTool, file: string): number {
  if (tool !== "gemini") return fileSize(file);
  return loadGeminiChat(file)?.messages?.length ?? 0;
}

/**
 * After a reply: what this chat did since last time goes to every chat it is linked to, at each
 * link's level: a line per ask (the default), a short summary, or the words themselves.
 */
export function sendUpdates(input: HookInput, now = Date.now(), tool: HookTool = "claude"): number {
  const id = input.session_id;
  if (!id || !input.transcript_path) return 0;
  const outgoing = readConnections().filter((c) => c.from.id === id && !c.paused);
  if (!outgoing.length) {
    // Not shared right now: the bookmark still moves with each reply, so a link made later starts
    // from then (its context covers the past) instead of sending everything said since.
    if (getCursor(id) !== undefined) setCursor(id, endOf(tool, input.transcript_path));
    return 0;
  }
  const from = getCursor(id);
  if (from === undefined) {
    // Never read before: start from here rather than resend its whole past.
    setCursor(id, endOf(tool, input.transcript_path));
    return 0;
  }
  // A chat that grew a lot while sharing was off (hundreds of MB) is not read here: the hook has a
  // few seconds, and a read that never finishes would never move the bookmark either. Skip ahead;
  // what was said is in the flightlog, which the extension catches up on its own.
  if (tool === "gemini" && fileSize(input.transcript_path) > GEMINI_HOOK_MAX) return 0;
  if (tool !== "gemini" && fileSize(input.transcript_path) - from > HOOK_STEP_MAX) {
    setCursor(id, fileSize(input.transcript_path));
    return 0;
  }
  // The words themselves are read only when a link asks for them.
  const words = outgoing.some((c) => c.level === "full") ? readSince(tool, input.transcript_path, from) : undefined;
  if (words) withLatestReply(id, words.messages, input);
  const { asks, next, trailing } = readAsksFrom(tool, input.transcript_path, from, 1, { lastReply: input.last_assistant_message ?? undefined });
  setCursor(id, words?.next ?? next);
  // A reply read with no ask before it: the end of one already sent (skipped), or more work on it.
  const sentBefore = getSentReply(id);
  if (trailing && !(sentBefore && trailing.includes(sentBefore.trim().slice(0, 200)))) {
    asks.unshift({ n: 0, at: now, ask: "(continuing)", did: trailing.replace(/\s+/g, " ").trim().slice(0, 400), files: [], refs: [], src: [from, from] });
  }
  if (!words) setSentReply(id, input.last_assistant_message ?? undefined);
  const tool0 = outgoing[0].from.tool;
  let sent = 0;
  for (const c of outgoing) {
    // A chat in another folder gets full file paths; one in the same folder, short ones.
    const elsewhere = !!(c.to.cwd && input.cwd && !sameFolder(c.to.cwd, input.cwd));
    const text =
      c.level === "full"
        ? words && buildUpdate(words.messages, words.files, input.cwd, tool0, elsewhere)
        : asks.length
          ? renderAsks(asks, c.level ?? "ping", { root: input.cwd, absolute: elsewhere })
          : undefined;
    if (!text) continue;
    appendInbox(c.to.id, { connectionId: c.id, from: { ...c.from, cwd: input.cwd ?? c.from.cwd }, at: now, kind: "update", text });
    sent++;
  }
  return sent;
}

/**
 * Keeps this chat's record (one short line per ask) current. A chat too big to read at a reply's
 * end is left to the extension, which catches it up in the background.
 */
export function keepRecord(input: HookInput, tool: HookTool = "claude"): void {
  const id = input.session_id;
  const file = input.transcript_path;
  if (!id || !file) return;
  try {
    if (readHead(id) && recordBehind(id, tool, file) > HOOK_STEP_MAX) return;
    updateRecord(id, tool, file, { cwd: input.cwd, lastReply: input.last_assistant_message ?? undefined });
  } catch {
    // The record is a nicety: a reply never waits on it or fails because of it.
  }
}

/**
 * When Stop fires, Claude Code (and possibly others) has not yet written the reply that just
 * ended to its file, but hands it to the hook. It goes out now, and is remembered so the copy
 * that lands in the file later is not sent a second time.
 */
export function withLatestReply(id: string, messages: ChatMessage[], input: HookInput): void {
  const before = getSentReply(id);
  if (before) {
    // Last time's reply, now in the file: it opens this read (after nothing, or after a tool step).
    const i = messages.findIndex((m) => m.who === "ai");
    if (i !== -1 && i <= 1 && messages[i].text.startsWith(before)) {
      const rest = messages[i].text.slice(before.length).trim();
      if (rest) messages[i].text = rest;
      else messages.splice(i, 1);
    }
  }
  const reply = cleanText(input.last_assistant_message ?? input.prompt_response ?? "");
  const last = messages[messages.length - 1];
  if (!reply || (last?.who === "ai" && last.text.endsWith(reply))) {
    setSentReply(id, undefined);
    return;
  }
  if (last?.who === "ai") last.text = `${last.text}\n\n${reply}`;
  else messages.push({ id: `reply-${Date.now()}`, who: "ai", text: reply });
  setSentReply(id, reply);
}

/** A new chat Airband opened for a task: connect it and give it the old chat's context. */
export function bindBranch(input: HookInput, now = Date.now(), tool: HookTool = "claude"): void {
  const id = input.session_id;
  if (!id || !input.prompt) return;
  const p = matchPending(input.prompt, input.cwd, now);
  if (!p) return;
  removePending(p.id);
  if (p.context) appendInbox(id, { from: p.from, at: now, kind: "context", text: p.context });
  // Airband set the old chat's cursor when it opened the branch, so its updates start from then.
  if (p.keepConnected) addConnection(p.from, { id, tool: TOOL_NAME[tool], title: p.title }, now);
}

/** Everything waiting for this chat, as context for the message it just got, and what it came from. */
export function deliver(input: HookInput, now = Date.now()): { text: string; items: InboxItem[] } | undefined {
  const id = input.session_id;
  if (!id) return undefined;
  const items = takeInbox(id);
  if (!items.length) return undefined;
  const text = formatDelivery(items, undefined, input.cwd);
  for (const i of items) logDelivery({ at: now, connectionId: i.connectionId, from: i.from.id, to: id, chars: i.text.length });
  return { text, items };
}

/** The hook's answer in the shape the tool expects: context for the model, and a line for the person
 *  (systemMessage, which the model never sees). Codex can't show a line, so it gets none. */
function out(tool: HookTool, event: "UserPromptSubmit" | "SessionStart", context: string | undefined, notice: string | undefined): string | undefined {
  const o: Record<string, unknown> = {};
  if (context) o.hookSpecificOutput = { hookEventName: tool === "gemini" && event === "UserPromptSubmit" ? "BeforeAgent" : event, additionalContext: context };
  if (notice && tool !== "codex") o.systemMessage = notice;
  return Object.keys(o).length ? JSON.stringify(o) : undefined;
}

export function handle(raw: HookInput, now = Date.now(), tool: HookTool = "claude"): string | undefined {
  const input = normalise(raw, tool);
  record(input, now);
  switch (input.hook_event_name) {
    case "Stop": {
      if (input.stop_hook_active) {
        // This turn only acknowledged delivered updates: skip it, so linked chats never ping-pong.
        if (input.session_id && input.transcript_path) {
          setCursor(input.session_id, endOf(tool, input.transcript_path));
          setSentReply(input.session_id, undefined);
        }
        return undefined;
      }
      keepRecord(input, tool);
      sendUpdates(input, now, tool);
      // Updates that arrived while this chat worked go in now, before it stops: a "block" with a
      // reason makes Claude Code, Codex and Gemini CLI (AfterAgent) keep the reply and continue
      // the turn with the reason as the next message, flagged stop_hook_active.
      if (!readConfig().autoDeliver) return undefined;
      const d = deliver(input, now);
      if (!d) return undefined;
      const notice = tool === "claude" && noticesOn() ? deliveryNotice(d.items) : undefined;
      return JSON.stringify({ decision: "block", reason: `${d.text}\n\n${AUTO_DELIVERY_ASK}`, ...(notice ? { systemMessage: notice } : {}) });
    }
    case "UserPromptSubmit": {
      bindBranch(input, now, tool);
      const d = deliver(input, now);
      const w = writingRules(input);
      // Gemini shows a line at a chat's start only, so the "added what … did" line is Claude's.
      const lines = tool === "claude" && noticesOn() ? [d ? deliveryNotice(d.items) : "", w ? `↪ Airband added its ${w.kinds.join(" and ")} writing rules to this chat` : ""].filter(Boolean) : [];
      return out(tool, "UserPromptSubmit", [d?.text, w?.text].filter(Boolean).join("\n\n") || undefined, lines.join("\n") || undefined);
    }
    case "SessionStart": {
      // A cleared or compacted chat has lost the rules it was given: they come again when needed.
      if (input.source === "clear" || input.source === "compact") forgetGiven(input.session_id);
      const d = deliver(input, now);
      const s = writingSettings(input.cwd);
      const replies = s.replies ? briefFor(["replies"], s) : undefined;
      // Once per chat: when it starts, is resumed or cleared; not after every compaction.
      const showStart = noticesOn() && input.source !== "compact";
      const lines = [showStart ? startNotice({ sessionId: input.session_id, cwd: input.cwd, now }) : "", d && noticesOn() ? deliveryNotice(d.items) : ""].filter(Boolean);
      return out(tool, "SessionStart", [d?.text, replies].filter(Boolean).join("\n\n") || undefined, lines.join("\n") || undefined);
    }
    case "PreToolUse":
      return sendCheck(input, tool);
    case "PostToolUse": {
      const doc = docCheck(input, tool);
      if (doc) return doc;
      // After an Airband tool, one line for the person: what it found and the tokens it saved.
      // Claude Code shows it; the others have no place for a line here.
      if (tool !== "claude" || !/airband_(map|flightlog|notes)$/.test(input.tool_name ?? "") || !noticesOn()) return undefined;
      const notice = toolNotice(input.tool_name, input.tool_input, input.tool_response, input.cwd);
      return notice ? JSON.stringify({ systemMessage: notice }) : undefined;
    }
    default:
      return undefined;
  }
}

/** The writing rules this ask needs and this chat has not had yet. */
export function writingRules(input: HookInput): { kinds: WritingKind[]; text: string } | undefined {
  try {
    const s = writingSettings(input.cwd);
    const kinds = notYetGiven(input.session_id, writingFor(input.prompt, s));
    return kinds.length ? { kinds, text: briefFor(kinds, s) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * After an agent writes or edits a doc file (Claude Code, Gemini CLI): what in the new text breaks
 * the docs rules, for the agent to fix, and a line for the person. Nothing when it reads clean.
 */
export function docCheck(input: HookInput, tool: HookTool): string | undefined {
  if (tool === "codex") return undefined;
  try {
    const doc = writtenDoc(input.tool_name, input.tool_input);
    if (!doc || !writingSettings(input.cwd).docs) return undefined;
    const found = checkWrittenDoc(doc);
    if (!found.length) return undefined;
    // Forward slashes on every system, as the agent and the person read paths elsewhere.
    const name = (input.cwd && doc.file.startsWith(input.cwd) ? path.relative(input.cwd, doc.file) : path.basename(doc.file)).split(path.sep).join("/");
    const context = [
      `Airband checked the text you just wrote in ${name} against the docs writing rules:`,
      renderFindings(found.slice(0, 12), name),
      found.length > 12 ? `… and ${found.length - 12} more.` : "",
      "Rewrite these sentences, keeping every fact, number and hedge, unless the project's own rules say otherwise or the person asked for this wording. Do not mention this check unless asked.",
    ].filter(Boolean).join("\n");
    const o: Record<string, unknown> = { hookSpecificOutput: { hookEventName: tool === "gemini" ? "AfterTool" : "PostToolUse", additionalContext: context } };
    if (tool === "claude" && noticesOn()) o.systemMessage = `↪ Airband checked ${name}: ${summarise(found)}`;
    return JSON.stringify(o);
  } catch {
    return undefined;
  }
}

/**
 * Before an agent sends a message, a PR or a commit (Claude Code, Gemini CLI): when the words break
 * the rules, the send is held once with what to fix. The same words sent again go through, so a
 * wording the person asked for is never stuck.
 */
export function sendCheck(input: HookInput, tool: HookTool): string | undefined {
  if (tool === "codex") return undefined;
  try {
    const o = outgoingText(input.tool_name, input.tool_input, input.cwd);
    if (!o) return undefined;
    const s = writingSettings(input.cwd);
    if (!s.beforeSend || (o.kind === "docs" && !s.docs) || (o.kind === "messages" && !s.messages) || (o.kind === "commit" && !s.docs && !s.messages)) return undefined;
    const found = checkOutgoing(o);
    if (!found.length || !holdOnce(input.session_id, o.text)) return undefined;
    const rules = o.kind === "messages" ? "message writing rules" : o.kind === "commit" ? "rule that text reads as the person's" : "docs writing rules";
    const reason = [
      `Airband held this ${o.where} before it went out. It breaks the ${rules}:`,
      renderFindings(found.slice(0, 12)),
      found.length > 12 ? `… and ${found.length - 12} more.` : "",
      `Rewrite it and send it again, keeping every fact, name, date and link. If the person asked for this exact wording, send it again unchanged: it will go through.`,
    ].filter(Boolean).join("\n");
    if (tool === "gemini") return JSON.stringify({ decision: "deny", reason });
    const out: Record<string, unknown> = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
    if (noticesOn()) out.systemMessage = `↪ Airband held a ${o.where} to fix first: ${summarise(found)}`;
    return JSON.stringify(out);
  } catch {
    return undefined;
  }
}

export function main(): void {
  const arg = (process.argv[2] ?? "claude").toLowerCase();
  const tool: HookTool = arg === "codex" || arg === "gemini" ? arg : "claude";
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    try {
      const out = handle(JSON.parse(raw) as HookInput, Date.now(), tool);
      if (out) process.stdout.write(out);
    } catch {
      // Never interrupt anyone's chat.
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

