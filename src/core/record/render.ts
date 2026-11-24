// What a linked chat is sent from a record: a line per ask, or a short summary of each.
import { fullPath, relativeTo } from "../paths";
import { shorten } from "../text";
import { askLog, readAsks, readHead, type RecordAsk } from "./store";

/** How much a link sends after each reply: a line per ask, a short summary, or the words themselves. */
export type LinkLevel = "ping" | "brief" | "full";

/** Files named as the receiving chat can open them: short in the same folder, full paths elsewhere. */
function fileNames(files: string[], root: string | undefined, absolute: boolean, max: number): string {
  const names = files.map((f) => (absolute ? fullPath(f, root) : relativeTo(f, root)));
  return names.length > max ? `${names.slice(0, max).join(", ")} (+${names.length - max})` : names.join(", ");
}

/** The first sentence, for a one-line headline. */
function firstSentence(text: string, max: number): string {
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(text);
  return shorten(m ? m[1] : text, max);
}

export function renderAsk(a: RecordAsk, level: Exclude<LinkLevel, "full">, opts: { root?: string; absolute?: boolean } = {}): string {
  const files = a.files.length ? fileNames(a.files, opts.root, !!opts.absolute, level === "ping" ? 3 : 8) : "";
  const refs = a.refs.length ? a.refs.join(", ") : "";
  if (level === "ping") {
    const extra = [files && `files: ${files}`, refs].filter(Boolean).join(" · ");
    return `• ${shorten(a.ask, 160)} → ${firstSentence(a.did || "(no reply yet)", 220)}${extra ? ` (${extra})` : ""}`;
  }
  return [
    `**Asked:** ${a.ask.replace(/\n+/g, " ")}`,
    `**Done:** ${a.did || "(no reply yet)"}`,
    a.open && `**Open:** ${a.open}`,
    files && `Files: ${files}`,
    refs && `Refs: ${refs}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Several asks, as one piece: headlines one per line, summaries a paragraph each. */
export function renderAsks(asks: RecordAsk[], level: Exclude<LinkLevel, "full">, opts: { root?: string; absolute?: boolean } = {}): string {
  return asks.map((a) => renderAsk(a, level, opts)).join(level === "ping" ? "\n" : "\n\n");
}

/** Where the rest of a record can be read: the tool, and the file for agents without it. */
export function recordPointer(id: string, title: string): string {
  return `The rest of that chat's flightlog: the airband_flightlog tool (chat "${title}"), or ${askLog(id)} (one JSON line per ask). The exact words of an ask: airband_flightlog with its n.`;
}

/**
 * What a chat gets on being linked: what the other chat set out to do, how many asks it has had,
 * and the latest few in full summary. `since`: only what is new after a time (a link made again).
 */
export function recordContext(id: string, title: string, opts: { root?: string; absolute?: boolean; latest?: number; since?: number } = {}): string | undefined {
  const head = readHead(id);
  if (!head) return undefined;
  const latest = opts.latest ?? 10;
  const all = readAsks(id, opts.since ? undefined : latest);
  const asks = opts.since ? all.filter((a) => a.at > opts.since!).slice(-latest) : all;
  const intro = opts.since
    ? asks.length
      ? `New since it last reached this chat (${head.n} asks in all):`
      : `Nothing new since it last reached this chat (${head.n} asks in all).`
    : `It set out to: ${head.goal ?? "(not recorded)"}\n${head.n} ask${head.n === 1 ? "" : "s"} so far${asks.length < head.n ? `; the latest ${asks.length}` : ""}:`;
  return [intro, asks.length ? renderAsks(asks, "brief", opts) : "", recordPointer(id, title)].filter(Boolean).join("\n\n");
}
