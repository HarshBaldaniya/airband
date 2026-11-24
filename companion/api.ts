// The companion's screen talks to the Station it was loaded from: the same address, its key in a cookie.
import type { CompanionAnswer, StationSettings, StationState } from "../src/station";
import type { Answer } from "../src/station/reply";

export type { AnswerChoice, CompanionAnswer, FinishedView, LiveChat, PendingView, StationSettings, StationState } from "../src/station";

/** How the screen reaches the Station: over HTTP from the page the Station served (the computer),
 *  or through Airband's relay, locked (the phone app). */
export interface Transport {
  post<T>(route: string, body: unknown): Promise<T>;
  watch(onState: (s: StationState) => void, onLink: (up: boolean) => void): () => void;
}

async function httpPost<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The Station said ${res.status}.`);
  return data;
}

let transport: Transport = { post: httpPost, watch: watchEvents };

/** The phone app sends everything through its relay connection instead. */
export function setTransport(t: Transport): void {
  transport = t;
}

const post = <T,>(route: string, body: unknown) => transport.post<T>(route, body);

export const api = {
  decide: (id: string, answer: Answer) => post<{ ok?: boolean }>("/api/decide", { id, ...answer }),
  ask: (text: string) => post<CompanionAnswer>("/api/ask", { text }),
  tell: (chatId: string, text: string) => post<{ title: string; when?: string }>("/api/tell", { chatId, text }),
  open: (chatId: string) => post<{ text: string }>("/api/open", { chatId }),
  dismiss: (chatId: string) => post<{ ok: boolean }>("/api/dismiss", { chatId }),
  settings: (patch: Partial<Omit<StationSettings, "companion">> & { companionName?: string; companionDesign?: string }) => post<StationSettings>("/api/settings", patch),
  linkPhone: () => post<{ url: string }>("/api/phone/link", {}),
  phoneCode: () => post<{ url?: string }>("/api/phone/code", {}),
  unlinkPhone: () => post<{ ok: boolean }>("/api/phone/unlink", {}),
  testPhone: () => post<{ results: { name: string; ok: boolean; status: number; why?: string }[] }>("/api/phone/test", {}),
};

/** The Station's state as it changes. */
export function watchState(onState: (s: StationState) => void, onLink: (up: boolean) => void): () => void {
  return transport.watch(onState, onLink);
}

/** Over one long-lived connection to the Station that reconnects by itself. */
function watchEvents(onState: (s: StationState) => void, onLink: (up: boolean) => void): () => void {
  let es: EventSource | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    es = new EventSource("/api/events", { withCredentials: true });
    es.onopen = () => onLink(true);
    es.onmessage = (e) => {
      try {
        onState(JSON.parse(e.data) as StationState);
      } catch {
        // A partial line: the next one is whole.
      }
    };
    es.onerror = () => {
      onLink(false);
      es?.close();
      if (!stopped) retry = setTimeout(connect, 2000);
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    es?.close();
  };
}

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
  onPlace(cb: (p: { side: "left" | "right"; vertical: "top" | "bottom" }) => void): void;
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
}

export const desktop: DesktopBridge | undefined = (window as unknown as { airbandDesktop?: DesktopBridge }).airbandDesktop;
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

export const MODE: "desktop" | "phone" = (window as unknown as { AIRBAND_MODE?: string }).AIRBAND_MODE === "desktop" && desktop ? "desktop" : "phone";
