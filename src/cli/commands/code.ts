// Finding your way in code: the code map, its answers, and the checks CI can run.
import * as path from "node:path";
import { diffReport, renderDiff } from "../../codemap/diff";
import { CodeMap } from "../../codemap/index";
import { usage, type Handler } from "../context";
import { out } from "../ui";

export const CODE_COMMANDS: Record<string, Handler> = {
  map: async (c) => {
    const { rest, folder } = c;
    const root = path.resolve(rest || folder);
    const m = new CodeMap(root);
    const s = await m.refresh({ yieldEvery: 1e9 });
    out(`${root}: ${s.files} files, ${s.decls} declarations; read ${s.parsed}, ${s.removed} gone, in ${(s.ms / 1000).toFixed(1)} s${s.bytes ? `, ${(s.bytes / 1024).toFixed(0)} KB` : ""}`);
    return 0;
  },
  find: async (c) => {
    const { rest, limit } = c;
    if (!rest) return usage("find <words or a name>");
    out((await c.freshMap()).find(rest, { limit, budget: 600 }));
    return 0;
  },
  outline: async (c) => {
    const { rest } = c;
    if (!rest) return usage("outline <path or name>");
    out((await c.freshMap()).outline(rest, 1200));
    return 0;
  },
  graph: async (c) => {
    const { rest, hops } = c;
    if (!rest) return usage("graph <name or path>");
    out((await c.freshMap()).graphOf(rest, hops as 1 | 2, 1200));
    return 0;
  },
  overview: async (c) => {
    out((await c.freshMap()).overview(1200));
    return 0;
  },
  diff: async (c) => {
    const { rest, asJson } = c;
    const r = await diffReport(await c.freshMap(), rest);
    if (typeof r === "string") {
      out(r);
      return 1;
    }
    out(asJson ? JSON.stringify(r, null, 2) : renderDiff(r, 4000));
    return 0;
  },
  check: async (c) => {
    const { rest } = c;
    const m = await c.freshMap();
    if (rest === "unused") out(m.unusedText(3000));
    else if (rest === "docs") {
      const stale = m.staleDocs();
      out(stale.length ? stale.map((d) => `${d.file}:${d.line}  ${d.missing} (${d.kind}) no longer exists`).join("\n") : "Every file, hook and script the docs name exists.");
      // A stale doc line fails a CI step on purpose.
      return stale.length ? 1 : 0;
    } else return usage("check unused|docs");
    return 0;
  },
};
