// The session record (a chat's flightlog): one short line per thing the person asked in a chat, what
// was done about it, the files it changed, the commits and PRs it mentioned, and anything left open.
// Written by code from the chat's own file (no AI), a few hundred bytes per ask, never a copy of the
// conversation: the exact words stay in the agent's file, found again through `src`.
//
//   ~/.airband/flightlogs/<id>.json    where the record has read up to, and what the chat is
//   ~/.airband/flightlogs/<id>.jsonl   one line per ask, appended
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentId } from "../../core/agents";
import { parseJsonLines, readJson } from "../../core/json";
import { airbandFile, safeId, writeFileAtomic } from "../../core/paths";
import { shorten } from "../../core/text";
import { DAY_MS, MiB } from "../../core/units";

export interface RecordAsk {
  n: number;
  at: number;
  /** The person's words (long pastes shortened, with how much was left out). */
  ask: string;
  /** What was done: the reply's first paragraph, which says the outcome. */
  did: string;
  /** A question or "Next:" the reply ended on. */
  open?: string;
  /** The reply handed the next step to the person: a question, "your step", "only you can". */
  yours?: boolean;
  /** A short summary for a notification: the outcome, then up to three key points, one per line. */
  brief?: string;
  files: string[];
  /** Commits, PRs, issues, tickets and Figma links named in the ask, the reply or what its commands printed. */
  refs: string[];
  /** Where this exchange is in the agent's file: byte offsets (Claude, Codex) or message indexes (Gemini). */
  src: [number, number];
}

export interface RecordHead {
  id: string;
  tool: AgentId;
  title?: string;
  cwd?: string;
  /** The agent's own chat file. */
  file: string;
  /** Read up to here (in the file's own units). */
  cursor: number;
  /** Asks recorded. */
  n: number;
  /** Gemini CLI: the ids of the last messages read, to find the place again after a rewind. */
  seen?: string[];
  /** The first thing asked: what the chat set out to do. */
  goal?: string;
  updatedAt: number;
}

/** A new chat's record is started by the hook; an older, bigger one is caught up in the background. */
export const HOOK_START_MAX = 8 * MiB;
/** The most the hook reads in one go: more is left to the background catch-up. */
export const HOOK_STEP_MAX = 16 * MiB;

const dir = () => airbandFile("flightlogs");
const headFile = (id: string) => path.join(dir(), `${id}.json`);
/** A record's log of asks, one JSON line each. */
export const askLog = (id: string) => path.join(dir(), `${id}.jsonl`);

/** A record's name as people read it: its title, else what it set out to do, else its id. */
export const recordName = (h: Pick<RecordHead, "id" | "title" | "goal">): string => h.title ?? (h.goal ? shorten(h.goal, 60) : h.id.slice(0, 8));

export function readHead(id: string): RecordHead | undefined {
  if (!safeId(id)) return undefined;
  return readJson<RecordHead | undefined>(headFile(id), undefined);
}

export function writeHead(h: RecordHead): void {
  fs.mkdirSync(dir(), { recursive: true });
  writeFileAtomic(headFile(h.id), JSON.stringify(h));
}

/** Adds asks to a record's log, after the ones it has. */
export function appendAsks(id: string, asks: RecordAsk[]): void {
  if (!asks.length) return;
  fs.mkdirSync(dir(), { recursive: true });
  fs.appendFileSync(askLog(id), asks.map((a) => JSON.stringify(a)).join("\n") + "\n");
}

/** Empties a record's log (its chat's file was replaced, so it is read again from the start). */
export function clearAsks(id: string): void {
  fs.rmSync(askLog(id), { force: true });
}

/** Every recorded ask, or the last `last` of them. */
export function readAsks(id: string, last?: number): RecordAsk[] {
  if (!safeId(id)) return [];
  let text: string;
  try {
    text = fs.readFileSync(askLog(id), "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n").filter(Boolean);
  return parseJsonLines<RecordAsk>((last ? lines.slice(-last) : lines).join("\n"));
}

/** All records kept on this computer, newest first. */
export function listHeads(): RecordHead[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((f) => readJson<RecordHead | undefined>(path.join(dir(), f), undefined))
    .filter((h): h is RecordHead => !!h)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Names a record (the extension knows titles; the hook doesn't). */
export function setRecordTitle(id: string, title: string, cwd?: string): void {
  const h = readHead(id);
  if (h && (h.title !== title || (cwd && h.cwd !== cwd))) writeHead({ ...h, title, cwd: cwd ?? h.cwd });
}

/** Deletes records not touched for `days` days, except those of chats still linked. */
export function pruneRecords(keep: Set<string>, days = 30, now = Date.now()): number {
  let gone = 0;
  for (const h of listHeads()) {
    if (keep.has(h.id) || now - h.updatedAt < days * DAY_MS) continue;
    for (const f of [headFile(h.id), askLog(h.id)]) fs.rmSync(f, { force: true });
    gone++;
  }
  return gone;
}
