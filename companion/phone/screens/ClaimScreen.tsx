import { useEffect } from "react";
import type { Pairing } from "../../../src/remote/box";
import { Companion } from "../../figure/Companion";
import { deviceName } from "../device";
import { RelayLink } from "../relay";
import { phoneId } from "../store";

/** Takes the link with a scanned code, once: the Mac answers with this iPhone's own secret. */
export function ClaimScreen({ code, onClaimed, onFailed }: { code: Pairing; onClaimed: (code: Pairing, own: Pairing) => void; onFailed: (code: Pairing, why: string) => void }) {
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
