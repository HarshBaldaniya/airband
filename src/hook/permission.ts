// A permission request (Claude Code, Codex): the chat shows as needing the person, and the request
// goes to the Airband app. Only this event waits: at most DECISION_MS, then the agent asks in its
// own terminal.
import type { AgentId } from "../core/agents";
import { askStation } from "../station/client";
import { permissionReply } from "../station/reply";
import { handle } from "./handle";
import type { HookInput } from "./input";
import { answered } from "./status";

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
  if (answer) answered(raw, tool);
  return permissionReply(tool, raw.tool_name, raw.tool_input, answer);
}
