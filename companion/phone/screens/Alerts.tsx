import { useEffect, useState } from "react";
import { BellRing, Share, SquarePlus, Smartphone } from "lucide-react";
import type { Pairing } from "../../../src/remote/box";
import { deviceName, installed, ios, pushable } from "../device";
import type { RelayLink } from "../relay";
import { get, phoneId, put } from "../store";

/** Alerts on the Lock Screen: on an iPhone only from the Home Screen app, and after a tap to allow. */
export function Alerts({ link, pairing, up, onError }: { link: RelayLink; pairing: Pairing; up: boolean; onError: (m: string) => void }) {
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
        <BellRing size={16} /> Get alerts on this iPhone
      </b>
      <span className="muted">On your Lock Screen, when a chat needs you or finishes.</span>
      <button className="btn primary wide" disabled={busy || !up} onClick={() => void turnOn()}>
        {busy ? "Turning on…" : up ? "Turn on alerts" : "Waiting for your computer…"}
      </button>
    </div>
  );
}
