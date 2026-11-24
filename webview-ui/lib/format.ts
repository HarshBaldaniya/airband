// How numbers, times and names read on every page.
import type { Status, Usage } from "../../src/core/types";
import { elapsed } from "../../shared/time";

export const STATUS_LABEL: Record<Status, string> = {
  working: "Working",
  waiting: "Needs you",
  done: "Done",
  idle: "Idle",
};

/** "now", "12m", "3h", "4d", "2mo". */
function ago(ms: number, now = Date.now()): string {
  const e = elapsed(ms, now);
  return e ? `${e.n}${e.unit}` : "now";
}

/** "just now", "12m ago", "3d ago". */
export function agoText(ms: number, now = Date.now()): string {
  const a = ago(ms, now);
  return a === "now" ? "just now" : `${a} ago`;
}

/** A token count in a few characters: "950", "4.2K", "18K", "1.0M". */
export function tokens(n: number): string {
  const short = (v: number, unit: string) => `${v < 10 ? v.toFixed(1) : Math.round(v)}${unit}`;
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return short(n / 1000, "K");
  if (n < 1_000_000_000) return short(n / 1_000_000, "M");
  return short(n / 1_000_000_000, "B");
}

/**
 * The headline count: tokens the model newly took in or wrote. Cache reads are
 * the same context re-read on every turn (billed at a tenth), so they are shown
 * on their own rather than swamping this number.
 */
export function fresh(u?: Usage): number {
  return u ? u.input + u.output + u.cacheWrite : 0;
}

/** Tokens a piece of text costs, roughly (four characters a token). */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** "claude-opus-5-5" → "Opus 5.5", "gemini-2.5-pro" → "Gemini 2.5 Pro"; anything else as the tool names it. */
export function modelName(model?: string): string | undefined {
  if (!model) return undefined;
  const claude = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i.exec(model);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  const gemini = /^gemini-([\d.]+)-(\w+)/i.exec(model);
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2][0].toUpperCase()}${gemini[2].slice(1)}`;
  // Codex: gpt-5.5-codex → GPT-5.5 Codex, gpt-5.1-codex-max → GPT-5.1 Codex Max.
  const gpt = /^gpt-([\d.]+)((?:-[a-z]+)*)$/i.exec(model);
  if (gpt) return `GPT-${gpt[1]}${gpt[2].split("-").filter(Boolean).map((w) => ` ${w[0].toUpperCase()}${w.slice(1)}`).join("")}`;
  return model;
}

/** How full a context window is, as a whole percentage. */
export function contextPct(c?: { used: number; window: number }): number | undefined {
  return c && c.window ? Math.min(100, Math.round((c.used / c.window) * 100)) : undefined;
}

/** How close something is to full, as the class its bar or ring is drawn with. */
export function level(pct: number | null | undefined): "none" | "ok" | "high" | "full" {
  return pct == null ? "none" : pct >= 90 ? "full" : pct >= 70 ? "high" : "ok";
}

/** Where "open in its folder" puts a chat: Claude's panel for Claude, a terminal for the others. */
export function whereItOpens(tool: string): string {
  return tool === "Claude" ? "with this chat in Claude" : `with this chat in a ${tool} terminal`;
}
