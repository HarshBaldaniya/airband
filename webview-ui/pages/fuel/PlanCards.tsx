// The Fuel page's plans: one card per agent with everything it reports (account, every limit with
// its reset, extra usage, where the use went).
import type { Tool } from "../../../src/core/agents";
import { useViewState } from "../../app/ViewStateContext";
import { agoText, level } from "../../lib/format";
import { send } from "../../lib/vscode";
import { Clock, I, RefreshCw, ToolMark } from "../../components/Icons";
import { headline, resetShort, resetText, shownPlans } from "./plans";

/** A ring that fills as a limit is used, its % in the middle. */
function Gauge({ pct, size = 92 }: { pct: number | null; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <span className={`gauge ${level(pct)}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="gaugebg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="gaugefg" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="gaugetext">
        {pct == null ? "–" : pct}
        <small>%</small>
      </span>
    </span>
  );
}

const productName = (t: Tool) => (t === "Claude" ? "Claude Code" : t === "Gemini" ? "Gemini CLI" : "Codex");

/** An organization named only after the email adds nothing: it is left out. */
const orgWorthShowing = (org?: string, email?: string) => !!org && !(email && org.toLowerCase().startsWith(email.toLowerCase()));

const SEGMENT = ["seg-a", "seg-b", "seg-c", "seg-d"];

/** The Fuel page: one card per agent with everything it reports. */
export function PlanCards() {
  const state = useViewState();
  const plans = shownPlans(state);
  return (
    <section className="plans">
      <div className="pagehead">
        <div>
          <h2>Plans and limits</h2>
          <p className="muted small">As each agent reports them, for the account signed in on this computer.</p>
        </div>
        <button className="btn small ghostbtn" onClick={() => send({ type: "plans" })} disabled={state.plansLoading} data-tip="Read them again (R)">
          <RefreshCw {...I} size={13} className={state.plansLoading ? "spin" : ""} /> {state.plansLoading ? "Reading…" : "Refresh"}
        </button>
      </div>
      {!plans.length && <p className="muted">{state.plansLoading ? "Asking your agents…" : "No agent has reported its plan yet."}</p>}
      <div className={`plancards ${plans.length === 1 ? "single" : ""}`}>
        {plans.map((p) => {
          const top = headline(p);
          const acct = p.account;
          const who = [acct?.auth, acct?.email, orgWorthShowing(acct?.organization, acct?.email) ? acct?.organization : undefined].filter(Boolean).join(" · ");
          return (
            <article key={p.tool} className="plancard">
              <header className="plancardhead">
                <span className={`plantile tool-${p.tool.toLowerCase()}`}>
                  <ToolMark tool={p.tool} size={18} />
                </span>
                <span className="plantitle">
                  <strong>{productName(p.tool)}</strong>
                  {who && <span className="planwho ellipsis">{who}</span>}
                </span>
                {acct?.plan && <span className="planbadge">{acct.plan}</span>}
              </header>

              {/* Left: the headline gauge. Right: every limit and where the use went. Side by side
                  when the card is wide, stacked when it is narrow. */}
              <div className="plancardbody">
              <div className="pcleft">
              {top ? (
                <div className="planhero">
                  <Gauge pct={top.pct} />
                  <div className="planherotext">
                    <span className="planherolabel">{top.label}</span>
                    <span className="planherohint">{top.pct != null && top.pct >= 90 ? "Almost used up" : top.pct != null && top.pct >= 70 ? "Getting close" : "Plenty left"}</span>
                    {top.resetsAt && (
                      <span className="planheroreset">
                        <Clock {...I} size={12} />
                        {/* "Resets tomorrow" and "8:30 AM IST" each stay whole; a narrow card wraps between them */}
                        {resetText(top.resetsAt)
                          .split(" · ")
                          .map((part, i) => (
                            <span key={i} className="rpart">
                              {i ? `· ${part}` : part}
                            </span>
                          ))}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="plannote muted">{p.note ?? "No limits reported."}</p>
              )}
              </div>
              {/* Only when there is more to show: an empty column left a gap under the gauge. */}
              {(p.windows.length > 1 || !!p.breakdown) && (
              <div className="pcright">
              {p.windows.length > 1 && (
                <div className="plangroup">
                  <div className="plangrouphead">All limits</div>
                  <div className="limitrows">
                    {p.windows.map((w) => (
                      <div key={w.label} className="limitrow">
                        <span className="limitname ellipsis">{w.label.replace("Current session (5-hour)", "5-hour session")}</span>
                        <span className={`planbar wide ${level(w.pct)}`} aria-hidden="true">
                          <span style={{ width: `${Math.max(1, w.pct ?? 0)}%` }} />
                        </span>
                        <span className={`planpct ${level(w.pct)}`}>{w.pct == null ? "–" : `${w.pct}%`}</span>
                        <span className="limitreset">{w.resetsAt ? resetShort(w.resetsAt) : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {p.breakdown && (
                <div className="plangroup">
                  <div className="plangrouphead">Where this week’s use went</div>
                  <div className="segbar" aria-hidden="true">
                    {p.breakdown.map((b, i) => (
                      <span key={b.label} className={SEGMENT[i % SEGMENT.length]} style={{ width: `${b.pct}%` }} />
                    ))}
                  </div>
                  <div className="seglegend">
                    {p.breakdown.map((b, i) => (
                      <span key={b.label}>
                        <i className={SEGMENT[i % SEGMENT.length]} /> {b.label} <b>{b.pct}%</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              </div>
              )}
              </div>

              <footer className="planfoot">
                {p.extra && (
                  <span className={`planchip ${p.extra.enabled ? "on" : ""}`}>
                    Extra usage {p.extra.enabled ? (p.extra.used != null ? `on · ${p.extra.used}${p.extra.limit != null ? ` of ${p.extra.limit}` : ""} ${p.extra.currency ?? ""}` : "on") : "off"}
                  </span>
                )}
                {p.windows.length > 0 && p.note && <span className="muted small">{p.note}</span>}
                <span className="grow" />
                <span className="muted small">
                  {p.source} · {agoText(p.at)}
                </span>
                {p.tool === "Claude" && (
                  <a className="small" href="https://claude.ai/settings/usage">
                    Manage on claude.ai
                  </a>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
