// The hook's part in the writing rules: they are added when a chat is asked for a doc or a message,
// a doc file it writes is checked, and a message, PR or commit it sends is held once if it breaks them.
import * as path from "node:path";
import type { AgentId } from "../core/agents";
import { noticesOn } from "../core/notices";
import { briefFor, writingFor } from "../core/writing/rules";
import { checkOutgoing, holdOnce, outgoingText } from "../core/writing/outgoing";
import { checkWrittenDoc, writtenDoc } from "../core/writing/docs";
import { notYetGiven } from "../core/writing/given";
import { renderFindings, summarise } from "../core/writing/check";
import { writingSettings, type WritingKind } from "../core/writing/settings";
import type { HookInput } from "./input";

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
