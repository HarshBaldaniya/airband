// The phone page: the companion at the top, then the same panel as on the computer, full screen.
import { useState } from "react";
import { Companion } from "../companion/Companion";
import { useCompanionState } from "../companion/useCompanionState";
import { AnswerCard } from "../components/Cards";
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
      {error && <AnswerCard answer={{ text: error, via: "action" }} onClose={() => setError(undefined)} onChoose={() => undefined} />}
      {c.answer && <AnswerCard answer={c.answer} onClose={c.clearAnswer} onChoose={(q) => void c.ask(q)} />}
      {state && <Panel state={state} name={c.name} design={c.design} onAsk={(q) => void c.ask(q)} asking={c.asking} onSay={c.say} onError={setError} />}
    </div>
  );
}
