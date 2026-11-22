// The phone app, served by Airband's relay and added to the Home Screen. It shows what needs you and
// what finished, on your linked computer, from anywhere. It answers requests (Allow, Always, Deny,
// a question's choices) and nothing else: asking, messaging a chat and settings stay on the computer.
import { useCallback, useEffect, useState } from "react";
import { BellRing, Share, SquarePlus, Smartphone } from "lucide-react";
import { parsePairing, type Pairing } from "../../src/remote/box";
import { setTransport } from "../api";
import { Companion } from "../companion/Companion";
import { useCompanionState } from "../companion/useCompanionState";
import { useStation } from "../views/useStation";
import { PhoneHome } from "./PhoneHome";
import { RelayLink } from "./relay";
import { Scanner } from "./Scanner";
import { get, phoneId, put, savedPairing, savePairing } from "./store";

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** Airband's phone link is for an iPhone (iPhone, or an iPad acting as one: same Safari, same alerts). */
const iphone = () => ios();
const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const pushable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const deviceName = () => (/iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad" : "iPhone");

/** Rooms this phone is done with (a used-up code, an ended link): an old address carrying one is ignored. */
const retired = async () => (await get<string[]>("retired")) ?? [];
async function retire(room: string): Promise<void> {
  await put("retired", [...(await retired()), room].slice(-20));
}

export function PhoneApp() {
  const [pairing, setPairing] = useState<Pairing | null>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void (async () => {
      const saved = await savedPairing();
      const fromLink = parsePairing(location.hash);
      // A fresh code in the address (just scanned with the Camera) comes first; a used one is ignored.
      if (fromLink && !(await retired()).includes(fromLink.room) && fromLink.room !== saved?.room) return setPairing(fromLink);
      if (fromLink && !(ios() && !installed())) history.replaceState(null, "", "/");
      setPairing(saved ?? null);
    })();
  }, []);
  /** The code worked: this iPhone's own room and secret. The code is retired here and gone on the relay. */
  const claimed = useCallback(async (code: Pairing, own: Pairing) => {
    const old = await savedPairing();
    if (old && old.room !== own.room) await retire(old.room);
    await retire(code.room);
    await savePairing(own);
    history.replaceState(null, "", "/");
    setError(undefined);
    setPairing(own);
  }, []);
  const unlinked = useCallback(async (why?: string) => {
    const old = await savedPairing();
    if (old) await retire(old.room);
    await savePairing(undefined);
    history.replaceState(null, "", "/");
    setError(why);
    setPairing(null);
  }, []);
  const failed = useCallback(async (code: Pairing, why: string) => {
    await retire(code.room);
    history.replaceState(null, "", "/");
    setError(why);
    setPairing((await savedPairing()) ?? null);
  }, []);
  if (!iphone()) return <NotIPhone />;
  if (pairing === undefined) return <div className="phonepage" />;
  if (!pairing) return <LinkScreen error={error} onScanned={setPairing} />;
  // A code: in Safari it only shows how to add Airband to the Home Screen; the Home Screen app claims it.
  if (!pairing.claimed) return ios() && !installed() ? <InstallScreen /> : <Claim key={pairing.room} code={pairing} onClaimed={claimed} onFailed={failed} />;
  return <Linked key={pairing.room} pairing={pairing} onUnlinked={unlinked} />;
}

function NotIPhone() {
  return (
    <div className="phonepage linkscreen">
      <Companion mood="idle" name="Airband" size={96} />
      <h1>Open this on your iPhone</h1>
      <p className="muted lead">Airband's phone link connects your Mac and your iPhone, and nothing else. Scan the code on your Mac with your iPhone's camera.</p>
    </div>
  );
}

function InstallScreen() {
  return (
    <div className="phonepage linkscreen">
      <Companion mood="hello" name="Airband" size={96} />
      <h1>Add Airband to your Home Screen</h1>
      <ol className="steps">
        <li>
          Tap <Share size={16} aria-label="Share" /> below.
        </li>
        <li>
          Choose <SquarePlus size={16} aria-hidden="true" /> Add to Home Screen, then Add.
        </li>
        <li>Open Airband from your Home Screen. It links by itself.</li>
      </ol>
      <p className="muted lead">Already have Airband on your Home Screen? Open it and tap Scan the code.</p>
    </div>
  );
}

function LinkScreen({ error, onScanned }: { error?: string; onScanned: (p: Pairing) => void }) {
  const [scanning, setScanning] = useState(false);
  if (scanning) return <Scanner onFound={onScanned} onClose={() => setScanning(false)} />;
  return (
    <div className="phonepage linkscreen">
      <Companion mood="hello" name="Airband" size={96} />
      <h1>Link your iPhone</h1>
      {error && <p className="offline">{error}</p>}
      <ol className="steps">
        <li>On your Mac, click Roger, then the gear.</li>
        <li>Next to Your phone, choose Link.</li>
        <li>Scan the code that appears.</li>
      </ol>
      <button className="btn primary wide" onClick={() => setScanning(true)}>
        Scan the code
      </button>
    </div>
  );
}

/** Takes the link with a scanned code, once: the Mac answers with this iPhone's own secret. */
function Claim({ code, onClaimed, onFailed }: { code: Pairing; onClaimed: (code: Pairing, own: Pairing) => void; onFailed: (code: Pairing, why: string) => void }) {
  useEffect(() => {
    let live = true;
    void (async () => {
      const l = await RelayLink.open(code);
      const check = await fetch(`/r/${code.room}/check`, { method: "POST", headers: { "x-room-token": l.token } }).catch(() => undefined);
      if (!live) return;
      if (check && check.status !== 200) return onFailed(code, "This code was already used, or it ran out. Make a new one on your Mac.");
      try {
        await l.open();
        const own = await l.claim(await phoneId(), deviceName());
        l.close();
        if (live) onClaimed(code, { room: own.room, secret: own.secret, vapid: code.vapid, claimed: true });
      } catch (e) {
        l.close();
        if (live) onFailed(code, e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [code, onClaimed, onFailed]);
  return (
    <div className="phonepage linkscreen">
      <Companion mood="thinking" name="Airband" size={96} />
      <h1>Linking to your Mac…</h1>
    </div>
  );
}

function Linked({ pairing, onUnlinked }: { pairing: Pairing; onUnlinked: (why?: string) => void }) {
  const [link, setLink] = useState<RelayLink>();
  useEffect(() => {
    let live = true;
    void (async () => {
      const l = await RelayLink.open(pairing);
      // Ended on the Mac while this app was closed: back to linking, without trying again and again.
      const check = await fetch(`/r/${pairing.room}/check`, { method: "POST", headers: { "x-room-token": l.token } }).catch(() => undefined);
      if (!live) return;
      if (check && (check.status === 410 || check.status === 403)) return onUnlinked("This iPhone was unlinked on your Mac.");
      // Ended while open: at once.
      l.onEnded = () => onUnlinked("This iPhone was unlinked on your Mac.");
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
    if (!confirm("Unlink this iPhone? It stops getting alerts. You can link it again from your Mac.")) return;
    await link.forget(await phoneId());
    try {
      await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription().then((s) => s?.unsubscribe());
    } catch {
      // No alerts were on.
    }
    onUnlinked();
  };
  return (
    <div className="phonepage home">
      <header className="topbar">
        <span className="brand">Airband</span>
        <span className={`macpill${up ? " on" : ""}`}>
          <span className="dot" />
          {up ? "Mac online" : "Mac offline"}
        </span>
      </header>
      {state ? <PhoneHome state={state} up={up} mood={c.mood} name={c.name || "Roger"} design={c.design} onError={setNote} afterHero={<Alerts link={link} pairing={pairing} up={up} onError={setNote} />} /> : <p className="muted pempty">Connecting to your computer…</p>}
      {note && (
        <p className="offline" role="alert" onClick={() => setNote(undefined)}>
          {note}
        </p>
      )}
      <footer className="phonefoot">
        {!(ios() && !installed()) && pushable() && (
          <button className="linkbtn" disabled={!up} onClick={() => void link.testAlert().then(() => setNote("Sent. The alert arrives in a few seconds. If it doesn't, check Settings, then Notifications, then Airband."), (e: Error) => setNote(e.message))}>
            Send me a test alert
          </button>
        )}
        <button className="linkbtn" onClick={() => void unlink()}>
          Unlink this iPhone
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
      const { fromB64u } = await import("../../src/remote/box");
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
        <BellRing size={16} /> Get alerts on this iPhone
      </b>
      <span className="muted">On your Lock Screen, when a chat needs you or finishes.</span>
      <button className="btn primary wide" disabled={busy || !up} onClick={() => void turnOn()}>
        {busy ? "Turning on…" : up ? "Turn on alerts" : "Waiting for your computer…"}
      </button>
    </div>
  );
}
