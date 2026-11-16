// The short lines Airband shows the person (never the model): when a chat starts, and when another
// chat's work rides along with a message. Claude Code and Gemini CLI show them; Codex can't.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handle } from "../src/hook/airband-hook";
import { deliveryNotice, startNotice } from "../src/core/notices";
import { addConnection, appendInbox } from "../src/core/store";
import { airbandFile } from "../src/core/paths";
import { storeDir } from "../src/codemap/store";
import { setConfig } from "../src/core/updates";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let project = "";
const NOW = Date.UTC(2026, 10, 16, 12, 0);

beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-notices-");
  process.env.AIRBAND_CLAUDE_SETTINGS = path.join(tmp("airband-claude-"), "settings.json");
  project = path.join(tmp("airband-proj-"), "BOS-Frontend");
  fs.mkdirSync(project);
});

function mapped(files: number) {
  fs.mkdirSync(storeDir(project), { recursive: true });
  fs.writeFileSync(path.join(storeDir(project), "meta.json"), JSON.stringify({ v: 1, root: project, files }));
}

function chat(id: string, tool: "claude" | "codex", title: string, minutesAgo: number, cwd = project) {
  fs.mkdirSync(airbandFile("flightlogs"), { recursive: true });
  fs.writeFileSync(airbandFile("flightlogs", `${id}.json`), JSON.stringify({ id, tool, title, cwd, file: "/x", cursor: 0, n: 3, updatedAt: NOW - minutesAgo * 60_000 }));
}

test("a chat starts with one line: on, the map, who it shares with", () => {
  mapped(5519);
  addConnection({ id: "s1", tool: "Claude", title: "UI bugs" }, { id: "b1", tool: "Codex", title: "Billing fix" }, NOW);
  assert.equal(startNotice({ sessionId: "s1", cwd: project, now: NOW }), "✓ Airband · map of BOS-Frontend ready (5,519 files) · sharing with “Billing fix” (Codex)");
});

test("not connected yet, no map yet: still says it is on and what it does", () => {
  assert.equal(startNotice({ sessionId: "s1", cwd: project, now: NOW }), "✓ Airband · map of BOS-Frontend builds on first use · other chats can catch up on this one");
});

test("other chats that worked here lately are named, with what to say to catch up", () => {
  mapped(10);
  chat("c1", "codex", "Fix login redirect", 30);
  chat("c2", "claude", "Write the billing tests", 90);
  chat("old", "claude", "Last week's work", 60 * 30);
  chat("elsewhere", "claude", "Another repo", 5, path.join(os.tmpdir(), "somewhere-else"));
  // One chat: "what it did".
  assert.match(startNotice({ sessionId: "c2", cwd: project, now: NOW }).split("\n")[1], /^  Another chat worked here.*“Fix login redirect” \(Codex\)\. Say “catch up” to hear what it did\.$/);
  const lines = startNotice({ sessionId: "s1", cwd: project, now: NOW }).split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1], "  2 other chats worked here in the last 12 hours: “Fix login redirect” (Codex) and “Write the billing tests” (Claude Code). Say “catch up” to hear what they did.");
});

test("what rode along with a message is said in one line", () => {
  const from = (id: string, tool: "Claude" | "Codex", title: string) => ({ from: { id, tool, title }, at: 1, kind: "update" as const, text: "x" });
  assert.equal(deliveryNotice([from("b1", "Codex", "Billing fix"), from("b1", "Codex", "Billing fix")]), "↪ Airband added what “Billing fix” (Codex) did to this message");
  assert.equal(
    deliveryNotice([from("b1", "Codex", "Billing fix"), from("t1", "Claude", "Tests"), from("x1", "Claude", "Docs")]),
    "↪ Airband added what “Billing fix” (Codex), “Tests” (Claude Code) and 1 more did to this message",
  );
  assert.equal(deliveryNotice([{ from: { id: "b1", tool: "Codex", title: "B" }, at: 1, kind: "notice", text: "paused" }]), "↪ Airband passed on a channel change");
  assert.equal(deliveryNotice([]), undefined);
});

test("the hook shows the lines to the person in Claude Code and Gemini, never in Codex, and only once a chat", () => {
  mapped(42);
  const start = (tool: "claude" | "codex" | "gemini", source = "startup") => handle({ session_id: "s1", cwd: project, hook_event_name: "SessionStart", source }, NOW, tool);
  assert.match(JSON.parse(start("claude")!).systemMessage, /^✓ Airband · map of BOS-Frontend ready \(42 files\)/);
  assert.match(JSON.parse(start("gemini")!).systemMessage, /^✓ Airband/);
  assert.equal(start("codex"), undefined, "Codex has no place to show it, and nothing else to say");
  assert.equal(start("claude", "compact"), undefined, "not again after every compaction");

  appendInbox("s1", { from: { id: "b1", tool: "Codex", title: "Billing fix" }, at: 1, kind: "update", text: "did things" });
  const sent = JSON.parse(handle({ session_id: "s1", cwd: project, hook_event_name: "UserPromptSubmit", prompt: "go on" }, NOW, "claude")!);
  assert.equal(sent.systemMessage, "↪ Airband added what “Billing fix” (Codex) did to this message");
  assert.match(sent.hookSpecificOutput.additionalContext, /did things/, "the model still gets the update itself");
});

test("turned off, the person sees no lines; the updates still arrive", () => {
  setConfig({ notices: false });
  assert.equal(handle({ session_id: "s1", cwd: project, hook_event_name: "SessionStart", source: "startup" }, NOW, "claude"), undefined);
  appendInbox("s1", { from: { id: "b1", tool: "Codex", title: "Billing fix" }, at: 1, kind: "update", text: "did things" });
  const sent = JSON.parse(handle({ session_id: "s1", cwd: project, hook_event_name: "UserPromptSubmit", prompt: "go on" }, NOW, "claude")!);
  assert.equal(sent.systemMessage, undefined);
  assert.match(sent.hookSpecificOutput.additionalContext, /did things/);
});
