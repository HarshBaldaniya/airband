// The companion's screen talks to the Station it was loaded from: the same address, its key in a cookie.
import type { CompanionAnswer, StationSettings, StationState } from "../../src/station";
import type { Answer } from "../../src/station/reply";

export type { AnswerChoice, CompanionAnswer, FinishedView, LiveChat, PendingView, StationSettings, StationState } from "../../src/station";

async function post<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The Station said ${res.status}.`);
  return data;
}

export const api = {
  decide: (id: string, answer: Answer) => post<{ ok?: boolean }>("/api/decide", { id, ...answer }),
  ask: (text: string) => post<CompanionAnswer>("/api/ask", { text }),
  tell: (chatId: string, text: string) => post<{ title: string }>("/api/tell", { chatId, text }),
  open: (chatId: string) => post<{ text: string }>("/api/open", { chatId }),
  dismiss: (chatId: string) => post<{ ok: boolean }>("/api/dismiss", { chatId }),
  settings: (patch: Partial<Omit<StationSettings, "companion">> & { companionName?: string; companionDesign?: string }) => post<StationSettings>("/api/settings", patch),
};

/** The Station's state as it changes, over one long-lived connection that reconnects by itself. */
export function watchState(onState: (s: StationState) => void, onLink: (up: boolean) => void): () => void {
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
}

/** What the desktop app adds (window place, drag, menus, the QR code); absent in a browser or on a phone. */
export interface DesktopBridge {
  /** The pointer is over something clickable: the window takes clicks there, and lets the rest through. */
  setHit(hit: boolean): void;
  /** A drag starts on the figure, whose box in the window is given so it stays under the pointer. */
  dragStart(figure: { x: number; y: number; width: number; height: number }): void;
  dragMove(): void;
  dragEnd(): void;
  /** Which way the cards open: towards the middle of the screen. */
  onPlace(cb: (p: { side: "left" | "right"; vertical: "top" | "bottom" }) => void): void;
  onCursor(cb: (p: { dx: number; dy: number }) => void): void;
  onCommand(cb: (c: string) => void): void;
  onPrefs(cb: (p: DesktopPrefs) => void): void;
  qr(text: string): Promise<string>;
  prefs(): Promise<DesktopPrefs>;
  setPref(key: keyof DesktopPrefs, on: boolean): void;
  /** The app's own menu, at the pointer (a right-click on the figure). */
  showMenu(): void;
  hide(): void;
}

export const desktop: DesktopBridge | undefined = (window as unknown as { airbandDesktop?: DesktopBridge }).airbandDesktop;
export const MODE: "desktop" | "phone" = (window as unknown as { AIRBAND_MODE?: string }).AIRBAND_MODE === "desktop" && desktop ? "desktop" : "phone";
