import { AgentMark } from "../../../shared/AgentMark";
import { openUrl } from "../tauri";
import type { Scan } from "../types";

/** Who makes each AI tool Airband works with, by the name the setup reports. */
const MAKER: Record<string, { agent: string; by: string }> = {
  "Claude Code": { agent: "claude", by: "Anthropic" },
  Codex: { agent: "codex", by: "OpenAI" },
  "Gemini CLI": { agent: "gemini", by: "Google" },
};

/** The AI tools to choose from, one tile each. A tile opens that tool's website. */
export function AgentTiles({ scan, watching }: { scan: Scan; watching?: boolean }) {
  return (
    <>
      <div className="tools">
        {scan.agents.map((a) => (
          <button key={a.name} className="tool" title={a.link} onClick={() => openUrl(a.link)}>
            {MAKER[a.name] ? <AgentMark agent={MAKER[a.name].agent} mark="product" className="logo" /> : <span className="logo" />}
            <b>{a.name}</b>
            <span className="by">{MAKER[a.name]?.by}</span>
            <span className="go" aria-hidden>
              ↗
            </span>
          </button>
        ))}
      </div>
      {watching && (
        <p className="hint">
          <i aria-hidden /> Install one. I'll notice it here.
        </p>
      )}
    </>
  );
}
