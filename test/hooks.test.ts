import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { CLAUDE_TIMEOUTS, HOOK_EVENTS, appNode, claudeAiCreditShown, connect, disconnect, isConnected, setClaudeAiCredit } from "../src/core/hooks";
import { handle, record, statusFor } from "../src/hook/airband-hook";
import { addConnection, addPending, appendInbox, getCursor, readConnections, readDeliveries, readInbox, setCursor } from "../src/core/store";

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const line = (o: unknown) => JSON.stringify(o) + "\n";
const user = (uuid: string, text: string) => line({ type: "user", uuid, message: { role: "user", content: text } });
const ai = (uuid: string, text: string, extra: object = {}) =>
  line({ type: "assistant", uuid, message: { id: `m-${uuid}`, role: "assistant", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }, ...extra });

beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-home-");
  process.env.AIRBAND_CLAUDE_SETTINGS = path.join(tmp("airband-claude-"), "settings.json");
});

test("connect adds Airband's hook to every event, keeps other settings, and disconnect restores them", () => {
  const file = path.join(tmp("airband-settings-"), "settings.json");
  const before = { model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
  fs.writeFileSync(file, JSON.stringify(before));
  connect('"/usr/bin/node" "/h/.airband/airband-hook.js"', file);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(isConnected(file));
  for (const e of HOOK_EVENTS) assert.ok(after.hooks[e].some((g: any) => g.hooks.some((h: any) => h.command.includes("airband-hook.js"))));
  assert.equal(after.hooks.Stop[0].hooks[0].command, "say done");
  assert.equal(after.hooks.PreToolUse[0].matcher, "Bash|mcp__.*", "before a tool: only shell commands and MCP tools start the hook");
  assert.equal(after.hooks.Stop[1].hooks[0].timeout, 5);
  connect('"/usr/bin/node" "/h/.airband/airband-hook.js"', file, HOOK_EVENTS, 5, CLAUDE_TIMEOUTS);
  const timed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(timed.hooks.PermissionRequest[0].hooks[0].timeout, 120, "a permission request may wait for a click in the Airband app");
  assert.equal(timed.hooks.PermissionRequest[0].matcher, undefined, "every tool's request, questions too");
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.airband-backup`, "utf8")), before);
  connect('"/usr/bin/node" "/h/.airband/airband-hook.js"', file);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).hooks.Stop.length, 2);
  disconnect(file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), before);
});

test("events map to statuses, and status files refuse odd ids", () => {
  assert.equal(statusFor({ hook_event_name: "UserPromptSubmit" }), "working");
  assert.equal(statusFor({ hook_event_name: "Notification" }), "waiting");
  assert.equal(statusFor({ hook_event_name: "Stop" }), "done");
  assert.equal(statusFor({ hook_event_name: "SessionStart" }), undefined);
  record({ session_id: "abc", hook_event_name: "Notification", message: "Needs permission" }, 1000);
  const s = JSON.parse(fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "status", "abc.json"), "utf8"));
  assert.deepEqual(s, { status: "waiting", at: 1000, event: "Notification", message: "Needs permission" });
  record({ session_id: "../x", hook_event_name: "Stop" });
  assert.ok(!fs.existsSync(path.join(process.env.AIRBAND_HOME!, "x.json")));
});

test("the live flow: A's finished reply reaches B with B's next message, once", () => {
  const dir = tmp("airband-transcript-");
  const transcript = path.join(dir, "aaa.jsonl");
  fs.writeFileSync(transcript, user("u1", "old ask") + ai("a1", "old answer"));
  const A = { id: "aaa", tool: "Claude" as const, title: "Billing fix" };
  const B = { id: "bbb", tool: "Claude" as const, title: "Payment page" };
  addConnection(A, B);

  // First Stop with no cursor: starts from here, sends nothing old.
  handle({ session_id: "aaa", hook_event_name: "Stop", transcript_path: transcript });
  assert.equal(readInbox("bbb").length, 0);
  assert.equal(getCursor("aaa"), fs.statSync(transcript).size);

  // A does more work; its reply ends.
  fs.appendFileSync(transcript, user("u2", "Free plan says See plans") + ai("a2", "Updated the buttons.") + line({ type: "assistant", uuid: "t", isSidechain: true, message: { content: [{ type: "text", text: "subagent" }] } }));
  handle({ session_id: "aaa", hook_event_name: "Stop", transcript_path: transcript, cwd: dir });
  const waiting = readInbox("bbb");
  assert.equal(waiting.length, 1);
  // A line per ask (a link's default level): what was asked, and what was done.
  assert.equal(waiting[0].text, "• Free plan says See plans → Updated the buttons.");
  // A's record keeps every ask, a line each; no copy of the conversation is written.
  const rec = fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "flightlogs", "aaa.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rec.map((a) => [a.n, a.ask, a.did]), [[1, "old ask", "old answer"], [2, "Free plan says See plans", "Updated the buttons."]]);
  assert.ok(!fs.existsSync(path.join(process.env.AIRBAND_HOME!, "chats")));

  // B gets a message: the update arrives as extra context, then is gone.
  const out = handle({ session_id: "bbb", hook_event_name: "UserPromptSubmit", prompt: "next" });
  const parsed = JSON.parse(out!);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /## New in “Billing fix”/);
  assert.equal(handle({ session_id: "bbb", hook_event_name: "UserPromptSubmit", prompt: "again" }), undefined);
  assert.equal(readDeliveries().length, 1);

  // Paused connections send nothing.
  const [c] = readConnections();
  c.paused = true;
  fs.writeFileSync(path.join(process.env.AIRBAND_HOME!, "connections.json"), JSON.stringify([c]));
  fs.appendFileSync(transcript, user("u3", "more") + ai("a3", "done"));
  handle({ session_id: "aaa", hook_event_name: "Stop", transcript_path: transcript });
  assert.equal(readInbox("bbb").length, 0);
});

test("a branch: the new chat's first message is recognised, connected and given the context", () => {
  const A = { id: "aaa", tool: "Claude" as const, title: "Billing fix" };
  setCursor("aaa", 0);
  addPending({ id: "p", from: A, title: "Caption bug", cwd: "/repo", at: Date.now(), taskStart: "Fix the caption overlap", context: "what A knew", keepConnected: true });
  const out = handle({ session_id: "new1", hook_event_name: "UserPromptSubmit", prompt: "Fix the caption overlap on 9:16", cwd: "/repo" });
  assert.match(JSON.parse(out!).hookSpecificOutput.additionalContext, /what A knew/);
  assert.deepEqual(readConnections().map((c) => [c.from.id, c.to.id, c.to.title]), [["aaa", "new1", "Caption bug"]]);
});

test("context waiting when a chat starts arrives through SessionStart", () => {
  appendInbox("ccc", { from: { id: "aaa", tool: "Claude", title: "A" }, at: 1, kind: "context", text: "hello" });
  const out = JSON.parse(handle({ session_id: "ccc", hook_event_name: "SessionStart" })!);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
});

const built = path.join(__dirname, "..", "dist", "airband-hook.js");
test("the built hook prints only delivered context and always exits 0", { skip: !fs.existsSync(built) && "run npm run build first" }, () => {
  const env = { ...process.env };
  assert.equal(execFileSync(process.execPath, [built], { input: JSON.stringify({ session_id: "s1", hook_event_name: "Stop" }), env, encoding: "utf8" }), "");
  assert.equal(execFileSync(process.execPath, [built], { input: "not json", env, encoding: "utf8" }), "");
  appendInbox("s1", { from: { id: "aaa", tool: "Claude", title: "A" }, at: 1, kind: "update", text: "x" });
  const out = execFileSync(process.execPath, [built], { input: JSON.stringify({ session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "hi" }), env, encoding: "utf8" });
  assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, "UserPromptSubmit");
});

test("updates that arrive while a chat works wait for its next message: no extra turn by default", () => {
  const dir = tmp("airband-transcript-");
  const transcript = path.join(dir, "bbb.jsonl");
  fs.writeFileSync(transcript, user("u1", "work") + ai("a1", "done"));
  appendInbox("bbb", { from: { id: "aaa", tool: "Claude", title: "A" }, at: 1, kind: "update", text: "A finished X" });
  assert.equal(handle({ session_id: "bbb", hook_event_name: "Stop", transcript_path: transcript }), undefined, "the reply ends as it is");
  assert.equal(readInbox("bbb").length, 1, "the update waits");
  assert.match(JSON.parse(handle({ session_id: "bbb", hook_event_name: "UserPromptSubmit", prompt: "next" })!).hookSpecificOutput.additionalContext, /A finished X/);
});

test("with delivery at once turned on, updates go in as a chat finishes, once, without ping-pong", () => {
  fs.writeFileSync(path.join(process.env.AIRBAND_HOME!, "config.json"), JSON.stringify({ autoDeliver: true }));
  const dir = tmp("airband-transcript-");
  const transcript = path.join(dir, "bbb.jsonl");
  fs.writeFileSync(transcript, user("u1", "work") + ai("a1", "done"));
  appendInbox("bbb", { from: { id: "aaa", tool: "Claude", title: "A" }, at: 1, kind: "update", text: "**Claude:** A finished X" });

  // B finishes a reply: the waiting update goes in, and Claude is asked to take it into account.
  const out = JSON.parse(handle({ session_id: "bbb", hook_event_name: "Stop", transcript_path: transcript })!);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /A finished X/);
  assert.match(out.reason, /Noted the updates from connected chats/);
  assert.equal(readInbox("bbb").length, 0);
  const status = JSON.parse(fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "status", "bbb.json"), "utf8"));
  assert.equal(status.status, "working", "sent back to work: Roger shows it working, not done");

  // Claude's acknowledgement ends with stop_hook_active: nothing more is delivered or forwarded.
  const A = { id: "aaa", tool: "Claude" as const, title: "A" };
  addConnection({ id: "bbb", tool: "Claude", title: "B" }, A);
  setCursor("bbb", 0);
  fs.appendFileSync(transcript, ai("a2", "Noted the updates from linked chats."));
  appendInbox("bbb", { from: A, at: 2, kind: "update", text: "more" });
  assert.equal(handle({ session_id: "bbb", hook_event_name: "Stop", transcript_path: transcript, stop_hook_active: true }), undefined);
  assert.equal(readInbox("aaa").length, 0, "the acknowledgement is not sent to linked chats");
  assert.equal(getCursor("bbb"), fs.statSync(transcript).size);
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "status", "bbb.json"), "utf8")).status, "done", "and done once it really stops");
});

test("linked again after a break: only what is new is sent, never what was said in between", () => {
  const dir = tmp("airband-relink-");
  const transcript = path.join(dir, "aaa.jsonl");
  fs.writeFileSync(transcript, user("u1", "first") + ai("a1", "one"));
  const A = { id: "aaa", tool: "Claude" as const, title: "A" };
  const B = { id: "bbb", tool: "Claude" as const, title: "B" };
  const { connection } = addConnection(A, B);
  setCursor("aaa", fs.statSync(transcript).size);
  // Unlinked; A keeps working.
  fs.writeFileSync(path.join(process.env.AIRBAND_HOME!, "connections.json"), "[]");
  fs.appendFileSync(transcript, user("u2", "while unlinked") + ai("a2", "two"));
  handle({ session_id: "aaa", hook_event_name: "Stop", transcript_path: transcript });
  assert.equal(getCursor("aaa"), fs.statSync(transcript).size, "the bookmark moved with the reply");
  // Linked again; A's next reply.
  addConnection(A, B);
  fs.appendFileSync(transcript, user("u3", "after the new link") + ai("a3", "three"));
  handle({ session_id: "aaa", hook_event_name: "Stop", transcript_path: transcript });
  assert.deepEqual(readInbox("bbb").map((i) => i.text), ["• after the new link → three"]);
  void connection;
});

test("a reply that quotes Airband's words is kept; Airband's own deliveries are not", () => {
  const dir = tmp("airband-quote-");
  const transcript = path.join(dir, "aaa.jsonl");
  fs.writeFileSync(transcript, "");
  addConnection({ id: "aaa", tool: "Claude", title: "A" }, { id: "bbb", tool: "Claude", title: "B" });
  setCursor("aaa", 0);
  fs.appendFileSync(transcript, user("u1", "[Airband] The person linked this chat…") + user("u2", "is any chat linked?") + ai("a1", 'Yes, one. The "[Airband] … New in" notes come from it.'));
  handle({ session_id: "aaa", hook_event_name: "Stop", transcript_path: transcript });
  assert.deepEqual(readInbox("bbb").map((i) => i.text), ['• is any chat linked? → Yes, one. The "[Airband] … New in" notes come from it.']);
});

test("Claude Code's AI-credit lines: hidden with its own setting, and back, keeping the person's own", () => {
  const file = path.join(tmp("airband-settings-"), "settings.json");
  fs.writeFileSync(file, JSON.stringify({ model: "opus" }));
  assert.equal(claudeAiCreditShown(file), true, "Claude Code's default");
  setClaudeAiCredit(false, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "opus", attribution: { commit: "", pr: "", sessionUrl: false } });
  assert.equal(claudeAiCreditShown(file), false);
  assert.ok(fs.existsSync(`${file}.airband-backup`));
  setClaudeAiCredit(true, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "opus" }, "back to how it was");
  // A person's own attribution text is never thrown away.
  fs.writeFileSync(file, JSON.stringify({ attribution: { commit: "Reviewed by Asha" } }));
  assert.equal(claudeAiCreditShown(file), true);
  setClaudeAiCredit(false, file);
  setClaudeAiCredit(true, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).attribution, { commit: "Reviewed by Asha" }, "their own text comes back");
});

test("a computer with no Node: the app's own Node runs the hook, on macOS, Linux and Windows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airband-appnode-"));
  const mac = appNode("/Applications/Air band's.app/Contents/MacOS/Airband", dir, "darwin");
  assert.equal(path.basename(mac), "node");
  const sh = fs.readFileSync(mac, "utf8");
  assert.match(sh, /^#!\/bin\/sh\n/);
  assert.match(sh, /ELECTRON_RUN_AS_NODE=1 exec '\/Applications\/Air band'\\''s\.app\/Contents\/MacOS\/Airband' "\$@"/, "a path with a space and a quote stays one word");
  // Windows has no "can be run" bit: there the app writes node.cmd instead.
  if (process.platform !== "win32") assert.ok(fs.statSync(mac).mode & 0o100, "it can be run");
  const win = appNode("C:\\Users\\Ana\\AppData\\Local\\Programs\\Airband\\Airband.exe", dir, "win32");
  assert.equal(path.basename(win), "node.cmd");
  assert.equal(fs.readFileSync(win, "utf8"), '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Users\\Ana\\AppData\\Local\\Programs\\Airband\\Airband.exe" %*\r\n');
  if (process.platform !== "win32") {
    // The script really runs: here with this test's own Node standing in for the app.
    const real = appNode(process.execPath, path.join(dir, "real"));
    assert.equal(execFileSync(real, ["-e", "process.stdout.write(String(1 + 1))"], { encoding: "utf8" }), "2");
  }
});
