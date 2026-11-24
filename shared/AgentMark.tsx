// Each agent's own logo, for every screen: the extension's pages, Roger, the phone app and the setup
// tour. LobeHub's icon set (MIT); the marks belong to their owners. The SVGs are bundled files from
// the icon set, never anything a chat sent.
import type { CSSProperties } from "react";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg";
import claudeCode from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import codex from "@lobehub/icons-static-svg/icons/codex-color.svg";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import { AGENT_IDS, AGENTS, isAgentId, type AgentId } from "../src/core/agents";

/** "chat" is the agent's own mark. "product" is the mark of the tool you install, which for Claude
 *  is Claude Code's. */
const LOGO: Record<"chat" | "product", Record<AgentId, string>> = {
  chat: { claude, codex, gemini },
  product: { claude: claudeCode, codex, gemini },
};

/** The agent an id ("claude") or a label ("Claude") names; nothing for anything else. */
const idOf = (agent: string): AgentId | undefined => (isAgentId(agent) ? agent : AGENT_IDS.find((id) => AGENTS[id].tool === agent));

export function AgentMark({ agent, mark = "chat", className, style, label }: { agent: string; mark?: "chat" | "product"; className?: string; style?: CSSProperties; label?: string }) {
  const id = idOf(agent);
  if (!id) return null;
  return <span className={className} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: LOGO[mark][id] }} />;
}
