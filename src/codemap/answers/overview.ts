// The project card: how to run it, its entry points and its main parts. No prose.
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson } from "../../core/json";
import { conventionLines } from "../modules";
import { isLowValuePath } from "../search";
import { commonDir, fitBudget, type MappedCode } from "./format";

/** The project card: how to run it, its entry points and its main folders. No prose. */
export function overviewText(map: MappedCode, budget = 500): string {
  const out: string[] = [];
  const pkg = readJson<{ name?: string; scripts?: Record<string, string> } | undefined>(path.join(map.root, "package.json"), undefined);
  if (pkg?.scripts) {
    const keep = Object.keys(pkg.scripts).filter((s) => /^(dev|start|build|test|lint|typecheck|check|e2e|format)(:|$)/.test(s)).slice(0, 8);
    if (keep.length) out.push(`commands: ${keep.map((s) => `npm run ${s}`).join(" · ")}`);
  }
  if (fs.existsSync(path.join(map.root, "pyproject.toml"))) out.push("python: pyproject.toml");
  if (fs.existsSync(path.join(map.root, "Makefile"))) {
    try {
      const targets = [...fs.readFileSync(path.join(map.root, "Makefile"), "utf8").matchAll(/^([a-zA-Z][\w-]*):/gm)].map((m) => m[1]).slice(0, 8);
      if (targets.length) out.push(`make: ${targets.join(" · ")}`);
    } catch {
      // No Makefile to read.
    }
  }
  const langs = new Map<string, number>();
  let decls = 0;
  for (const f of map.entries()) {
    langs.set(f.l, (langs.get(f.l) ?? 0) + 1);
    decls += f.d.length;
  }
  out.push(`${map.fileCount()} files (${[...langs.entries()].map(([l, n]) => `${n} ${l}`).join(", ")}), ${decls} declarations`);

  const entries: string[] = [];
  const pages = map.paths().filter((p) => /^(src\/)?app\/(.+\/)?(page|route|layout)\.(tsx|ts|jsx|js)$|^(src\/)?pages\/.+\.(tsx|jsx|ts|js)$/.test(p));
  if (pages.length) entries.push(`${pages.length} Next.js pages and routes under ${commonDir(pages)}`);
  let routes = 0;
  for (const f of map.entries()) for (const d of f.d) if (d.k === "route") routes++;
  if (routes) entries.push(`${routes} web routes (find "route" lists them)`);
  for (const m of ["main.py", "app/main.py", "src/main.py", "manage.py", "src/index.ts", "src/main.ts", "index.ts", "src/extension.ts", "server.ts"]) {
    if (!!map.file(m)) entries.push(m);
  }
  if (entries.length) out.push(`entry points: ${entries.join(" · ")}`);

  const mods = map.modules().slice(0, 10);
  if (mods.length) {
    out.push(`main parts (most depended on first):\n${mods.map((m) => `  ${m.id}/  ${m.files.length} files${m.dependsOn.length ? ` · uses ${m.dependsOn[0]}` : ""}`).join("\n")}`);
  }
  const central = [...map.graph.rank.entries()].filter(([p]) => !isLowValuePath(p)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p);
  if (central.length) out.push(`most imported files: ${central.join(" · ")}`);
  const conv = conventionLines(map.conventions().filter((c) => c.share >= 0.6).slice(0, 3)).map((c) => c.replace(/, e\.g\. ([^,]+), .*$/, ", e.g. $1"));
  if (conv.length) out.push(`conventions:\n${conv.map((c) => `  ${c}`).join("\n")}`);
  const stale = map.staleDocs();
  if (stale.length) out.push(`docs out of date: ${stale.length === 1 ? "1 line names something that is" : `${stale.length} lines name things that are`} gone, e.g. ${stale.slice(0, 2).map((d) => `${d.file}:${d.line} (${d.missing})`).join(", ")}`);
  return fitBudget(out.join("\n"), budget);
}
