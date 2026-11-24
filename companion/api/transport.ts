// How the screen reaches the Station: over HTTP from the page the Station served (the computer),
// or through Airband's relay, locked (the phone app).
import type { StationState } from "../../src/station/types";

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

export const post = <T,>(route: string, body: unknown) => transport.post<T>(route, body);

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
