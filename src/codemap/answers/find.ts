// find: ranked code for words or a name, one line each, within a token budget.
import * as path from "node:path";
import { memberName } from "../graph";
import type { Doc, Hit } from "../search";
import type { MappedCode } from "./format";
import { tokensOf, type FindOptions } from "./tokens";

function boostFor(map: MappedCode, focus?: string[]): (doc: Doc) => number {
  const graph = map.graph;
  const rank = graph.rank;
  const near = new Set<string>();
  for (const f of focus ?? []) {
    const rel = path.isAbsolute(f) ? path.relative(map.root, f).split(path.sep).join("/") : f;
    if (!map.file(rel)) continue;
    near.add(rel);
    for (const t of graph.imports.get(rel) ?? []) near.add(t);
    for (const t of graph.importers.get(rel) ?? []) near.add(t);
  }
  return (doc: Doc) => {
    const file = doc.file.p;
    const r = rank.get(file) ?? 1;
    // Code many places use is more likely the code being asked about.
    const users = doc.decl ? graph.usedBy(file, memberName(doc.decl)).length : 0;
    return (1 + 0.12 * Math.log(1 + r)) * (1 + 0.1 * Math.log(1 + users)) * (near.has(file) ? 1.6 : 1);
  };
}

/** Ranked declarations and files for a question, one line each. */
export function findHits(map: MappedCode, question: string, opts: FindOptions = {}): Hit[] {
  return map.searchIndex.search(question, boostFor(map, opts.focus), 80);
}

export function findText(map: MappedCode, question: string, opts: FindOptions = {}): string {
  if (!map.fileCount()) return "The code map is still being built. Try again in a few seconds, or search the usual way.";
  const budget = opts.budget ?? 300;
  const limit = opts.limit ?? 10;
  const hits = findHits(map, question, opts);
  if (!hits.length) return `Nothing in the code map matches "${question}". Search the usual way (grep), or try other words.`;
  const lines: string[] = [];
  const perFile = new Map<string, number>();
  let used = 0;
  for (const h of hits) {
    if (lines.length >= limit) break;
    const n = perFile.get(h.doc.file.p) ?? 0;
    if (n >= 3) continue;
    const line = hitLine(map, h);
    const cost = tokensOf(line) + 1;
    if (used + cost > budget && lines.length) break;
    lines.push(line);
    used += cost;
    perFile.set(h.doc.file.p, n + 1);
  }
  return lines.join("\n");
}

function hitLine(map: MappedCode, h: Hit): string {
  const f = h.doc.file;
  const d = h.doc.decl;
  if (!d) return `${f.p}  (file, ${f.n} lines)`;
  const users = map.graph.usedBy(f.p, memberName(d)).length;
  const name = d.p ? `${d.p}.${d.n}` : d.n;
  const parts = [`${name}  ${d.route ?? d.k}  ${f.p}:${d.s}-${d.e}`];
  if (users) parts.push(`used by ${users}`);
  if (d.d) parts.push(d.d.length > 70 ? `${d.d.slice(0, 69)}…` : d.d);
  return parts.join("  · ");
}
