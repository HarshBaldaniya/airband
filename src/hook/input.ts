// What an agent hands the hook, made one shape whatever the agent, and the shape of what the hook
// hands back.
import type { AgentId } from "../core/agents";

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
  /** Set (Claude Code) when the event comes from an agent the chat started, not the chat itself. */
  agent_id?: string;
  agent_type?: string;
}

/** The event comes from an agent the chat started: Claude Code runs the hook inside them, under
 *  the chat's own id, with the agent's id (and its own file, under the chat's subagents folder). */
export function fromAgent(input: HookInput): boolean {
  return !!input.agent_id || /[\\/]subagents[\\/]/.test(input.transcript_path ?? "");
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

/** The hook's answer in the shape the tool expects: context for the model, and a line for the person
 *  (systemMessage, which the model never sees). Codex can't show a line, so it gets none. */
export function hookOutput(tool: AgentId, event: "UserPromptSubmit" | "SessionStart", context: string | undefined, notice: string | undefined): string | undefined {
  const o: Record<string, unknown> = {};
  if (context) o.hookSpecificOutput = { hookEventName: tool === "gemini" && event === "UserPromptSubmit" ? "BeforeAgent" : event, additionalContext: context };
  if (notice && tool !== "codex") o.systemMessage = notice;
  return Object.keys(o).length ? JSON.stringify(o) : undefined;
}
