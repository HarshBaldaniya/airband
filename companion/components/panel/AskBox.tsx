import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

/** Ask the companion anything, on the computer. */
export function AskBox({ name, onAsk, busy }: { name: string; onAsk: (q: string) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        if (!q.trim() || busy) return;
        onAsk(q.trim());
        setQ("");
      }}
    >
      <label className="sr" htmlFor="ask">
        Ask {name}
      </label>
      <input id="ask" ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder={busy ? `${name} is looking…` : `Ask ${name}…`} disabled={busy} />
      <button className="btn primary" type="submit" disabled={busy || !q.trim()} aria-label="Ask">
        <Send size={14} />
      </button>
    </form>
  );
}
