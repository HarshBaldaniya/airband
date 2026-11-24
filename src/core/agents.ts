// The three agents Airband works with, in one table. Each has an id (what hooks, records and files
// on disk use), a Tool label (what the extension shows and older records carry) and the name people
// know it by. Plain data with no Node imports, so the browser pages can use it too.
export const AGENT_IDS = ["claude", "codex", "gemini"] as const;
export type AgentId = (typeof AGENT_IDS)[number];
/** An agent's label in the extension and in older records. */
export type Tool = "Claude" | "Codex" | "Gemini";

export const AGENTS: Record<AgentId, { tool: Tool; name: string }> = {
  claude: { tool: "Claude", name: "Claude Code" },
  codex: { tool: "Codex", name: "Codex" },
  gemini: { tool: "Gemini", name: "Gemini CLI" },
};

export const isAgentId = (v: unknown): v is AgentId => typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);

/** The agent a Tool label, an id or a file path names. Anything that isn't Codex or Gemini is Claude. */
export const agentOf = (t: Tool | string): AgentId => (/codex/i.test(t) ? "codex" : /gemini/i.test(t) ? "gemini" : "claude");

/** An agent's Tool label: "Claude", "Codex", "Gemini". */
export const toolOf = (id: AgentId): Tool => AGENTS[id].tool;

/** The name people know an agent by ("Claude Code"), from its id or Tool label. Undefined for anything else. */
export function agentName(idOrTool: string | undefined): string | undefined {
  const id = idOrTool?.toLowerCase();
  return isAgentId(id) ? AGENTS[id].name : undefined;
}
