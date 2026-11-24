import { useEffect, useState } from "react";
import { desktop, onAppUpdate, type AppUpdate } from "../../api/desktop-bridge";
import { sounds } from "../../sound";

/** "Airband 0.1.2 is ready · Update": one click updates the app and starts it again. While it
 *  runs, the bar fills with the download, then says it is installing and starting again. */
export function UpdateBar() {
  const [u, setU] = useState<AppUpdate>();
  useEffect(() => onAppUpdate(setU), []);
  if (!u?.version) return null;
  const pct = u.installing && u.step === "downloading" ? u.progress : undefined;
  const say = u.error
    ? u.error
    : !u.installing
      ? `Airband ${u.version} is ready`
      : u.step === "installing"
        ? `Installing Airband ${u.version}…`
        : u.step === "restarting"
          ? "Starting again. I'll be right back."
          : `Downloading Airband ${u.version}${pct != null ? ` · ${pct}%` : "…"}`;
  return (
    <div className={`updatebar${u.installing ? " busy" : ""}`} role="status">
      {u.installing && <span className="fill" style={{ width: `${u.step === "downloading" ? (pct ?? 4) : 100}%` }} />}
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
