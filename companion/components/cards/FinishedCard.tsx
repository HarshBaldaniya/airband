// A chat that finished: a card on the phone and in the panel, a short toast by the companion.
import { CircleCheck, Eye, X } from "lucide-react";
import { api, type FinishedView } from "../../api/station";
import { AgentMark } from "../AgentMark";
import { CardHead } from "./CardHead";

export function FinishedCard({ finished }: { finished: FinishedView }) {
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

/** A chat that finished, as one line by the companion: it fades away by itself (the panel keeps it). */
export function FinishedToast({ finished, onClose }: { finished: FinishedView; onClose: () => void }) {
  const f = finished;
  return (
    <div className="toast" data-hit>
      <CircleCheck size={16} className="toasticon" />
      <AgentMark agent={f.agent} />
      <span className="toasttext ellipsis">
        <b>{f.title}</b> {f.yours ? "· your turn" : "finished"}
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
