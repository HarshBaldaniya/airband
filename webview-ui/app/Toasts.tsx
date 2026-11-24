// Short notes from the extension in the corner: what just happened, with Undo when it can be put back.
// Each goes by itself after a few seconds, and a new one replaces the last.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Info, Link2, Pause, Play, RefreshCw, Unlink, X } from "lucide-react";
import type { ToWebview } from "../../src/vscode/protocol";
import { onMessage, send } from "../lib/vscode";
import { useSetModal } from "./ModalContext";

type ToastMsg = Extract<ToWebview, { type: "toast" }>;
interface Toast extends ToastMsg {
  id: number;
  ms: number;
}

const ICON = { link: Link2, unlink: Unlink, pause: Pause, play: Play, sync: RefreshCw, info: Info } as const;
/** Long enough to read, and longer with Undo, so there is time to press it. */
const SHOWN_MS = 5500;
const UNDO_MS = 8000;

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const setModal = useSetModal();
  useEffect(() => {
    let n = 0;
    return onMessage((msg) => {
      if (msg.type !== "toast") return;
      // The answer to whatever was loading has come.
      setModal((m) => (m?.kind === "loading" ? null : m));
      setToasts([{ ...msg, id: ++n, ms: msg.undo ? UNDO_MS : SHOWN_MS }]);
    });
  }, [setModal]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} dismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({ t, dismiss: dismissId }: { t: Toast; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissId(t.id), t.ms);
    return () => clearTimeout(timer);
  }, [t.id, t.ms, dismissId]);
  const dismiss = () => dismissId(t.id);
  const Icon = t.tone === "warn" ? AlertTriangle : ICON[t.icon ?? "info"];
  return (
    <div className={`toast ${t.tone ?? "ok"} ${t.icon ?? ""}`} onClick={(e) => e.target === e.currentTarget && dismiss()}>
      <span className="toasticon" aria-hidden="true">
        <Icon size={15} strokeWidth={2} />
      </span>
      <div className="toastbody">
        {t.title && <b>{t.title}</b>}
        <span>{t.text}</span>
      </div>
      {t.undo && (
        <button
          className="toastundo"
          onClick={() => {
            send(t.undo!);
            dismiss();
          }}
        >
          Undo
        </button>
      )}
      <button className="icon sm toastclose" onClick={dismiss} aria-label="Dismiss">
        <X size={13} />
      </button>
      <span className="toastbar" style={{ animationDuration: `${t.ms}ms` }} aria-hidden="true" />
    </div>
  );
}
