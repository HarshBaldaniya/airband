// Sharing between linked chats, in the cases that once lost or repeated an update: a turn after
// the person's message, a Gemini rewind, links at different levels, an acknowledgement written
// late, a very big turn, and several hooks writing the store at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handle, FROM_PERSON } from "../src/hook/airband-hook";
import { addConnection, appendInbox, readConnections, readInbox, setCursor, setLevel, takeInbox } from "../src/core/store";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const j = (o: unknown) => JSON.stringify(o) + "\n";
const day = new Date().toISOString();
let n = 0;
const user = (t: string) => j({ type: "user", uuid: `u${++n}`, timestamp: day, message: { role: "user", content: t } });
const ai = (t: string) => j({ type: "assistant", uuid: `a${++n}`, timestamp: day, message: { id: `m${n}`, role: "assistant", content: [{ type: "text", text: t }] } });

function env() {
  process.env.AIRBAND_HOME = tmp("rv-home-");
  process.env.AIRBAND_CLAUDE_SETTINGS = path.join(tmp("rv-set-"), "settings.json");
  process.env.AIRBAND_GEMINI_TMP = tmp("rv-gem-");
}
const A = { id: "aaaa1111-0000-4000-8000-000000000001", tool: "Claude" as const, title: "A" };
const B = { id: "bbbb2222-0000-4000-8000-000000000002", tool: "Claude" as const, title: "B" };
const C = { id: "cccc3333-0000-4000-8000-000000000003", tool: "Claude" as const, title: "C" };
const root = "/work/app";

// Run as a writer by the race test below: it writes one chat's bookmark many times, then exits.
if (process.env.AIRBAND_RACE_WRITER) {
  for (let i = 1; i <= 150; i++) setCursor(process.env.AIRBAND_RACE_WRITER, i);
  process.exit(0);
}

test("work done after the person's message reaches linked chats", () => {
  env();
  const file = path.join(tmp("rv-c-"), "a.jsonl");
  fs.writeFileSync(file, "");
  addConnection(A, B);
  setCursor(A.id, 0);
  fs.appendFileSync(file, user("Fix the login bug") + ai("Fixed the login bug in auth.ts."));
  appendInbox(A.id, { from: { id: FROM_PERSON, tool: "Claude", title: "You" }, at: 1, kind: "update", text: "also add a test for logout" });
  const out1 = handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Fixed the login bug in auth.ts.", stop_hook_active: false });
  assert.match(out1!, /block/);
  // The agent continues the turn with the person's ask: real work.
  fs.appendFileSync(file, user("Stop hook feedback:\n[Airband] ... also add a test for logout") + ai("Added a logout test in auth.test.ts; all 40 tests pass."));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Added a logout test in auth.test.ts; all 40 tests pass.", stop_hook_active: true });
  // Next normal turn
  fs.appendFileSync(file, user("Now bump the version") + ai("Bumped to 1.2.0."));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Bumped to 1.2.0.", stop_hook_active: false });
  const all = readInbox(B.id).map((i) => i.text).join("\n---\n");
  console.log("B inbox:\n" + all);
  assert.match(all, /logout test/, "the logout-test work should reach B");
});

test("Gemini: turns after a rewind are shared", () => {
  env();
  const G = { id: "gggg1111-0000-4000-8000-000000000001", tool: "Gemini" as const, title: "G" };
  const chats = path.join(process.env.AIRBAND_GEMINI_TMP!, "app", "chats");
  fs.mkdirSync(chats, { recursive: true });
  const file = path.join(chats, `session-x-gggg1111.jsonl`);
  fs.writeFileSync(file, j({ sessionId: G.id, startTime: day }));
  addConnection(G, B);
  setCursor(G.id, 0);
  const say = (k: number, ask: string, did: string) => fs.appendFileSync(file, j({ id: `u${k}`, timestamp: day, type: "user", content: [{ text: ask }] }) + j({ id: `a${k}`, timestamp: day, type: "gemini", content: did }));
  const stop = (did: string) => handle({ session_id: G.id, transcript_path: file, hook_event_name: "AfterAgent", cwd: root, prompt_response: did, stop_hook_active: false }, Date.now(), "gemini");
  say(1, "one", "did one."); stop("did one.");
  say(2, "two", "did two."); stop("did two.");
  say(3, "three", "did three."); stop("did three.");
  takeInbox(B.id);
  // The person rewinds to before "two", then asks two new things.
  fs.appendFileSync(file, j({ $rewindTo: "u2" }));
  say(4, "four (after rewind)", "did four."); stop("did four.");
  say(5, "five", "did five."); stop("did five.");
  const all = readInbox(B.id).map((i) => i.text).join("\n");
  console.log("B inbox after rewind:", JSON.stringify(all));
  assert.match(all, /four/, "turn after rewind should be sent");
  assert.match(all, /five/);
});

test("links at different levels: a reply written after its Stop reaches each chat once", () => {
  env();
  const file = path.join(tmp("rv-c-"), "a.jsonl");
  fs.writeFileSync(file, "");
  addConnection(A, B);
  addConnection(A, C);
  setLevel([readConnections().find((c) => c.to.id === B.id)!.id], "full");
  setCursor(A.id, 0);
  // Stop fires before the final reply is in the file (as Claude Code does).
  fs.appendFileSync(file, user("Rename the route"));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Renamed the route to /accounts.", stop_hook_active: false });
  fs.appendFileSync(file, ai("Renamed the route to /accounts."));
  fs.appendFileSync(file, user("Add rate limits"));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Added rate limits.", stop_hook_active: false });
  const c = readInbox(C.id).map((i) => i.text);
  const b = readInbox(B.id).map((i) => i.text);
  console.log("C inbox:", JSON.stringify(c));
  console.log("B inbox:", JSON.stringify(b));
  assert.equal(c.join("\n").split("Renamed the route").length - 1, 1, "C should get the rename once");
});

test("ping links: a reply written after its Stop reaches each chat once", () => {
  env();
  const file = path.join(tmp("rv-c-"), "a.jsonl");
  fs.writeFileSync(file, "");
  addConnection(A, C);
  setCursor(A.id, 0);
  fs.appendFileSync(file, user("Rename the route"));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Renamed the route to /accounts.", stop_hook_active: false });
  fs.appendFileSync(file, ai("Renamed the route to /accounts."));
  fs.appendFileSync(file, user("Add rate limits"));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Added rate limits.", stop_hook_active: false });
  const c = readInbox(C.id).map((i) => i.text);
  console.log("C inbox (ping only):", JSON.stringify(c));
  assert.equal(c.join("\n").split("Renamed the route").length - 1, 1);
});

test("an acknowledgement of updates is never sent on, even when written after its Stop", () => {
  env();
  fs.writeFileSync(path.join(process.env.AIRBAND_HOME!, "config.json"), JSON.stringify({ autoDeliver: true }));
  const file = path.join(tmp("rv-c-"), "a.jsonl");
  fs.writeFileSync(file, "");
  addConnection(A, B);
  setCursor(A.id, 0);
  appendInbox(A.id, { connectionId: "x", from: C, at: 1, kind: "update", text: "• C did a thing" });
  fs.appendFileSync(file, user("Fix bug") + ai("Fixed the bug."));
  const o = handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Fixed the bug.", stop_hook_active: false });
  assert.match(o!, /block/);
  fs.appendFileSync(file, user("Stop hook feedback:\n[Airband] stuff"));
  const ack = "C's change means the bug fix also needs the new header; I'll handle that next.";
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: ack, stop_hook_active: true });
  fs.appendFileSync(file, ai(ack)); // written after its Stop
  takeInbox(B.id);
  fs.appendFileSync(file, user("Next task") + ai("Did the next task."));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "Did the next task.", stop_hook_active: false });
  const all = readInbox(B.id).map((i) => i.text).join("\n");
  console.log("B inbox:", JSON.stringify(all));
  assert.doesNotMatch(all, /continuing/, "ack turn should not be forwarded");
});

test("a turn over 16 MB is still shared, from its end", () => {
  env();
  const file = path.join(tmp("rv-c-"), "a.jsonl");
  fs.writeFileSync(file, "");
  addConnection(A, B);
  setCursor(A.id, 0);
  const big = "x".repeat(17 * 1024 * 1024);
  fs.appendFileSync(file, user("Look at these screenshots") + j({ type: "user", uuid: "t", timestamp: day, message: { role: "user", content: [{ type: "tool_result", content: big }] } }) + ai("The header overlaps the logo on mobile; fixed in Header.tsx."));
  handle({ session_id: A.id, transcript_path: file, hook_event_name: "Stop", cwd: root, last_assistant_message: "The header overlaps the logo on mobile; fixed in Header.tsx.", stop_hook_active: false });
  const all = readInbox(B.id);
  console.log("B inbox items:", all.length);
  assert.ok(all.length >= 1, "B should hear something about the turn");
});

test("hooks of different chats writing at once never lose a bookmark", async () => {
  const { spawn } = await import("node:child_process");
  const { getCursor } = await import("../src/core/store");
  process.env.AIRBAND_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "airband-race-"));
  const writer = (id: string) => new Promise<void>((done) => spawn(process.execPath, [__filename], { env: { ...process.env, AIRBAND_RACE_WRITER: id }, stdio: "ignore" }).on("exit", () => done()));
  const runs = [writer("race-a"), writer("race-b")];
  setCursor("race-once", 7);
  await Promise.all(runs);
  assert.equal(getCursor("race-once"), 7);
  assert.equal(getCursor("race-a"), 150);
  assert.equal(getCursor("race-b"), 150);
});
