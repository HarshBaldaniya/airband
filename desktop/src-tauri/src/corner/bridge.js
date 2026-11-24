// What the Station's page is given to reach the app: `window.airbandDesktop`, by invoke and
// events. Only on the Station's own page, on this computer. Added to the page by the app
// (corner/mod.rs) before the page's own scripts run.
(() => {
  if (location.hostname !== "127.0.0.1" || !window.__TAURI_INTERNALS__) return;
  const T = window.__TAURI_INTERNALS__;
  // A call the app refuses is written to its log, never lost.
  const invoke = (cmd, args) => T.invoke(cmd, args || {}).catch((e) => { if (cmd !== "log_line") T.invoke("log_line", { line: `bridge: ${cmd} refused: ${e}` }).catch(() => {}); });
  const on = (event, cb) => T.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler: T.transformCallback((e) => cb(e.payload)) });
  window.airbandDesktop = {
    // Station pages from 0.1.6 and earlier still read these three. Remove once no engine that old can run.
    nativeDrag: true,
    setHit: () => {},
    qr: async () => undefined,
    setHitAreas: (rects) => invoke("hit_areas", { rects }),
    dragStart: () => invoke("drag"),
    onPlace: (cb) => on("place", cb),
    onCursor: (cb) => on("cursor", cb),
    onPointer: (cb) => on("pointer", cb),
    onCommand: (cb) => on("command", cb),
    onPrefs: (cb) => on("prefs", cb),
    prefs: () => invoke("prefs"),
    setPref: (key, on) => invoke("set_pref", { key, on }),
    showMenu: () => invoke("menu"),
    setAsleep: (asleep) => invoke("asleep", { asleep }),
    comeBack: () => invoke("come_back"),
    update: () => invoke("update_info"),
    onUpdate: (cb) => on("update", cb),
    installUpdate: () => invoke("install_update"),
    justUpdated: () => invoke("just_updated"),
  };
})();
