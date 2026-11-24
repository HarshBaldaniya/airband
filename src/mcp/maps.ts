// The code maps the tools answer from, one per folder, brought up to date before each answer.
import { CodeMap } from "../codemap/index";
import { listHeads, readAsks } from "../core/record/store";

/** A map read this recently answers as it is. */
const FRESH_MS = 1500;

const maps = new Map<string, { map: CodeMap; at: number }>();

/** A folder's map (this project's unless another is named), brought up to date first: only files
 *  whose size or time changed are read again. */
export async function freshMap(folder: string): Promise<CodeMap> {
  let m = maps.get(folder);
  if (!m) maps.set(folder, (m = { map: new CodeMap(folder), at: 0 }));
  if (Date.now() - m.at > FRESH_MS) {
    await m.map.refresh();
    m.at = Date.now();
  }
  return m.map;
}

/**
 * What the chat calling is working on: the files its newest asks touched. The calling chat is this
 * folder's most recently active one (an MCP server is started per chat, in the chat's folder).
 */
export function recentFiles(root: string): string[] {
  try {
    const head = listHeads().filter((h) => h.cwd === root).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!head) return [];
    return [...new Set(readAsks(head.id, 8).flatMap((a) => a.files))].slice(0, 20);
  } catch {
    return [];
  }
}
