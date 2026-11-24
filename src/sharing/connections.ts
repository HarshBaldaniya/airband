// Which chats are linked, kept in ~/.airband/connections.json: each link has a direction, a level
// (a line per ask, a summary, or the words) and can be paused.
import { randomBytes } from "node:crypto";
import type { ChatRef, Connection } from "../core/types";
import { airbandFile, writeFileAtomic } from "../core/paths";
import { readJson } from "../core/json";
import { withLock } from "./lock";
import { removeInboxFrom } from "./inbox";

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
