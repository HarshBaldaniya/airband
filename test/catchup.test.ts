// The Station keeps every recent chat's record caught up, in every folder, with no editor
// extension: big chats and quiet ones the hook leaves alone, running ones first.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CatchUp, needsCatchUp } from "../src/station/catchup";
import { projectOf } from "../src/station/chats";
import { readAsks, readHead } from "../src/sessions/record/store";
import { statusDir } from "../src/core/paths";
import type { Adapter } from "../src/adapters/adapter";
import type { ChatSession } from "../src/core/types";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-catchup-home-");
  process.env.CLAUDE_CONFIG_DIR = tmp("airband-catchup-claude-");
});

const j = (o: unknown) => JSON.stringify(o) + "\n";
let t = Date.parse("2026-11-23T08:00:00Z");
const ts = () => new Date((t += 60_000)).toISOString();
const exchange = (ask: string, did: string) =>
  j({ type: "user", timestamp: ts(), message: { role: "user", content: ask } }) + j({ type: "assistant", timestamp: ts(), message: { id: `m${t}`, role: "assistant", content: [{ type: "text", text: did }] } });

/** A Claude Code chat file in its own project folder, last written `ago` ms before `now`. */
function chat(id: string, cwd: string, ago: number, now: number): ChatSession {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", "-Users-me-shop-frontend");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, exchange("Fix the usage page", "Fixed it. 6 new tests pass.") + exchange("Now sync the PR", "Synced and pushed."));
  const when = new Date(now - ago);
  fs.utimesSync(file, when, when);
  return { id, tool: "Claude", title: `Chat ${id}`, cwd, lastModified: now - ago, status: "idle", file };
}

function hookSays(id: string, status: "working" | "waiting", at: number) {
  fs.mkdirSync(statusDir(), { recursive: true });
  fs.writeFileSync(path.join(statusDir(), `${id}.json`), JSON.stringify({ status, at, event: "PostToolUse" }));
}

test("big or quiet chats with no record are caught up, running ones first; a small chat replying now is left to its hook", () => {
  const now = Date.now();
  const quiet = chat("quiet", "/Users/me/shop-frontend", 10 * 60_000, now);
  const running = chat("running", "/Users/me/shop-frontend/.claude/worktrees/audit", 5 * 60_000, now);
  hookSays("running", "working", now - 1000);
  const replying = chat("replying", "/Users/me/glyphcast", 5_000, now);
  const old = chat("old", "/Users/me/old", 3 * 24 * 3600e3, now);
  const picked = needsCatchUp([quiet, replying, old, running], now).map((s) => s.id);
  assert.deepEqual(picked, ["running", "quiet"]);
});

test("one sweep writes the records, in any folder, through each agent's own list", async () => {
  const now = Date.now();
  const a = chat("shop-1", "/Users/me/shop-frontend/.claude/worktrees/usage-fe-sync", 10 * 60_000, now);
  const b = chat("shop-2", "/Users/me/shop-frontend/.claude/worktrees/audit", 10 * 60_000, now);
  const fake: Adapter = { tool: "Claude", present: () => true, list: async () => [a, b], read: async () => ({ messages: [], files: [] }), usage: () => undefined } as unknown as Adapter;
  const done = await new CatchUp([fake]).sweep(now);
  assert.equal(done, 2);
  for (const id of ["shop-1", "shop-2"]) {
    assert.equal(readHead(id)?.title, `Chat ${id}`);
    assert.deepEqual(readAsks(id).map((x) => x.ask), ["Fix the usage page", "Now sync the PR"]);
  }
  // Caught up: the next sweep has nothing to do.
  assert.equal(await new CatchUp([fake]).sweep(now), 0);
});

test("a worktree chat is named after its repository", () => {
  assert.equal(projectOf("/Users/me/shop-frontend/.claude/worktrees/audit"), "shop-frontend");
  assert.equal(projectOf("/Users/me/shop-frontend"), "shop-frontend");
  assert.equal(projectOf("C:\\code\\app\\.codex\\worktrees\\fix"), "app");
  assert.equal(projectOf(undefined), "no folder");
});
