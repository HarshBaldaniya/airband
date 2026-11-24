import { sounds } from "../../sound";

/** A few things to ask with one click, when nothing else is showing. */
const QUICK = [
  { label: "What's happening?", ask: "what's happening?" },
  { label: "What did I do today?", ask: "what did I do today?" },
  { label: "Tell me a joke", ask: "tell me a joke" },
];

export function QuickAsks({ name, onAsk }: { name: string; onAsk: (q: string) => void }) {
  return (
    <div className="quickasks" role="group" aria-label={`Ask ${name}`}>
      {QUICK.map((q) => (
        <button key={q.ask} className="chip" onClick={() => (sounds.tick(), onAsk(q.ask))}>
          {q.label}
        </button>
      ))}
    </div>
  );
}
