// What Airband tells the person, not the model, in the agent's own window: a line when a chat
// starts (Airband is on, the map is ready, who this chat shares with, what other chats did here
// lately) and a line when another chat's work rides along with a message. Hooks hand them over as
// `systemMessage`, which Claude Code and Gemini CLI show and never send to the model, so they cost
// no tokens. Codex has no place for one, so Codex chats get none.
import * as fs from "node:fs";
import * as path from "node:path";
import { storeDir } from "../codemap/where";
import { listHeads, type RecordHead } from "./record";
import { readConnections } from "./store";
import type { InboxItem } from "./types";
import { readConfig, sameFolder } from "./updates";

/** How far back "other chats worked here" looks. */
const RECENT_MS = 12 * 3600e3;

const AGENT: Record<string, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", Claude: "Claude Code", Codex: "Codex", Gemini: "Gemini CLI" };
const agentName = (tool: string | undefined) => AGENT[tool ?? ""] ?? tool ?? "an agent";

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
  const peers = others.filter((p) => !seen.has(p.id) && seen.add(p.id)).map((p) => `${chatName(p.title)} (${agentName(p.tool)})`);
  parts.push(peers.length ? `sharing with ${list(peers)}` : "other chats can catch up on this one");
  const lines = [parts.join(" · ")];

  // Other chats that worked in this folder lately and aren't already shared with: worth a catch-up.
  if (o.cwd) {
    const recent = listHeads()
      .filter((h: RecordHead) => h.id !== id && !seen.has(h.id) && h.n > 0 && h.cwd && sameFolder(h.cwd, o.cwd!) && now - h.updatedAt < RECENT_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (recent.length) {
      const names = recent.map((h) => `${chatName(h.title, h.goal)} (${agentName(h.tool)})`);
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
  const from = work.filter((i) => !seen.has(i.from.id) && seen.add(i.from.id)).map((i) => `${chatName(i.from.title)} (${agentName(i.from.tool)})`);
  if (!from.length) return `↪ Airband passed on ${changes === 1 ? "a channel change" : `${changes} channel changes`}`;
  return `↪ Airband added what ${list(from)} did to this message`;
}
