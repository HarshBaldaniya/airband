// How far each source chat has been read, the reply last sent from it, and why Airband sent a chat
// back to work at its Stop. One small file per chat: hooks of different chats write at the same time,
// and a shared file would lose one of two writes.
import * as fs from "node:fs";
import * as path from "node:path";
import { airbandFile, safeId, writeFileAtomic } from "../core/paths";
import { readJson } from "../core/json";
import { withLock } from "./lock";

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

// Why Airband sent a chat back to work at its Stop.

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
