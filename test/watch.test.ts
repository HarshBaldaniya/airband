// The backup for chats whose hook doesn't run: the Station reads their files as they change, and
// such a chat still shows as working, then done, with its record caught up. A chat whose hook runs
// is left to the hook, and lines that are not a reply (a title, an app taking a chat over) are
// never taken for work.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChatWatch, WATCHED, chatOfFile, readWritten } from "../src/station/watch";
import { readHookStatus } from "../src/sessions/status";
import { readAsks, readHead } from "../src/sessions/record/store";
import { statusDir, writeFileAtomic } from "../src/core/paths";
import { forgetReads, liveChats } from "../src/station/chats";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const j = (o: unknown) => JSON.stringify(o) + "\n";
let claudeDir = "";
let codexDir = "";
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-watch-home-");
  claudeDir = tmp("airband-watch-claude-");
  codexDir = tmp("airband-watch-codex-");
});

const ID = "aaaa1111-0000-4000-8000-000000000001";
const user = (text: string) => j({ type: "user", cwd: "/work/shop-frontend", timestamp: new Date().toISOString(), message: { role: "user", content: text } });
const toolCall = () => j({ type: "assistant", timestamp: new Date().toISOString(), message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
const toolResult = () => j({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a.ts" }] } });
const reply = (text: string) => j({ type: "assistant", timestamp: new Date().toISOString(), message: { id: "m2", role: "assistant", content: [{ type: "text", text }] } });

function claudeChat(id = ID) {
  const dir = path.join(claudeDir, "-work-shop-frontend");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}.jsonl`);
}

test("which chat a changed file belongs to: a chat's own file only", () => {
  assert.deepEqual(chatOfFile(path.join(claudeDir, "-work-app", `${ID}.jsonl`), claudeDir, codexDir), { tool: "claude", id: ID });
  assert.equal(chatOfFile(path.join(claudeDir, "-work-app", ID, "subagents", "agent-1.jsonl"), claudeDir, codexDir), undefined);
  assert.equal(chatOfFile(path.join(claudeDir, "-work-app", "notes.txt"), claudeDir, codexDir), undefined);
  const uuid = "01a1fe92-880c-7bb3-9db5-687369b71640";
  assert.deepEqual(chatOfFile(path.join(codexDir, "2026", "11", "21", `rollout-2026-11-21T20-16-21-${uuid}.jsonl`), claudeDir, codexDir), { tool: "codex", id: uuid });
  assert.equal(chatOfFile(path.join(os.tmpdir(), `${ID}.jsonl`), claudeDir, codexDir), undefined);
});

test("what was written: Claude Code's turn ends with a reply that asks for no tool", () => {
  assert.deepEqual(readWritten("claude", user("hi") + toolCall()), { replied: true, ended: false, cwd: "/work/shop-frontend" });
  assert.equal(readWritten("claude", toolCall() + toolResult()).ended, false);
  assert.equal(readWritten("claude", toolResult() + reply("Done.")).ended, true);
  assert.deepEqual(readWritten("claude", j({ type: "ai-title", aiTitle: "x" }) + '{"half'), { replied: false, ended: false });
});

test("what was written: Codex's turn ends with task_complete", () => {
  const ev = (type: string) => j({ type: "event_msg", payload: { type } });
  const said = j({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } });
  assert.deepEqual(readWritten("codex", ev("task_started") + said), { replied: true, ended: false });
  assert.equal(readWritten("codex", said + ev("task_complete")).ended, true);
  assert.equal(readWritten("codex", ev("turn_aborted")).ended, true);
});

test("a Claude chat with no hook: working while it replies, done when the turn ends, its ask recorded", async () => {
  let changes = 0;
  const watch = new ChatWatch(() => changes++, { claude: claudeDir, codex: codexDir });
  const file = claudeChat();
  fs.writeFileSync(file, user("List the files") + toolCall());
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(ID)?.status, "working");
  assert.equal(readHookStatus(ID)?.event, WATCHED);
  assert.equal(liveChats().find((c) => c.id === ID)?.status, "working", "Roger lists it as working");

  fs.appendFileSync(file, toolResult() + reply("There is one file, a.ts."));
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(ID)?.status, "done");
  assert.equal(readHead(ID)?.cwd, "/work/shop-frontend");
  assert.equal(readAsks(ID, 5).at(-1)?.ask, "List the files");
  assert.equal(changes, 2);
  forgetReads();
  assert.equal(liveChats().find((c) => c.id === ID)?.status, "done");

  // Lines after the turn (a title): still done, and no new change for Roger.
  fs.appendFileSync(file, j({ type: "ai-title", aiTitle: "Files", sessionId: ID }));
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(ID)?.status, "done");
  assert.equal(changes, 2);
});

test("a chat whose hook runs is the hook's: the watcher writes nothing", async () => {
  const watch = new ChatWatch(() => undefined, { claude: claudeDir, codex: codexDir });
  const file = claudeChat();
  fs.mkdirSync(statusDir(), { recursive: true });
  writeFileAtomic(path.join(statusDir(), `${ID}.json`), JSON.stringify({ status: "working", at: 1, event: "UserPromptSubmit" }));
  fs.writeFileSync(file, user("hi") + reply("Hello."));
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(ID)?.event, "UserPromptSubmit");
});

test("an old chat that only gets a title, or is taken over by an app, is not work", async () => {
  const watch = new ChatWatch(() => assert.fail("no change expected"), { claude: claudeDir, codex: codexDir });
  const file = claudeChat();
  fs.writeFileSync(file, user("old ask") + reply("old reply"));
  // Its record is caught up to the end: what follows is all that is read.
  const { updateRecord } = await import("../src/sessions/record/update");
  updateRecord(ID, "claude", file, { cwd: "/work/shop-frontend" });
  fs.appendFileSync(file, j({ type: "ai-title", aiTitle: "Old" }) + j({ type: "cost-state", totalCostUSD: 1 }));
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(ID), undefined);
});

test("a Codex chat with no hook: a whole turn written at once counts as done", async () => {
  let changes = 0;
  const watch = new ChatWatch(() => changes++, { claude: claudeDir, codex: codexDir });
  const id = "01a1fe92-880c-7bb3-9db5-687369b71640";
  const day = path.join(codexDir, "2026", "11", "24");
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-11-24T10-00-00-${id}.jsonl`);
  const msg = (role: string, text: string) => j({ type: "response_item", payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] } });
  fs.writeFileSync(
    file,
    j({ type: "session_meta", payload: { id, cwd: "/work/api", originator: "Codex Desktop" } }) + j({ type: "event_msg", payload: { type: "task_started" } }) + msg("user", "Add a health check") + msg("assistant", "Added GET /health.") + j({ type: "event_msg", payload: { type: "task_complete" } }),
  );
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(id)?.status, "done");
  assert.equal(readHead(id)?.cwd, "/work/api");
  assert.equal(readAsks(id, 5).at(-1)?.ask, "Add a health check");
  assert.equal(changes, 1);
});

test("a Codex agent's own thread is part of the chat that started it, not a chat of its own", async () => {
  const { isSubagentMeta } = await import("../src/adapters/codex");
  assert.equal(isSubagentMeta({ id: "x", source: "vscode", thread_source: "user" }), false);
  assert.equal(isSubagentMeta({ id: "x", source: { subagent: { parent_thread_id: "p" } } }), true);
  assert.equal(isSubagentMeta({ id: "x", source: "exec", thread_source: "subagent" }), true);
  let changes = 0;
  const watch = new ChatWatch(() => changes++, { claude: claudeDir, codex: codexDir });
  const id = "01a1fe92-880c-7bb3-9db5-687369b71641";
  const day = path.join(codexDir, "2026", "11", "24");
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-11-24T10-00-00-${id}.jsonl`);
  fs.writeFileSync(file, j({ type: "session_meta", payload: { id, cwd: "/work/api", source: { subagent: { parent_thread_id: "p" } } } }) + j({ type: "event_msg", payload: { type: "task_complete" } }));
  watch.touched(file);
  await watch.tick();
  assert.equal(readHookStatus(id), undefined);
  assert.equal(changes, 0);
});
