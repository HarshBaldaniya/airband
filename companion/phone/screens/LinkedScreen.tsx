// Linked: what needs you and what finished on the Mac, alerts, and Unlink.
import { useEffect, useState } from "react";
import type { Pairing } from "../../../src/remote/box";
import { setTransport } from "../../api/station";
import { useCompanionState } from "../../state/useCompanionState";
import { useStation } from "../../state/useStation";
import { installed, ios, pushable } from "../device";
import { RelayLink } from "../relay";
import { phoneId } from "../store";
import { Alerts } from "./Alerts";
import { PhoneHome } from "./PhoneHome";

export function LinkedScreen({ pairing, onUnlinked }: { pairing: Pairing; onUnlinked: (why?: string) => void }) {
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
