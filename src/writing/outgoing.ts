// Before it goes out: a message, a PR or a commit an agent is about to send, checked and held once
// when its words break the rules.
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson } from "../core/json";
import { airbandFile, writeFileAtomic } from "../core/paths";
import { checkWriting, type WritingFinding } from "./check";

export interface Outgoing {
  /** What it is, as the person would say it: "Slack message", "PR description", "commit message" */
  where: string;
  /** Which rules it gets: a commit only the AI-credit rule */
  kind: "docs" | "messages" | "commit";
  text: string;
}

const SHELL_TOOL = /^(Bash|run_shell_command|shell|exec_command|local_shell)$/;
/** An MCP tool that sends or posts words for people to read. */
const SENDS = /(send|post|reply|forward|schedule|draft|comment|review|create_?(issue|pull|pr)|update_?(issue|pull|pr)|save_?(comment|issue)|message|announce)/i;
const NOT_SENDS = /(reaction|label|read|get|list|search|find|delete|remove|upload|download|mark|status|query|fetch)/i;
const TEXT_FIELD = /^(text|message|body|content|markdown|comment|description|reply|draft|html_?body|note)$/i;

/** The words after a flag in a shell command: a quoted value, a heredoc, or a file named by it. */
function shellValues(command: string, flags: string[], cwd?: string): string[] {
  const out: string[] = [];
  const names = flags.map((f) => f.replace(/[-]/g, "\\-")).join("|");
  // A heredoc anywhere in the command ("$(cat <<'EOF' … EOF)") is the body: agents write long ones so.
  const here = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/.exec(command);
  if (here) out.push(here[2]);
  else {
    const re = new RegExp(`(?:^|\\s)(?:${names})(?:=|\\s+)(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`, "g");
    for (const m of command.matchAll(re)) {
      const v = m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, "$1") : (m[2] ?? m[3] ?? "");
      if (v) out.push(v);
    }
  }
  const file = new RegExp(`(?:^|\\s)(?:--body-file|-F|--file)(?:=|\\s+)("([^"]+)"|'([^']+)'|(\\S+))`).exec(command);
  const name = file && (file[2] ?? file[3] ?? file[4]);
  if (name && name !== "-") {
    try {
      out.push(fs.readFileSync(path.resolve(cwd ?? ".", name), "utf8").slice(0, BODY_FILE_MAX));
    } catch {
      // A file not there yet: nothing to read.
    }
  }
  return out;
}

/** How much of a file a command sends (gh pr create --body-file) is read to check its words. */
const BODY_FILE_MAX = 64_000;

/** What an agent is about to send, read from the tool call; nothing for anything else. */
export function outgoingText(toolName: string | undefined, input: unknown, cwd?: string): Outgoing | undefined {
  if (!input || typeof input !== "object" || !toolName) return undefined;
  const i = input as Record<string, unknown>;
  if (SHELL_TOOL.test(toolName)) {
    const raw = i.command;
    const command = Array.isArray(raw) ? raw.join(" ") : typeof raw === "string" ? raw : "";
    if (!command) return undefined;
    // Only what runs: "git commit" or "gh pr create" as a command of its own, not words inside a
    // quoted string (a prompt handed to another tool, an echo).
    const bare = command.replace(/<<-?\s*['"]?([A-Za-z_]\w*)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, "").replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    const at = (re: string) => new RegExp(`(?:^|[;&|(\\n]|\\$\\()\\s*(?:\\w+=\\S*\\s+)*${re}`).test(bare);
    let where: string | undefined;
    let kind: Outgoing["kind"] = "messages";
    let flags = ["--body", "-b"];
    if (at("git\\s+(?:-C\\s+\\S+\\s+)?commit\\b")) {
      where = "commit message";
      kind = "commit";
      flags = ["-m", "--message"];
    } else if (at("gh\\s+pr\\s+(?:create|edit)\\b")) [where, kind] = ["PR description", "docs"];
    else if (at("gh\\s+issue\\s+(?:create|edit)\\b")) [where, kind] = ["issue", "docs"];
    else if (at("gh\\s+(?:pr|issue)\\s+comment\\b")) where = "comment";
    else if (at("gh\\s+pr\\s+review\\b")) where = "review";
    else if (at("gh\\s+release\\s+(?:create|edit)\\b")) [where, kind, flags] = ["release notes", "docs", ["--notes", "-n"]];
    if (!where) return undefined;
    const text = shellValues(command, flags, cwd).join("\n\n").trim();
    return text ? { where, kind, text } : undefined;
  }
  // Another tool, from an MCP server: Slack, email, GitHub, Linear and the like.
  if (/airband/i.test(toolName) || !/__|^mcp/i.test(toolName)) return undefined;
  const verb = toolName.split(/__/).pop() ?? toolName;
  if (!SENDS.test(verb) || NOT_SENDS.test(verb)) return undefined;
  const text = Object.entries(i)
    .filter(([k, v]) => TEXT_FIELD.test(k) && typeof v === "string")
    .map(([, v]) => v as string)
    .join("\n\n")
    .trim();
  if (!text) return undefined;
  const kind: Outgoing["kind"] = /create_?(issue|pull|pr)|update_?(issue|pull|pr)|save_?issue|document/i.test(verb) ? "docs" : "messages";
  const where = /slack/i.test(toolName)
    ? "Slack message"
    : /gmail|mail|outlook/i.test(toolName)
      ? "email"
      : /teams/i.test(toolName)
        ? "Teams message"
        : /comment|review/i.test(verb)
          ? "comment"
          : kind === "docs"
            ? /issue/i.test(verb)
              ? "issue"
              : "PR description"
            : "message";
  return { where, kind, text };
}

/** What in an outgoing text breaks its rules. A commit is held only for a line crediting an AI tool. */
export function checkOutgoing(o: Outgoing): WritingFinding[] {
  if (o.kind === "commit") return checkWriting(o.text, "docs").filter((f) => f.rule === "ai");
  return checkWriting(o.text, o.kind);
}

const heldFile = () => airbandFile("writing-held.json");
/** The most held texts remembered: the oldest are let go. */
const HELD_MAX = 400;

/** djb2, enough to know the same text again. */
function hashText(t: string): string {
  let h = 5381;
  for (let k = 0; k < t.length; k++) h = ((h << 5) + h + t.charCodeAt(k)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Hold this text once: true the first time it is seen, false when it comes again unchanged (the
 * agent was told it may send it as it is, when the person asked for that wording).
 */
export function holdOnce(sessionId: string | undefined, text: string, now = Date.now()): boolean {
  const key = `${sessionId ?? "-"}:${hashText(text)}`;
  const held = readJson<Record<string, number>>(heldFile(), {});
  if (held[key]) return false;
  held[key] = now;
  const keys = Object.keys(held);
  for (const k of keys.slice(0, Math.max(0, keys.length - HELD_MAX))) delete held[k];
  try {
    writeFileAtomic(heldFile(), JSON.stringify(held));
  } catch {
    // Not kept: the next try is held again, which is only one more round.
  }
  return true;
}
