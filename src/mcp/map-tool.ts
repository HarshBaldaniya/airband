// airband_map: where things are in this codebase, in a few hundred tokens, no AI.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { diffReport, renderDiff } from "../codemap/diff";
import { findProject } from "../codemap/where";
import { text } from "./answer";
import { freshMap, recentFiles } from "./maps";

export function registerMapTool(server: McpServer, root: string): void {
  server.registerTool(
    "airband_map",
    {
      description:
        "Code map (no AI), cheaper than grep or reading files. find: words/name → ranked code, path:start-end. outline: path/name → parts. graph: its users and uses. check: unused code, stale docs. diff: branch, a..b or #PR → changes, callers, tests. in: another project. None: overview.",
      inputSchema: {
        find: z.string().optional(),
        outline: z.string().optional(),
        graph: z.string().optional(),
        hops: z.number().int().min(1).max(2).optional(),
        check: z.enum(["unused", "docs"]).optional(),
        diff: z.string().optional(),
        in: z.string().optional(),
      },
    },
    async ({ find, outline, graph, hops, check, diff, in: other }) => {
      let folder = root;
      let label = "";
      if (other) {
        const p = findProject(other, root);
        if (typeof p === "string") return text(p, true);
        folder = p.root;
        label = folder === root ? "" : `In ${p.name} (${p.root}):\n`;
      }
      const map = await freshMap(folder);
      const answer = (t: string) => text(label + t);
      if (diff !== undefined) {
        const r = await diffReport(map, diff);
        return typeof r === "string" ? text(r, true) : answer(renderDiff(r));
      }
      if (check === "unused") return answer(map.unusedText());
      if (check === "docs") {
        const stale = map.staleDocs();
        return answer(stale.length ? stale.map((d) => `${d.file}:${d.line}  names ${d.missing} (${d.kind}), which no longer exists`).join("\n") : "Every file, hook and script the docs name exists.");
      }
      if (find) return answer(map.find(find, { focus: folder === root ? recentFiles(root) : [] }));
      if (outline) return answer(map.outline(outline));
      if (graph) return answer(map.graphOf(graph, (hops ?? 1) as 1 | 2));
      return answer(map.overview());
    },
  );
}
