// A new chat has no record until its first turn ends, so Roger lists it from the hook's status:
// working on its first ask, with that ask as its title, and done once its record exists. The
// Claude app's own id for a chat comes from its running agent too, so Open can show it there.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { record } from "../src/hook/status";
import { readHookStatus } from "../src/sessions/status";
import { forgetReads, liveChats } from "../src/station/chats";
import { updateRecord } from "../src/sessions/record/update";
import { claudeAppHost } from "../src/sessions/apps";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const j = (o: unknown) => JSON.stringify(o) + "\n";
const ID = "bbbb2222-0000-4000-8000-000000000002";

let file = "";
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-first-home-");
  const dir = path.join(tmp("airband-first-claude-"), "-work-shop");
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, `${ID}.jsonl`);
  fs.writeFileSync(file, j({ type: "user", cwd: "/work/shop", entrypoint: "claude-desktop", message: { role: "user", content: "Fix the cart total" } }));
  forgetReads();
});

test("the hook's status keeps the agent, the chat's file and the ask from one event to the next", () => {
  const now = Date.now();
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", transcript_path: file, prompt: "Fix the cart total" }, now, "claude");
  record({ session_id: ID, hook_event_name: "PostToolUse", cwd: "/work/shop", tool_name: "Bash" }, now + 1, "claude");
  assert.deepEqual(readHookStatus(ID), { status: "working", at: now + 1, event: "PostToolUse", cwd: "/work/shop", tool: "claude", file, ask: "Fix the cart total" });
  record({ session_id: ID, hook_event_name: "SessionEnd", cwd: "/work/shop" }, now + 2, "claude");
  assert.equal(readHookStatus(ID)?.ask, undefined, "an ended chat works on nothing");
});

test("a new chat shows as working on its first ask, before it has a record, and once only after", () => {
  const now = Date.now();
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", transcript_path: file, prompt: "Fix the cart total" }, now, "claude");
  const listed = liveChats(now).filter((c) => c.id === ID);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "working");
  assert.equal(listed[0].title, "Fix the cart total");
  assert.equal(listed[0].project, "shop");
  assert.equal(listed[0].app, "claude-app", "Open shows it where it runs");

  // The turn ends: the hook writes the record, and the chat is listed from it, once.
  fs.appendFileSync(file, j({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Fixed." }] } }));
  updateRecord(ID, "claude", file, { cwd: "/work/shop" });
  record({ session_id: ID, hook_event_name: "Stop", cwd: "/work/shop", transcript_path: file }, now + 5, "claude");
  forgetReads();
  const after = liveChats(now + 5).filter((c) => c.id === ID);
  assert.equal(after.length, 1);
  assert.equal(after[0].status, "done");
});

test("a status with no agent (an older hook), or one that only finished, adds no chat", () => {
  const now = Date.now();
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", prompt: "hi" }, now);
  assert.equal(liveChats(now).some((c) => c.id === ID), false);
  record({ session_id: ID, hook_event_name: "Stop", cwd: "/work/shop", transcript_path: file }, now, "claude");
  assert.equal(liveChats(now).some((c) => c.id === ID), false);
});

test("the Claude app's id for a chat its agent runs now", () => {
  const dir = tmp("airband-first-sessions-");
  fs.writeFileSync(path.join(dir, "19045.json"), JSON.stringify({ pid: 19045, sessionId: ID, hostSessionId: "local_9739f939", entrypoint: "claude-desktop" }));
  fs.writeFileSync(path.join(dir, "200.json"), JSON.stringify({ pid: 200, sessionId: "other", hostSessionId: "local_x" }));
  fs.writeFileSync(path.join(dir, "300.json"), JSON.stringify({ pid: 300, sessionId: "cli-chat" }));
  fs.writeFileSync(path.join(dir, "400.json"), "{ half");
  assert.equal(claudeAppHost(ID, dir), "local_9739f939");
  assert.equal(claudeAppHost("cli-chat", dir), undefined, "a chat in a terminal has no app id");
  assert.equal(claudeAppHost(ID, path.join(dir, "missing")), undefined);
});

test("the ask is what the person wrote: the app's hidden reminder in front of it is left out", () => {
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", transcript_path: file, prompt: "<system-reminder>\nYou are operating in a git worktree.\n</system-reminder>\nHi there" }, Date.now(), "claude");
  assert.equal(readHookStatus(ID)?.ask, "Hi there");
});

test("a new Claude app chat is working from its start, while its startup hooks still run; a terminal's start is nothing", () => {
  const was = process.env.CLAUDE_CODE_ENTRYPOINT;
  try {
    const now = Date.now();
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    record({ session_id: ID, hook_event_name: "SessionStart", source: "startup", cwd: "/work/shop", transcript_path: file }, now, "claude");
    assert.equal(readHookStatus(ID), undefined, "a terminal starts Claude Code before anything is asked");

    process.env.CLAUDE_CODE_ENTRYPOINT = "claude-desktop";
    record({ session_id: ID, hook_event_name: "SessionStart", source: "resume", cwd: "/work/shop", transcript_path: file }, now, "claude");
    assert.equal(readHookStatus(ID), undefined, "the app opening an old chat is not work");
    record({ session_id: ID, hook_event_name: "SessionStart", source: "startup", cwd: "/work/shop", transcript_path: file }, now, "claude");
    const listed = liveChats(now).find((c) => c.id === ID);
    assert.equal(listed?.status, "working");
    assert.equal(listed?.title, "New chat");
    assert.equal(liveChats(now + 3 * 60_000).some((c) => c.id === ID), false, "a start with nothing after it does not stay working");
  } finally {
    if (was === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
    else process.env.CLAUDE_CODE_ENTRYPOINT = was;
  }
});

test("done stays done while the app writes its own lines after the turn; a new reply after it is work", () => {
  const hooks = path.join(tmp("airband-first-settings-"), "settings.json");
  process.env.AIRBAND_CLAUDE_SETTINGS = hooks;
  const { connect } = require("../src/install/agent-hooks") as typeof import("../src/install/agent-hooks");
  connect('"/usr/bin/node" "/h/.airband/airband-hook.js"', hooks);
  const at = Date.now() - 30_000;
  const stamp = (ms: number) => new Date(ms).toISOString();
  fs.appendFileSync(file, j({ type: "assistant", timestamp: stamp(at - 100), message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Hi." }] } }));
  updateRecord(ID, "claude", file, { cwd: "/work/shop" });
  record({ session_id: ID, hook_event_name: "Stop", cwd: "/work/shop", transcript_path: file }, at, "claude");
  // Seconds later the app writes a summary of its Stop hooks and its own notes: not work.
  fs.appendFileSync(file, j({ type: "system", subtype: "stop_hook_summary", timestamp: stamp(at + 15_000) }) + j({ type: "session-owner" }));
  forgetReads();
  assert.equal(liveChats().find((c) => c.id === ID)?.status, "done");
  // Another Stop hook sent it back to work: a reply made after the Stop.
  fs.appendFileSync(file, j({ type: "assistant", timestamp: stamp(Date.now()), message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Also fixed the tax." }] } }));
  forgetReads();
  assert.equal(liveChats().find((c) => c.id === ID)?.status, "working");
});

test("an agent's steps keep the chat working on its own file and ask; the system's messages are not asks", () => {
  const now = Date.now();
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", transcript_path: file, prompt: "Fix the cart total" }, now, "claude");
  const agentFile = path.join(path.dirname(file), ID, "subagents", "agent-a1.jsonl");
  record({ session_id: ID, hook_event_name: "PostToolUse", cwd: "/work/shop", transcript_path: agentFile, agent_id: "a1", tool_name: "Bash" }, now + 1, "claude");
  assert.equal(readHookStatus(ID)?.status, "working");
  assert.equal(readHookStatus(ID)?.file, file, "the chat's file, not the agent's");
  // An agent finishing sends the chat a notice in the person's place: it is not the ask.
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", transcript_path: file, prompt: "<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>" }, now + 2, "claude");
  assert.equal(readHookStatus(ID)?.ask, "Fix the cart total");
  record({ session_id: ID, hook_event_name: "UserPromptSubmit", cwd: "/work/shop", transcript_path: file, prompt: "Another Claude session sent a message: hi" }, now + 3, "claude");
  assert.equal(readHookStatus(ID)?.ask, "Fix the cart total");
});
