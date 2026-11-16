// Two reports read from every chat's flightlog on this computer, across Claude Code, Codex and
// Gemini CLI: what was done in the last days (for a standup or a status update), and the tokens
// spent, by project, agent, chat and ticket. Read from the agents' own files; nothing is sent.
import * as path from "node:path";
import { ClaudeAdapter } from "../adapters/claude";
import { codexUsage } from "../adapters/codex";
import { geminiUsage, loadGeminiChat } from "../adapters/gemini";
import { listHeads, readAsks, type RecordAsk, type RecordHead } from "./record";
import { addUsage, readLinesFrom } from "./transcript";
import { NO_USAGE, type ChatSession, type Usage } from "./types";

const DAY = 24 * 3600e3;
const AGENT = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" } as const;

/** Midnight (local time) `days - 1` days ago: 1 is today, 2 is yesterday and today. */
export function sinceDays(days: number, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - (Math.max(1, days) - 1) * DAY;
}

const project = (h: RecordHead) => (h.cwd ? path.basename(h.cwd) : "(no folder)");
const nameOf = (h: RecordHead) => h.title ?? (h.goal ? short(h.goal, 60) : h.id.slice(0, 8));
const short = (t: string, max: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const dateText = (at: number) => new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Only this project's chats, when a folder is given (its subfolders count too). */
function inScope(h: RecordHead, root?: string): boolean {
  if (!root) return true;
  if (!h.cwd) return false;
  const r = path.resolve(root);
  const c = path.resolve(h.cwd);
  return c === r || c.startsWith(r + path.sep);
}

// ---- what was done ----

export interface WorkChat {
  id: string;
  agent: string;
  title: string;
  project: string;
  asks: RecordAsk[];
  refs: string[];
  open?: string;
}

export function workSince(since: number, root?: string): WorkChat[] {
  const out: WorkChat[] = [];
  for (const h of listHeads()) {
    if (h.updatedAt < since || !inScope(h, root)) continue;
    const asks = readAsks(h.id).filter((a) => a.at >= since);
    if (!asks.length) continue;
    const refs = [...new Set(asks.flatMap((a) => a.refs))];
    const last = asks[asks.length - 1];
    out.push({ id: h.id, agent: AGENT[h.tool], title: nameOf(h), project: project(h), asks, refs, ...(last.open ? { open: last.open } : {}) });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project) || b.asks[b.asks.length - 1].at - a.asks[a.asks.length - 1].at);
}

/** The work as a few hundred tokens: per project, each chat's outcomes, tickets and what is open. */
export function renderWork(chats: WorkChat[], since: number, perChat = 5): string {
  if (!chats.length) return `No chat recorded work since ${dateText(since)}.`;
  const asks = chats.reduce((n, c) => n + c.asks.length, 0);
  const projects = [...new Set(chats.map((c) => c.project))];
  const out = [`Since ${dateText(since)}: ${plural(asks, "ask")} in ${plural(chats.length, "chat")}, ${plural(projects.length, "project")}.`];
  for (const p of projects) {
    out.push("", p);
    for (const c of chats.filter((x) => x.project === p)) {
      out.push(`  “${c.title}” (${c.agent}, ${plural(c.asks.length, "ask")}, id ${c.id.slice(0, 8)})${c.refs.length ? ` · ${c.refs.slice(0, 6).join(", ")}` : ""}`);
      const shown = c.asks.slice(-perChat);
      if (c.asks.length > shown.length) out.push(`    … ${c.asks.length - shown.length} earlier`);
      for (const a of shown) out.push(`    - ${short(a.ask, 90)} → ${short(a.did || "(no reply)", 140)}`);
      if (c.open) out.push(`    Open: ${short(c.open, 160)}`);
    }
  }
  return out.join("\n");
}

// ---- tokens spent ----

export interface SpendChat {
  id: string;
  agent: string;
  title: string;
  project: string;
  usage: Usage;
  /** The tickets and PRs its asks named, each with its share of the chat's tokens */
  refs: { name: string; part: number }[];
}

export const totalOf = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Tokens each chat spent from `since` on, as its agent reported them. */
export function spendSince(since: number, root?: string): SpendChat[] {
  const day = utcDay(since);
  const claude = new ClaudeAdapter();
  const out: SpendChat[] = [];
  for (const h of listHeads()) {
    if (h.updatedAt < since || !inScope(h, root) || !h.file) continue;
    let usage: Usage = NO_USAGE;
    try {
      if (h.tool === "claude") usage = claude.usageSince({ id: h.id, tool: "Claude", file: h.file } as ChatSession, day);
      else if (h.tool === "codex") usage = codexUsage(readLinesFrom(h.file, 0).lines, day).today;
      else usage = geminiUsage(loadGeminiChat(h.file)?.messages ?? [], day).today;
    } catch {
      continue;
    }
    if (!totalOf(usage)) continue;
    out.push({ id: h.id, agent: AGENT[h.tool], title: nameOf(h), project: project(h), usage, refs: shares(readAsks(h.id).filter((a) => a.at >= since)) });
  }
  claude.saveCache();
  return out.sort((a, b) => totalOf(b.usage) - totalOf(a.usage));
}

const isTicket = (r: string) => !/^[0-9a-f]{7,40}$/.test(r) && !r.startsWith("Figma ");

/**
 * A chat's tokens split evenly over its asks, and an ask's share over the tickets it names: an
 * estimate (an agent reports tokens per reply, not per topic), but one that adds up to the total.
 */
function shares(asks: RecordAsk[]): SpendChat["refs"] {
  const m = new Map<string, number>();
  for (const a of asks) {
    const refs = [...new Set(a.refs.filter(isTicket))];
    for (const r of refs) m.set(r, (m.get(r) ?? 0) + 1 / asks.length / refs.length);
  }
  return [...m].map(([name, part]) => ({ name, part }));
}

const scale = (u: Usage, k: number): Usage => ({ input: u.input * k, output: u.output * k, cacheRead: u.cacheRead * k, cacheWrite: u.cacheWrite * k });

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function sumBy(chats: SpendChat[], key: (c: SpendChat) => { name: string; part: number }[]): { name: string; usage: Usage; chats: number }[] {
  const m = new Map<string, { usage: Usage; chats: number }>();
  for (const c of chats) {
    for (const { name: k, part } of key(c)) {
      const e = m.get(k) ?? { usage: NO_USAGE, chats: 0 };
      e.usage = addUsage(e.usage, scale(c.usage, part));
      e.chats++;
      m.set(k, e);
    }
  }
  return [...m].map(([name, e]) => ({ name, ...e })).sort((a, b) => totalOf(b.usage) - totalOf(a.usage));
}

const split = (u: Usage) => `${fmtTokens(u.input)} new input, ${fmtTokens(u.output)} output, ${fmtTokens(u.cacheRead)} cache reads${u.cacheWrite ? `, ${fmtTokens(u.cacheWrite)} cache writes` : ""}`;

/** Tokens by project, agent, ticket and chat. A chat that names several tickets counts for each. */
export function renderSpend(chats: SpendChat[], since: number, top = 8): string {
  if (!chats.length) return `No chat spent tokens since ${dateText(since)} (only chats Airband has a flightlog for are counted).`;
  const all = chats.reduce((u, c) => addUsage(u, c.usage), NO_USAGE);
  const out = [`Since ${dateText(since)}: ${fmtTokens(totalOf(all))} tokens in ${plural(chats.length, "chat")} (${split(all)}).`];
  const share = (u: Usage) => `${Math.round((100 * totalOf(u)) / Math.max(1, totalOf(all)))}%`;
  const table = (title: string, rows: { name: string; usage: Usage; chats: number }[]) => {
    if (!rows.length) return;
    out.push("", title);
    for (const r of rows.slice(0, top)) out.push(`  ${r.name.padEnd(24)} ${fmtTokens(totalOf(r.usage)).padStart(7)}  ${share(r.usage).padStart(4)}  ${plural(r.chats, "chat")}`);
    if (rows.length > top) out.push(`  … ${rows.length - top} more`);
  };
  table("By project", sumBy(chats, (c) => [{ name: c.project, part: 1 }]));
  table("By agent", sumBy(chats, (c) => [{ name: c.agent, part: 1 }]));
  table("By ticket or PR (estimated: a chat's tokens split over its asks, an ask's over what it names)", sumBy(chats, (c) => c.refs));
  out.push("", "Biggest chats");
  for (const c of chats.slice(0, top)) out.push(`  ${fmtTokens(totalOf(c.usage)).padStart(7)}  “${short(c.title, 50)}” (${c.agent}, ${c.project}, id ${c.id.slice(0, 8)})`);
  out.push("", "Cache reads are billed at about a tenth of new input. Where one chat's tokens went: airband_flightlog with its id and tokens.");
  return out.join("\n");
}
