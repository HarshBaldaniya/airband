// Claude Code's chat files, read directly from a byte offset: what the SDK does not give, new
// messages since last time (live updates), the files a reply changed, and token usage. Light on
// purpose: the hook imports it.
import type { ChatMessage, Usage } from "../core/types";
import { parseJsonLine } from "../core/json";
import { cleanText } from "./chat-text";

const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: { file_path?: string; notebook_path?: string };
}

interface ClaudeLine {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  message?: { id?: string; content?: unknown; usage?: Record<string, number> };
}

/** Your words and Claude's replies from raw lines, without tool traffic or editor machinery. */
export function claudeMessages(lines: string[]): { messages: ChatMessage[]; files: string[] } {
  const messages: ChatMessage[] = [];
  const files = new Set<string>();
  for (const line of lines) {
    const o = parseJsonLine<ClaudeLine>(line);
    if (!o || (o.type !== "user" && o.type !== "assistant")) continue;
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    const content = o.message?.content;
    const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    const texts: string[] = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) texts.push(b.text);
      if (o.type === "assistant" && b.type === "tool_use" && b.name && FILE_TOOLS.has(b.name)) {
        const p = b.input?.file_path || b.input?.notebook_path;
        if (p) files.add(p);
      }
    }
    const text = cleanText(texts.join("\n"));
    if (!text) continue;
    const who = o.type === "user" ? "you" : "ai";
    const prev = messages[messages.length - 1];
    if (prev && prev.who === who && who === "ai") prev.text = `${prev.text}\n\n${text}`;
    else messages.push({ id: o.uuid ?? String(messages.length), who, text });
  }
  return { messages, files: [...files] };
}

/**
 * Token usage per assistant message, keyed by message id: Claude writes one
 * line per content block, each repeating the message's usage, so the last line
 * of a message wins.
 */
export function claudeUsage(lines: string[], into: Map<string, { u: Usage; day: string }>): void {
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    const o = parseJsonLine<ClaudeLine>(line);
    const u = o?.message?.usage;
    const id = o?.message?.id;
    if (o?.type !== "assistant" || !u || !id) continue;
    into.set(id, {
      u: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      },
      day: (o.timestamp ?? "").slice(0, 10),
    });
  }
}

/**
 * The latest main-chat reply's model and how much context it held (everything
 * read in plus what it wrote, which the next turn reads back).
 */
export function claudeLatest(lines: string[], prev?: { model?: string; used?: number }): { model?: string; used?: number } {
  let last = prev ?? {};
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    const o = parseJsonLine<ClaudeLine & { message?: { model?: string } }>(line);
    const u = o?.message?.usage;
    if (o?.type !== "assistant" || !u || o.isSidechain) continue;
    const model = (o.message as { model?: string }).model;
    if (model === "<synthetic>") continue;
    last = {
      model: model ?? last.model,
      used: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0),
    };
  }
  return last;
}
