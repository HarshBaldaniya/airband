// outline: one level of a folder, a file or a symbol, with signatures read from the file itself.
import * as fs from "node:fs";
import * as path from "node:path";
import { memberName } from "../graph";
import { docPath, serveModuleDoc } from "../moduledocs";
import { conventionLines } from "../modules";
import { isLowValuePath } from "../search";
import type { FileEntry } from "../store";
import type { Decl } from "../types";
import { edgeList, fitBudget, listShort, type MappedCode } from "./format";
import { tokensOf } from "./tokens";

/** One level of a folder, a file or a symbol. */
export function outlineText(map: MappedCode, target: string, budget = 600): string {
  const t = target.trim().replace(/^\.\//, "").replace(/\/$/, "");
  const rel = path.isAbsolute(t) ? path.relative(map.root, t).split(path.sep).join("/") : t;
  const file = map.file(rel);
  if (file) return fileOutline(map, file, budget);
  const prefix = rel === "" || rel === "." ? "" : `${rel}/`;
  const inFolder = [...map.entries()].filter((f) => f.p.startsWith(prefix));
  if (inFolder.length) return folderOutline(map, prefix, inFolder, budget);
  const sym = symbolHits(map, t);
  if (sym.length) return symbolOutline(map, sym, budget);
  return `Nothing called "${target}" in the code map: not a file, folder or symbol. airband_map with find searches by words.`;
}

export function symbolHits(map: MappedCode, name: string): { file: FileEntry; decl: Decl }[] {
  const [a, b] = name.includes(".") && !name.includes("/") ? name.split(".", 2) : [undefined, name];
  const out: { file: FileEntry; decl: Decl }[] = [];
  for (const f of map.entries()) {
    for (const d of f.d) if (d.n === b && (!a || d.p === a)) out.push({ file: f, decl: d });
  }
  return out.sort((x, y) => Number(isLowValuePath(x.file.p)) - Number(isLowValuePath(y.file.p)) || (map.graph.rank.get(y.file.p) ?? 0) - (map.graph.rank.get(x.file.p) ?? 0));
}

function signature(map: MappedCode, file: FileEntry, d: Decl): string {
  // Read from the file itself: always current, and never stored twice.
  try {
    const text = fs.readFileSync(path.join(map.root, file.p), "utf8");
    const lines = text.split("\n").slice(d.s - 1, Math.min(d.e, d.s + 3));
    let sig = "";
    for (const l of lines) {
      sig += ` ${l.trim()}`;
      if (/[{:]\s*$|=>\s*[({]?\s*$|\)\s*$/.test(l) || sig.length > 140) break;
    }
    sig = sig.replace(/\s+/g, " ").trim().replace(/\s*[{(]\s*$/, "");
    return sig.length > 150 ? `${sig.slice(0, 149)}…` : sig;
  } catch {
    return `${d.k} ${d.n}`;
  }
}

function fileOutline(map: MappedCode, f: FileEntry, budget: number): string {
  const out: string[] = [`${f.p}  ${f.n} lines`];
  const top = f.d.filter((d) => !d.p || d.k === "method");
  let used = tokensOf(out[0]);
  for (const d of top) {
    const line = `  ${d.s}-${d.e}  ${d.p ? "  " : ""}${signature(map, f, d)}${d.x ? "" : "  (not exported)"}`;
    if (used + tokensOf(line) > budget * 0.7) {
      out.push(`  … ${top.length - (out.length - 1)} more declarations`);
      break;
    }
    out.push(line);
    used += tokensOf(line);
  }
  const imports = [...(map.graph.imports.get(f.p) ?? [])];
  const importers = [...(map.graph.importers.get(f.p) ?? [])].sort((a, b) => (map.graph.rank.get(b) ?? 0) - (map.graph.rank.get(a) ?? 0));
  if (imports.length) out.push(`imports: ${listShort(imports, 6)}`);
  if (importers.length) out.push(`imported by ${importers.length}: ${listShort(importers, 6)}`);
  return out.join("\n");
}

function folderOutline(map: MappedCode, prefix: string, files: FileEntry[], budget: number): string {
  const sub = new Map<string, FileEntry[]>();
  const here: FileEntry[] = [];
  for (const f of files) {
    const rest = f.p.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i < 0) here.push(f);
    else {
      const dir = rest.slice(0, i);
      let list = sub.get(dir);
      if (!list) sub.set(dir, (list = []));
      list.push(f);
    }
  }
  const rank = (f: FileEntry) => map.graph.rank.get(f.p) ?? 0;
  const out = [`${prefix || "./"}  ${files.length} files`];
  const mod = map.modules().find((m) => `${m.id}/` === prefix) ?? (prefix && fs.existsSync(docPath(map.root, prefix.slice(0, -1))) ? map.moduleOrFolder(prefix.slice(0, -1)) : undefined);
  let doc: string | undefined;
  if (mod) {
    if (mod.dependsOn.length) out.push(`uses: ${mod.dependsOn.join(", ")}`);
    const conv = conventionLines(map.conventions(mod.id).filter((c) => c.share >= 0.6).slice(0, 3));
    if (conv.length) out.push(`conventions: ${conv.join("; ")}`);
    const md = map.moduleDoc(mod.id);
    doc = md ? serveModuleDoc(md, (n) => map.nameExists(n)) : undefined;
  }
  let used = tokensOf(out.join("\n"));
  const dirs = [...sub.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [dir, list] of dirs) {
    const best = [...list].sort((a, b) => rank(b) - rank(a))[0];
    const line = `  ${dir}/  ${list.length} files · e.g. ${best.p.slice(prefix.length + dir.length + 1)}`;
    if (used + tokensOf(line) > budget * 0.6) {
      out.push(`  … ${dirs.length - (out.length - 1)} more folders`);
      break;
    }
    out.push(line);
    used += tokensOf(line);
  }
  for (const f of [...here].sort((a, b) => rank(b) - rank(a))) {
    const names = f.d.filter((d) => d.x && !d.p).slice(0, 4).map((d) => d.n);
    const line = `  ${f.p.slice(prefix.length)}  ${f.n} lines${names.length ? ` · ${names.join(", ")}` : ""}`;
    if (used + tokensOf(line) > budget) {
      out.push(`  … more files`);
      break;
    }
    out.push(line);
    used += tokensOf(line);
  }
  return doc ? `${out.join("\n")}\n\n${fitBudget(doc, 1500)}` : out.join("\n");
}

function symbolOutline(map: MappedCode, hits: { file: FileEntry; decl: Decl }[], budget: number): string {
  const out: string[] = [];
  let used = 0;
  for (const { file, decl } of hits.slice(0, 3)) {
    const block = [`${file.p}:${decl.s}-${decl.e}  ${decl.route ?? decl.k}  ${signature(map, file, decl)}`];
    if (decl.d) block.push(`  ${decl.d}`);
    const members = file.d.filter((d) => d.p === decl.n);
    if (members.length) block.push(`  members: ${members.slice(0, 12).map((m) => `${m.n} ${m.s}`).join(", ")}${members.length > 12 ? ", …" : ""}`);
    const users = map.graph.usedBy(file.p, memberName(decl));
    if (users.length) block.push(`  used by ${users.length}: ${edgeList(users, "from", 5)}`);
    const uses = map.graph.uses(file.p, memberName(decl));
    if (uses.length) block.push(`  uses: ${edgeList(uses, "to", 6)}`);
    const text = block.join("\n");
    if (used + tokensOf(text) > budget && out.length) break;
    out.push(text);
    used += tokensOf(text);
  }
  if (hits.length > 3) out.push(`(${hits.length - 3} more declarations with this name)`);
  return out.join("\n");
}
