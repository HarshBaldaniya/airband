import { useEffect, useState } from "react";
import { desktop, onAppUpdate, type AppUpdate } from "../../api/desktop-bridge";
import { sounds } from "../../sound";

/** "Airband 0.3.0 is ready · Update": one click updates the app and starts it again. While it
 *  runs, the bar fills with the download, then says it is installing and starting again. A small
 *  update installs by itself while Roger sleeps: the bar shows only once it runs, or if it failed. */
export function UpdateBar() {
  const [u, setU] = useState<AppUpdate>();
  useEffect(() => onAppUpdate(setU), []);
  if (!u?.version || (u.automatic && !u.installing && !u.error)) return null;
  const pct = u.installing && u.step === "downloading" ? u.progress : undefined;
  const say = u.error
    ? u.error
    : !u.installing
      ? `Airband ${u.version} is ready`
      : u.step === "installing"
        ? `Installing Airband ${u.version}…`
        : u.step === "restarting"
          ? "Starting again. I'll be right back."
          : pct != null
            ? `Downloading Airband ${u.version} · ${pct}%`
            : `Getting Airband ${u.version}…`;
  // Downloading with no size yet: the band moves until the first bytes say how far it is.
  const waiting = u.installing && u.step === "downloading" && pct == null;
  return (
    <div className={`updatebar${u.installing ? " busy" : ""}`} role="status">
      {u.installing && <span className={`fill${waiting ? " waiting" : ""}`} style={waiting ? undefined : { width: `${u.step === "downloading" ? pct : 100}%` }} />}
      <span className="ellipsis">{say}</span>
      {u.installing ? (
        <span className="spin" aria-hidden />
      ) : (
        <button className="btn primary small" onClick={() => (sounds.tick(), desktop?.installUpdate?.())}>
          {u.error ? "Try again" : "Update"}
        </button>
      )}
    </div>
  );
}
