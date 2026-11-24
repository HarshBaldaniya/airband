// What every answer of the code map shares: the map it reads, short lists, and a budget in tokens.
import type { CodeGraph, Confidence, Edge } from "../graph";
import type { ModuleDoc } from "../moduledocs";
import type { Convention, Module, StaleDocLine } from "../modules";
import type { SearchIndex } from "../search";
import type { FileEntry } from "../store";
import { CHARS_PER_TOKEN } from "../../core/text";

/** What an answer reads from the code map (index.ts). */
export interface MappedCode {
  readonly root: string;
  readonly graph: CodeGraph;
  readonly searchIndex: SearchIndex;
  entries(): Iterable<FileEntry>;
  file(p: string): FileEntry | undefined;
  paths(): string[];
  fileCount(): number;
  modules(): Module[];
  moduleOrFolder(id: string): Module | undefined;
  conventions(moduleId?: string): Convention[];
  moduleDoc(moduleId: string): ModuleDoc | undefined;
  nameExists(name: string): boolean;
  staleDocs(): StaleDocLine[];
}

export function commonDir(paths: string[]): string {
  const split = paths.map((p) => p.split("/"));
  const first = split[0] ?? [];
  let i = 0;
  while (i < first.length - 1 && split.every((s) => s[i] === first[i])) i++;
  return `${first.slice(0, i).join("/") || "."}/`;
}

export function listShort(items: string[], n: number): string {
  return items.length > n ? `${items.slice(0, n).join(", ")}, … ${items.length - n} more` : items.join(", ");
}

const CONF_MARK: Record<Confidence, string> = { found: "", likely: " (likely)", guessed: " (guessed)" };

export function edgeList(edges: Edge[], side: "from" | "to", n: number): string {
  const uniq = dedupe(edges, side);
  return listShort(uniq.map((e) => `${e[side].name}${CONF_MARK[e.conf]}`), n);
}

export function edgeLines(edges: Edge[], side: "from" | "to", n: number): string {
  const uniq = dedupe(edges, side);
  const lines = uniq.slice(0, n).map((e) => `  ${e[side].name}  ${e[side].file}${CONF_MARK[e.conf]}`);
  if (uniq.length > n) lines.push(`  … ${uniq.length - n} more`);
  return lines.join("\n");
}

function dedupe(edges: Edge[], side: "from" | "to"): Edge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const k = `${e[side].file}#${e[side].name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A text cut to about `budget` tokens, at a line break, saying it was cut. */
export function fitBudget(text: string, budget: number): string {
  const max = budget * CHARS_PER_TOKEN;
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max - 20);
  return `${text.slice(0, cut > 0 ? cut : max - 20)}\n… (cut to fit; ask about one part for more)`;
}
