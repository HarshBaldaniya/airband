// Every recent chat on this computer, in Claude Code, Codex and Gemini CLI, with what it is doing
// now: read from Airband's own records (the flightlog) and the status each chat's hook writes.
import * as fs from "node:fs";
import { airbandHome, safeId, statusDir } from "../core/paths";
import { AGENTS, type AgentId } from "../core/agents";
import { listHeads, readAsks, setRecordTitle, type RecordHead } from "../core/record";
import { chatApp, type ChatApp } from "../core/apps";
import { agentSummary } from "../core/setup";
import { readHookStatus, resolveStatus } from "../core/status";
import type { HookStatus, Status } from "../core/types";
import { plainText, shorten } from "../core/text";


export interface LiveChat {
  id: string;
  agent: AgentId;
  title: string;
  project: string;
  cwd?: string;
  /** Where it runs: a terminal, VS Code, the Claude app or the Codex app (when its file says). */
  app?: ChatApp;
  status: Status;
  /** What it waits for, when it waits. */
  line?: string;
  /** The person's latest ask, and what came of it. */
  lastAsk?: string;
  lastDid?: string;
  /** The latest reply's notification summary (see briefOf), and whether it left the next step to you. */
  lastBrief?: string;
  yours?: boolean;
  /** A question or "Next:" the latest reply ended on. */
  open?: string;
  updatedAt: number;
  /** When the current status began. */
  since: number;
}

const ORDER: Record<Status, number> = { waiting: 0, working: 1, done: 2, idle: 3 };
/** Words for a small screen: plain, one line, cut to `max`. */
const short = (t: string | undefined, max: number) => (t ? shorten(plainText(t), max) : undefined);

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
  if (heads?.home !== home) (lastAsk.clear(), names.clear());
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
  names.clear();
  replies.clear();
}

// A chat renamed in its agent (Claude Code's "rename"): the agent writes the new name into the chat's
// own file, and no hook runs. So the end of the file is read again whenever it grows, and a new
// name found there is kept in Airband's record too, for the flightlog and the board.
const TAIL_BYTES = 256 * 1024;
const names = new Map<string, { size: number; name?: string }>();

/** The latest name the person gave a chat in Claude Code, from the end of its file. */
export function renamedTitle(file: string, size: number, from = 0): string | undefined {
  if (from > 0 && from >= size) return undefined;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    // Only what is new since the last look (a rename is appended), and never more than the tail.
    const start = Math.max(0, size - TAIL_BYTES, from > 0 && from < size ? from - 1024 : 0);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    let name: string | undefined;
    for (const line of text.split("\n")) {
      if (!line.includes('"custom-title"')) continue;
      try {
        const o = JSON.parse(line) as { type?: string; customTitle?: string };
        if (o.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle.trim()) name = o.customTitle.trim();
      } catch {
        // A line cut at the start of the tail.
      }
    }
    return name;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function liveName(h: RecordHead): string | undefined {
  if (h.tool !== "claude" || !h.file) return undefined;
  let size: number;
  try {
    size = fs.statSync(h.file).size;
  } catch {
    return undefined;
  }
  const hit = names.get(h.id);
  if (hit && hit.size === size) return hit.name;
  // A working chat grows all the time: read only the part added since the last look.
  const name = renamedTitle(h.file, size, hit && hit.size < size ? hit.size : 0) ?? hit?.name;
  names.set(h.id, { size, name });
  if (name && name !== h.title) {
    try {
      setRecordTitle(h.id, name);
    } catch {
      // Shown anyway; kept next time.
    }
  }
  return name;
}

/** Chats that moved in the last `windowMs`, the ones that need you first. */
/** A chat's project as people name it: its folder, or for a git worktree (an agent's own, in
 *  <repo>/.claude/worktrees/<name>, or any linked worktree beside it) the repository it belongs to. */
export function projectOf(cwd: string | undefined): string {
  if (!cwd) return "no folder";
  const m = /^(.*?)[\\/]\.(?:claude|codex|gemini)[\\/]worktrees[\\/][^\\/]+/.exec(cwd);
  // The last part of the path, with either separator (a Windows path read on any computer).
  return (m ? m[1] : cwd).split(/[\\/]+/).filter(Boolean).pop() ?? cwd;
}

/** Whether a chat's file holds a reply made after `at`: its newest lines, read again when it grows. */
const REPLY_TAIL = 128 * 1024;
const replies = new Map<string, { size: number; at: number; after: boolean }>();
function repliedAfter(tool: AgentId, file: string | undefined, at: number): boolean {
  if (!file || tool === "gemini") return false;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  const hit = replies.get(file);
  if (hit && hit.size === size && hit.at === at) return hit.after;
  let after = false;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const start = Math.max(0, size - REPLY_TAIL);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line) as { type?: string; isSidechain?: boolean; timestamp?: string; payload?: { type?: string; role?: string } };
        const reply = tool === "codex" ? o.type === "response_item" && o.payload?.type === "message" && o.payload.role === "assistant" : o.type === "assistant" && !o.isSidechain;
        // A second's margin: the reply that just ended is written as the Stop runs.
        if (reply && Date.parse(o.timestamp ?? "") > at + 1000) after = true;
      } catch {
        // A line cut at the start of the tail.
      }
    }
  } catch {
    // Unread: the hook's word stands.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  replies.set(file, { size, at, after });
  return after;
}

/** The agents whose chats tell Airband what they do (its hook is on), looked at once a minute. */
let hooked: { at: number; tools: Set<string> } | undefined;
function hookedTools(now: number): Set<string> {
  if (!hooked || now - hooked.at > 60_000) {
    let tools = new Set<string>();
    try {
      tools = new Set(agentSummary().filter((a) => a.sharing).map((a) => a.id));
    } catch {
      // Unknown: every chat falls back to its file's activity.
    }
    hooked = { at: now, tools };
  }
  return hooked.tools;
}

export function liveChats(now = Date.now(), windowMs = 24 * 3600e3, limit = 60): LiveChat[] {
  const out: LiveChat[] = [];
  const told = hookedTools(now);
  for (const h of cachedHeads(now)) {
    const hook = readHookStatus(h.id);
    const last = Math.max(h.updatedAt, hook?.at ?? 0);
    if (now - last > windowMs) continue;
    // With the hook on, a chat that works says so: its file being touched (an agent writes a title
    // or a note into an old chat now and then) is not work. Without it, the file is all there is.
    // A chat whose hook said it finished stays finished: an app writes lines after a turn ends
    // (the Claude app a summary of its Stop hooks, seconds later), and they are not work. Only a
    // reply made after that, as when another Stop hook sends the chat back to work, is.
    const settled = !!hook && hook.status !== "working" && hook.status !== "waiting" && told.has(h.tool);
    const activity = settled ? (repliedAfter(h.tool, h.file, hook!.at) ? (mtime(h.file) ?? hook!.at) : hook!.at) : !hook && told.has(h.tool) ? h.updatedAt : (mtime(h.file) ?? h.updatedAt);
    const r = resolveStatus(activity, hook, now);
    const ask = cachedLastAsk(h);
    const renamed = liveName(h);
    const app = chatApp(h.tool, h.file);
    out.push({
      id: h.id,
      agent: h.tool,
      title: renamed ? short(renamed, 70)! : titleOf(h),
      project: projectOf(h.cwd),
      ...(h.cwd ? { cwd: h.cwd } : {}),
      ...(app ? { app } : {}),
      status: r.status,
      ...(r.line ? { line: short(r.line, 200) } : {}),
      ...(ask ? { lastAsk: short(ask.ask, 200), lastDid: short(ask.did, 280) } : {}),
      ...(ask?.open ? { open: short(ask.open, 200) } : {}),
      ...(ask?.brief ? { lastBrief: ask.brief } : {}),
      ...(ask?.yours ? { yours: true } : {}),
      updatedAt: last,
      since: hook?.at ?? last,
    });
  }
  out.push(...startingChats(new Set(out.map((c) => c.id)), now, windowMs));
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt - a.updatedAt).slice(0, limit);
}

/** A new chat gets its record when its first turn ends, so until then the hook's status is all
 *  there is: a chat working on its first ask (or asking you something in it) is listed from it. */
const STARTING_MS = 30 * 60_000;
/** A Claude app chat that started and said nothing more counts as working only this long. */
const STARTED_MS = 2 * 60_000;
function startingChats(listed: Set<string>, now: number, windowMs: number): LiveChat[] {
  let names: string[];
  try {
    names = fs.readdirSync(statusDir()).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LiveChat[] = [];
  for (const name of names) {
    const id = name.slice(0, -5);
    if (listed.has(id) || !safeId(id)) continue;
    const hook = readHookStatus(id) as HookStatus | undefined;
    if (!hook?.tool || !AGENTS[hook.tool] || (hook.status !== "working" && hook.status !== "waiting")) continue;
    if (now - hook.at > Math.min(windowMs, hook.event === "Starting" ? STARTED_MS : STARTING_MS)) continue;
    const r = resolveStatus(mtime(hook.file) ?? hook.at, hook, now);
    if (r.status !== "working" && r.status !== "waiting") continue;
    const app = hook.file ? chatApp(hook.tool, hook.file) : undefined;
    out.push({
      id,
      agent: hook.tool,
      title: short(hook.ask, 70) ?? "New chat",
      project: projectOf(hook.cwd),
      ...(hook.cwd ? { cwd: hook.cwd } : {}),
      ...(app ? { app } : {}),
      status: r.status,
      ...(r.line ? { line: short(r.line, 200) } : {}),
      ...(hook.ask ? { lastAsk: short(hook.ask, 200) } : {}),
      updatedAt: hook.at,
      since: hook.at,
    });
  }
  return out;
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
    const more = new Set([...words(AGENTS[c.agent].name), ...words(c.lastAsk ?? "")]);
    let score = terms.filter((t) => has(name, t)).length * 3 + terms.filter((t) => has(more, t)).length;
    const q = terms.join(" ");
    if (c.project.toLowerCase() === q || c.title.toLowerCase() === q) score += 10;
    if (score > 0) out.push({ chat: c, score });
  }
  return out.sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt);
}
