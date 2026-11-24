// A Claude Code chat whose turn ended while agents it sent to the background still work is working
// until they end: read from each agent's description beside the chat's file, while the chat's
// process runs and the agent wrote lately.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AGENT_QUIET_MS, WAITED_AGENT_QUIET_MS, forgetAgents, runningAgents } from "../src/sessions/subagents";
import { claudeRunningChats } from "../src/sessions/running";
import { record } from "../src/hook/status";
import { forgetReads, liveChats } from "../src/station/chats";
import { updateRecord } from "../src/sessions/record/update";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const j = (o: unknown) => JSON.stringify(o) + "\n";
const ID = "cccc3333-0000-4000-8000-000000000003";

let file = "";
let agents = "";
let sessions = "";
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-bg-home-");
  const config = tmp("airband-bg-claude-");
  process.env.CLAUDE_CONFIG_DIR = config;
  sessions = path.join(config, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const dir = path.join(config, "projects", "-work-shop");
  file = path.join(dir, `${ID}.jsonl`);
  agents = path.join(dir, ID, "subagents");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(file, j({ type: "user", cwd: "/work/shop", message: { role: "user", content: "Fix the cart" } }));
  forgetAgents();
  forgetReads();
});

function agent(name: string, meta: Record<string, unknown>, wrote = Date.now()) {
  fs.writeFileSync(path.join(agents, `agent-${name}.meta.json`), JSON.stringify({ agentType: "general-purpose", requestShape: "background", ...meta }));
  const f = path.join(agents, `agent-${name}.jsonl`);
  fs.writeFileSync(f, j({ type: "assistant" }));
  fs.utimesSync(f, wrote / 1000, wrote / 1000);
}

/** This test's own process stands in for the chat's Claude Code. */
const runs = (pid = process.pid) => fs.writeFileSync(path.join(sessions, `${pid}.json`), JSON.stringify({ pid, sessionId: ID }));

test("an agent not marked finished, in a chat that runs, works; a finished one does not", () => {
  runs();
  agent("a1", { finished: true });
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions)), undefined);
  // One the chat waits for counts while it writes, and is taken for gone sooner once quiet.
  agent("a2", { requestShape: "foreground" });
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions))?.count, 1);
  agent("a2", { requestShape: "foreground" }, Date.now() - WAITED_AGENT_QUIET_MS - 60_000);
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions)), undefined);
  agent("a3", {});
  agent("a4", {});
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions))?.count, 2);
  // One ends: its description is rewritten in place.
  fs.writeFileSync(path.join(agents, "agent-a3.meta.json"), JSON.stringify({ requestShape: "background", finished: true }));
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions))?.count, 1);
});

test("an unmarked agent of a closed chat, or one quiet for long, is gone", () => {
  agent("a1", {});
  // A process id no process has.
  runs(2 ** 22 + 12345);
  assert.equal(claudeRunningChats(sessions).has(ID), false);
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions)), undefined, "the chat was closed");
  runs();
  agent("a1", {}, Date.now() - AGENT_QUIET_MS - 60_000);
  assert.equal(runningAgents(ID, file, claudeRunningChats(sessions)), undefined, "quiet for half an hour");
});

test("Roger lists a chat whose turn ended as working while its background agent works, and says so", () => {
  const hooks = path.join(tmp("airband-bg-settings-"), "settings.json");
  process.env.AIRBAND_CLAUDE_SETTINGS = hooks;
  const { connect } = require("../src/install/agent-hooks") as typeof import("../src/install/agent-hooks");
  connect('"/usr/bin/node" "/h/.airband/airband-hook.js"', hooks);
  fs.appendFileSync(file, j({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Started an agent." }] } }));
  updateRecord(ID, "claude", file, { cwd: "/work/shop" });
  record({ session_id: ID, hook_event_name: "Stop", cwd: "/work/shop", transcript_path: file }, Date.now(), "claude");
  assert.equal(liveChats().find((c) => c.id === ID)?.status, "done");

  runs();
  agent("a1", {});
  forgetReads();
  const chat = liveChats().find((c) => c.id === ID);
  assert.equal(chat?.status, "working");
  assert.equal(chat?.agents, 1);

  fs.writeFileSync(path.join(agents, "agent-a1.meta.json"), JSON.stringify({ requestShape: "background", finished: true }));
  forgetReads();
  const after = liveChats().find((c) => c.id === ID);
  assert.equal(after?.status, "done");
  assert.equal(after?.agents, undefined);
});
