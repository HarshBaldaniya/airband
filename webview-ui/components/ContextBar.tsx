// How full a chat's context window is, as a short bar that turns amber, then red.
import { level } from "../lib/format";

export function ContextBar({ pct }: { pct: number }) {
  return (
    <span className={`ctxbar ${level(pct)}`}>
      <span style={{ width: `${Math.max(2, pct)}%` }} />
    </span>
  );
}
