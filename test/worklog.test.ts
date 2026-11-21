// A standup and a spend report from every chat's record: what was done since a day, per project,
// and the tokens each agent reported, with each ticket's share estimated from the asks.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { airbandFile } from "../src/core/paths";
import { renderSpend, renderWork, sinceDays, spendSince, totalOf, workSince } from "../src/core/worklog";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const HOUR = 3600e3;
let root = "";

beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-worklog-");
  root = tmp("airband-projects-");
});

/** A Claude Code chat file with one reply per ask, each reporting its tokens. */
function claudeFile(at: number[], tokens: number): string {
  const file = path.join(tmp("airband-chat-"), "chat.jsonl");
  const lines = at.map((t, i) =>
    JSON.stringify({ type: "assistant", timestamp: new Date(t).toISOString(), message: { id: `m${i}`, model: "claude-opus-5-5", usage: { input_tokens: tokens, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "ok" }] } }),
  );
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function chat(id: string, project: string, title: string, asks: { at: number; ask: string; did: string; refs?: string[]; open?: string }[], file = "/none") {
  fs.mkdirSync(airbandFile("flightlogs"), { recursive: true });
  const cwd = path.join(root, project);
  fs.writeFileSync(airbandFile("flightlogs", `${id}.json`), JSON.stringify({ id, tool: "claude", title, cwd, file, cursor: 0, n: asks.length, updatedAt: Math.max(...asks.map((a) => a.at)) }));
  fs.writeFileSync(
    airbandFile("flightlogs", `${id}.jsonl`),
    asks.map((a, i) => JSON.stringify({ n: i + 1, at: a.at, ask: a.ask, did: a.did, files: [], refs: a.refs ?? [], src: [0, 0], ...(a.open ? { open: a.open } : {}) })).join("\n") + "\n",
  );
}

test("a standup: what each project's chats did since the day, with tickets and what is open", () => {
  const now = Date.now();
  const since = sinceDays(2, now);
  chat("aaaa1111", "my-api", "Seat limits", [
    { at: since - 5 * HOUR, ask: "old work", did: "Done long ago." },
    { at: now - HOUR, ask: "clamp negative seats", did: "syncSeats now rejects negatives.", refs: ["ENG-142", "PR #128"], open: "Next: add the migration." },
  ]);
  chat("bbbb2222", "my-app", "Login page", [{ at: now - 2 * HOUR, ask: "fix redirect", did: "Redirect goes back to the page you came from." }]);
  chat("cccc3333", "my-app", "Last month", [{ at: since - 40 * 24 * HOUR, ask: "x", did: "y" }]);
  const work = workSince(since);
  assert.deepEqual(work.map((c) => c.title), ["Seat limits", "Login page"]);
  assert.equal(work[0].asks.length, 1, "only asks since the day");
  const text = renderWork(work, since);
  assert.match(text, /2 asks in 2 chats, 2 projects\./);
  assert.match(text, /my-api\n {2}“Seat limits” \(Claude Code, 1 ask, id aaaa1111\) · ENG-142, PR #128\n {4}- clamp negative seats → syncSeats now rejects negatives\.\n {4}Open: Next: add the migration\./);
  assert.deepEqual(workSince(since, path.join(root, "my-app")).map((c) => c.title), ["Login page"], "one project only");
  assert.match(renderWork([], since), /^No chat recorded work since /);
});

test("spend: each chat's tokens since the day, by project, and each ticket's estimated share", () => {
  const now = Date.now();
  const since = sinceDays(1, now);
  // Two replies today, whatever the time (an hour ago is yesterday just after midnight).
  const t1 = since + (now - since) / 3;
  const t2 = since + (2 * (now - since)) / 3;
  const file = claudeFile([since - 30 * HOUR, t1, t2], 1000);
  chat(
    "dddd4444",
    "my-api",
    "Seat limits",
    [
      { at: t1, ask: "clamp", did: "done", refs: ["ENG-142"] },
      { at: t2, ask: "review", did: "done", refs: ["PR #128", "ENG-142", "9fe1d02e1"] },
    ],
    file,
  );
  const chats = spendSince(since);
  assert.equal(chats.length, 1);
  assert.equal(totalOf(chats[0].usage), 2 * 1010, "the reply from before the day is left out");
  const parts = Object.fromEntries(chats[0].refs.map((r) => [r.name, r.part]));
  assert.deepEqual(parts, { "ENG-142": 0.75, "PR #128": 0.25 }, "split over asks, then over what each names; commits are not tickets");
  const text = renderSpend(chats, since);
  assert.match(text, /2k tokens in 1 chat/);
  assert.match(text, /By ticket or PR \(estimated[^\n]*\n {2}ENG-142 +2k +75%/);
  assert.match(renderSpend([], since), /^No chat spent tokens since/);
});
