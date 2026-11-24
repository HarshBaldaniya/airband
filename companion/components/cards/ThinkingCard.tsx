import { useEffect, useState } from "react";

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
