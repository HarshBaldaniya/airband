// Each chat's inbox (~/.airband/inbox/<chat id>.jsonl): what waits to reach it with its next turn.
import * as fs from "node:fs";
import type { InboxItem } from "../core/types";
import { airbandFile, safeId, writeFileAtomic } from "../core/paths";
import { parseJsonLines } from "../core/json";
import { withLock } from "./lock";

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

export function removeInboxFrom(chatId: string, fromId: string): void {
  if (!safeId(chatId)) return;
  withLock(`inbox-${chatId}`, () => {
    const kept = readInbox(chatId).filter((i) => i.from.id !== fromId);
    if (kept.length) writeFileAtomic(inboxFile(chatId), kept.map((i) => JSON.stringify(i)).join("\n") + "\n");
    else fs.rmSync(inboxFile(chatId), { force: true });
  });
}
