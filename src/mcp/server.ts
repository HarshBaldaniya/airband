// Airband's tools for any AI tool that speaks MCP (Claude Code, Codex, Cursor, Gemini CLI ...):
// the code map, the flightlogs of every chat on this computer, and notes. Three tools on purpose:
// every tool's definition is paid for in every chat, used or not, so they are few and short.
import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fenced, fenceNote, newFenceTag } from "../core/fence";
import { listNotes, readNote, saveNote } from "../core/notes";
import { catchUpRecord, recordBehind } from "../core/record/update";
import { exchangeText } from "../core/record/extract";
import { listHeads, readAsks, recordName, type RecordAsk, type RecordHead } from "../core/record/store";
import { CodeMap } from "../codemap/index";
import { diffReport, renderDiff } from "../codemap/diff";
import { findProject } from "../codemap/where";
import { renderTokenReport, tokenReport } from "../core/tokens";
import { allCommands, renderCommand, userLibraryDir, type LibraryCommand } from "../library/index";
import { plural, shorten } from "../core/text";

const root = process.env.AIRBAND_ROOT || process.cwd();

// Shown to the agent at the start of every session, so it reaches for Airband without being told.
// Short on purpose (the agent reads it in every chat); the most useful line first.
const INSTRUCTIONS = [
  "Airband gives this project a map of its code and the records of the person's other AI chats on this computer.",
  "- To find code (where something is defined, what calls or imports it, how a folder is laid out), call airband_map before grep, glob or reading whole files: find for a name or plain words, outline for a file or folder, graph for who uses what, no arguments for an overview. It answers in a few hundred tokens.",
  "- To review a branch or pull request, call airband_map with diff first (\"main..feature\", a branch, or \"#128\"): what it changed, who calls each change and which tests reach it, without checking it out. Add in to ask another project the person mapped (\"my-api\").",
  "- When the person refers to earlier work or another chat (what was done, which chat changed something, what happened while they were away, a ticket like ENG-142, a PR like #128), call airband_flightlog: with query to search every chat, or with chat to read one.",
  "- airband_notes holds notes chats left for this project; read them before working in an unfamiliar area, and save one when you learn something the next chat should know.",
].join("\n");

const server = new McpServer({ name: "airband", version: __AIRBAND_VERSION__ }, { instructions: INSTRUCTIONS });

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) });

/** An answer made of words other chats wrote (or a note a repository carries): fenced as data. */
const data = (t: string, whose = "from the person's AI chats", after?: string) => {
  const tag = newFenceTag();
  return text(`${fenceNote(tag, whose)}\n${fenced(t, tag)}${after ? `\n${after}` : ""}`);
};

// ---- the code map: where things are in this codebase, in a few hundred tokens, no AI ----

const maps = new Map<string, { map: CodeMap; at: number }>();

/** A folder's map (this project's unless another is named), brought up to date first: only files
 *  whose size or time changed are read again. */
async function freshMap(folder = root): Promise<CodeMap> {
  let m = maps.get(folder);
  if (!m) maps.set(folder, (m = { map: new CodeMap(folder), at: 0 }));
  if (Date.now() - m.at > 1500) {
    await m.map.refresh();
    m.at = Date.now();
  }
  return m.map;
}

/**
 * What the chat calling is working on: the files its newest asks touched. The calling chat is this
 * folder's most recently active one (an MCP server is started per chat, in the chat's folder).
 */
function recentFiles(): string[] {
  try {
    const head = listHeads().filter((h) => h.cwd === root).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!head) return [];
    return [...new Set(readAsks(head.id, 8).flatMap((a) => a.files))].slice(0, 20);
  } catch {
    return [];
  }
}

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
    if (find) return answer(map.find(find, { focus: folder === root ? recentFiles() : [] }));
    if (outline) return answer(map.outline(outline));
    if (graph) return answer(map.graphOf(graph, (hops ?? 1) as 1 | 2));
    return answer(map.overview());
  },
);

// ---- flightlogs: what any chat on this computer was asked and did, a line per ask ----

const when = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The records a chat name, id or part of either points to; this folder's first. */
function findRecords(chat: string): RecordHead[] {
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
      const h = chat ? findRecords(chat)[0] : listHeads().filter((x) => x.cwd === root).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!h?.file) return text("No chat file to read: name the chat.", true);
      return text(renderTokenReport(tokenReport(h.tool, h.file), recordName(h)));
    }
    if (!chat && query) return data(await recall(query));
    if (!chat) {
      const heads = listHeads().slice(0, 25);
      if (!heads.length) return text("No flightlogs yet. Airband starts one for each chat as it replies.");
      return data(
        heads.length
          ? heads.map((h) => `${recordName(h)} · ${h.cwd ? path.basename(h.cwd) : "?"} · ${h.n} asks · ${when(h.updatedAt)} · id ${h.id.slice(0, 8)}`).join("\n")
          : "No flightlogs yet. Airband starts one for each chat as it replies.",
      );
    }
    const found = findRecords(chat);
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

/**
 * Every chat's asks that match: by words, and by code. A code name the map knows ("useEditRights")
 * also finds the asks that changed the file it lives in.
 */
async function recall(query: string): Promise<string> {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  let files = new Set<string>();
  try {
    const map = await freshMap();
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

// ---- notes: what one chat leaves in this project for others ----

server.registerTool(
  "airband_notes",
  {
    description: "Notes chats leave for this project. None: list. name: read one. title and text: save one (a handover).",
    inputSchema: {
      name: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
    },
  },
  async ({ name, title, text: body }) => {
    if (title && body) {
      let saved: string;
      try {
        saved = saveNote(root, title, `# ${title}\n\n${body.trim()}`);
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
      return text(`Saved as ${saved}. Other chats can read it with airband_notes.`);
    }
    if (name) {
      const note = readNote(root, name);
      if (note === undefined) return text(`No note called ${name}. Call airband_notes with nothing to see the names.`, true);
      return data(note, `a note saved in this project's .airband/notes, which anyone who can change the repository can write`);
    }
    const notes = listNotes(root);
    return text(
      notes.length
        ? notes.map((x) => `${x.name} — ${x.title} (${new Date(x.at).toISOString().slice(0, 16).replace("T", " ")})`).join("\n")
        : "No notes yet in this project.",
    );
  },
);

// ---- the Library: Airband's commands and the person's own, as slash commands ----

type Registered = ReturnType<typeof server.registerPrompt>;
const prompts = new Map<string, { reg: Registered; key: string }>();

function promptKey(c: LibraryCommand): string {
  return `${c.source}\0${c.description}\0${c.body}\0${c.args.map((a) => `${a.name}${a.required ? "*" : ""}`).join(",")}`;
}

/** Offers every command as an MCP prompt; run again, it adds, updates and removes what changed. */
function syncPrompts() {
  const commands = allCommands();
  const seen = new Set<string>();
  for (const c of commands) {
    seen.add(c.name);
    const key = promptKey(c);
    const had = prompts.get(c.name);
    if (had && had.key === key) continue;
    had?.reg.remove();
    const argsSchema: Record<string, z.ZodTypeAny> = {};
    for (const a of c.args) argsSchema[a.name] = a.required ? z.string().describe(a.description) : z.string().optional().describe(a.description);
    const reg = server.registerPrompt(
      c.name,
      { title: c.title, description: c.needs ? `${c.description} (needs ${c.needs} connected)` : c.description, argsSchema },
      (values: Record<string, unknown>) => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: renderCommand(c, values as Record<string, string | undefined>) } }],
      }),
    );
    prompts.set(c.name, { reg, key });
  }
  for (const [name, p] of prompts) {
    if (!seen.has(name)) {
      p.reg.remove();
      prompts.delete(name);
    }
  }
}

syncPrompts();
// The person's own commands are live: a saved file is offered within a few seconds.
let libraryStamp = "";
setInterval(() => {
  let stamp = "";
  try {
    const dir = userLibraryDir();
    for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
      if (!f.endsWith(".md")) continue;
      const st = fs.statSync(path.join(dir, f));
      stamp += `${f}:${st.mtimeMs}:${st.size};`;
    }
  } catch {
    // No library folder: only the shipped commands.
  }
  if (stamp !== libraryStamp) {
    const first = libraryStamp === "" && stamp === "";
    libraryStamp = stamp;
    if (!first) syncPrompts();
  }
}, 3000).unref();

server.connect(new StdioServerTransport()).catch((err) => {
  console.error("airband-mcp:", err);
  process.exit(1);
});
