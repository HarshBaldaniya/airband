// The first-run setup, in the app itself (before Airband's engine is there). Three screens:
// welcome; setting up, one checklist that runs by itself and never blocks (a missing or old Node,
// no AI tool, a failed download each say what they need, and Continue still works); and ready:
// where Roger lives, or what is left. Calm, little text, one button at a time. After it, Roger says hello
// from his corner.
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Companion } from "../../companion/figure/Companion";
import "./setup.css";

interface Found { name: string; found: boolean; detail?: string | null; link: string }
interface Scan { os: "mac" | "windows" | "linux"; node?: string | null; node_ok: boolean; node_min: number; own_node: boolean; engine?: string | null; agents: Found[]; editors: Found[] }
interface Connected { agents: string[]; codexTrust: boolean; list: { id: string; name: string; tools: boolean; sharing: boolean }[] }

const T = (window as unknown as { __TAURI_INTERNALS__: { invoke<R>(cmd: string, args?: unknown): Promise<R>; transformCallback(cb: (e: { payload: unknown }) => void): number } }).__TAURI_INTERNALS__;
const call = <R,>(cmd: string, args?: unknown) => T.invoke<R>(cmd, args ?? {});
const listen = (event: string, cb: (p: unknown) => void) => void T.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler: T.transformCallback((e) => cb(e.payload)) });
const open = (url: string) => void call("open_url", { url });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

type Screen = "welcome" | "setup" | "ready";
type State = "waiting" | "working" | "done" | "needs" | "failed";
type Key = "computer" | "node" | "engine" | "connect";

interface Item {
  state: State;
  /** What it says on the right: a version, how far, what's wrong. */
  note?: string;
}

function Status({ state }: { state: State }) {
  return <span className={`status ${state}`} aria-label={state}>{state === "done" ? "✓" : state === "needs" || state === "failed" ? "!" : ""}</span>;
}

function Line({ label, item, children }: { label: string; item: Item; children?: React.ReactNode }) {
  return (
    <li className={`line ${item.state}`}>
      <Status state={item.state} />
      <span className="label">{label}</span>
      <span className="note">{item.note}</span>
      {children && <div className="more">{children}</div>}
    </li>
  );
}

function Footer({ at, children }: { at: number; children: React.ReactNode }) {
  return (
    <footer>
      <span className="step">{at} of 3</span>
      {children}
    </footer>
  );
}

/** What the checklist found, for the last screen. */
interface Result { scan: Scan; items: Record<Key, Item> }

function Setup({ onDone }: { onDone: (r: Result) => void }) {
  const [scan, setScan] = useState<Scan>();
  const [items, setItems] = useState<Record<Key, Item>>({ computer: { state: "working" }, node: { state: "waiting" }, engine: { state: "waiting" }, connect: { state: "waiting" } });
  const [connected, setConnected] = useState<Connected>();
  const [running, setRunning] = useState(true);
  const progress = useRef<Record<string, number>>({});
  const set = (k: Key, v: Item) => setItems((was) => ({ ...was, [k]: v }));

  useEffect(
    () =>
      listen("setup-progress", (p) => {
        const e = p as { step: "node" | "engine"; got: number; total: number };
        const pct = Math.min(99, Math.round((e.got / e.total) * 100));
        if (progress.current[e.step] === pct) return;
        progress.current[e.step] = pct;
        set(e.step, { state: "working", note: `Downloading ${pct}%` });
      }),
    [],
  );

  /** The whole setup, in order. Nothing missing stops it: each line says what it needs, and
   *  everything that can still be done is. */
  const run = useCallback(async () => {
    setRunning(true);
    set("computer", { state: "working", note: "Looking…" });
    const [s] = await Promise.all([call<Scan>("scan"), wait(700)]);
    setScan(s);
    const found = s.agents.filter((a) => a.found).map((a) => a.name);
    set("computer", found.length ? { state: "done", note: `${list(found)} found` } : { state: "needs", note: "No AI coding tool yet" });
    set("node", s.node_ok ? { state: "done", note: s.node! } : { state: "needs", note: s.node ? `${s.node} is too old` : "Not installed" });
    // The engine downloads without Node; only running it needs Node.
    let engine = s.engine;
    if (!engine) {
      set("engine", { state: "working", note: "Downloading…" });
      try {
        engine = await call<string>("install_engine");
      } catch (e) {
        engine = null;
        set("engine", { state: "failed", note: String(e) });
      }
    }
    if (engine) set("engine", { state: "done", note: `Version ${engine}` });
    if (!found.length) set("connect", { state: "waiting", note: "After you install one" });
    else if (!s.node_ok) set("connect", { state: "waiting", note: "After Node.js" });
    else if (!engine) set("connect", { state: "waiting", note: "After the engine" });
    else {
      set("connect", { state: "working", note: "Connecting…" });
      try {
        const [c] = await Promise.all([call<Connected>("connect_agents"), wait(500)]);
        setConnected(c);
        const ok = c.list.filter((a) => a.tools && a.sharing).map((a) => a.name);
        set("connect", ok.length ? { state: "done", note: list(ok) } : { state: "failed", note: "Couldn't connect" });
      } catch (e) {
        set("connect", { state: "failed", note: String(e) });
      }
    }
    setRunning(false);
  }, []);

  useEffect(() => void run(), [run]);

  const installNode = async () => {
    setRunning(true);
    set("node", { state: "working", note: "Downloading…" });
    try {
      await call("install_node");
      void run();
    } catch (e) {
      set("node", { state: "failed", note: String(e) });
      setRunning(false);
    }
  };

  const left = (Object.keys(items) as Key[]).filter((k) => items[k].state !== "done");
  const nodeOld = !!scan?.node && !scan.node_ok;

  return (
    <div className="screen">
      <div className="body">
        <h1>Setting up</h1>
        <p className="lede">Everything comes from its official source and is checked before it runs.</p>
        <ul className="lines">
          <Line label="Your computer" item={items.computer}>
            {items.computer.state === "needs" && scan && <Tools scan={scan} />}
          </Line>
          <Line label="Node.js" item={items.node}>
            {items.node.state === "needs" && scan && (
              <>
                <p className="say">Airband needs version {scan.node_min} or newer. Its own copy leaves yours as it is.</p>
                <p>
                  <button className="small" disabled={running} onClick={() => void installNode()}>
                    {nodeOld ? "Get a newer one" : "Install Node.js"}
                  </button>
                  <button className="link" onClick={() => open("https://nodejs.org")}>
                    or {nodeOld ? "update" : "install"} it yourself
                  </button>
                </p>
              </>
            )}
          </Line>
          <Line label="Airband engine" item={items.engine} />
          <Line label="Connect your tools" item={items.connect}>
            {connected?.codexTrust && <p>In Codex, type /hooks once and trust Airband.</p>}
          </Line>
        </ul>
      </div>
      <Footer at={2}>
        {!running && left.length > 0 && (
          <button className="ghost" onClick={() => void run()}>
            Check again
          </button>
        )}
        <button className="primary" disabled={running || !scan} onClick={() => scan && onDone({ scan, items })}>
          {!running && left.length ? "Continue anyway" : "Continue"}
        </button>
      </Footer>
    </div>
  );
}

/** "Airband works with Claude Code, Codex or Gemini CLI", each a link to where it comes from. */
function Tools({ scan }: { scan: Scan }) {
  return (
    <p className="say">
      Airband works with{" "}
      {scan.agents.map((a, i) => (
        <span key={a.name}>
          <button className="link" onClick={() => open(a.link)}>
            {a.name}
          </button>
          {i < scan.agents.length - 2 ? ", " : i === scan.agents.length - 2 ? " or " : "."}
        </span>
      ))}
    </p>
  );
}

/** A small picture of the screen with Roger in his corner: where to find him. */
function Desk({ os }: { os: Scan["os"] }) {
  return (
    <div className={`desk ${os}`} aria-hidden>
      <div className="bar">
        <i />
        <i />
        <i className="me" />
      </div>
      <div className="win" />
      <div className="roger">
        <Companion mood="hello" name="Roger" size={40} />
      </div>
    </div>
  );
}

/** What is left, as the last screen names it. */
const LEFT: Record<Key, string> = { computer: "AI coding tool", node: "Node.js", engine: "Airband engine", connect: "Connect your tools" };

function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [result, setResult] = useState<Result>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const mac = result?.scan.os === "mac";
  // Only what is itself missing: "connect" waiting on another line is that line's.
  const left = result ? (Object.keys(result.items) as Key[]).filter((k) => result.items[k].state !== "done" && result.items[k].state !== "waiting") : [];
  /** The engine can run now, so Roger comes as soon as the tour closes. */
  const runs = !!result && result.items.engine.state === "done" && result.items.node.state === "done";
  const start = () => {
    setStarting(true);
    call("finish").catch((e) => (setError(String(e)), setStarting(false)));
  };
  return (
    <div className="tour" key={screen}>
      <div className="drag" data-tauri-drag-region />
      {screen === "welcome" && (
        <div className="screen">
          <div className="body center">
            <Companion mood="hello" name="Roger" size={96} />
            <h1>Welcome to Airband</h1>
            <p className="lede">I'm Roger. I keep an ear on your AI coding chats and let you know the moment one needs you.</p>
          </div>
          <Footer at={1}>
            <button className="primary" onClick={() => setScreen("setup")}>
              Get started
            </button>
          </Footer>
        </div>
      )}
      {screen === "setup" && <Setup onDone={(r) => (setResult(r), setScreen("ready"))} />}
      {screen === "ready" && result && (
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
                    {k === "computer" && <Tools scan={result.scan} />}
                  </Line>
                ))}
              </ul>
              {error && <p className="error">{error}</p>}
            </div>
          )}
          <Footer at={3}>
            {left.length > 0 && (
              <button className="ghost" onClick={() => setScreen("setup")}>
                Back
              </button>
            )}
            <button className="primary" disabled={starting} onClick={start}>
              {starting ? "Starting…" : runs ? "Start Airband" : "Finish"}
            </button>
          </Footer>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
