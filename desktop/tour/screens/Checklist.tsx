// Setting up: one checklist that runs by itself and never blocks. A missing or old Node, no AI tool,
// a failed download each say what they need, and Continue still works.
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentTiles } from "../components/AgentTiles";
import { Footer } from "../components/Footer";
import { Line } from "../components/Line";
import { call, listen, openUrl } from "../tauri";
import type { Connected, Item, Key, Result, Scan } from "../types";

/** The scan takes at least this long, so its line doesn't flash. */
const SCAN_MIN_MS = 700;
const CONNECT_MIN_MS = 500;
/** With no AI tool yet, the computer is looked at again this often. */
const LOOK_AGAIN_MS = 4000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function Checklist({ onDone }: { onDone: (r: Result) => void }) {
  const [scan, setScan] = useState<Scan>();
  const [items, setItems] = useState<Record<Key, Item>>({ computer: { state: "working" }, node: { state: "waiting" }, engine: { state: "waiting" }, connect: { state: "waiting" } });
  const [connected, setConnected] = useState<Connected>();
  const [running, setRunning] = useState(true);
  const progress = useRef<Record<string, number>>({});
  const set = (k: Key, v: Item) => setItems((was) => ({ ...was, [k]: v }));

  // The app reports each download's progress.
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
    const [s] = await Promise.all([call<Scan>("scan"), wait(SCAN_MIN_MS)]);
    setScan(s);
    const found = s.agents.filter((a) => a.found).map((a) => a.name);
    set("computer", found.length ? { state: "done", note: `${list(found)} found` } : { state: "needs", note: "None yet" });
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
        const [c] = await Promise.all([call<Connected>("connect_agents"), wait(CONNECT_MIN_MS)]);
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

  // With no AI tool yet, it is looked for again every few seconds: one installed while this window
  // is open shows up by itself, and the rest of the setup carries on.
  const lacking = items.computer.state === "needs" && !running;
  useEffect(() => {
    if (!lacking) return;
    let busy = false;
    const id = setInterval(async () => {
      if (busy) return;
      busy = true;
      const s = await call<Scan>("scan").catch(() => undefined);
      busy = false;
      if (s?.agents.some((a) => a.found)) {
        clearInterval(id);
        void run();
      }
    }, LOOK_AGAIN_MS);
    return () => clearInterval(id);
  }, [lacking, run]);

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
          <Line label="AI coding tool" item={items.computer}>
            {items.computer.state === "needs" && scan && <AgentTiles scan={scan} watching />}
          </Line>
          <Line label="Node.js" item={items.node}>
            {items.node.state === "needs" && scan && (
              <>
                <p className="say">Airband needs version {scan.node_min} or newer. Its own copy leaves yours as it is.</p>
                <p>
                  <button className="small" disabled={running} onClick={() => void installNode()}>
                    {nodeOld ? "Get a newer one" : "Install Node.js"}
                  </button>
                  <button className="link" onClick={() => openUrl("https://nodejs.org")}>
                    or {nodeOld ? "update" : "install"} it yourself
                  </button>
                </p>
              </>
            )}
          </Line>
          <Line label="Airband engine" item={items.engine} />
          <Line label="Connect your tools" item={items.connect}>
            {(connected?.command === "added" || connected?.command === "updated" || connected?.command === "there") && <p>The airband command works in any new terminal.</p>}
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
