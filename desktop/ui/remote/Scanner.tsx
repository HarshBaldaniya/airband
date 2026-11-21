// Scans the pairing code with the phone's camera, for when the app on the Home Screen opens unlinked
// (a phone keeps the Home Screen app's storage apart from the browser's).
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parsePairing, type Pairing } from "../../../src/remote/box";

export function Scanner({ onFound, onClose }: { onFound: (p: Pairing) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        timer = setInterval(() => {
          if (!ctx || !v.videoWidth) return;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
          if (!code) return;
          let url: URL;
          try {
            url = new URL(code.data);
          } catch {
            return setError("That isn't an Airband code.");
          }
          if (url.origin !== location.origin) return setError("That code is for a different Airband.");
          const p = parsePairing(url.hash);
          if (p) onFound(p);
          else setError("That isn't an Airband code.");
        }, 250);
      } catch {
        setError("Allow the camera to scan the code: Settings, then Airband or Safari, then Camera.");
      }
    })();
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onFound]);
  return (
    <div className="scanner">
      <video ref={video} playsInline muted />
      <span className="scanframe" aria-hidden="true" />
      <p className="muted">{error ?? "Point the camera at the code on your computer."}</p>
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
