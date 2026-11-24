// airband_flightlog: what any chat on this computer was asked and did, a line per ask. Other chats'
// words come back fenced as data.
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exchangeText } from "../sessions/record/extract";
import { listHeads, readAsks, recordName, type RecordAsk, type RecordHead } from "../sessions/record/store";
import { catchUpRecord, recordBehind } from "../sessions/record/update";
import { plural, shorten } from "../core/text";
import { renderTokenReport, tokenReport } from "../sessions/tokens";
import { data, text } from "./answer";
import { freshMap } from "./maps";

export function registerFlightlogTool(server: McpServer, root: string): void {
  server.registerTool(
    "airband_flightlog",
    {
      description:
        "What AI chats on this computer were asked and did, a line per ask. No chat: list; query: search all (words, code, tickets, PRs). n: one ask whole. tokens: its token use.",
      inputSchema: {
        chat: z.string().optional(),
        query: z.string().optional(),
        last: z.number().int().min(1).max(500).optional(),
        n: z.number().int().min(1).optional(),
        tokens: z.boolean().optional(),
      },
    },
    async ({ chat, query, last, n, tokens }) => {
      if (tokens) {
        const h = chat ? findRecords(root, chat)[0] : listHeads().filter((x) => x.cwd === root).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!h?.file) return text("No chat file to read: name the chat.", true);
        return text(renderTokenReport(tokenReport(h.tool, h.file), recordName(h)));
      }
      if (!chat && query) return data(await recall(root, query));
      if (!chat) {
        const heads = listHeads().slice(0, 25);
        if (!heads.length) return text("No flightlogs yet. Airband starts one for each chat as it replies.");
        return data(
          heads.length
            ? heads.map((h) => `${recordName(h)} · ${h.cwd ? path.basename(h.cwd) : "?"} · ${h.n} asks · ${when(h.updatedAt)} · id ${h.id.slice(0, 8)}`).join("\n")
            : "No flightlogs yet. Airband starts one for each chat as it replies.",
        );
      }
      const found = findRecords(root, chat);
      if (!found.length) return text(`No flightlog matches "${chat}". Call airband_flightlog with no chat to see them.`, true);
      if (n) {
        const words = exchangeText(found[0].id, n);
        return words ? data(words) : text(`No ask #${n} in a flightlog matching "${chat}".`, true);
      }
      if (found.length > 1 && !found.some((h) => h.id === chat)) {
        const list = found.slice(0, 10).map((h) => `${recordName(h)} · ${h.cwd ? path.basename(h.cwd) : "?"} · ${h.n} asks · id ${h.id.slice(0, 8)}`);
        if (found.length > 10) list.push(`… ${found.length - 10} more`);
        return data(`Several chats match; name one by id:\n${list.join("\n")}`);
      }
      const h = found[0];
      // A record behind its chat (a big chat, read in the background until now) is caught up first.
      if (recordBehind(h.id, h.tool, h.file) > 0) await catchUpRecord(h.id, h.tool, h.file);
      let asks = readAsks(h.id);
      if (query) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        asks = asks.filter((a) => {
          const hay = `${a.ask} ${a.did} ${a.open ?? ""} ${a.files.join(" ")} ${a.refs.join(" ")}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
      }
      const count = last ?? 30;
      const shown = asks.slice(-count);
      const fresh = readAsks(h.id, 1)[0];
      const lines = [
        `${recordName(h)} (${h.tool}, ${h.cwd ?? "folder unknown"}): ${h.n} asks, last ${when(h.updatedAt)}.`,
        h.goal ? `It set out to: ${shorten(h.goal, 240)}` : "",
        fresh?.open ? `Still open: ${fresh.open}` : "",
        query ? `${plural(asks.length, "ask")} mention "${query}"${asks.length > count ? `; the newest ${count}` : ""}:` : asks.length > count ? `The newest ${count} (ask with last for more):` : "",
        ...shown.map(askLine),
      ].filter(Boolean);
      return data(lines.join("\n"), undefined, "The exact words of an ask: airband_flightlog with its n.");
    },
  );
}

const when = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The records a chat name, id or part of either points to; this folder's first. */
function findRecords(root: string, chat: string): RecordHead[] {
  const q = chat.trim().toLowerCase();
  const all = listHeads();
  const exact = all.filter((h) => h.id === q || h.id.startsWith(q) || (h.title ?? "").toLowerCase() === q);
  const hits = exact.length ? exact : all.filter((h) => (h.title ?? "").toLowerCase().includes(q) || (h.goal ?? "").toLowerCase().includes(q));
  return hits.sort((a, b) => Number(b.cwd === root) - Number(a.cwd === root));
}

function askLine(a: RecordAsk): string {
  const extra = [a.files.length ? `${plural(a.files.length, "file")}` : "", ...a.refs].filter(Boolean).join(", ");
  return `#${a.n} · ${when(a.at)} · ${shorten(a.ask, 160)} → ${shorten(a.did || "(no reply)", 220)}${extra ? ` (${extra})` : ""}`;
}

/**
 * Every chat's asks that match: by words, and by code. A code name the map knows ("useEditRights")
 * also finds the asks that changed the file it lives in.
 */
async function recall(root: string, query: string): Promise<string> {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  let files = new Set<string>();
  try {
    const map = await freshMap(root);
    const hits = map.findHits(query).filter((h) => h.score > 20).slice(0, 3);
    files = new Set(hits.map((h) => path.join(root, h.doc.file.p)));
  } catch {
    // No map here: words alone.
  }
  const found: { h: RecordHead; a: RecordAsk; score: number }[] = [];
  for (const h of listHeads()) {
    for (const a of readAsks(h.id)) {
      const hay = `${a.ask} ${a.did} ${a.open ?? ""} ${a.files.join(" ")} ${a.refs.join(" ")}`.toLowerCase();
      let score = words.filter((w) => hay.includes(w)).length / Math.max(1, words.length);
      if (a.files.some((f) => files.has(f))) score += 1;
      if (score >= 0.66) found.push({ h, a, score: score + (h.cwd === root ? 0.1 : 0) + a.at / 1e15 });
    }
  }
  if (!found.length) return `No chat's asks mention "${query}".`;
  found.sort((x, y) => y.score - x.score);
  return found
    .slice(0, 12)
    .map(({ h, a }) => `${recordName(h)} (id ${h.id.slice(0, 8)}) ${askLine(a)}`)
    .join("\n");
}
