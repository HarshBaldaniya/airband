// The phone page: the companion at the top, then the same panel as on the computer, full screen.
import { useState } from "react";
import { Companion } from "../companion/Companion";
import { useCompanionState } from "../companion/useCompanionState";
import { Conversation } from "../components/Conversation";
import { Panel } from "../components/Panel";
import { useStation } from "./useStation";

export function PhoneView() {
  const { state, link } = useStation();
  const c = useCompanionState(state);
  const [error, setError] = useState<string>();
  return (
    <div className="phonepage">
      <header className="phonehead">
        <Companion mood={c.mood} name={c.name || "Airband"} design={c.design} size={60} count={state?.pending.length ?? 0} />
        <div>
          <b>{c.name || "Airband"}</b>
          <span className="muted">{state?.headline ?? "Connecting to your computer…"}</span>
        </div>
      </header>
      {!link && <p className="offline">Can't reach your computer. Is it awake and on the same Wi-Fi?</p>}
      {state && <Panel state={state} name={c.name} design={c.design} onAsk={(q) => void c.ask(q)} asking={c.asking} onSay={c.say} onError={setError} answer={<Conversation name={c.name} asking={c.asking} question={c.question} answer={c.answer} error={error} onClose={c.clearAnswer} onCloseError={() => setError(undefined)} onAsk={(q) => void c.ask(q)} />} />}
    </div>
  );
}
