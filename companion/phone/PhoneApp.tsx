// The phone app, served by Airband's relay and added to the Home Screen. It shows what needs you and
// what finished, on your linked computer, from anywhere. It answers requests (Allow, Always, Deny,
// a question's choices) and nothing else: asking, messaging a chat and settings stay on the computer.
import { useCallback, useEffect, useState } from "react";
import { parsePairing, type Pairing } from "../../src/remote/box";
import { installed, ios, iphone } from "./device";
import { ClaimScreen } from "./screens/ClaimScreen";
import { InstallScreen } from "./screens/InstallScreen";
import { LinkedScreen } from "./screens/LinkedScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { NotIPhone } from "./screens/NotIPhone";
import { retire, retired, savedPairing, savePairing } from "./store";

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
  if (!pairing.claimed) return ios() && !installed() ? <InstallScreen /> : <ClaimScreen key={pairing.room} code={pairing} onClaimed={claimed} onFailed={failed} />;
  return <LinkedScreen key={pairing.room} pairing={pairing} onUnlinked={unlinked} />;
}
