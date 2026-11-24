// A request a chat is waiting on: a permission, a question with its choices, or a plan to approve.
// Each says who asks and what, with the buttons, and a thin line for the time left.
import { useEffect, useState } from "react";
import { Check, CheckCheck, PenLine, SkipForward, SquareTerminal, X } from "lucide-react";
import { MODE } from "../../api/desktop-bridge";
import { api, type PendingView } from "../../api/station";
import { AgentMark } from "../AgentMark";
import { CardHead } from "./CardHead";

/** How much of the wait is left, as a thin line: when it runs out, the terminal asks. */
function TimeLeft({ at, until }: { at: number; until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.min(1, (until - now) / Math.max(1, until - at)));
  return (
    <div className="timeleft" title={`${Math.ceil(Math.max(0, until - now) / 1000)} s, then the terminal asks`}>
      <span style={{ width: `${left * 100}%` }} />
    </div>
  );
}

export function RequestCard({ request, onError, compact = false }: { request: PendingView; onError: (m: string) => void; compact?: boolean }) {
  const p = request;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);
  useEffect(() => setOpen(!compact), [compact]);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const decide = async (decision: "allow" | "always" | "deny" | "terminal", extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api.decide(p.id, { decision, ...extra });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  // The question goes back to the chat, and the chat is opened to answer there.
  const writeOwn = async () => {
    await decide("terminal");
    if (p.chatId) void api.open(p.chatId).catch(() => undefined);
  };
  // On a phone, away from the computer, "answer in the terminal" helps no one.
  const terminal = MODE === "phone" ? null : (
    <button className="iconbtn term" disabled={busy} onClick={() => decide("terminal")} title="Answer in the chat's own terminal instead" aria-label="Answer in the terminal instead">
      <SquareTerminal size={16} />
    </button>
  );

  // With several requests waiting, each is one line until it is opened.
  if (!open) {
    const quick = !p.questions?.length && p.toolName !== "ExitPlanMode";
    return (
      <div className="card needs row" data-hit>
        <button className="rowopen" onClick={() => setOpen(true)} aria-label={`Show ${p.chatTitle}'s request`}>
          <span className="dot needs" />
          <AgentMark agent={p.agent} />
          <span className="rowtext">
            <b className="ellipsis">{p.chatTitle}</b>
            <span className="muted ellipsis">{p.detail ? `${p.title}: ${p.detail}` : p.title}</span>
          </span>
        </button>
        {quick ? (
          <>
            <button className="btn primary small" disabled={busy} onClick={() => decide("allow")} aria-label={`Allow ${p.chatTitle}'s request`}>
              <Check size={13} />
            </button>
            <button className="btn small" disabled={busy} onClick={() => decide("deny")} aria-label={`Deny ${p.chatTitle}'s request`}>
              <X size={13} />
            </button>
          </>
        ) : (
          <button className="btn small" onClick={() => setOpen(true)}>
            Answer
          </button>
        )}
      </div>
    );
  }

  if (p.questions?.length) {
    const qs = p.questions;
    const complete = qs.every((q) => (picks[q.question]?.length ?? 0) > 0);
    const send = (all: Record<string, string[]>) => decide("allow", { answers: Object.fromEntries(qs.map((q) => [q.question, q.multiSelect ? all[q.question] : all[q.question][0]])) });
    const pick = (q: (typeof qs)[number], label: string) => {
      const cur = picks[q.question] ?? [];
      const next = q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label];
      const all = { ...picks, [q.question]: next };
      setPicks(all);
      // One question, one choice: the click is the answer.
      if (qs.length === 1 && !q.multiSelect) void send(all);
    };
    return (
      <div className="card needs" data-hit>
        <CardHead agent={p.agent} title={p.chatTitle} project={p.project} at={p.at} tone="needs" />
        {qs.map((q) => (
          <div key={q.question} className="question">
            <span className="qtext">{q.question}</span>
            <div className="choices">
              {q.options.map((o) => (
                <button key={o.label} className={`choice${picks[q.question]?.includes(o.label) ? " on" : ""}`} disabled={busy} onClick={() => pick(q, o.label)} title={o.description}>
                  {q.multiSelect && <span className="tick">{picks[q.question]?.includes(o.label) ? <Check size={12} /> : null}</span>}
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="actions">
          {(qs.length > 1 || qs.some((q) => q.multiSelect)) && (
            <button className="btn primary" disabled={busy || !complete} onClick={() => send(picks)}>
              <Check size={14} /> Send
            </button>
          )}
          {/* None of the choices: the question goes back to the chat, which is opened to type in
              (its own "Other"). On a phone, away from the computer, only skipping helps. */}
          {MODE !== "phone" && (
            <button className="btn" disabled={busy} onClick={() => void writeOwn()} title="Answer in the chat itself, in your own words">
              <PenLine size={14} /> Write my own
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => decide("deny")} title="The chat carries on without an answer, and says what it assumed">
            <SkipForward size={14} /> Skip
          </button>
        </div>
        <TimeLeft at={p.at} until={p.expiresAt} />
      </div>
    );
  }

  const plan = p.toolName === "ExitPlanMode";
  return (
    <div className="card needs" data-hit>
      <CardHead agent={p.agent} title={p.chatTitle} project={p.project} at={p.at} tone="needs" />
      <span className="qtext">{p.title}</span>
      {p.detail && <pre className={`detail${plan ? " plan" : ""}`}>{p.detail}</pre>}
      {p.truncated && <span className="muted">This shows the first {p.detail?.length ?? 0} of {p.detailLength} characters. Read the whole request in the chat before you allow it.</span>}
      <div className="actions">
        <button className="btn primary" disabled={busy} onClick={() => decide("allow")}>
          <Check size={14} /> {plan ? "Approve" : "Allow"}
        </button>
        {!plan && (
          <button className="btn" disabled={busy} onClick={() => decide("always")} title="Allow this same thing in this folder from now on">
            <CheckCheck size={14} /> Always
          </button>
        )}
        <button className="btn" disabled={busy} onClick={() => decide("deny", plan ? { message: "Keep planning: the person wants changes before you start." } : {})}>
          <X size={14} /> {plan ? "Not yet" : "Deny"}
        </button>
        {terminal}
      </div>
      <TimeLeft at={p.at} until={p.expiresAt} />
    </div>
  );
}
