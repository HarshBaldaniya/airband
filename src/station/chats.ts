// Every recent chat on this computer, in Claude Code, Codex and Gemini CLI, with what it is doing
// now: read from Airband's own records (the flightlog) and the status each chat's hook writes.
import * as fs from "node:fs";
import * as path from "node:path";
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

/** Chats that moved in the last `windowMs`, the ones that need you first. */
export function liveChats(now = Date.now(), windowMs = 24 * 3600e3, limit = 60): LiveChat[] {
  const out: LiveChat[] = [];
  for (const h of listHeads()) {
    const hook = readHookStatus(h.id);
    const last = Math.max(h.updatedAt, hook?.at ?? 0);
    if (now - last > windowMs) continue;
    const r = resolveStatus(mtime(h.file) ?? h.updatedAt, hook, now);
    const ask = readAsks(h.id, 1)[0];
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

/** The chats a person may mean by a few words (its title, project or agent, or its id), best first. */
export function matchChats(chats: LiveChat[], words: string): { chat: LiveChat; score: number }[] {
  const raw = words.trim();
  const exact = chats.find((c) => c.id === raw || (raw.length >= 8 && c.id.startsWith(raw)));
  if (exact) return [{ chat: exact, score: 100 }];
  const q = raw.toLowerCase().replace(/\b(the|chat|session|one|in|on|for|my)\b/g, " ").replace(/\s+/g, " ").trim();
  const terms = q.split(" ").filter((t) => t.length > 1);
  if (!terms.length) return [];
  const out: { chat: LiveChat; score: number }[] = [];
  for (const c of chats) {
    const title = c.title.toLowerCase();
    const hay = `${title} ${c.project.toLowerCase()} ${AGENT_NAME[c.agent].toLowerCase()} ${(c.lastAsk ?? "").toLowerCase()}`;
    let score = terms.filter((t) => title.includes(t) || c.project.toLowerCase().includes(t)).length * 3 + terms.filter((t) => hay.includes(t)).length;
    if (c.project.toLowerCase() === q || title === q) score += 10;
    if (score > 0) out.push({ chat: c, score });
  }
  return out.sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt);
}

/** The one chat a person most likely means. */
export function findChat(chats: LiveChat[], words: string): LiveChat | undefined {
  return matchChats(chats, words)[0]?.chat;
}
