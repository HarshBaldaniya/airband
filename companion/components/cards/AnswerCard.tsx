import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CompanionAnswer } from "../../api/station";

const LINES_SHOWN = 4;
const CLOSE_AFTER_MS = 15_000;
/** A short note on something done ("Opened it in Terminal."): read in a glance, then gone. */
const ACTION_CLOSE_MS = 3_500;

/** The companion's answer: a few lines (More for the rest), a button for each choice when it asks
 *  which one you mean. It closes by itself after a while, unless the pointer is on it or it asks. */
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
        <div className={`saytext${long && !all ? " clamp" : ""}`} key={answer.text}>
          {(() => {
            // The words come in one after another, like being said (the first 60; the rest together).
            let n = 0;
            const words = (t: string) => t.split(/(\s+)/).map((w, j) => (/^\s+$/.test(w) || !w ? w : <span key={j} className="w" style={{ animationDelay: `${Math.min(n++, 60) * 28}ms` }}>{w}</span>));
            return lines.map((l, i) => {
              // "project: what happened" reads best with the project in bold.
              const m = /^([^:]{1,32}):\s(.+)$/.exec(l);
              return <p key={i}>{m && i > 0 ? (<><b>{words(m[1])}</b> {words(m[2])}</>) : words(l)}</p>;
            });
          })()}
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
