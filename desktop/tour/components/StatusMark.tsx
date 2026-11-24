import type { State } from "../types";

export function StatusMark({ state }: { state: State }) {
  return (
    <span className={`status ${state}`} aria-label={state}>
      {state === "done" ? "✓" : state === "needs" || state === "failed" ? "!" : ""}
    </span>
  );
}
