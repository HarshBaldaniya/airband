import { useState } from "react";
import type { Pairing } from "../../../src/remote/box";
import { Companion } from "../../figure/Companion";
import { Scanner } from "../Scanner";

/** Not linked yet: how to get a code on the Mac, and the camera to scan it. */
export function LinkScreen({ error, onScanned }: { error?: string; onScanned: (p: Pairing) => void }) {
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
