// Folders as the pages name them.
import type { ChatSession } from "../../src/core/types";

/** A folder's own name ("/Users/me/work/api" → "api"). */
export function folderName(p?: string): string {
  if (!p) return "";
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** The folder a chat works in: its own for a chat from elsewhere, this window's for the rest. */
export function folderOf(s: ChatSession, root: string | undefined): string {
  return (s.away ? s.cwd : root) ?? root ?? "";
}

/**
 * What tells folders with the same name apart: their parent's name. Folders whose name is their
 * own get no hint.
 */
export function folderHints(paths: string[]): Map<string, string | undefined> {
  const count = new Map<string, number>();
  for (const p of paths) count.set(folderName(p), (count.get(folderName(p)) ?? 0) + 1);
  return new Map(paths.map((p) => [p, (count.get(folderName(p)) ?? 0) > 1 ? folderName(p.replace(/[\\/][^\\/]+[\\/]?$/, "")) : undefined]));
}

/** The drag payload type for a chat, so drops from elsewhere are ignored. */
export const DRAG_TYPE = "application/x-airband-chat";
