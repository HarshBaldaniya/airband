// The first-run setup, in the app itself (before Airband's engine is there). Three screens:
// welcome; setting up, one checklist that runs by itself and never blocks; and ready: where Roger
// lives, or what is left. Calm, little text, one button at a time. After it, Roger says hello from
// his corner.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Checklist } from "./screens/Checklist";
import { Ready } from "./screens/Ready";
import { Welcome } from "./screens/Welcome";
import type { Result } from "./types";
import "./setup.css";

type Screen = "welcome" | "setup" | "ready";

function Tour() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [result, setResult] = useState<Result>();
  return (
    <div className="tour" key={screen}>
      <div className="drag" data-tauri-drag-region />
      {screen === "welcome" && <Welcome onStart={() => setScreen("setup")} />}
      {screen === "setup" && <Checklist onDone={(r) => (setResult(r), setScreen("ready"))} />}
      {screen === "ready" && result && <Ready result={result} onBack={() => setScreen("setup")} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Tour />);
