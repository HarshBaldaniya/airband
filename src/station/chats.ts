// Every recent chat on this computer, in Claude Code, Codex and Gemini CLI, with what it is doing
// now: read from Airband's own records (the flightlog) and the status each chat's hook writes.
import * as fs from "node:fs";
import * as path from "node:path";
import { airbandHome } from "../core/paths";
import { listHeads, readAsks, type RecordHead, type RecordTool } from "../core/record";
import { readHookStatus, resolveStatus } from "../core/status";
import type { Status } from "../core/types";

export type Agent = RecordTool;
export const AGENT_NAME: Record<Agent, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" };

export interface LiveChat {
  id: string;
  agent: Agent;
  title: string;
  project: string;
  cwd?: string;
  status: Status;
  /** What it waits for, when it waits. */
  line?: string;
  /** The person's latest ask, and what came of it. */
  lastAsk?: string;
  lastDid?: string;
  /** A question or "Next:" the latest reply ended on. */
  open?: string;
  updatedAt: number;
  /** When the current status began. */
  since: number;
}

const ORDER: Record<Status, number> = { waiting: 0, working: 1, done: 2, idle: 3 };
/** Words fit for a small screen: no Markdown marks, no escaped line breaks, one line. */
export function plain(t: string): string {
  return t
    .replace(/\\[nrt]/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*|__|`|^#+\s*/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*\(?https?:\/\/\S+\)?/g, "")
    .replace(/[:,]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const short = (t: string | undefined, max: number) => {
  if (!t) return undefined;
  const s = plain(t);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function titleOf(h: Pick<RecordHead, "id" | "title" | "goal">): string {
  return short(h.title, 70) ?? short(h.goal, 70) ?? h.id.slice(0, 8);
}

function mtime(file: string | undefined): number | undefined {
  if (!file) return undefined;
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

// Light on the disk: the chat records are read again only every so often (a status change comes
// from the hook's small status file at once), and each chat's latest ask only when its file grows.
const HEADS_FRESH_MS = 15_000;
let heads: { at: number; home: string; list: RecordHead[] } | undefined;
const lastAsk = new Map<string, { size: number; ask: ReturnType<typeof readAsks>[number] | undefined }>();

function cachedHeads(now: number): RecordHead[] {
  const home = airbandHome();
  if (heads?.home !== home) lastAsk.clear();
  if (!heads || heads.home !== home || now - heads.at > HEADS_FRESH_MS) heads = { at: now, home, list: listHeads() };
  return heads.list;
}

function cachedLastAsk(h: RecordHead): ReturnType<typeof readAsks>[number] | undefined {
  const size = h.n;
  const hit = lastAsk.get(h.id);
  if (hit && hit.size === size) return hit.ask;
  const ask = readAsks(h.id, 1)[0];
  lastAsk.set(h.id, { size, ask });
  return ask;
}

/** Forget what was read, so the next look reads everything again (tests, a new day). */
export function forgetReads(): void {
  heads = undefined;
  lastAsk.clear();
}

/** Chats that moved in the last `windowMs`, the ones that need you first. */
export function liveChats(now = Date.now(), windowMs = 24 * 3600e3, limit = 60): LiveChat[] {
  const out: LiveChat[] = [];
  for (const h of cachedHeads(now)) {
    const hook = readHookStatus(h.id);
    const last = Math.max(h.updatedAt, hook?.at ?? 0);
    if (now - last > windowMs) continue;
    const r = resolveStatus(mtime(h.file) ?? h.updatedAt, hook, now);
    const ask = cachedLastAsk(h);
    out.push({
      id: h.id,
      agent: h.tool,
      title: titleOf(h),
      project: h.cwd ? path.basename(h.cwd) : "no folder",
      ...(h.cwd ? { cwd: h.cwd } : {}),
      status: r.status,
      ...(r.line ? { line: short(r.line, 200) } : {}),
      ...(ask ? { lastAsk: short(ask.ask, 200), lastDid: short(ask.did, 280) } : {}),
      ...(ask?.open ? { open: short(ask.open, 200) } : {}),
      updatedAt: last,
      since: hook?.at ?? last,
    });
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt - a.updatedAt).slice(0, limit);
}

/** Words that say nothing about which chat is meant. */
const FILLER = new Set("a an and are at be can chat chats could did do does for from has have how i in is it its me my of on or our please session sessions should so tell that the their them then there this to us was we what when where which who why will with would you your".split(" "));

const words = (t: string) => t.toLowerCase().split(/[^a-z0-9#.-]+/).filter((w) => w.length > 1);

/** The chats a person may mean by a few words (its title, project or agent, or its id), best first.
 *  Whole words only, and filler words ("what", "is") don't count, so a general question matches none. */
export function matchChats(chats: LiveChat[], text: string): { chat: LiveChat; score: number }[] {
  const raw = text.trim();
  const exact = chats.find((c) => c.id === raw || (raw.length >= 8 && c.id.startsWith(raw)));
  if (exact) return [{ chat: exact, score: 100 }];
  const terms = words(raw).filter((w) => !FILLER.has(w));
  if (!terms.length) return [];
  const has = (pool: Set<string>, t: string) => pool.has(t) || (t.length >= 4 && [...pool].some((w) => w.startsWith(t)));
  const out: { chat: LiveChat; score: number }[] = [];
  for (const c of chats) {
    const name = new Set([...words(c.title), ...words(c.project)]);
    const more = new Set([...words(AGENT_NAME[c.agent]), ...words(c.lastAsk ?? "")]);
    let score = terms.filter((t) => has(name, t)).length * 3 + terms.filter((t) => has(more, t)).length;
    const q = terms.join(" ");
    if (c.project.toLowerCase() === q || c.title.toLowerCase() === q) score += 10;
    if (score > 0) out.push({ chat: c, score });
  }
  return out.sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt);
}

/** The one chat a person most likely means. */
export function findChat(chats: LiveChat[], words: string): LiveChat | undefined {
  return matchChats(chats, words)[0]?.chat;
}
