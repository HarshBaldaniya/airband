// The hook's part in sharing: what a chat did goes to the chats it is linked to as it finishes a
// reply, and what waits in a chat's inbox goes into it with its next message.
import { toolOf, type AgentId } from "../core/agents";
import { buildUpdate, formatDelivery } from "../core/delivery";
import { sameFolder } from "../core/paths";
import { HOOK_STEP_MAX, readHead } from "../sessions/record/store";
import { readAsksFrom } from "../sessions/record/extract";
import { recordBehind, updateRecord } from "../sessions/record/update";
import { renderAsks } from "../sessions/record/render";
import { addConnection, appendInbox, getSentReply, logDelivery, matchPending, readConnections, readCursor, readInbox, removePending, setCursor, setSentReply, takeInbox } from "../core/store";
import { cleanText } from "../adapters/chat-text";
import { fileSize, readLinesFrom } from "../core/file-lines";
import type { ChatMessage, InboxItem } from "../core/types";
import { MiB } from "../core/units";
import { lineMessages } from "../adapters/transcripts";
import { geminiMessages, geminiSeen, geminiStart, loadGeminiChat } from "../adapters/gemini";
import type { HookInput } from "./input";

/** Gemini CLI keeps a chat as one JSON file, read whole: past this size the hook doesn't read it. */
const GEMINI_HOOK_MAX = 32 * MiB;

/**
 * What a chat said since `cursor`, read in its tool's own format. Claude Code and
 * Codex append JSON lines (the cursor is a byte offset); Gemini CLI's file also
 * edits and rewinds earlier messages, so it is read whole (the cursor is a message count).
 */
export function readSince(tool: AgentId, file: string, cursor: number, seen?: string[]): { messages: ChatMessage[]; files: string[]; next: number; seen?: string[] } {
  if (tool === "gemini") {
    const chat = loadGeminiChat(file);
    if (!chat) return { messages: [], files: [], next: cursor, ...(seen ? { seen } : {}) };
    const all = chat.messages ?? [];
    return { ...geminiMessages(all.slice(geminiStart(all, cursor, seen))), next: all.length, seen: geminiSeen(all, all.length) };
  }
  const { lines, next } = readLinesFrom(file, cursor);
  return { ...lineMessages(tool, lines), next };
}

/** Where a chat's file ends now, in its tool's cursor units. */
export function endOf(tool: AgentId, file: string): number {
  if (tool !== "gemini") return fileSize(file);
  return loadGeminiChat(file)?.messages?.length ?? 0;
}

/** Moves a chat's bookmark to the end of its file: nothing said so far is sent on. */
export function markRead(id: string, tool: AgentId, file: string): void {
  if (tool !== "gemini") return setCursor(id, fileSize(file));
  const all = loadGeminiChat(file)?.messages ?? [];
  setCursor(id, all.length, geminiSeen(all, all.length));
}

/**
 * After a reply: what this chat did since last time goes to every chat it is linked to, at each
 * link's level: a line per ask (the default), a short summary, or the words themselves.
 */
export function sendUpdates(input: HookInput, now = Date.now(), tool: AgentId = "claude"): number {
  const id = input.session_id;
  const file = input.transcript_path;
  if (!id || !file) return 0;
  const outgoing = readConnections().filter((c) => c.from.id === id && !c.paused);
  const cursor = readCursor(id);
  if (!outgoing.length) {
    // Not shared right now: the bookmark still moves with each reply, so a link made later starts
    // from then (its context covers the past) instead of sending everything said since.
    if (cursor) markRead(id, tool, file);
    return 0;
  }
  if (!cursor) {
    // Never read before: start from here rather than resend its whole past.
    markRead(id, tool, file);
    return 0;
  }
  // Too big to read in the few seconds a hook has: the bookmark moves on, so the next reply is
  // shared again.
  if (tool === "gemini" && fileSize(file) > GEMINI_HOOK_MAX) {
    markRead(id, tool, file);
    return 0;
  }
  // The bookmark moves with every reply, so this much new text is one turn (big tool output,
  // pictures). Its end is read: that is where the turn's reply is.
  const from = tool !== "gemini" && fileSize(file) - cursor.at > HOOK_STEP_MAX ? fileSize(file) - HOOK_STEP_MAX : cursor.at;
  // The reply already sent, read before this reply takes its place.
  const sentBefore = getSentReply(id);
  // The words themselves are read only when a link asks for them.
  const words = outgoing.some((c) => c.level === "full") ? readSince(tool, file, from, cursor.seen) : undefined;
  if (words) withLatestReply(id, words.messages, input);
  const { asks, next, trailing, seen } = readAsksFrom(tool, file, from, 1, { lastReply: input.last_assistant_message ?? undefined, seen: cursor.seen });
  setCursor(id, words?.next ?? next, words?.seen ?? seen);
  // A reply read with no ask before it: the end of one already sent (skipped), or more work on it.
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
export function keepRecord(input: HookInput, tool: AgentId = "claude"): void {
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
  // Nothing new in the file, and the reply is the one already sent (from the file, or held from
  // last time): an agent that signals a reply's end twice. Sent once is enough.
  if (!messages.length && (!before || reply === before)) return;
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
export function bindBranch(input: HookInput, now = Date.now(), tool: AgentId = "claude"): void {
  const id = input.session_id;
  if (!id || !input.prompt) return;
  const p = matchPending(input.prompt, input.cwd, now);
  if (!p) return;
  removePending(p.id);
  if (p.context) appendInbox(id, { from: p.from, at: now, kind: "context", text: p.context });
  // Airband set the old chat's cursor when it opened the branch, so its updates start from then.
  if (p.keepConnected) addConnection(p.from, { id, tool: toolOf(tool), title: p.title }, now);
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

/** Who a message from the person comes from: they sent it through the app (Roger). */
export const FROM_PERSON = "airband-app";

/** Said with the person's own message when it reaches a chat that is working, or about to stop. */
export const PERSON_ASK = "The person sent this while you were working. Act on it now: answer it or change course as it asks, then carry on with the task.";

/** The person sent this chat something through the app, and it hasn't reached it yet. Unlike a
 *  linked chat's update, which waits for the next message, it goes in as soon as the chat can take
 *  it: after its next tool step, or before it stops. */
export function personWaiting(id: string | undefined): boolean {
  return !!id && readInbox(id).some((i) => i.from.id === FROM_PERSON);
}
