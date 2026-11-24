// The last screen: where Roger lives, or what is left to do.
import { useState } from "react";
import { Companion } from "../../../companion/figure/Companion";
import { AgentTiles } from "../components/AgentTiles";
import { Desk } from "../components/Desk";
import { Footer } from "../components/Footer";
import { Line } from "../components/Line";
import { call } from "../tauri";
import type { Key, Result } from "../types";

/** What is left, as the last screen names it. */
const LEFT: Record<Key, string> = { computer: "AI coding tool", node: "Node.js", engine: "Airband engine", connect: "Connect your tools" };

export function Ready({ result, onBack }: { result: Result; onBack: () => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const mac = result.scan.os === "mac";
  // Only what is itself missing: "connect" waiting on another line is that line's.
  const left = (Object.keys(result.items) as Key[]).filter((k) => result.items[k].state !== "done" && result.items[k].state !== "waiting");
  /** The engine can run now, so Roger comes as soon as the tour closes. */
  const runs = result.items.engine.state === "done" && result.items.node.state === "done";
  const start = () => {
    setStarting(true);
    call("finish").catch((e) => (setError(String(e)), setStarting(false)));
  };
  return (
    <div className="screen">
      {left.length === 0 ? (
        <div className="body center">
          <Desk os={result.scan.os} />
          <h1>You're all set</h1>
          <p className="lede">I live in the corner of your screen. Click me to see your chats or ask me anything.</p>
          <div className="tiles">
            <div>
              <kbd>{mac ? "⌥⌘R" : "Alt+Ctrl+R"}</kbd>
              <span>Show or hide me</span>
            </div>
            <div>
              <b>{mac ? "iPhone" : "Settings"}</b>
              <span>{mac ? "Link it in my settings" : "Sounds, alerts, start at login"}</span>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="body center">
          <Companion mood="thinking" name="Roger" size={72} />
          <h1>Almost there</h1>
          <p className="lede">
            {runs
              ? "I can start now. Once this is done, run the setup tour again from my menu."
              : `I start once ${result.items.node.state !== "done" ? "Node.js" : "the engine"} is there. Until then I wait in the ${mac ? "menu bar" : "system tray"}, where Set up Airband… finishes it.`}
          </p>
          <ul className="lines left">
            {left.map((k) => (
              <Line key={k} label={LEFT[k]} item={{ state: "needs", note: k === "computer" ? "None yet" : result.items[k].note }}>
                {k === "computer" && <AgentTiles scan={result.scan} />}
              </Line>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
        </div>
      )}
      <Footer at={3}>
        {left.length > 0 && (
          <button className="ghost" onClick={onBack}>
            Back
          </button>
        )}
        <button className="primary" disabled={starting} onClick={start}>
          {starting ? "Starting…" : runs ? "Start Airband" : "Finish"}
        </button>
      </Footer>
    </div>
  );
}
