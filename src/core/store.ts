// Airband's shared store in ~/.airband, used by both the extension and the hook:
// connections, the inbox of each chat, how far each source chat has been read,
// what was delivered, and branches waiting for their new chat.
// It imports nothing heavy: the hook runs on every message and must start fast.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { ChatRef, Connection, Delivery, InboxItem, PendingBranch } from "./types";
import { airbandFile, safeId, writeFileAtomic } from "./paths";
import { parseJsonLines, readJson } from "./json";

const PENDING_MS = 30 * 60_000;

// ---- locks: one writer at a time ----

/** A lock older than this was left by a process that died: it is taken over. */
const LOCK_STALE_MS = 5_000;
/** How long a writer waits for a lock before it writes anyway. */
const LOCK_WAIT_MS = 2_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Runs `fn` while holding a lock file, so two hooks (or a hook and the extension) changing the same
 * file never lose each other's change. A lock that can't be had in time is broken: a stuck writer
 * must not stop every chat.
 */
function withLock<T>(name: string, fn: () => T): T {
  const dir = airbandFile("locks");
  const lock = path.join(dir, `${name}.lock`);
  fs.mkdirSync(dir, { recursive: true });
  const until = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      held = true;
    } catch {
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
      if (age > LOCK_STALE_MS || Date.now() > until) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// ---- connections ----

/** Levels saved before they were renamed (headlines, summary) are read as today's (ping, brief). */
const OLD_LEVEL: Record<string, Connection["level"]> = { headlines: undefined, summary: "brief" };

export function readConnections(): Connection[] {
  const list = readJson<Connection[]>(airbandFile("connections.json"), []);
  for (const c of list) if (c.level && (c.level as string) in OLD_LEVEL) c.level = OLD_LEVEL[c.level as string];
  return list;
}

function writeConnections(list: Connection[]): void {
  writeFileAtomic(airbandFile("connections.json"), JSON.stringify(list, null, 2));
}

/** Connects `from` to `to`. Connecting a pair that already exists resumes it. */
export function addConnection(from: ChatRef, to: ChatRef, now = Date.now()): { connection: Connection; created: boolean } {
  return withLock("connections", () => addConnectionLocked(from, to, now));
}

function addConnectionLocked(from: ChatRef, to: ChatRef, now: number): { connection: Connection; created: boolean } {
  const list = readConnections();
  const existing = list.find((c) => c.from.id === from.id && c.to.id === to.id);
  if (existing) {
    existing.paused = false;
    existing.from = from;
    existing.to = to;
    writeConnections(list);
    return { connection: existing, created: false };
  }
  const connection: Connection = { id: randomBytes(6).toString("hex"), from, to, createdAt: now };
  list.push(connection);
  writeConnections(list);
  return { connection, created: true };
}

export function removeConnection(id: string): Connection | undefined {
  const gone = withLock("connections", () => {
    const list = readConnections();
    const c = list.find((x) => x.id === id);
    if (c) writeConnections(list.filter((x) => x.id !== id));
    return c;
  });
  if (gone) removeInboxFrom(gone.to.id, gone.from.id);
  return gone;
}

/** How much a link sends (both ways of a two-way link are set together by the caller). */
export function setLevel(ids: string[], level: "ping" | "brief" | "full"): void {
  withLock("connections", () => {
    const list = readConnections();
    for (const c of list) if (ids.includes(c.id)) c.level = level === "ping" ? undefined : level;
    writeConnections(list);
  });
}

export function setPaused(id: string, paused: boolean): void {
  withLock("connections", () => {
    const list = readConnections();
    const c = list.find((x) => x.id === id);
    if (!c) return;
    c.paused = paused;
    writeConnections(list);
  });
}

// ---- inbox: context waiting to reach a chat ----

function inboxFile(chatId: string): string {
  return airbandFile("inbox", `${chatId}.jsonl`);
}

export function appendInbox(chatId: string, item: InboxItem): void {
  if (!safeId(chatId)) return;
  fs.mkdirSync(airbandFile("inbox"), { recursive: true });
  withLock(`inbox-${chatId}`, () => fs.appendFileSync(inboxFile(chatId), `${JSON.stringify(item)}\n`));
}


export function readInbox(chatId: string): InboxItem[] {
  if (!safeId(chatId)) return [];
  try {
    return parseJsonLines<InboxItem>(fs.readFileSync(inboxFile(chatId), "utf8"));
  } catch {
    return [];
  }
}

/** Reads and empties a chat's inbox. Anything appended after waits for the next message. */
export function takeInbox(chatId: string): InboxItem[] {
  if (!safeId(chatId)) return [];
  const file = inboxFile(chatId);
  if (!fs.existsSync(file)) return [];
  return withLock(`inbox-${chatId}`, () => {
    const items = readInbox(chatId);
    fs.rmSync(file, { force: true });
    return items;
  });
}

function removeInboxFrom(chatId: string, fromId: string): void {
  if (!safeId(chatId)) return;
  withLock(`inbox-${chatId}`, () => {
    const kept = readInbox(chatId).filter((i) => i.from.id !== fromId);
    if (kept.length) writeFileAtomic(inboxFile(chatId), kept.map((i) => JSON.stringify(i)).join("\n") + "\n");
    else fs.rmSync(inboxFile(chatId), { force: true });
  });
}

// ---- cursors: how far each source chat has been read ----
// One small file per chat: hooks of different chats write at the same time, and a shared file
// would lose one of two writes. Values saved in the older shared files are still read.

/** A chat's own state file, `<kind>/<chat id>`. */
const chatFile = (kind: "cursors" | "replies" | "stops", chatId: string) => airbandFile(kind, chatId);

function writeChatFile(kind: "cursors" | "replies" | "stops", chatId: string, text: string | undefined): void {
  if (!safeId(chatId)) return;
  const file = chatFile(kind, chatId);
  if (text === undefined) return void fs.rmSync(file, { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, text);
}

function readChatFile(kind: "cursors" | "replies" | "stops", chatId: string): string | undefined {
  if (!safeId(chatId)) return undefined;
  try {
    return fs.readFileSync(chatFile(kind, chatId), "utf8");
  } catch {
    return undefined;
  }
}

/** Where a chat was read up to: a byte offset (Claude Code, Codex) or a message count (Gemini
 *  CLI), with the ids of the last Gemini messages read, to find its place again after a rewind. */
export interface Cursor {
  at: number;
  seen?: string[];
}

export function readCursor(chatId: string): Cursor | undefined {
  const own = readChatFile("cursors", chatId);
  if (own !== undefined) {
    try {
      const c = JSON.parse(own) as Cursor | number;
      return typeof c === "number" ? { at: c } : typeof c?.at === "number" ? c : undefined;
    } catch {
      return undefined;
    }
  }
  const legacy = readJson<Record<string, number>>(airbandFile("cursors.json"), {})[chatId];
  return typeof legacy === "number" ? { at: legacy } : undefined;
}

export function getCursor(chatId: string): number | undefined {
  return readCursor(chatId)?.at;
}

export function setCursor(chatId: string, at: number, seen?: string[]): void {
  writeChatFile("cursors", chatId, JSON.stringify(seen?.length ? { at, seen } : { at }));
}

/**
 * A reply sent on from the hook's own input (the tool had not written it to its file
 * yet), so it is not sent again when it shows up in the file.
 */
export function getSentReply(chatId: string): string | undefined {
  return readChatFile("replies", chatId) ?? readJson<Record<string, string>>(airbandFile("replies.json"), {})[chatId];
}

export function setSentReply(chatId: string, text: string | undefined): void {
  writeChatFile("replies", chatId, text);
  // The older shared file is no longer written: an entry left there would come back.
  const legacy = airbandFile("replies.json");
  if (text === undefined && chatId in readJson<Record<string, string>>(legacy, {})) {
    withLock("replies", () => {
      const all = readJson<Record<string, string>>(legacy, {});
      delete all[chatId];
      writeFileAtomic(legacy, JSON.stringify(all));
    });
  }
}

// ---- stops: why Airband sent a chat back to work at its Stop ----

/** Airband answered a chat's Stop with a "block": with linked chats' updates (the next turn only
 *  acknowledges them) or with the person's own message (the next turn is real work). */
export type StopBlock = "updates" | "person";

export function setStopBlock(chatId: string, why: StopBlock): void {
  writeChatFile("stops", chatId, why);
}

/** Why the chat was sent back to work, read once. */
export function takeStopBlock(chatId: string): StopBlock | undefined {
  const why = readChatFile("stops", chatId);
  if (why !== undefined) writeChatFile("stops", chatId, undefined);
  return why === "updates" || why === "person" ? why : undefined;
}

// ---- deliveries: what reached which chat ----

export function logDelivery(d: Delivery): void {
  fs.mkdirSync(airbandFile(), { recursive: true });
  fs.appendFileSync(airbandFile("deliveries.jsonl"), `${JSON.stringify(d)}\n`);
}

/** The most recent deliveries (the log is only ever read from its tail). */
export function readDeliveries(max = 2000): Delivery[] {
  const file = airbandFile("deliveries.jsonl");
  try {
    const size = fs.statSync(file).size;
    const want = Math.min(size, max * 160);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(want);
      fs.readSync(fd, buf, 0, want, size - want);
      const lines = parseJsonLines<Delivery>(buf.toString("utf8"));
      return lines.slice(-max);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

// ---- branches waiting for their new chat ----

function readPending(now = Date.now()): PendingBranch[] {
  return readJson<PendingBranch[]>(airbandFile("pending.json"), []).filter((p) => now - p.at < PENDING_MS);
}

export function addPending(p: PendingBranch): void {
  writeFileAtomic(airbandFile("pending.json"), JSON.stringify([...readPending(), p], null, 2));
}

export function removePending(id: string): void {
  writeFileAtomic(airbandFile("pending.json"), JSON.stringify(readPending().filter((p) => p.id !== id), null, 2));
}

/** The branch a new chat's first message belongs to, if any: matched on the start of the task text. */
export function matchPending(prompt: string, cwd: string | undefined, now = Date.now()): PendingBranch | undefined {
  const said = normalise(prompt);
  if (!said) return undefined;
  return readPending(now).find((p) => {
    const start = normalise(p.taskStart).slice(0, 60);
    return start.length > 0 && said.startsWith(start) && (!p.cwd || !cwd || path.resolve(p.cwd) === path.resolve(cwd));
  });
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
