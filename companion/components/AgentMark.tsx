import { AgentMark as Mark } from "../../shared/AgentMark";

/** The agent's logo, `size` pixels square. */
export function AgentMark({ agent, size = 14 }: { agent: string; size?: number }) {
  return <Mark agent={agent} className="agentmark" style={{ width: size, height: size }} />;
}
