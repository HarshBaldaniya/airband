// Where the Tower's cards go, in board units. Pure: no React, no React Flow, so it is tested on its
// own (test/board-layout.test.ts).
import type { ConnectionView } from "../../../src/vscode/protocol";
import type { BoardPosition, ChatSession } from "../../../src/core/types";
import { folderName, folderOf } from "../../lib/folders";

/** One spacing unit for the whole board: gaps between cards, a group panel's padding, and the
 *  space between panels (two units) all come from it, in every arrangement. */
export const UNIT = 24;
/** Room a group's panel keeps around its cards. */
export const LANE_PAD = UNIT;
/** A group's heading: its 32-px tile with one unit above and below, like the panel's sides. */
export const LANE_HEAD = 80;
export const CARD_W = 300;
export const CARD_H = 160;
/** The board never opens smaller than this: cards stay readable, and it scrolls for the rest. */
export const READABLE = 0.8;
/** By links: room between columns for the line and its label; rows sit two units apart. */
const COL_GAP = 192;
const ROW_GAP = 48;
const LOOSE_GAP = 48;
const DAY = 86_400_000;

export type ArrangeMode = "links" | "time" | "status" | "agent" | "folder";
export type LaneMode = Exclude<ArrangeMode, "links">;
export type Size = { w: number; h: number };
export type Box = { x: number; y: number; w: number; h: number };

export interface Lane {
  label: string;
  /** A folder's row ("By folder"): its full path, and whether it is this window's folder. */
  folder?: string;
  here?: boolean;
  count: number;
  /** When anything in it last happened. */
  latest?: number;
  /** Where its cards sit (the panel drawn around them is a little larger). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The words each arrangement is called by in the toolbar. */
export const ARRANGE_LABEL: Record<ArrangeMode, string> = { links: "Channels", time: "Time", status: "Status", agent: "Agent", folder: "Folder" };

const STATUS_LANE = { waiting: "Needs you", working: "Working", done: "Done", idle: "Idle" } as const;

/**
 * Cards in labelled groups: by time, by status, by agent or by folder; newest first in each. Cut to
 * the board's size: a panel is never taller than the board (a group with many chats spreads
 * sideways into more columns instead of growing down), and panels flow left to right, wrapping to
 * a new band once the board's width is used.
 */
export function laneLayout(
  chats: ChatSession[],
  mode: LaneMode,
  sizes: Record<string, Size>,
  root: string | undefined,
  view: Size,
  now = Date.now(),
): { positions: Record<string, BoardPosition>; lanes: Lane[] } {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const key = (c: ChatSession): string => {
    if (mode === "folder") return folderOf(c, root);
    if (mode === "agent") return c.tool;
    if (mode === "status") return STATUS_LANE[c.status];
    if (c.lastModified >= today) return "Today";
    if (c.lastModified >= today - DAY) return "Yesterday";
    if (c.lastModified >= today - 6 * DAY) return "This week";
    return "Older";
  };
  const groups = new Map<string, ChatSession[]>();
  for (const c of [...chats].sort((a, b) => b.lastModified - a.lastModified)) groups.set(key(c), [...(groups.get(key(c)) ?? []), c]);
  const order = (
    mode === "folder"
      ? // This window's folder first, the others by their newest chat (groups were filled newest first).
        [...groups.keys()].sort((a, b) => (a === root ? -1 : b === root ? 1 : 0))
      : mode === "agent"
        ? ["Claude", "Codex", "Gemini"]
        : mode === "status"
          ? Object.values(STATUS_LANE)
          : ["Today", "Yesterday", "This week", "Older"]
  ).filter((k) => groups.get(k)?.length);
  const labelOf = (k: string) => (mode === "folder" ? folderName(k) || "Other" : k);

  const GAP = UNIT;
  const BETWEEN = 2 * UNIT;
  const hOf = (c: ChatSession) => sizes[c.id]?.h ?? CARD_H + 70;
  const all = chats.map(hOf).sort((a, b) => a - b);
  const typical = all.length ? all[Math.floor(all.length / 2)] : CARD_H + 70;
  const maxRows = Math.max(1, Math.floor((view.h - LANE_HEAD - LANE_PAD + GAP) / (typical + GAP)));
  const panels = order.map((k) => {
    const list = groups.get(k)!;
    // A wide board makes balanced blocks (4 cards: 2 × 2); a narrow one keeps panels one card wide
    // until they reach the board's height.
    const cols = view.w >= 1000 ? Math.max(Math.ceil(list.length / maxRows), Math.ceil(Math.sqrt(list.length))) : Math.ceil(list.length / maxRows);
    // Masonry: cards are dealt across the columns in order (newest first, reading across), and
    // each column stacks its own cards exactly one gap apart, whatever their heights.
    const place: { c: ChatSession; col: number; y: number }[] = [];
    const colY = Array.from({ length: cols }, () => 0);
    list.forEach((c, i) => {
      const col = i % cols;
      place.push({ c, col, y: colY[col] });
      colY[col] += hOf(c) + GAP;
    });
    const w = cols * CARD_W + (cols - 1) * GAP;
    const h = Math.max(...colY) - GAP;
    return { k, list, place, w, h };
  });
  const positions: Record<string, BoardPosition> = {};
  const lanes: Lane[] = [];
  // A wide board wraps panels at its own width. A narrow one keeps them in one strip, like lists
  // on a kanban board: every panel already fits its height, so it only ever scrolls sideways.
  const shelfW = view.w >= 1000 ? Math.max(view.w, ...panels.map((p) => p.w + 2 * LANE_PAD)) : Infinity;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const p of panels) {
    const outerW = p.w + 2 * LANE_PAD;
    const outerH = p.h + LANE_HEAD + LANE_PAD;
    if (x > 0 && x + outerW > shelfW) {
      x = 0;
      y += shelfH + BETWEEN;
      shelfH = 0;
    }
    const ax = x + LANE_PAD;
    const ay = y + LANE_HEAD;
    for (const { c, col, y: cy } of p.place) positions[c.id] = { x: ax + col * (CARD_W + GAP), y: ay + cy };
    lanes.push({
      label: labelOf(p.k),
      folder: mode === "folder" ? p.k : undefined,
      here: mode === "folder" && p.k === root,
      count: p.list.length,
      latest: Math.max(...p.list.map((c) => c.lastModified)),
      x: ax,
      y: ay,
      w: p.w,
      h: p.h,
    });
    x += outerW + BETWEEN;
    shelfH = Math.max(shelfH, outerH);
  }
  return { positions, lanes };
}

/**
 * Cards pushed down, never up, until each is one unit clear of every card above it that it shares
 * any width with. Cards side by side are left alone. Only the cards that move are returned.
 */
export function spreadDown(cards: (Box & { id: string })[]): Record<string, BoardPosition> {
  const order = [...cards].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Box[] = [];
  const moved: Record<string, BoardPosition> = {};
  for (const c of order) {
    let y = c.y;
    for (let pass = 0; pass < order.length; pass++) {
      const under = placed.filter((p) => c.x < p.x + p.w && c.x + c.w > p.x && y < p.y + p.h + UNIT && y + c.h + UNIT > p.y);
      if (!under.length) break;
      y = Math.max(...under.map((p) => p.y + p.h + UNIT));
    }
    placed.push({ x: c.x, y, w: c.w, h: c.h });
    if (Math.abs(y - c.y) > 0.5) moved[c.id] = { x: c.x, y };
  }
  return moved;
}

/**
 * Where a dropped card goes: where it was dropped, unless that is closer than one unit to another
 * card; then the nearest place beside that card (below, above, right or left) that is one unit clear
 * of every card. A few steps at most; a crowded spot ends at the last clear place found.
 */
export function clearOf(pos: BoardPosition, size: Size, others: Box[]): BoardPosition {
  const tooClose = (p: BoardPosition) =>
    others.find((o) => p.x < o.x + o.w + UNIT && p.x + size.w + UNIT > o.x && p.y < o.y + o.h + UNIT && p.y + size.h + UNIT > o.y);
  // Nearly lined up with a card (within half a unit) is meant to be lined up.
  const near = (v: number, list: number[]) => list.find((t) => Math.abs(v - t) <= UNIT / 2) ?? v;
  let p = { x: near(pos.x, others.map((o) => o.x)), y: near(pos.y, others.map((o) => o.y)) };
  for (let step = 0; step < 24; step++) {
    const hit = tooClose(p);
    if (!hit) return p;
    // Placed under or beside the card it came near, lined up with that card's edge when it was
    // nearly lined up anyway (within a unit), so neat columns stay neat.
    const ax = Math.abs(p.x - hit.x) < UNIT ? hit.x : p.x;
    const ay = Math.abs(p.y - hit.y) < UNIT ? hit.y : p.y;
    const options = [
      { x: ax, y: hit.y + hit.h + UNIT },
      { x: ax, y: hit.y - size.h - UNIT },
      { x: hit.x + hit.w + UNIT, y: ay },
      { x: hit.x - size.w - UNIT, y: ay },
    ];
    const free = options.filter((o) => !tooClose(o));
    p = (free.length ? free : options).sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))[0];
  }
  return p;
}

/**
 * Lays cards out by who shares with whom: chats that only share sit on the
 * left, each chat one column right of what feeds it, columns centred on each
 * other; unlinked chats go below in an even grid. Uses each card's real size.
 */
export function autoLayout(ids: string[], conns: ConnectionView[], sizes: Record<string, Size> = {}): Record<string, BoardPosition> {
  const size = (id: string) => sizes[id] ?? { w: CARD_W, h: CARD_H };
  const set = new Set(ids);
  const edges = conns.filter((c) => set.has(c.from.id) && set.has(c.to.id) && c.from.id !== c.to.id);
  const linked = new Set(edges.flatMap((e) => [e.from.id, e.to.id]));
  const rank = new Map<string, number>();
  for (const id of linked) rank.set(id, 0);
  for (let pass = 0; pass < linked.size; pass++) {
    let changed = false;
    for (const e of edges) {
      const r = (rank.get(e.from.id) ?? 0) + 1;
      if (r > (rank.get(e.to.id) ?? 0) && r < linked.size) {
        rank.set(e.to.id, r);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const out: Record<string, BoardPosition> = {};
  const cols = new Map<number, string[]>();
  for (const id of ids) if (linked.has(id)) cols.set(rank.get(id)!, [...(cols.get(rank.get(id)!) ?? []), id]);
  const colHeight = (list: string[]) => list.reduce((h, id) => h + size(id).h, 0) + ROW_GAP * (list.length - 1);
  const tallest = Math.max(0, ...[...cols.values()].map(colHeight));
  let x = 0;
  for (const col of [...cols.keys()].sort((a, b) => a - b)) {
    const list = cols.get(col)!;
    let y = (tallest - colHeight(list)) / 2;
    const width = Math.max(...list.map((id) => size(id).w));
    for (const id of list) {
      out[id] = { x, y };
      y += size(id).h + ROW_GAP;
    }
    x += width + COL_GAP;
  }
  const loose = ids.filter((id) => !linked.has(id));
  const perRow = Math.max(3, Math.min(4, Math.ceil(Math.sqrt(loose.length))));
  let y = linked.size ? tallest + 96 : 0;
  for (let i = 0; i < loose.length; i += perRow) {
    const row = loose.slice(i, i + perRow);
    row.forEach((id, j) => (out[id] = { x: j * (CARD_W + LOOSE_GAP), y }));
    y += Math.max(...row.map((id) => size(id).h)) + ROW_GAP;
  }
  return out;
}
