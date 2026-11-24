// Candidates for clean-up: exports nothing uses, and files nothing imports.
import * as fs from "node:fs";
import * as path from "node:path";
import { isLowValuePath } from "../search";
import type { Decl } from "../types";
import { fitBudget, type MappedCode } from "./format";

/**
 * Candidates for clean-up: exports nothing in the codebase uses, and files nothing imports. Entry
 * points (pages, routes, configs, tests, scripts) are never listed. Code used by name at run time
 * (dynamic imports, frameworks) can look unused, so each is a candidate to check, not a verdict.
 */
export function unusedCode(map: MappedCode): { exports: { file: string; decl: Decl }[]; localOnly: { file: string; decl: Decl }[]; files: string[] } {
  const graph = map.graph;
  const entry = (p: string) =>
    isLowValuePath(p) ||
    /(^|\/)(page|layout|route|loading|error|not-found|global-error|template|default|middleware|proxy|instrumentation|instrumentation-client|mdx-components|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.(tsx?|jsx?|mdx?)$/.test(p) ||
    /(^|\/)pages\//.test(p) ||
    /\.(config|setup)\.[cm]?[jt]s$|\.d\.ts$|(^|\/)(index|main|server|cli|extension|__init__|__main__|manage|conftest|settings|wsgi|asgi)\.[a-z]+$/.test(p);
  const candidates: { file: string; decl: Decl }[] = [];
  const files: string[] = [];
  for (const f of map.entries()) {
    if (entry(f.p)) continue;
    if (!(graph.importers.get(f.p)?.size) && f.l !== "python") {
      files.push(f.p);
      continue;
    }
    for (const d of f.d) {
      if (!d.x || d.p || d.k === "route" || d.n === "default" || d.n === f.def) continue;
      if (/^(metadata|generateMetadata|generateStaticParams|revalidate|dynamic|runtime|config|viewport)$/.test(d.n)) continue;
      if (graph.usedBy(f.p, d.n).length) continue;
      candidates.push({ file: f.p, decl: d });
    }
  }
  // A last plain-text pass over the codebase: any mention outside its own file counts as a use the
  // graph couldn't see (property access, strings, a framework calling it by name).
  const names = new Set(candidates.map((c) => c.decl.n));
  const seenIn = new Map<string, Set<string>>();
  const ownCount = new Map<string, number>();
  for (const f of map.entries()) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(map.root, f.p), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const w = m[0];
      if (!names.has(w)) continue;
      let set = seenIn.get(w);
      if (!set) seenIn.set(w, (set = new Set()));
      set.add(f.p);
      const k = `${f.p}#${w}`;
      ownCount.set(k, (ownCount.get(k) ?? 0) + 1);
    }
  }
  const exports: { file: string; decl: Decl }[] = [];
  const localOnly: { file: string; decl: Decl }[] = [];
  for (const c of candidates) {
    const where = seenIn.get(c.decl.n) ?? new Set();
    if ([...where].some((p) => p !== c.file)) continue;
    if ((ownCount.get(`${c.file}#${c.decl.n}`) ?? 0) > 1) localOnly.push(c);
    else exports.push(c);
  }
  return { exports, localOnly, files: files.sort() };
}

export function unusedText(map: MappedCode, budget = 600): string {
  const { exports, localOnly, files } = unusedCode(map);
  const out = ["Candidates: checked by imports and by name across the codebase, but code loaded by name at run time can still look unused."];
  out.push(`files nothing imports (${files.length}): ${files.slice(0, 12).join(", ")}${files.length > 12 ? ", …" : ""}`);
  out.push(`unused anywhere (${exports.length}):`);
  for (const e of exports.slice(0, 30)) out.push(`  ${e.decl.n}  ${e.decl.k}  ${e.file}:${e.decl.s}-${e.decl.e}`);
  if (localOnly.length) out.push(`exported but used only in their own file, so the export can go (${localOnly.length}): ${localOnly.slice(0, 15).map((e) => `${e.decl.n} (${e.file})`).join(", ")}${localOnly.length > 15 ? ", …" : ""}`);
  return fitBudget(out.join("\n"), budget);
}
