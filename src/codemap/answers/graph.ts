// graph: who uses a file or symbol and what it uses, one or two hops out.
import { memberName, type Edge } from "../graph";
import { edgeLines, fitBudget, listShort, type MappedCode } from "./format";
import { symbolHits } from "./outline";

/** Who uses a symbol or file and what it uses, one or two hops. */
export function graphText(map: MappedCode, target: string, hops: 1 | 2 = 1, budget = 400): string {
  const t = target.trim().replace(/^\.\//, "");
  const file = map.file(t);
  if (file) {
    const importers = [...(map.graph.importers.get(file.p) ?? [])];
    const imports = [...(map.graph.imports.get(file.p) ?? [])];
    const out = [`${file.p}`, `imported by ${importers.length}: ${listShort(importers, 10)}`, `imports ${imports.length}: ${listShort(imports, 10)}`];
    if (hops === 2) {
      const second = new Set<string>();
      for (const i of importers) for (const j of map.graph.importers.get(i) ?? []) if (j !== file.p && !importers.includes(j)) second.add(j);
      out.push(`then imported by ${second.size} more: ${listShort([...second], 8)}`);
    }
    return fitBudget(out.join("\n"), budget);
  }
  const hits = symbolHits(map, t);
  if (!hits.length) return `No file or symbol called "${target}". airband_map with find searches by words.`;
  const { file: f, decl } = hits[0];
  const me = memberName(decl);
  const users = map.graph.usedBy(f.p, me);
  const uses = map.graph.uses(f.p, me);
  const out = [`${me}  ${decl.k}  ${f.p}:${decl.s}-${decl.e}`];
  out.push(users.length ? `used by ${users.length}:\n${edgeLines(users, "from", 12)}` : "used by: nothing found in this codebase (it may be an entry point, or used dynamically)");
  if (hops === 2 && users.length) {
    const second: Edge[] = [];
    const seen = new Set(users.map((u) => `${u.from.file}#${u.from.name}`));
    for (const u of users) {
      for (const e of map.graph.usedBy(u.from.file, u.from.name)) {
        const k = `${e.from.file}#${e.from.name}`;
        if (!seen.has(k)) {
          seen.add(k);
          second.push(e);
        }
      }
    }
    if (second.length) out.push(`and through them, ${second.length} more:\n${edgeLines(second, "from", 8)}`);
  }
  if (uses.length) out.push(`uses ${uses.length}:\n${edgeLines(uses, "to", 10)}`);
  if (hits.length > 1) out.push(`(${hits.length - 1} other declarations named ${decl.n}; name the file to pick one)`);
  return fitBudget(out.join("\n"), budget);
}
