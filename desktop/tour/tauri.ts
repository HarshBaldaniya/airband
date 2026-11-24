// The tour's line to the app: its commands, and its events. Each listen gives back a way to stop.
const T = (window as unknown as { __TAURI_INTERNALS__: { invoke<R>(cmd: string, args?: unknown): Promise<R>; transformCallback(cb: (e: { payload: unknown }) => void): number } }).__TAURI_INTERNALS__;

export const call = <R,>(cmd: string, args?: unknown) => T.invoke<R>(cmd, args ?? {});

export function listen(event: string, cb: (p: unknown) => void): () => void {
  const id = T.invoke<number>("plugin:event|listen", { event, target: { kind: "Any" }, handler: T.transformCallback((e) => cb(e.payload)) });
  return () => void id.then((eventId) => T.invoke("plugin:event|unlisten", { event, eventId })).catch(() => undefined);
}

export const openUrl = (url: string) => void call("open_url", { url });
