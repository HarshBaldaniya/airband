// What the desktop app gives the corner's page (window place, drag, menus, its settings), as
// window.airbandDesktop (desktop/src-tauri/src/corner/bridge.js). Absent in a browser or on a phone.
// The app's events are listened to once, here, and passed on to every part of the page that asks:
// the app gives no way to stop listening.

export interface DesktopPrefs {
  sound: boolean;
  notify: boolean;
  startAtLogin: boolean;
  /** The companion is tucked away: small, with no cards until it is clicked. */
  tucked: boolean;
  /** It has said hello once, on the very first start. */
  greeted: boolean;
}

/** What the desktop app adds (window place, drag, menus); absent in a browser or on a phone. The
 *  optional members are missing in older apps. */
export interface DesktopBridge {
  /** A drag starts on the figure: the system moves the window from here, and keeps the pointer. */
  dragStart(figure: { x: number; y: number; width: number; height: number }): void;
  /** Which way the cards open: towards the middle of the screen. */
  onPlace(cb: (p: Place) => void): void;
  onCursor(cb: (p: { dx: number; dy: number }) => void): void;
  /** Where the pointer is over the window (null once it leaves), sent even while the window is
   *  not in front, when the page itself gets no mouse moves. Absent in apps before 0.1.4. */
  onPointer?(cb: (p: { x: number; y: number } | null) => void): void;
  onCommand(cb: (c: string) => void): void;
  onPrefs(cb: (p: DesktopPrefs) => void): void;
  prefs(): Promise<DesktopPrefs>;
  setPref(key: keyof DesktopPrefs, on: boolean): void;
  /** The app's own menu, at the pointer (a right-click on the figure). */
  showMenu(): void;
  /** Asleep: the app stops following the pointer until it wakes. */
  setAsleep?(asleep: boolean): void;
  /**
   * The app can't see the pointer while clicks pass through, so the screen tells it where its
   * clickable parts are, and the app watches the pointer.
   */
  setHitAreas(rects: { x: number; y: number; width: number; height: number }[]): void;
  /** A request or a finished chat came while hidden or tucked away: show the companion. */
  comeBack?(): void;
  /** A newer app, if there is one; older apps don't have these. */
  update?(): Promise<AppUpdate | undefined>;
  onUpdate?(cb: (u: AppUpdate) => void): void;
  /** Download the newer app, put it in place and start it. */
  installUpdate?(): void;
  /** The version the app was just updated to, once after the restart that put it in place. */
  justUpdated?(): Promise<string | null | undefined>;
}

/** A newer desktop app, as the app tells it. */
export interface AppUpdate {
  version?: string | null;
  installing: boolean;
  /** While installing: "downloading", "installing", then "restarting". */
  step?: "downloading" | "installing" | "restarting" | null;
  /** How much of the download is in, 0 to 100. */
  progress?: number | null;
  error?: string | null;
  /** A small update: it installs by itself once Roger is asleep (apps before 0.2.1 never say so). */
  automatic?: boolean;
}

/** Which way the cards open: towards the middle of the screen. */
export interface Place {
  side: "left" | "right";
  vertical: "top" | "bottom";
}

export const desktop: DesktopBridge | undefined = (window as unknown as { airbandDesktop?: DesktopBridge }).airbandDesktop;

export const MODE: "desktop" | "phone" = (window as unknown as { AIRBAND_MODE?: string }).AIRBAND_MODE === "desktop" && desktop ? "desktop" : "phone";

/** One of the app's events, listened to on first use. Each listener gets an unsubscribe; `last`
 *  replays the latest value to a new listener. */
function channel<T>(listen: ((cb: (v: T) => void) => void) | undefined, { last = false } = {}) {
  const subs = new Set<(v: T) => void>();
  let latest: { v: T } | undefined;
  let listening = false;
  return (f: (v: T) => void): (() => void) => {
    if (!listening && listen) {
      listening = true;
      listen((v) => {
        latest = { v };
        subs.forEach((s) => s(v));
      });
    }
    subs.add(f);
    if (last && latest) f(latest.v);
    return () => void subs.delete(f);
  };
}

export const onPlace = channel<Place>(desktop && ((cb) => desktop.onPlace(cb)));
export const onCursor = channel<{ dx: number; dy: number }>(desktop && ((cb) => desktop.onCursor(cb)));
export const onPointer = channel<{ x: number; y: number } | null>(desktop?.onPointer && ((cb) => desktop.onPointer!(cb)));
export const onCommand = channel<string>(desktop && ((cb) => desktop.onCommand(cb)));
export const onPrefs = channel<DesktopPrefs>(desktop && ((cb) => desktop.onPrefs(cb)), { last: true });

/** The newer app the desktop app found, followed from one place however often the panel opens. */
let appUpdate: AppUpdate | undefined;
const updateSubs = new Set<(u: AppUpdate | undefined) => void>();
const setAppUpdate = (u: AppUpdate | undefined) => {
  appUpdate = u;
  updateSubs.forEach((f) => f(u));
};
if (desktop?.onUpdate) {
  desktop.onUpdate(setAppUpdate);
  void desktop.update?.().then((u) => u && setAppUpdate(u));
}
export function onAppUpdate(f: (u: AppUpdate | undefined) => void): () => void {
  updateSubs.add(f);
  f(appUpdate);
  return () => void updateSubs.delete(f);
}
