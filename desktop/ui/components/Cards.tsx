// The cards the companion shows: a permission request, a question with its choices, a plan to
// approve, a chat that finished, and the companion's own answer. Each says who asks, what, and the
// buttons; nothing more. The same cards fill the phone page.
import { useEffect, useState } from "react";
import { Check, CheckCheck, CircleCheck, Eye, SquareTerminal, X } from "lucide-react";
import claudeLogo from "@lobehub/icons-static-svg/icons/claude-color.svg";
import codexLogo from "@lobehub/icons-static-svg/icons/codex-color.svg";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import { api, MODE, type CompanionAnswer, type FinishedView, type PendingView } from "../api";

const LOGO: Record<string, string> = { claude: claudeLogo, codex: codexLogo, gemini: geminiLogo };

export function AgentMark({ agent, size = 14 }: { agent: string; size?: number }) {
  const svg = LOGO[agent];
  if (!svg) return null;
  return <span className="agentmark" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

function CardHead({ agent, title, project, at, tone }: { agent: string; title: string; project: string; at: number; tone: "needs" | "done" }) {
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
          {terminal}
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

export function FinishedCard({ finished, onSay }: { finished: FinishedView; onSay?: (text: string) => void }) {
  const f = finished;
  return (
    <div className="card done" data-hit>
      <CardHead agent={f.agent} title={f.title} project={f.project} at={f.at} tone="done" />
      {f.did && <span className="did">{f.did}</span>}
      <div className="actions">
        <button className="btn done" onClick={() => void api.open(f.chatId)}>
          <Eye size={14} /> Review
        </button>
        <button className="btn ghost" onClick={() => void api.dismiss(f.chatId)}>
          Later
        </button>
      </div>
    </div>
  );
}

const LINES_SHOWN = 4;
const CLOSE_AFTER_MS = 15_000;
/** A short note on something done ("Opened it in Terminal."): read in a glance, then gone. */
const ACTION_CLOSE_MS = 3_500;

/** The companion's answer: a few lines (More for the rest), a button for each choice when it asks
 *  which one you mean. It closes by itself after a while, unless the pointer is on it or it asks. */
/** While the companion works on a question: the question, a moving bar, and what it is doing now. */
export function ThinkingCard({ name, question, since }: { name: string; question?: string; since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(t);
  }, []);
  const s = (now - since) / 1000;
  const step = s < 2.5 ? "Thinking" : s < 25 ? "Looking it up" : "Still on it, this one takes a minute";
  return (
    <div className="card say thinking" data-hit role="status" aria-live="polite">
      {question && <span className="asked">{question}</span>}
      <span className="step">
        {name} · {step}
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="bar" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}

/** A chat that finished, as one line by the companion: it fades away by itself (the panel keeps it). */
export function FinishedToast({ finished, onSay, onClose }: { finished: FinishedView; onSay?: (text: string) => void; onClose: () => void }) {
  const f = finished;
  return (
    <div className="toast" data-hit>
      <CircleCheck size={16} className="toasticon" />
      <AgentMark agent={f.agent} />
      <span className="toasttext ellipsis">
        <b>{f.title}</b> finished
      </span>
      <button className="btn done small" onClick={() => (void api.open(f.chatId), onClose())}>
        <Eye size={13} /> Review
      </button>
      <button className="iconbtn" onClick={() => (void api.dismiss(f.chatId), onClose())} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

export function AnswerCard({ answer, onClose, onChoose, question }: { answer: CompanionAnswer; onClose: () => void; onChoose: (ask: string) => void; question?: string }) {
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState(false);
  const lines = answer.text.split("\n").filter((l) => l.trim());
  const long = lines.length > LINES_SHOWN || answer.text.length > 320;
  const asks = !!answer.choices?.length;
  useEffect(() => {
    if (asks || hover || all) return;
    const t = setTimeout(onClose, answer.via === "action" && answer.text.length < 90 ? ACTION_CLOSE_MS : CLOSE_AFTER_MS);
    return () => clearTimeout(t);
  }, [asks, hover, all, onClose, answer]);
  return (
    <div className="card say" data-hit onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {question && <span className="asked">{question}</span>}
      <div className="sayrow">
        <div className={`saytext${long && !all ? " clamp" : ""}`}>
          {lines.map((l, i) => {
            // "project: what happened" reads best with the project in bold.
            const m = /^([^:]{1,32}):\s(.+)$/.exec(l);
            return <p key={i}>{m && i > 0 ? (<><b>{m[1]}</b> {m[2]}</>) : l}</p>;
          })}
        </div>
        <button className="iconbtn close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {long && (
        <button className="linkbtn" onClick={() => setAll(!all)}>
          {all ? "Less" : "More"}
        </button>
      )}
      {asks && (
        <div className="saychoices">
          {(answer.choices ?? []).map((c) => (
            <button key={c.ask} className="choice light" onClick={() => onChoose(c.ask)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
