// How the sidebar groups chats (by what needs attention, or by folder), and who each chat shares with.
import type { ConnectionView } from "../../src/core/protocol";
import type { ChatSession } from "../../src/core/types";
import type { Tool } from "../../src/core/agents";
import { folderHints, folderName, folderOf } from "../lib/folders";

export type GroupKey = "needs" | "working" | "today" | "week" | "older";
const GROUP_LABEL: Record<GroupKey, string> = { needs: "Needs you", working: "Working", today: "Today", week: "This week", older: "Older" };
export interface Group {
  key: string;
  label: string;
  items: ChatSession[];
  /** A folder's own group: its rows need no folder label. */
  folder?: string;
  /** Its parent folder's name, when another folder has the same name. */
  hint?: string;
  waiting?: number;
  working?: number;
  /** When anything in the folder last happened. */
  latest?: number;
  /** The agents that have chats in it. */
  tools?: Tool[];
}
export interface MergedLink {
  other: ConnectionView["from"];
  /** This chat shares its work with the other. */
  shares?: ConnectionView;
  /** This chat learns from the other. */
  learns?: ConnectionView;
}

/** One entry per linked chat, whichever way the work flows. */
export function mergeLinks(out: ConnectionView[], inc: ConnectionView[]): MergedLink[] {
  const by = new Map<string, MergedLink>();
  for (const c of out) by.set(c.to.id, { ...(by.get(c.to.id) ?? { other: c.to }), shares: c });
  for (const c of inc) by.set(c.from.id, { ...(by.get(c.from.id) ?? { other: c.from }), learns: c });
  return [...by.values()];
}

export function groupChats(list: ChatSession[]): Group[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = startOfToday - 6 * 86_400_000;
  const out: Record<GroupKey, ChatSession[]> = { needs: [], working: [], today: [], week: [], older: [] };
  for (const s of list) {
    if (s.status === "waiting") out.needs.push(s);
    else if (s.status === "working") out.working.push(s);
    else if (s.lastModified >= startOfToday) out.today.push(s);
    else if (s.lastModified >= weekAgo) out.week.push(s);
    else out.older.push(s);
  }
  return (Object.keys(out) as GroupKey[]).filter((k) => out[k].length).map((key) => ({ key, label: GROUP_LABEL[key], items: out[key] }));
}

/** Rows inside a folder: what needs you, then what is working, then the newest. */
const ORDER: Record<string, number> = { waiting: 0, working: 1 };

/**
 * One group per folder, this window's folder first, the rest by their newest chat. A folder
 * whose name another folder shares says its parent ("work · e2e2").
 */
export function groupByFolder(list: ChatSession[], root?: string): Group[] {
  const folders = new Map<string, ChatSession[]>();
  for (const s of list) folders.set(folderOf(s, root), [...(folders.get(folderOf(s, root)) ?? []), s]);
  const newest = (f: string) => Math.max(...folders.get(f)!.map((s) => s.lastModified));
  const order = [...folders.keys()].sort((a, b) => (a === root ? -1 : b === root ? 1 : newest(b) - newest(a)));
  const hints = folderHints(order);
  return order.map((f) => {
    const items = [...folders.get(f)!].sort((a, b) => (ORDER[a.status] ?? 2) - (ORDER[b.status] ?? 2) || b.lastModified - a.lastModified);
    return {
      key: `f:${f}`,
      label: folderName(f) || "Other",
      items,
      folder: f,
      hint: hints.get(f),
      waiting: items.filter((s) => s.status === "waiting").length,
      working: items.filter((s) => s.status === "working").length,
      latest: newest(f),
      tools: [...new Set(items.map((s) => s.tool))],
    };
  });
}

export interface FolderInfo {
  path: string;
  name: string;
  hint?: string;
  count: number;
  latest?: number;
}

/** Every folder with chats, this one first, then by their newest chat. */
export function folderList(sessions: ChatSession[], root?: string): FolderInfo[] {
  return groupByFolder(sessions, root).map((g) => ({ path: g.folder!, name: g.label, hint: g.hint, count: g.items.length, latest: g.latest }));
}

export function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}
