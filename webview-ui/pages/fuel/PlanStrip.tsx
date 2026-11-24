import { useViewState } from "../../app/ViewStateContext";
import { level } from "../../lib/format";
import { send } from "../../lib/vscode";
import { ToolMark } from "../../components/Icons";
import { headline, limitedPlans, resetShort, shortLabel } from "./plans";

/**
 * Foot of the sidebar: a small card per agent with its plan, the limit nearest to running out
 * (big %, a full-width bar) and exactly when it resets. Click: the Fuel page with everything.
 */
export function PlanStrip() {
  const plans = limitedPlans(useViewState());
  if (!plans.length) return null;
  return (
    <footer className="planstrip" aria-label="Plan usage">
      {plans.map((p) => {
        const w = headline(p);
        const name = p.account?.plan ?? p.tool;
        if (!w) return null;
        const lvl = level(w.pct);
        return (
          <button key={p.tool} className={`plancardmini ${lvl}`} onClick={() => send({ type: "openBoard", tab: "usage" })} data-tip="Open Fuel" aria-label={`${name}: ${w.pct}% of ${w.label} used. Open the Fuel page`}>
            <span className="pcmtop">
              <ToolMark tool={p.tool} size={14} />
              <span className="pcmname ellipsis">{name}</span>
              <span className={`pcmpct ${lvl}`}>
                {w.pct}
                <small>%</small>
              </span>
            </span>
            <span className={`planbar wide ${lvl}`} aria-hidden="true">
              <span style={{ width: `${Math.max(2, w.pct ?? 0)}%` }} />
            </span>
            <span className="pcmmeta ellipsis">
              {shortLabel(w.label)}
              {w.resetsAt ? ` · resets ${resetShort(w.resetsAt)}` : ""}
            </span>
          </button>
        );
      })}
    </footer>
  );
}
