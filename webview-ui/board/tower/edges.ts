// What the Tower's lines join, and where each one leaves and enters its cards.
import { Position, type InternalNode } from "@xyflow/react";
import type { ConnectionView } from "../../../src/core/protocol";
import type { BoardState } from "../../../src/core/types";
import { CARD_H, CARD_W } from "./layout";
import type { CardLink, LineEdge } from "./types";

/** A line that carried an update this recently glows. */
const FRESH_MS = 12_000;

/** The chats a card is linked with, one entry each, whichever way the work flows. */
export function cardLinks(id: string, conns: ConnectionView[]): CardLink[] {
  const by = new Map<string, CardLink>();
  for (const c of conns) {
    if (c.from.id === id) {
      const prev = by.get(c.to.id);
      by.set(c.to.id, { id: c.to.id, title: c.to.title, dir: prev?.dir === "in" ? "both" : "out" });
    } else if (c.to.id === id) {
      const prev = by.get(c.from.id);
      by.set(c.from.id, { id: c.from.id, title: c.from.title, dir: prev?.dir === "out" ? "both" : "in" });
    }
  }
  return [...by.values()];
}

/** One line per pair of chats on the board, two-way links folded into one. */
export function lineEdges(conns: ConnectionView[], members: Set<string>, handles: BoardState["handles"], now: number): LineEdge[] {
  const out: LineEdge[] = [];
  const seen = new Set<string>();
  for (const c of conns) {
    if (!members.has(c.from.id) || !members.has(c.to.id) || seen.has(c.id)) continue;
    const back = conns.find((r) => r.from.id === c.to.id && r.to.id === c.from.id);
    seen.add(c.id);
    if (back) seen.add(back.id);
    const last = Math.max(c.lastAt ?? 0, back?.lastAt ?? 0);
    // The sides the person drew it between; a two-way link drawn the other way uses those, mirrored.
    const fwd = handles?.[`${c.from.id}>${c.to.id}`];
    const rev = back ? handles?.[`${c.to.id}>${c.from.id}`] : undefined;
    const sides = fwd ?? (rev ? { s: rev.t, t: rev.s } : undefined);
    out.push({ id: c.id, source: c.from.id, target: c.to.id, type: "link", data: { forward: c, back, fresh: now - last < FRESH_MS, sides } });
  }
  return out;
}

/** The four dots on a card that a line can be drawn from. */
export const SIDES = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
] as const;

const SIDE_POS: Record<string, Position> = Object.fromEntries(SIDES);

export interface LineEnds {
  sx: number;
  sy: number;
  sp: Position;
  tx: number;
  ty: number;
  tp: Position;
}

function box(n: InternalNode) {
  const w = n.measured.width ?? CARD_W;
  const h = n.measured.height ?? CARD_H;
  const p = n.internals.positionAbsolute;
  return { x: p.x, y: p.y, w, h, cx: p.x + w / 2, cy: p.y + h / 2 };
}

/** A point on a card's side, for a line drawn to a particular dot. */
function sidePoint(n: InternalNode, side: string) {
  const b = box(n);
  switch (side) {
    case "top":
      return { x: b.cx, y: b.y };
    case "bottom":
      return { x: b.cx, y: b.y + b.h };
    case "left":
      return { x: b.x, y: b.cy };
    default:
      return { x: b.x + b.w, y: b.cy };
  }
}

/** Line ends on the exact dots the person linked. */
export function sideEnds(a: InternalNode, b: InternalNode, sides: { s: string; t: string }): LineEnds {
  const s = sidePoint(a, sides.s);
  const t = sidePoint(b, sides.t);
  return { sx: s.x, sy: s.y, sp: SIDE_POS[sides.s] ?? Position.Right, tx: t.x, ty: t.y, tp: SIDE_POS[sides.t] ?? Position.Left };
}

/** Where a line leaves and enters two cards: the sides facing each other. */
export function facingEnds(a: InternalNode, b: InternalNode): LineEnds {
  const A = box(a);
  const B = box(b);
  const dx = B.cx - A.cx;
  const dy = B.cy - A.cy;
  // Sideways when the cards sit more side by side than above each other.
  if (Math.abs(dx) * 0.6 >= Math.abs(dy)) {
    const right = dx > 0;
    return {
      sx: right ? A.x + A.w : A.x,
      sy: A.cy,
      sp: right ? Position.Right : Position.Left,
      tx: right ? B.x : B.x + B.w,
      ty: B.cy,
      tp: right ? Position.Left : Position.Right,
    };
  }
  const down = dy > 0;
  return {
    sx: A.cx,
    sy: down ? A.y + A.h : A.y,
    sp: down ? Position.Bottom : Position.Top,
    tx: B.cx,
    ty: down ? B.y : B.y + B.h,
    tp: down ? Position.Top : Position.Bottom,
  };
}
