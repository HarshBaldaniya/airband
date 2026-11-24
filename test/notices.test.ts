// The short lines Airband shows the person (never the model): when a chat starts, and when another
// chat's work rides along with a message. Claude Code and Gemini CLI show them; Codex can't.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handle } from "../src/hook/handle";
import { deliveryNotice, startNotice, toolNotice } from "../src/core/notices";
import { addConnection, appendInbox } from "../src/core/store";
import { airbandFile } from "../src/core/paths";
import { storeDir } from "../src/codemap/where";
import { setConfig } from "../src/core/config";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let project = "";
const NOW = Date.UTC(2026, 10, 16, 12, 0);

beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-notices-");
  process.env.AIRBAND_CLAUDE_SETTINGS = path.join(tmp("airband-claude-"), "settings.json");
  project = path.join(tmp("airband-proj-"), "my-app");
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
  assert.equal(startNotice({ sessionId: "s1", cwd: project, now: NOW }), "✓ Airband · map of my-app ready (5,519 files) · sharing with “Billing fix” (Codex)");
});

test("not connected yet, no map yet: still says it is on and what it does", () => {
  assert.equal(startNotice({ sessionId: "s1", cwd: project, now: NOW }), "✓ Airband · map of my-app builds on first use · other chats can catch up on this one");
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
  assert.match(JSON.parse(start("claude")!).systemMessage, /^✓ Airband · map of my-app ready \(42 files\)/);
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

test("after an Airband tool, one line: what it found, and the measured saving against reading the files", () => {
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src/seats.ts"), "x".repeat(24_000));
  fs.writeFileSync(path.join(project, "src/billing.ts"), "y".repeat(16_000));
  const answer = "syncSeats  function  src/seats.ts:40-88\nused by 2:\n  bill  src/billing.ts\n  other  src/missing.ts";
  const response = [{ type: "text", text: answer }];
  const line = toolNotice("mcp__airband__airband_map", { graph: "syncSeats" }, response, project);
  // 40,000 bytes on disk in the two files that exist; the answer is ~100 characters.
  assert.equal(line, "↪ Airband: “syncSeats” and the 2 places that use it · about 30 tokens instead of about 10,000 to read the 2 files");
  assert.equal(toolNotice("mcp__plugin_airband_airband__airband_map", { find: "seats" }, { content: response }, project), "↪ Airband: found “seats” · about 30 tokens instead of about 10,000 to read the 2 files");

  // No saving worth saying: no number.
  assert.equal(toolNotice("mcp__airband__airband_map", { outline: "src/nothing" }, [{ type: "text", text: "src/nothing.ts: 2 lines" }], project), "↪ Airband: the outline of “src/nothing”");
  // Errors, empty finds and other tools: nothing.
  assert.equal(toolNotice("mcp__airband__airband_map", { find: "zzz" }, [{ type: "text", text: 'Nothing in the code map matches "zzz".' }], project), undefined);
  assert.equal(toolNotice("mcp__airband__airband_map", { in: "x" }, { isError: true, content: [{ type: "text", text: "No mapped project" }] }, project), undefined);
  assert.equal(toolNotice("Read", { file_path: "a" }, "text", project), undefined);

  // Another project: named, and its files measured there.
  const other = `In my-api (${project}):\nsyncSeats  function  src/seats.ts:1-3`;
  assert.match(toolNotice("mcp__airband__airband_map", { find: "syncSeats", in: "my-api" }, [{ type: "text", text: other }], "/elsewhere")!, /^↪ Airband in my-api: found “syncSeats” · about \d+ tokens instead of about 6,000 to read the file$/);

  assert.equal(
    toolNotice("mcp__airband__airband_flightlog", { query: "ENG-142" }, [{ type: "text", text: "Fix (id 1234abcd) #1 · 3 Nov, 10:00 · Fix seats → Done (PR #128)\nB (id 9) #2 · 3 Nov, 11:00 · more → ok" }], project),
    "↪ Airband found 2 earlier asks about “ENG-142” in your chats",
  );
  assert.equal(toolNotice("mcp__airband__airband_notes", { title: "Seats handoff", text: "x" }, [{ type: "text", text: "Saved" }], project), "↪ Airband saved a note for the next chat: “Seats handoff”");
});

test("the hook says the line in Claude Code only, and not when notices are off", () => {
  const ev = { session_id: "s1", cwd: project, hook_event_name: "PostToolUse", tool_name: "mcp__airband__airband_map", tool_input: { check: "unused" }, tool_response: [{ type: "text", text: "Nothing unused." }] };
  assert.equal(JSON.parse(handle(ev, NOW, "claude")!).systemMessage, "↪ Airband: checked for unused code");
  assert.equal(handle(ev, NOW, "codex"), undefined);
  assert.equal(handle({ ...ev, tool_name: "Bash" }, NOW, "claude"), undefined);
  setConfig({ notices: false });
  assert.equal(handle(ev, NOW, "claude"), undefined);
});
