// Every AI tool Airband links runs the hook on a few events, with the event as JSON
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
import type { AgentId } from "../core/agents";
import { readConfig } from "../core/config";
import { AUTO_DELIVERY_ASK } from "../core/delivery";
import { deliveryNotice, noticesOn, startNotice, toolNotice } from "../core/notices";
import { safeId } from "../core/paths";
import { setSentReply, setStopBlock, takeStopBlock, type StopBlock } from "../core/store";
import { cleanText } from "../adapters/chat-text";
import { briefFor } from "../core/writing/rules";
import { forgetGiven } from "../core/writing/given";
import { writingSettings } from "../core/writing/settings";
import { hookOutput, normalise, type HookInput } from "./input";
import { bindBranch, deliver, keepRecord, markRead, PERSON_ASK, personWaiting, sendUpdates } from "./sharing";
import { continued, record } from "./status";
import { docCheck, sendCheck, writingRules } from "./writing";

/** What the hook answers an event with (printed to the agent), or nothing. */
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
      return hookOutput(tool, "UserPromptSubmit", [d?.text, w?.text].filter(Boolean).join("\n\n") || undefined, lines.join("\n") || undefined);
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
      return hookOutput(tool, "SessionStart", [d?.text, replies].filter(Boolean).join("\n\n") || undefined, lines.join("\n") || undefined);
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
