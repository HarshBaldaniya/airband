// The phone app, served by Airband's relay and added to the Home Screen. It shows what needs you and
// what finished, on your linked computer, from anywhere. It answers requests (Allow, Always, Deny,
// a question's choices) and nothing else: asking, messaging a chat and settings stay on the computer.
import { useCallback, useEffect, useState } from "react";
import { BellRing, Share, SquarePlus, Smartphone } from "lucide-react";
import { parsePairing, type Pairing } from "../../../src/remote/box";
import { setTransport } from "../api";
import { Companion } from "../companion/Companion";
import { useCompanionState } from "../companion/useCompanionState";
import { Panel } from "../components/Panel";
import { useStation } from "../views/useStation";
import { RelayLink } from "./relay";
import { Scanner } from "./Scanner";
import { get, phoneId, put, savedPairing, savePairing } from "./store";

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const pushable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const deviceName = () => (/iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android phone" : "Phone");

/** Rooms this phone was unlinked from: an old Home Screen address that still carries one is ignored. */
const retired = async () => (await get<string[]>("retired")) ?? [];
async function retire(room: string): Promise<void> {
  await put("retired", [...(await retired()), room].slice(-20));
}

export function PhoneApp() {
  const [pairing, setPairing] = useState<Pairing | null>();
  useEffect(() => {
    void (async () => {
      const fromLink = parsePairing(location.hash);
      if (fromLink && !(await retired()).includes(fromLink.room)) {
        await savePairing(fromLink);
        // In Safari on an iPhone the address keeps the code: "Add to Home Screen" saves the address,
        // and the Home Screen app keeps its own storage, so it reads the code from there.
        if (!(ios() && !installed())) history.replaceState(null, "", "/");
        return setPairing(fromLink);
      }
      setPairing((await savedPairing()) ?? null);
    })();
  }, []);
  const linked = useCallback(async (p: Pairing) => {
    const old = await savedPairing();
    if (old && old.room !== p.room) await retire(old.room);
    await savePairing(p);
    history.replaceState(null, "", "/");
    setPairing(p);
  }, []);
  const unlinked = useCallback(async (why?: string) => {
    const old = await savedPairing();
    if (old) await retire(old.room);
    await savePairing(undefined);
    history.replaceState(null, "", why ? `/?ended=1` : "/");
    setPairing(null);
  }, []);
  if (pairing === undefined) return <div className="phonepage" />;
  if (!pairing) return <LinkScreen onLinked={linked} />;
  return <Linked key={pairing.room} pairing={pairing} onUnlinked={unlinked} />;
}

function LinkScreen({ onLinked }: { onLinked: (p: Pairing) => void }) {
  const [scanning, setScanning] = useState(false);
  const ended = new URLSearchParams(location.search).has("ended");
  if (scanning) return <Scanner onFound={onLinked} onClose={() => setScanning(false)} />;
  return (
    <div className="phonepage linkscreen">
      <Companion mood="hello" name="Airband" size={96} />
      <h1>Link your phone</h1>
      {ended && <p className="offline">This phone was unlinked on your computer.</p>}
      <ol className="steps">
        <li>On your computer, click Roger, then the gear.</li>
        <li>Next to Your phone, choose Link.</li>
        <li>Scan the code that appears.</li>
      </ol>
      <button className="btn primary wide" onClick={() => setScanning(true)}>
        Scan the code
      </button>
    </div>
  );
}

function Linked({ pairing, onUnlinked }: { pairing: Pairing; onUnlinked: (why?: string) => void }) {
  const [link, setLink] = useState<RelayLink>();
  useEffect(() => {
    let live = true;
    void (async () => {
      const l = await RelayLink.open(pairing);
      // Ended on the computer: back to linking, without trying again and again.
      const check = await fetch(`/r/${pairing.room}/check`, { method: "POST", headers: { "x-room-token": l.token } }).catch(() => undefined);
      if (!live) return;
      if (check && (check.status === 410 || check.status === 403)) return onUnlinked("ended");
      setTransport(l);
      setLink(l);
    })();
    return () => {
      live = false;
    };
  }, [pairing, onUnlinked]);
  if (!link) return <div className="phonepage" />;
  return <LinkedView link={link} pairing={pairing} onUnlinked={onUnlinked} />;
}

function LinkedView({ link, pairing, onUnlinked }: { link: RelayLink; pairing: Pairing; onUnlinked: (why?: string) => void }) {
  const { state, link: up } = useStation();
  const c = useCompanionState(state);
  const [note, setNote] = useState<string>();
  const unlink = async () => {
    if (!confirm("Unlink this phone? It stops getting alerts. You can link it again from your computer.")) return;
    await link.forget(await phoneId());
    try {
      await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription().then((s) => s?.unsubscribe());
    } catch {
      // No alerts were on.
    }
    onUnlinked();
  };
  return (
    <div className="phonepage">
      <header className="phonehead">
        <Companion mood={up ? c.mood : "resting"} name={c.name || "Airband"} design={c.design} size={60} count={state?.pending.length ?? 0} />
        <div>
          <b>{c.name || "Airband"}</b>
          <span className="muted">{up ? (state?.headline ?? "Connecting…") : "Your computer is offline."}</span>
        </div>
      </header>
      {!up && state && <p className="offline">Requests wait on your computer until it's back. This page shows them again when it is.</p>}
      <Alerts link={link} pairing={pairing} up={up} onError={setNote} />
      {note && (
        <p className="offline" role="alert" onClick={() => setNote(undefined)}>
          {note}
        </p>
      )}
      {state && <Panel state={state} name={c.name} design={c.design} onSay={setNote} onError={setNote} />}
      <footer className="phonefoot">
        <button className="linkbtn" onClick={() => void unlink()}>
          Unlink this phone
        </button>
      </footer>
    </div>
  );
}

/** Alerts on the Lock Screen: on an iPhone only from the Home Screen app, and after a tap to allow. */
function Alerts({ link, pairing, up, onError }: { link: RelayLink; pairing: Pairing; up: boolean; onError: (m: string) => void }) {
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pushable()) return setOn(true);
    void (async () => {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setOn(Notification.permission === "granted" && !!sub && (await get<string>("alertsKey")) === pairing.vapid);
    })().catch(() => setOn(false));
  }, [pairing.vapid]);
  if (ios() && !installed())
    return (
      <div className="card hint">
        <b>
          <Smartphone size={16} /> Get alerts on this iPhone
        </b>
        <ol className="steps">
          <li>
            Tap <Share size={15} aria-label="Share" /> below.
          </li>
          <li>
            Choose <SquarePlus size={15} aria-hidden="true" /> Add to Home Screen.
          </li>
          <li>Open Airband from your Home Screen.</li>
        </ol>
      </div>
    );
  if (on !== false) return null;
  const turnOn = async () => {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Alerts are off for Airband. Turn them on in Settings, then Notifications.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const { fromB64u } = await import("../../../src/remote/box");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(pairing.vapid) as BufferSource });
      await link.subscribe(await phoneId(), deviceName(), sub.toJSON());
      await put("alertsKey", pairing.vapid);
      setOn(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card hint">
      <b>
        <BellRing size={16} /> Get an alert when a chat needs you
      </b>
      <span className="muted">Only when you're away from your computer.</span>
      <button className="btn primary wide" disabled={busy || !up} onClick={() => void turnOn()}>
        {busy ? "Turning on…" : up ? "Turn on alerts" : "Waiting for your computer…"}
      </button>
    </div>
  );
}
