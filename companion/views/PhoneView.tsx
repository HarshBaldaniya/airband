// The phone page: the companion at the top, then the panel, full screen. It answers requests
// (Allow, Deny, Always, a question's choices) and shows what finished. Nothing is typed here:
// asking and telling a chat stay on the computer.
import { useState } from "react";
import { Companion } from "../figure/Companion";
import { Panel } from "../components/panel/Panel";
import { useCompanionState } from "../state/useCompanionState";
import { useStation } from "../state/useStation";

export function PhoneView() {
  const { state, link } = useStation();
  const c = useCompanionState(state);
  const [note, setNote] = useState<string>();
  return (
    <div className="phonepage">
      <header className="phonehead">
        <Companion mood={c.mood} name={c.name || "Airband"} design={c.design} size={60} count={state?.pending.length ?? 0} />
        <div>
          <b>{c.name || "Airband"}</b>
          <span className="muted">{state?.headline ?? "Connecting to your computer…"}</span>
        </div>
      </header>
      {!link && <p className="offline">Can't reach Airband's Station. Is it still running?</p>}
      {note && (
        <p className="offline" role="alert" onClick={() => setNote(undefined)}>
          {note}
        </p>
      )}
      {state && <Panel state={state} name={c.name} design={c.design} onSay={setNote} onError={setNote} />}
    </div>
  );
}
