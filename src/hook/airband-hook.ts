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
//      sends a message, a PR or a commit, holds it once if it breaks them;
//   6. when a chat asks permission (Claude Code, Codex), hands the request to
//      the Airband app if it runs, and passes the person's click back.
// It never blocks a chat: errors are swallowed, it always exits 0, and it
// prints nothing except the context it delivers. A permission request is the one
// event that waits, and only while the app runs: at most 110 s, then the agent
// asks in its own terminal.
import * as path from "node:path";
import type { ChatMessage, HookStatus, InboxItem, Status } from "../core/types";
import { safeId, statusDir, writeFileAtomic } from "../core/paths";
import {
  addConnection,
  appendInbox,
  getSentReply,
  logDelivery,
  matchPending,
  readConnections,
  removePending,
  setCursor,
  readCursor,
  readInbox,
  setSentReply,
  setStopBlock,
  takeInbox,
  takeStopBlock,
  type StopBlock,
} from "../core/store";
import { claudeMessages, cleanText, fileSize, readLinesFrom } from "../core/transcript";
import { codexMessages } from "../adapters/codex";
import { geminiMessages, geminiSeen, geminiStart, loadGeminiChat } from "../adapters/gemini";
import { AUTO_DELIVERY_ASK, buildUpdate, formatDelivery, readConfig, sameFolder } from "../core/updates";
import { deliveryNotice, noticesOn, startNotice, toolNotice } from "../core/notices";
import { HOOK_STEP_MAX, readAsksFrom, readHead, recordBehind, renderAsks, updateRecord } from "../core/record";
import { askStation } from "../station/client";
import { readHookStatus } from "../core/status";
import { describeRequest, permissionReply } from "../station/reply";
import { briefFor, checkOutgoing, checkWrittenDoc, forgetGiven, holdOnce, notYetGiven, outgoingText, renderFindings, summarise, writingFor, writingSettings, writtenDoc, type WritingKind } from "../core/writing";
import { toolOf, type AgentId } from "../core/agents";

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
const EVENT_ALIASES: Record<AgentId, Record<string, string>> = {
  claude: { PermissionRequest: "Notification" },
  codex: { PermissionRequest: "Notification" },
  gemini: { BeforeAgent: "UserPromptSubmit", AfterAgent: "Stop", AfterTool: "PostToolUse", BeforeTool: "PreToolUse" },
};

export function normalise(input: HookInput, tool: AgentId): HookInput {
  const name = input.hook_event_name ?? "";
  // Gemini CLI hands over the reply that just ended as prompt_response: one name for it everywhere.
  const reply = input.last_assistant_message ?? input.prompt_response;
  return { ...input, hook_event_name: EVENT_ALIASES[tool][name] ?? name, ...(reply != null ? { last_assistant_message: reply } : {}) };
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
    case "SessionStart":
      // The Claude app starts a new chat's agent when its first message is sent, and the chat's
      // startup hooks may take a while before that message reaches it: it is working already. A
      // terminal starts Claude Code before anything is asked, so there it means nothing.
      return input.source === "startup" && process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop" ? "working" : undefined;
    default:
      return undefined;
  }
}

/** What a chat's status keeps from one event to the next: its agent, its file and the ask it works on. */
function carried(id: string, input: HookInput, tool: AgentId | undefined, status: Status): Pick<HookStatus, "tool" | "file" | "ask"> {
  const was = readHookStatus(id);
  const said = input.prompt ? cleanText(input.prompt).replace(/\s+/g, " ").trim() : "";
  const ask = status === "idle" ? undefined : said ? said.slice(0, 200) : was?.ask;
  const file = input.transcript_path ?? was?.file;
  const t = tool ?? was?.tool;
  return { ...(t ? { tool: t } : {}), ...(file ? { file } : {}), ...(ask ? { ask } : {}) };
}

/** The chat's Stop was answered with a "block": it carries on, so it counts as working. */
function continued(input: HookInput, now: number, tool: AgentId): void {
  const id = input.session_id;
  if (!id || !safeId(id)) return;
  try {
    const entry: HookStatus = { status: "working", at: now, event: CONTINUED, cwd: input.cwd, ...carried(id, input, tool, "working") };
    writeFileAtomic(path.join(statusDir(), `${id}.json`), JSON.stringify(entry));
  } catch {
    // Only a status.
  }
}

/** The status events the hook writes itself: a chat sent back to work, and a Claude app chat starting. */
export const CONTINUED = "Continued";
export const STARTING = "Starting";

export function record(input: HookInput, now = Date.now(), tool?: AgentId): void {
  const id = input.session_id;
  const status = statusFor(input);
  if (!id || !status || !safeId(id)) return;
  const event = input.hook_event_name === "SessionStart" ? STARTING : input.hook_event_name!;
  const entry: HookStatus = { status, at: now, event, cwd: input.cwd, ...carried(id, input, tool, status) };
  if (status === "waiting" && input.message) entry.message = input.message.slice(0, 200);
  else if (status === "waiting" && input.tool_name) {
    const d = describeRequest(input.tool_name, input.tool_input);
    entry.message = (d.detail ? `${d.title}: ${d.detail}` : d.title).slice(0, 200);
  }
  writeFileAtomic(path.join(statusDir(), `${id}.json`), JSON.stringify(entry));
}

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
  return { ...(tool === "codex" ? codexMessages(lines) : claudeMessages(lines)), next };
}

/** Gemini CLI keeps a chat as one JSON file, read whole: past this size the hook doesn't read it. */
const GEMINI_HOOK_MAX = 32 * 1024 * 1024;

/** Where a chat's file ends now, in its tool's cursor units. */
export function endOf(tool: AgentId, file: string): number {
  if (tool !== "gemini") return fileSize(file);
  return loadGeminiChat(file)?.messages?.length ?? 0;
}

/** Moves a chat's bookmark to the end of its file: nothing said so far is sent on. */
function markRead(id: string, tool: AgentId, file: string): void {
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

/** The hook's answer in the shape the tool expects: context for the model, and a line for the person
 *  (systemMessage, which the model never sees). Codex can't show a line, so it gets none. */
function out(tool: AgentId, event: "UserPromptSubmit" | "SessionStart", context: string | undefined, notice: string | undefined): string | undefined {
  const o: Record<string, unknown> = {};
  if (context) o.hookSpecificOutput = { hookEventName: tool === "gemini" && event === "UserPromptSubmit" ? "BeforeAgent" : event, additionalContext: context };
  if (notice && tool !== "codex") o.systemMessage = notice;
  return Object.keys(o).length ? JSON.stringify(o) : undefined;
}

export function handle(raw: HookInput, now = Date.now(), tool: AgentId = "claude"): string | undefined {
  // The app's own questions to Claude Code (what its companion looks up) are not chats of yours.
  if (process.env.AIRBAND_COMPANION) return undefined;
  const input = normalise(raw, tool);
  record(input, now, tool);
  switch (input.hook_event_name) {
    case "Stop": {
      // The person's own message, sent through the app while the chat worked: it goes in before
      // the chat stops, so the turn carries on with it (in every agent, the hook's "block").
      // A "block" sends the chat back to work: it is working, not done, until its next Stop, and
      // that Stop is told apart by why it was sent back.
      const goOn = (why: StopBlock, reply: string) => {
        if (input.session_id && safeId(input.session_id)) setStopBlock(input.session_id, why);
        continued(input, now, tool);
        return reply;
      };
      // Sent back to work by Airband with linked chats' updates, this turn only acknowledged them.
      // Any other turn after a block (the person's own message, another tool's Stop hook) is work.
      const ackOnly = !!input.stop_hook_active && !!input.session_id && takeStopBlock(input.session_id) === "updates";
      if (personWaiting(input.session_id)) {
        if (!ackOnly) {
          keepRecord(input, tool);
          sendUpdates(input, now, tool);
        }
        const d = deliver(input, now);
        if (d) {
          const notice = tool === "claude" && noticesOn() ? deliveryNotice(d.items) : undefined;
          return goOn("person", JSON.stringify({ decision: "block", reason: `${d.text}\n\n${PERSON_ASK}`, ...(notice ? { systemMessage: notice } : {}) }));
        }
      }
      if (ackOnly) {
        // Skipped, so linked chats never ping-pong. Its reply is remembered, so the copy that lands
        // in the file after this hook is not taken for new work next time.
        if (input.session_id && input.transcript_path) {
          markRead(input.session_id, tool, input.transcript_path);
          setSentReply(input.session_id, input.last_assistant_message ? cleanText(input.last_assistant_message) || undefined : undefined);
        }
        return undefined;
      }
      keepRecord(input, tool);
      sendUpdates(input, now, tool);
      // Already sent back to work once in this turn: it stops now.
      if (input.stop_hook_active) return undefined;
      // Updates that arrived while this chat worked go in now, before it stops: a "block" with a
      // reason makes Claude Code, Codex and Gemini CLI (AfterAgent) keep the reply and continue
      // the turn with the reason as the next message, flagged stop_hook_active.
      if (!readConfig().autoDeliver) return undefined;
      const d = deliver(input, now);
      if (!d) return undefined;
      const notice = tool === "claude" && noticesOn() ? deliveryNotice(d.items) : undefined;
      return goOn("updates", JSON.stringify({ decision: "block", reason: `${d.text}\n\n${AUTO_DELIVERY_ASK}`, ...(notice ? { systemMessage: notice } : {}) }));
    }
    case "UserPromptSubmit": {
      // A new message starts a new turn: a block left from a turn that never stopped is forgotten.
      if (input.session_id) takeStopBlock(input.session_id);
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
      // The person's own message reaches a working chat after its next tool step, as context the
      // model reads straight away (Claude Code and Gemini CLI; Codex takes it as it stops).
      if (tool !== "codex" && personWaiting(input.session_id)) {
        const d = deliver(input, now);
        if (d) {
          const docText = doc ? (JSON.parse(doc) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext : undefined;
          const o: Record<string, unknown> = { hookSpecificOutput: { hookEventName: tool === "gemini" ? "AfterTool" : "PostToolUse", additionalContext: [d.text, PERSON_ASK, docText].filter(Boolean).join("\n\n") } };
          if (tool === "claude" && noticesOn()) o.systemMessage = deliveryNotice(d.items);
          return JSON.stringify(o);
        }
      }
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
export function docCheck(input: HookInput, tool: AgentId): string | undefined {
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
export function sendCheck(input: HookInput, tool: AgentId): string | undefined {
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

/**
 * A permission request: the chat shows as needing you, and the request goes to the Airband app.
 * The reply is the person's click in the shape the agent reads, or nothing (the terminal asks).
 */
export async function permission(raw: HookInput, tool: AgentId, now = Date.now()): Promise<string | undefined> {
  try {
    handle(raw, now, tool);
  } catch {
    // The status is a nicety; the question still goes to the app.
  }
  if (process.env.AIRBAND_COMPANION || (tool !== "claude" && tool !== "codex")) return undefined;
  const answer = await askStation({ agent: tool, session_id: raw.session_id, cwd: raw.cwd, transcript_path: raw.transcript_path, tool_name: raw.tool_name, tool_input: raw.tool_input });
  // Answered or not, the chat is no longer waiting on the app.
  if (answer && raw.session_id && safeId(raw.session_id)) {
    try {
      writeFileAtomic(path.join(statusDir(), `${raw.session_id}.json`), JSON.stringify({ status: "working", at: Date.now(), event: "PermissionAnswered", cwd: raw.cwd, ...carried(raw.session_id, raw, tool, "working") } satisfies HookStatus));
    } catch {
      // Only a status.
    }
  }
  return permissionReply(tool, raw.tool_name, raw.tool_input, answer);
}

export function main(): void {
  const arg = (process.argv[2] ?? "claude").toLowerCase();
  const tool: AgentId = arg === "codex" || arg === "gemini" ? arg : "claude";
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let input: HookInput;
    try {
      input = JSON.parse(raw) as HookInput;
    } catch {
      process.exit(0);
    }
    if (input.hook_event_name === "PermissionRequest") {
      // The one event that waits for a person: the usual 4 s limit gives way to the app's own.
      clearTimeout(limit);
      setTimeout(() => process.exit(0), 115_000).unref();
      void permission(input, tool).then(
        (out) => {
          if (out) process.stdout.write(out);
          process.exit(0);
        },
        () => process.exit(0),
      );
      return;
    }
    try {
      const out = handle(input, Date.now(), tool);
      if (out) process.stdout.write(out);
    } catch {
      // Never interrupt anyone's chat.
    }
    process.exit(0);
  });
  const limit = setTimeout(() => process.exit(0), 4000);
  limit.unref();
}

