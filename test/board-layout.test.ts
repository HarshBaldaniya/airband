// The Tower's layouts: channels left to right, groups cut to the board's size, cards pushed down
// when one grows, and a dropped card kept one unit clear of the others.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectionView } from "../src/vscode/protocol";
import type { ChatSession } from "../src/core/types";
import { autoLayout, CARD_H, CARD_W, clearOf, LANE_HEAD, LANE_PAD, laneLayout, spreadDown, UNIT } from "../webview-ui/board/tower/layout";

const NOW = new Date(2026, 10, 24, 15, 0).getTime();
const HOUR = 3_600_000;

function chat(id: string, over: Partial<ChatSession> = {}): ChatSession {
  return { id, tool: "Claude", title: `Chat ${id}`, cwd: "/work/app", lastModified: NOW - HOUR, status: "idle", file: `/tmp/${id}.jsonl`, ...over };
}

function link(from: string, to: string): ConnectionView {
  return { id: `${from}>${to}`, from: { id: from, title: from, tool: "Claude" }, to: { id: to, title: to, tool: "Claude" }, updates: 0, chars: 0, paused: false, level: "ping" } as ConnectionView;
}

test("by channels: each chat sits one column right of what feeds it; unlinked chats go below", () => {
  const p = autoLayout(["a", "b", "c", "loose"], [link("a", "b"), link("b", "c")]);
  assert.equal(p.a.x, 0);
  assert.ok(p.b.x > p.a.x && p.c.x > p.b.x, "a feeds b feeds c, left to right");
  assert.equal(p.a.y, p.b.y, "columns of one card line up");
  assert.ok(p.loose.y > p.a.y + CARD_H, "the unlinked chat is under the channels");
  assert.equal(p.loose.x, 0);
});

test("by channels with no links: an even grid, three or four across", () => {
  const ids = ["1", "2", "3", "4", "5", "6", "7"];
  const p = autoLayout(ids, []);
  const rows = new Set(ids.map((id) => p[id].y));
  assert.equal(rows.size, 3, "seven cards: rows of three, three and one");
  assert.deepEqual(
    ids.filter((id) => p[id].y === 0).map((id) => p[id].x),
    [0, 1, 2].map((i) => i * (CARD_W + 48)),
  );
});

test("by time: Today before Yesterday before Older, newest first in each", () => {
  const chats = [chat("old", { lastModified: NOW - 30 * 24 * HOUR }), chat("today", { lastModified: NOW - HOUR }), chat("yesterday", { lastModified: NOW - 24 * HOUR }), chat("now", { lastModified: NOW })];
  const { positions, lanes } = laneLayout(chats, "time", {}, "/work/app", { w: 1600, h: 1200 }, NOW);
  assert.deepEqual(
    lanes.map((l) => [l.label, l.count]),
    [
      ["Today", 2],
      ["Yesterday", 1],
      ["Older", 1],
    ],
  );
  assert.equal(lanes[0].x, LANE_PAD);
  assert.equal(lanes[0].y, LANE_HEAD);
  assert.ok(positions.now.x <= positions.today.x && positions.now.y <= positions.today.y, "the newest card comes first");
});

test("by folder: this window's folder first, a folder from elsewhere by its own name", () => {
  const chats = [chat("x", { away: true, cwd: "/work/api", lastModified: NOW }), chat("y")];
  const { lanes } = laneLayout(chats, "folder", {}, "/work/app", { w: 1600, h: 1200 }, NOW);
  assert.deepEqual(
    lanes.map((l) => [l.label, l.here]),
    [
      ["app", true],
      ["api", false],
    ],
  );
});

test("a group never grows taller than the board: it spreads sideways into more columns", () => {
  const chats = Array.from({ length: 6 }, (_, i) => chat(`c${i}`, { lastModified: NOW - i * 1000 }));
  const sizes = Object.fromEntries(chats.map((c) => [c.id, { w: CARD_W, h: 200 }]));
  const view = { w: 800, h: LANE_HEAD + LANE_PAD + 2 * 200 + UNIT };
  const { lanes } = laneLayout(chats, "agent", sizes, "/work/app", view, NOW);
  assert.equal(lanes.length, 1);
  assert.ok(lanes[0].h <= view.h - LANE_HEAD - LANE_PAD, "fits the board's height");
  assert.equal(lanes[0].w, 3 * CARD_W + 2 * UNIT, "two cards high, three across");
});

test("a card that grows pushes the cards under it down, never up, and leaves cards beside it alone", () => {
  const moved = spreadDown([
    { id: "top", x: 0, y: 0, w: CARD_W, h: 300 },
    { id: "under", x: 0, y: 200, w: CARD_W, h: 100 },
    { id: "beside", x: CARD_W + 2 * UNIT, y: 100, w: CARD_W, h: 100 },
  ]);
  assert.deepEqual(moved, { under: { x: 0, y: 300 + UNIT } });
});

test("a card dropped too close to another moves beside it, one unit clear", () => {
  const other = { x: 0, y: 0, w: CARD_W, h: CARD_H };
  assert.deepEqual(clearOf({ x: 500, y: 500 }, { w: CARD_W, h: CARD_H }, [other]), { x: 500, y: 500 }, "far enough: stays where it was dropped");
  const p = clearOf({ x: 5, y: CARD_H - 20 }, { w: CARD_W, h: CARD_H }, [other]);
  assert.deepEqual(p, { x: 0, y: CARD_H + UNIT }, "under the card, lined up with it");
});
