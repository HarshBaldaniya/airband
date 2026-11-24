// What Airband tells the person, not the model, in the agent's own window: a line when a chat
// starts (Airband is on, the map is ready, who this chat shares with, what other chats did here
// lately) and a line when another chat's work rides along with a message. Hooks hand them over as
// `systemMessage`, which Claude Code and Gemini CLI show and never send to the model, so they cost
// no tokens. Codex has no place for one, so Codex chats get none.
import * as fs from "node:fs";
import * as path from "node:path";
import { storeDir } from "../codemap/where";
import { listHeads, type RecordHead } from "./record/store";
import { readConnections } from "./store";
import type { InboxItem } from "./types";
import { readConfig } from "./config";
import { sameFolder } from "./paths";
import { agentName } from "./agents";
import { tokensFor } from "./text";
import { HOUR_MS } from "./units";

/** How far back "other chats worked here" looks. */
const RECENT_MS = 12 * HOUR_MS;

/** The agent as people know it; an unknown one as it was given. */
const agentLabel = (tool: string | undefined) => agentName(tool) ?? tool ?? "an agent";

/** A chat's name as people see it: its title, else what it set out to do, short. */
function chatName(title: string | undefined, fallback?: string): string {
  const t = (title || fallback || "a chat").replace(/\s+/g, " ").trim();
  return `“${t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t}”`;
}

/** "A", "A and B", "A, B and 2 more". */
function list(names: string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export function noticesOn(): boolean {
  return readConfig().notices;
}

/** The map of this folder: ready (with its size) or built on first use. */
function mapPart(cwd: string): string {
  const name = path.basename(cwd) || cwd;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(storeDir(cwd), "meta.json"), "utf8")) as { files?: number };
    if (meta.files) return `map of ${name} ready (${meta.files.toLocaleString("en-US")} files)`;
  } catch {
    // Not mapped yet.
  }
  return `map of ${name} builds on first use`;
}

/** The line (or two) a chat starts with. */
export function startNotice(o: { sessionId?: string; cwd?: string; now?: number }): string {
  const now = o.now ?? Date.now();
  const parts = ["✓ Airband"];
  if (o.cwd) parts.push(mapPart(o.cwd));

  const id = o.sessionId;
  const linked = id ? readConnections().filter((c) => !c.paused && (c.from.id === id || c.to.id === id)) : [];
  const others = linked.map((c) => (c.from.id === id ? c.to : c.from));
  const seen = new Set<string>();
  const peers = others.filter((p) => !seen.has(p.id) && seen.add(p.id)).map((p) => `${chatName(p.title)} (${agentLabel(p.tool)})`);
  parts.push(peers.length ? `sharing with ${list(peers)}` : "other chats can catch up on this one");
  const lines = [parts.join(" · ")];

  // Other chats that worked in this folder lately and aren't already shared with: worth a catch-up.
  if (o.cwd) {
    const recent = listHeads()
      .filter((h: RecordHead) => h.id !== id && !seen.has(h.id) && h.n > 0 && h.cwd && sameFolder(h.cwd, o.cwd!) && now - h.updatedAt < RECENT_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (recent.length) {
      const names = recent.map((h) => `${chatName(h.title, h.goal)} (${agentLabel(h.tool)})`);
      const one = recent.length === 1;
      lines.push(`  ${one ? "Another chat" : `${recent.length} other chats`} worked here in the last 12 hours: ${list(names)}. Say “catch up” to hear what ${one ? "it" : "they"} did.`);
    }
  }
  return lines.join("\n");
}

/** The line that says what rode along with this message. */
export function deliveryNotice(items: InboxItem[]): string | undefined {
  if (!items.length) return undefined;
  const work = items.filter((i) => i.kind !== "notice");
  const changes = items.length - work.length;
  const seen = new Set<string>();
  const from = work.filter((i) => !seen.has(i.from.id) && seen.add(i.from.id)).map((i) => `${chatName(i.from.title)} (${agentLabel(i.from.tool)})`);
  if (!from.length) return `↪ Airband passed on ${changes === 1 ? "a channel change" : `${changes} channel changes`}`;
  return `↪ Airband added what ${list(from)} did to this message`;
}

// ---- after an Airband tool: one line saying what it found and what it saved ----

/** What a tool call handed back, as text, whatever shape the agent passes it in. */
function responseText(r: unknown): string {
  if (typeof r === "string") return r;
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || v == null) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      else for (const k of ["content", "result", "structuredContent"]) walk(o[k], depth + 1);
    }
  };
  walk(r, 0);
  return parts.join("\n");
}

const FILE_REF = /(?<![\w@/.-])((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z][A-Za-z0-9]{0,5})(?::\d+(?:-\d+)?)?(?![\w/])/g;

/** The files an answer points to, that exist under its project: what the agent would otherwise read. */
function filesNamed(answer: string, root: string): { count: number; bytes: number } {
  const seen = new Set<string>();
  let bytes = 0;
  for (const m of answer.matchAll(FILE_REF)) {
    const rel = m[1];
    if (seen.has(rel) || seen.size >= 60 || rel.startsWith("..")) continue;
    try {
      const st = fs.statSync(path.join(root, rel));
      if (!st.isFile()) continue;
      seen.add(rel);
      bytes += st.size;
    } catch {
      // Not a file here (a name like "e.g." or a package).
    }
  }
  return { count: seen.size, bytes };
}

/** "about 300", "about 9,800", "about 41,000": a round number, as an estimate should be. */
function about(tokens: number): string {
  const r = tokens < 1000 ? Math.max(10, Math.round(tokens / 10) * 10) : Math.round(tokens / 100) * 100;
  return `about ${r.toLocaleString("en-US")}`;
}

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;

/**
 * The line shown after an Airband tool call (Claude Code only): what it found, how many tokens the
 * answer cost, and what reading the files it points to would have cost instead. The comparison is
 * measured, not claimed: the answer's own length, and the real size on disk of every file it names.
 * Said only when it is a real saving; nothing for errors or small answers.
 */
export function toolNotice(toolName: string | undefined, toolInput: unknown, toolResponse: unknown, cwd: string | undefined): string | undefined {
  const tool = /airband_(map|flightlog|notes)$/.exec(toolName ?? "")?.[1];
  if (!tool) return undefined;
  const input = (toolInput && typeof toolInput === "object" ? toolInput : {}) as Record<string, unknown>;
  if ((toolResponse as { isError?: boolean } | undefined)?.isError) return undefined;
  const answer = responseText(toolResponse);
  if (!answer.trim()) return undefined;
  const str = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim() : undefined);

  if (tool === "notes") return str("title") && str("text") ? `↪ Airband saved a note for the next chat: ${quote(str("title")!)}` : undefined;
  if (tool === "flightlog") {
    const q = str("query");
    if (!q || str("chat")) return undefined;
    if (/^No chat's asks mention/.test(answer)) return `↪ Airband searched every chat for ${quote(q)}: nothing yet`;
    const n = answer.split("\n").filter((l) => / · .* → /.test(l)).length;
    return n ? `↪ Airband found ${n} earlier ask${n === 1 ? "" : "s"} about ${quote(q)} in your chats` : undefined;
  }

  // The map: what it found, and the measured saving.
  const other = /^In ([^\n]+?) \(([^\n]+)\):\n/.exec(answer);
  const root = other?.[2] ?? cwd;
  const where = other ? ` in ${other[1]}` : "";
  let what: string;
  const diff = str("diff");
  if (diff !== undefined || input.diff === "") {
    const head = /: (\d+) declarations? changed in (\d+) files?/.exec(answer);
    what = head ? `${diff || "this branch"} changes ${head[1]} declaration${head[1] === "1" ? "" : "s"} in ${head[2]} file${head[2] === "1" ? "" : "s"}, with callers and tests` : `read what ${diff || "this branch"} changed`;
  } else if (str("graph")) {
    const used = /used by (\d+)/.exec(answer)?.[1] ?? /imported by (\d+)/.exec(answer)?.[1];
    what = used ? `${quote(str("graph")!)} and ${used === "1" ? "the one place that uses it" : `the ${used} places that use it`}` : `who uses ${quote(str("graph")!)}`;
  } else if (str("find")) {
    if (/^Nothing in the code map|still being built/.test(answer)) return undefined;
    what = `found ${quote(str("find")!)}`;
  } else if (str("outline")) what = `the outline of ${quote(str("outline")!)}`;
  else if (input.check) what = input.check === "unused" ? "checked for unused code" : "checked the docs for stale names";
  else what = "the project overview";

  const cost = tokensFor(answer.length);
  const named = root ? filesNamed(answer, root) : { count: 0, bytes: 0 };
  const instead = tokensFor(named.bytes);
  const saving = named.count >= 1 && instead >= cost * 2 && instead - cost >= 500;
  const tail = saving ? ` · ${about(cost)} tokens instead of ${about(instead)} to read the ${named.count === 1 ? "file" : `${named.count} files`}` : "";
  return `↪ Airband${where}: ${what}${tail}`;
}
