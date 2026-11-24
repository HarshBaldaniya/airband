import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { sounds } from "../../sound";

/** How long the check shows after a save. */
const SAVED_MS = 900;

type Saving = "idle" | "busy" | "done";

/** A switch that shows its own progress: a short pulse while it saves, then a check. No message. */
export function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => Promise<unknown> | void }) {
  const [saving, setSaving] = useState<Saving>("idle");
  const [shown, setShown] = useState(on);
  useEffect(() => setShown(on), [on]);
  // The check shows for a moment after a save.
  useEffect(() => {
    if (saving !== "done") return;
    const t = setTimeout(() => setSaving("idle"), SAVED_MS);
    return () => clearTimeout(t);
  }, [saving]);
  const flip = async () => {
    const next = !shown;
    setShown(next);
    (next ? sounds.on : sounds.off)();
    setSaving("busy");
    try {
      await onChange(next);
      setSaving("done");
    } catch {
      setShown(!next);
      setSaving("idle");
    }
  };
  return (
    <span className="togglewrap">
      <span className={`saved${saving === "done" ? " show" : ""}`} aria-hidden="true">
        <Check size={13} />
      </span>
      <button role="switch" aria-checked={shown} aria-label={label} aria-busy={saving === "busy"} className={`toggle${shown ? " on" : ""}${saving === "busy" ? " busy" : ""}`} onClick={() => void flip()}>
        <span />
      </button>
    </span>
  );
}
