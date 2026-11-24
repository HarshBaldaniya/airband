// What the hook writes about a chat after each event: working, waiting for the person, done or
// idle. The Station and the extension read these files to show every chat as it is.
import * as path from "node:path";
import type { AgentId } from "../core/agents";
import { safeId, statusDir, writeFileAtomic } from "../core/paths";
import { readHookStatus } from "../sessions/status";
import { cleanText } from "../adapters/chat-text";
import type { HookStatus, Status } from "../core/types";
import { describeRequest } from "../station/reply";
import type { HookInput } from "./input";

/** The status events the hook writes itself: a chat sent back to work, and a Claude app chat starting. */
const CONTINUED = "Continued";
const STARTING = "Starting";

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
export function continued(input: HookInput, now: number, tool: AgentId): void {
  const id = input.session_id;
  if (!id || !safeId(id)) return;
  try {
    const entry: HookStatus = { status: "working", at: now, event: CONTINUED, cwd: input.cwd, ...carried(id, input, tool, "working") };
    writeFileAtomic(path.join(statusDir(), `${id}.json`), JSON.stringify(entry));
  } catch {
    // Only a status.
  }
}

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

/** The person answered a permission request: the chat no longer waits on the app. */
export function answered(input: HookInput, tool: AgentId): void {
  const id = input.session_id;
  if (!id || !safeId(id)) return;
  try {
    writeFileAtomic(path.join(statusDir(), `${id}.json`), JSON.stringify({ status: "working", at: Date.now(), event: "PermissionAnswered", cwd: input.cwd, ...carried(id, input, tool, "working") } satisfies HookStatus));
  } catch {
    // Only a status.
  }
}
