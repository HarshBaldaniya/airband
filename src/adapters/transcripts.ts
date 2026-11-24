// The messages in a run of chat-file lines, read in the agent's own format. Claude Code and Codex
// append JSON lines; Gemini CLI keeps one JSON file per chat (gemini.ts reads it whole).
import type { AgentId } from "../core/agents";
import type { ChatMessage } from "../core/types";
import { claudeMessages } from "./claude-transcript";
import { codexMessages } from "./codex";

export function lineMessages(agent: Exclude<AgentId, "gemini">, lines: string[]): { messages: ChatMessage[]; files: string[] } {
  return agent === "codex" ? codexMessages(lines) : claudeMessages(lines);
}
