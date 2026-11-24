// The page's line to the extension: messages both ways, and the small memory VS Code keeps for a
// webview while it is hidden (filters, folded groups, the last tab).
import type { FromWebview, ToWebview } from "../../src/vscode/protocol";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): any; setState(s: any): void };

const vscode = acquireVsCodeApi();

export function send(msg: FromWebview): void {
  vscode.postMessage(msg);
}

export function onMessage(fn: (msg: ToWebview) => void): () => void {
  const handler = (e: MessageEvent<ToWebview>) => fn(e.data);
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/** A value saved with `remember`, or `fallback` when there is none. */
export function remembered<T>(key: string, fallback: T): T {
  return (vscode.getState()?.[key] as T) ?? fallback;
}

export function remember(key: string, value: unknown): void {
  vscode.setState({ ...(vscode.getState() ?? {}), [key]: value });
}
