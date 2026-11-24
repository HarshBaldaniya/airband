// The top line of every card: whether it needs you or is done, the agent, the chat, its project,
// and how long ago.
import { ago } from "../../format";
import { AgentMark } from "../AgentMark";

export function CardHead({ agent, title, project, at, tone }: { agent: string; title: string; project: string; at: number; tone: "needs" | "done" }) {
  return (
    <div className="cardhead">
      <span className={`dot ${tone}`} />
      <AgentMark agent={agent} />
      <b className="ellipsis">{title}</b>
      {project && project !== title && <span className="muted ellipsis">{project}</span>}
      <span className="grow" />
      <span className="muted">{ago(at)}</span>
    </div>
  );
}
