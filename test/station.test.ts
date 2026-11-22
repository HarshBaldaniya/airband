// The Station behind the companion: a permission request held until the person answers, the reply
// each agent reads, "always allow", questions with choices, messages to chats, and the companion's
// answers, which never reach past Airband's own records without the person's yes.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { handle, permission } from "../src/hook/airband-hook";
import { readInbox } from "../src/core/store";
import { readHookStatus } from "../src/core/status";
import { pickLanAddress, Station } from "../src/station/server";
import { askStation, readStationInfo } from "../src/station/client";
import { answersFit, describeRequest, permissionReply, questionsOf } from "../src/station/reply";
import { ask, headline, lookupArgs, lookupMode, whatsHappening } from "../src/station/manager";
import { knowledge } from "../src/station/knowledge";
import { cleanDesign, cleanName, DEFAULT_COMPANION } from "../src/station/companion";
import { forgetReads, liveChats, renamedTitle, type LiveChat } from "../src/station/chats";
import { readHead } from "../src/core/record";
import { editorCommand, windowsResumeLine } from "../src/station/open";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let station: Station | undefined;

beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-station-");
  delete process.env.AIRBAND_NO_STATION;
  delete process.env.AIRBAND_COMPANION;
});
afterEach(async () => {
  await station?.stop();
  station = undefined;
});

const start = async () => {
  station = new Station({ port: 0, claude: null, pollMs: 60_000, open: (c) => `opened ${c.id}` });
  await station.start();
  return station;
};

/** Waits until the Station holds a request, then returns it. */
async function held(s: Station, n = 1) {
  for (let i = 0; i < 200; i++) {
    const p = s.snapshot().pending;
    if (p.length >= n) return p[n - 1];
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no request reached the Station");
}

const ASK_INPUT = {
  questions: [{ question: "Keep plan history editable?", header: "History", options: [{ label: "Yes" }, { label: "No, lock it" }], multiSelect: false }],
};

// ---- what the hook prints ----

test("the reply each agent reads, and silence when nobody clicked", () => {
  const allow = JSON.parse(permissionReply("claude", "Bash", { command: "npm test" }, { decision: "allow" })!);
  assert.deepEqual(allow, { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  assert.equal(JSON.parse(permissionReply("claude", "Bash", {}, { decision: "always" })!).hookSpecificOutput.decision.behavior, "allow", "always still answers a plain allow");
  const deny = JSON.parse(permissionReply("codex", "shell", {}, { decision: "deny" })!);
  assert.equal(deny.hookSpecificOutput.decision.behavior, "deny");
  assert.match(deny.hookSpecificOutput.decision.message, /said no/);
  assert.equal(permissionReply("claude", "Bash", {}, undefined), undefined);
  assert.equal(permissionReply("claude", "Bash", {}, { decision: "terminal" }), undefined, "the terminal asks");
  assert.equal(permissionReply("gemini", "run_shell_command", {}, { decision: "allow" }), undefined, "Gemini CLI has no permission hook");
});

test("a question is answered only with a choice it offered", () => {
  const qs = questionsOf("AskUserQuestion", ASK_INPUT)!;
  assert.equal(qs[0].options.length, 2);
  assert.equal(answersFit(qs, { "Keep plan history editable?": "No, lock it" }), true);
  assert.equal(answersFit(qs, { "Keep plan history editable?": "Maybe" }), false);
  assert.equal(answersFit(qs, {}), false);
  const out = JSON.parse(permissionReply("claude", "AskUserQuestion", ASK_INPUT, { decision: "allow", answers: { "Keep plan history editable?": "Yes" } })!);
  assert.deepEqual(out.hookSpecificOutput.decision.updatedInput.answers, { "Keep plan history editable?": "Yes" });
  assert.equal(out.hookSpecificOutput.decision.updatedInput.questions.length, 1, "the questions stay as asked");
  assert.equal(permissionReply("claude", "AskUserQuestion", ASK_INPUT, { decision: "allow" }), undefined, "no answers: the terminal asks");
});

test("each request reads as a sentence", () => {
  assert.deepEqual(describeRequest("Bash", { command: "npm install stripe" }), { title: "Wants to run a command", detail: "npm install stripe" });
  assert.equal(describeRequest("Edit", { file_path: "/x/seats.ts" }).detail, "/x/seats.ts");
  assert.equal(describeRequest("mcp__claude_ai_Slack__slack_send_message", {}).title, "Wants to use slack_send_message (claude_ai_Slack)");
  assert.deepEqual(describeRequest("AskUserQuestion", ASK_INPUT), { title: "Has a question for you", detail: "Keep plan history editable?" });
});

// ---- the Station ----

test("with no Station running, the hook gives up at once and the terminal asks", async () => {
  const t = Date.now();
  assert.equal(await askStation({ agent: "claude", tool_name: "Bash", tool_input: { command: "ls" } }), undefined);
  assert.ok(Date.now() - t < 1500);
  // A Station file left behind by a process that is gone is ignored.
  fs.writeFileSync(path.join(process.env.AIRBAND_HOME!, "station.json"), JSON.stringify({ port: 1, token: "x", pid: 999999, at: 0, approvals: true }));
  assert.equal(readStationInfo(), undefined);
});

test("a request is held until the person clicks, then the chat gets the answer", async () => {
  const s = await start();
  assert.equal(readStationInfo()?.port, s.port);
  const waiting = askStation({ agent: "claude", session_id: "c1", cwd: "/p/my-api", tool_name: "Bash", tool_input: { command: "npm install stripe" } });
  const p = await held(s);
  assert.deepEqual([p.agent, p.project, p.title, p.detail], ["claude", "my-api", "Wants to run a command", "npm install stripe"]);
  assert.ok(p.expiresAt > p.at);
  assert.equal(s.decide(p.id, { decision: "allow" }), true);
  assert.deepEqual(await waiting, { decision: "allow" });
  assert.equal(s.snapshot().pending.length, 0, "answered requests leave the list");
  assert.equal(s.decide(p.id, { decision: "deny" }), false, "an ended request takes no second answer");
});

test("always allow lets the same command in the same folder through without asking again", async () => {
  const s = await start();
  const ask1 = askStation({ agent: "codex", cwd: "/p/my-api", tool_name: "shell", tool_input: { command: "npm test" } });
  s.decide((await held(s)).id, { decision: "always" });
  assert.equal((await ask1)?.decision, "always");
  const t = Date.now();
  assert.deepEqual(await askStation({ agent: "codex", cwd: "/p/my-api", tool_name: "shell", tool_input: { command: "npm test" } }), { decision: "allow" });
  assert.ok(Date.now() - t < 1000, "no card the second time");
  // Another command, or the same in another folder, still asks.
  const other = askStation({ agent: "codex", cwd: "/p/my-app", tool_name: "shell", tool_input: { command: "npm test" } });
  s.decide((await held(s)).id, { decision: "terminal" });
  assert.equal((await other)?.decision, "terminal");
});

test("the hook's permission step: the chat shows as needing you, then gets the person's answer", async () => {
  const s = await start();
  const out = permission({ hook_event_name: "PermissionRequest", session_id: "c7", cwd: "/p/my-app", tool_name: "AskUserQuestion", tool_input: ASK_INPUT }, "claude");
  const p = await held(s);
  assert.equal(readHookStatus("c7")?.status, "waiting");
  assert.equal(readHookStatus("c7")?.message, "Has a question for you: Keep plan history editable?");
  assert.equal(p.questions?.[0].question, "Keep plan history editable?");
  s.decide(p.id, { decision: "allow", answers: { "Keep plan history editable?": "No, lock it" } });
  const reply = JSON.parse((await out)!);
  assert.deepEqual(reply.hookSpecificOutput.decision.updatedInput.answers, { "Keep plan history editable?": "No, lock it" });
  assert.equal(readHookStatus("c7")?.status, "working", "answered: back to work");
});

test("with approvals off, every request goes to the terminal", async () => {
  const s = await start();
  await s.setSettings({ approvals: false });
  assert.equal(await askStation({ agent: "claude", tool_name: "Bash", tool_input: { command: "ls" } }), undefined);
});

test("a message to a chat waits in its inbox for its next turn", async () => {
  const s = await start();
  assert.equal(s.tell("c9", "the API changed: use /v2/seats"), "c9");
  const inbox = readInbox("c9");
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].text, /the API changed: use \/v2\/seats/);
  assert.equal(inbox[0].from.title, "You, via the Airband app");
});

test("every request needs the Station's key, and only this computer may ask permission", async () => {
  const s = await start();
  const get = (route: string, headers: Record<string, string> = {}) =>
    new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port: s.port, path: route, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
    });
  assert.equal(await get("/api/state"), 401);
  assert.equal(await get("/api/state", { "x-airband-token": "wrong" }), 401);
  assert.equal(await get("/api/state", { "x-airband-token": s.token }), 200);
  assert.equal(await get(`/app?t=${s.token}`), 200);
  assert.notEqual(await get("/ui/../../station.json"), 200, "only the companion's own files are served");
  assert.equal(await get("/ui/..%2F..%2Fstation.json"), 404);
});

// ---- the companion's answers ----

const chat = (over: Partial<LiveChat>): LiveChat => ({ id: "x", agent: "claude", title: "Billing", project: "my-app", status: "working", updatedAt: 0, since: 0, ...over });

test("the companion says what needs you, what works and what finished", () => {
  const now = 10 * 3600e3;
  const chats = [chat({ id: "a", title: "Billing", status: "waiting", line: "Wants to run a command: npm i", since: now - 60e3 }), chat({ id: "b", title: "Migration", status: "working" }), chat({ id: "c", title: "Seats", status: "done", since: now - 600e3, lastDid: "Fixed the seat count." })];
  assert.equal(headline(chats, [], now), "1 chat needs you. 1 is working. 1 finished in the last hour.");
  assert.equal(headline([], [], now), "All quiet. No chats today yet.");
  assert.equal(headline([chat({ status: "working" })], [], now), "Nothing needs you. 1 chat is working.");
  const text = whatsHappening(chats, [], now);
  assert.match(text, /Billing \(my-app\) waits: Wants to run a command: npm i\./);
  assert.match(text, /Working: Migration\./);
  assert.match(text, /Seats finished: Fixed the seat count\./);
});

test("'tell the billing chat ...' passes the message on, without any AI call", async () => {
  const told: string[] = [];
  const chats = [chat({ id: "a1", title: "Billing redesign", project: "my-app" }), chat({ id: "b1", title: "Seat sync", project: "my-api" })];
  const r = await ask("tell the billing chat that the API changed", { chats, pending: [], claude: null, tell: (id, t) => (told.push(`${id}:${t}`), "Billing redesign") });
  assert.deepEqual(told, ["a1:the API changed"]);
  assert.equal(r.via, "action");
  assert.match(r.text, /Sent to "Billing redesign"/);
  const s = await ask("what's happening?", { chats, pending: [], claude: null, tell: () => "" });
  assert.equal(s.via, "records");
  const none = await ask("tell the payroll chat to stop", { chats, pending: [], claude: null, tell: () => "" });
  assert.match(none.text, /couldn't find a chat called "payroll"/);
  assert.equal(none.choices?.length, 2, "it offers the chats to pick from");
});

test("when an ask could mean two chats, the companion asks which, with a button for each", async () => {
  const chats = [chat({ id: "a1", title: "Billing redesign", project: "my-app" }), chat({ id: "b1", title: "Billing export", project: "my-api" })];
  const told: string[] = [];
  const r = await ask("tell the billing chat that the plan changed", { chats, pending: [], claude: null, tell: (id) => (told.push(id), "") });
  assert.equal(told.length, 0, "nothing is sent on a guess");
  assert.equal(r.text, "Which chat do you mean?");
  assert.deepEqual(r.choices?.map((c) => c.ask), ["tell a1 that the plan changed", "tell b1 that the plan changed"]);
  // Pressing a choice asks again, by id: now it is clear.
  await ask(r.choices![1].ask, { chats, pending: [], claude: null, tell: (id) => (told.push(id), "Billing export") });
  assert.deepEqual(told, ["b1"]);
});

test("the companion does what it is asked: open a chat, allow the one request, tuck away", async () => {
  const chats = [chat({ id: "a1", title: "Seat sync", project: "my-api" })];
  const opened: string[] = [];
  const decided: string[] = [];
  const ctx = { chats, claude: null, tell: () => "", open: (id: string) => (opened.push(id), "Opening it in VS Code."), decide: (id: string, d: string) => (decided.push(`${id}:${d}`), true) };
  assert.equal((await ask("open the seat sync chat", { ...ctx, pending: [] })).text, "Opening it in VS Code.");
  assert.deepEqual(opened, ["a1"]);
  assert.equal((await ask("allow it", { ...ctx, pending: [] })).text, "Nothing is waiting for an answer.");
  const one = [{ id: "p1", chatTitle: "Seat sync", project: "my-api", title: "Wants to run a command" }];
  assert.equal((await ask("allow it", { ...ctx, pending: one })).text, "Allowed. Seat sync carries on.");
  const two = [...one, { id: "p2", chatTitle: "Billing", project: "my-app", title: "Wants to edit a file" }];
  const which = await ask("deny", { ...ctx, pending: two });
  assert.equal(which.choices?.length, 2, "two requests: it asks which");
  assert.deepEqual(decided, ["p1:allow"]);
  assert.equal((await ask("hide", { ...ctx, pending: [] })).action, "tuck");
});

test("privacy: the companion never reads files or folders, and open questions wait for a yes", async () => {
  const chats = [chat({ id: "a1", title: "Seat sync" })];
  const base = { chats, pending: [], tell: () => "" };
  for (const q of ["check my downloads folder", "can you look in my Documents", "read the files on my desktop", "scan my photos"]) {
    const r = await ask(q, { ...base, lookups: true, claude: "/no/such/claude" });
    assert.match(r.text, /can't look at your files or folders/, q);
    assert.equal(r.via, "records", `${q}: nothing goes to Claude Code`);
  }
  const off = await ask("why did the seat sync chat change the cron job?", { ...base, lookups: false, claude: "/no/such/claude" });
  assert.equal(off.via, "records", "look-ups off: no AI call");
  assert.equal(off.action, "settings");
  assert.match(off.text, /Turn on "Look things up"/);
  // When the person says yes, Claude Code gets Airband's records and nothing else.
  const args = lookupArgs("q", "{}");
  const at = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(at("--tools"), "", "no built-in tools: no files, shell or web");
  assert.ok(args.includes("--strict-mcp-config"), "no MCP server but Airband's");
  assert.equal(at("--allowedTools"), "mcp__airband__airband_flightlog");
  assert.match(at("--disallowedTools"), /airband_map/);
  assert.ok(args.includes("--no-session-persistence"), "the question is not kept as a chat");
});

test("the companion's name and look are settings, cleaned and defaulted", async () => {
  assert.equal(cleanName("  Pip  "), "Pip");
  assert.equal(cleanName(""), DEFAULT_COMPANION.name);
  assert.equal(cleanName("x".repeat(80)).length, 24);
  assert.equal(cleanDesign("../../etc"), DEFAULT_COMPANION.design);
  const s = await start();
  assert.equal(s.snapshot().settings.companion.name, DEFAULT_COMPANION.name);
  assert.equal(s.snapshot().settings.lookups, true, "look-ups start on, with Airband's records only")
  await s.setSettings({ companion: { name: cleanName("Pip"), design: "headset" } });
  await s.stop();
  station = new Station({ port: 0, claude: null, pollMs: 60_000 });
  await station.start();
  assert.equal(station.snapshot().settings.companion.name, "Pip", "kept across restarts");
});

test("the companion answers questions about itself at once, in its own name", async () => {
  const c = { name: "Pip", version: "0.0.5", headline: "All quiet. Nothing needs you." };
  assert.match(knowledge("hi", c)!.text, /^Hi! I'm Pip\. All quiet/);
  assert.equal(knowledge("hello!", c)!.choices?.length, 2, "a greeting offers what to ask next");
  assert.match(knowledge("who are you?", c)!.text, /I'm Pip, Airband's helper/);
  assert.match(knowledge("who built you?", c)!.text, /Harsh Baldaniya/);
  assert.match(knowledge("who is your owner", c)!.text, /open source/);
  assert.match(knowledge("what is airband?", c)!.text, /links your AI coding chats/);
  assert.match(knowledge("can you see my files?", c)!.text, /Never your files/);
  assert.match(knowledge("which version are you", c)!.text, /0\.0\.5/);
  assert.ok(knowledge("tell me a joke", c));
  assert.equal(knowledge("what did the phone chat do yesterday?", c), undefined, "a question about chats is not small talk");
  assert.equal(knowledge("is the migration safe?", c), undefined);
  // Through ask: no AI call, even with look-ups on.
  const r = await ask("hey", { chats: [], pending: [], tell: () => "", claude: "/no/such/claude", lookups: true, name: "Pip", version: "0.0.5" });
  assert.equal(r.via, "records");
});

test("open questions go to one locked room: the chats' records, or the web, never both", () => {
  const chats = [chat({ id: "a1", title: "Billing redesign", project: "my-app" })];
  assert.equal(lookupMode("what did the billing chat decide?", chats), "chats");
  assert.equal(lookupMode("why did my tests fail yesterday", chats), "chats");
  assert.equal(lookupMode("billing redesign", chats), "chats", "a chat's own name");
  assert.equal(lookupMode("what is FedCM?", chats), "web");
  const busy = [chat({ id: "x1", title: "This list is long", project: "my-app", lastAsk: "what is this list for" })];
  assert.equal(lookupMode("what is FedCM in Chrome?", busy), "web", "filler words never tie a question to a chat");
  assert.equal(lookupMode("who won the cricket match", chats), "web");
  const web = lookupArgs("q", "{}", "web");
  const at = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(at(web, "--tools"), "WebSearch", "the web room has web search and nothing else");
  assert.equal(at(web, "--mcp-config"), JSON.stringify({ mcpServers: {} }), "no Airband records in the web room");
  assert.ok(web.includes("--strict-mcp-config"));
  assert.ok(!web.join(" ").includes("airband_flightlog"));
  const rec = lookupArgs("q", "{}", "chats");
  assert.equal(at(rec, "--tools"), "", "the chats room has no web, files or shell");
});

test("a chat renamed in Claude Code shows its new name, and Airband's record keeps it", () => {
  const dir = path.join(process.env.AIRBAND_HOME!, "flightlogs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(tmp("airband-claude-chat-"), "c42.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: "clone the repo" } },
    { type: "custom-title", customTitle: "First name", sessionId: "c42" },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    { type: "custom-title", customTitle: "Airband Work", sessionId: "c42" },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  assert.equal(renamedTitle(file, fs.statSync(file).size), "Airband Work", "the latest name wins");
  fs.writeFileSync(path.join(dir, "c42.json"), JSON.stringify({ id: "c42", tool: "claude", file, cursor: 0, n: 1, updatedAt: Date.now(), title: "dummyPlane repository clone" }));
  const chat = liveChats().find((c) => c.id === "c42");
  assert.equal(chat?.title, "Airband Work");
  assert.equal(readHead("c42")?.title, "Airband Work", "kept for the flightlog and the board too");
});

test("open chats the light way: Airband knows which folders are open in VS Code", async () => {
  const { registerWindow, openWindows, windowFor, unregisterWindow } = await import("../src/core/folders");
  const root = tmp("airband-win-");
  registerWindow([root]);
  assert.equal(openWindows().length, 1);
  assert.deepEqual(windowFor(path.join(root, "src")), { root }, "a chat in a subfolder belongs to that window");
  assert.equal(windowFor(tmp("airband-other-")), undefined, "a folder no window has: the terminal, not VS Code");
  registerWindow(["/gone"], "Visual Studio Code", 999999);
  assert.equal(openWindows().length, 1, "a note left by a closed window is dropped");
  unregisterWindow();
  assert.equal(openWindows().length, 0);
});

test("a chat open in one editor is opened there, never in another editor with the same folder", async () => {
  const { addOpenRequest, takeOpenRequests } = await import("../src/core/folders");
  const cwd = tmp("airband-two-editors-");
  addOpenRequest({ id: "c1", tool: "Claude", cwd, at: Date.now(), app: "Visual Studio Code" });
  assert.deepEqual(takeOpenRequests([cwd], Date.now(), () => true, "Cursor"), [], "Cursor leaves it");
  assert.equal(takeOpenRequests([cwd], Date.now(), () => true, "Visual Studio Code").length, 1, "VS Code takes it");
});

// ---- the phone link ----

test("a phone answers requests and nothing else: asking, telling a chat and settings stay on the computer", async () => {
  const s = await start();
  const phone = (JSON.parse(fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "station-phone.json"), "utf8")) as { key: string }).key;
  const post = (route: string, key: string, body: unknown) =>
    new Promise<number>((resolve) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port: s.port, path: route, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), "x-airband-token": key } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.end(data);
    });
  assert.equal(await post("/api/ask", phone, { text: "what's happening?" }), 403);
  assert.equal(await post("/api/tell", phone, { chatId: "x", text: "stop" }), 403);
  assert.equal(await post("/api/settings", phone, { approvals: false }), 403);
  assert.equal(await post("/api/hook/permission", phone, {}), 403, "a phone cannot pose as a chat");
  assert.equal(readInbox("x").length, 0, "nothing typed on the phone reached a chat");
  // What a phone is for: answering a real request.
  const waiting = askStation({ agent: "claude", session_id: "c1", cwd: "/p/my-api", tool_name: "Bash", tool_input: { command: "npm test" } });
  const p = await held(s);
  assert.equal(await post("/api/decide", phone, { id: p.id, decision: "allow" }), 200);
  assert.equal((await waiting)?.decision, "allow");
  assert.equal(await post("/api/dismiss", phone, { chatId: "x" }), 200);
  assert.equal(await post("/api/ask", s.token, { text: "what's happening?" }), 200, "the computer still asks");
});

const nic = (address: string, internal = false): os.NetworkInterfaceInfo => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });

test("the phone link names the Wi-Fi address, never a VPN, container or virtual machine", () => {
  // Windows lists WSL and Hyper-V adapters before the Wi-Fi.
  assert.equal(pickLanAddress({ "vEthernet (WSL)": [nic("172.24.16.1")], "Wi-Fi": [nic("192.168.1.23")], "Loopback Pseudo-Interface 1": [nic("127.0.0.1", true)] }), "192.168.1.23");
  assert.equal(pickLanAddress({ "VirtualBox Host-Only Network": [nic("192.168.56.1")], Ethernet: [nic("10.0.0.12")] }), "10.0.0.12");
  // macOS: a VPN tunnel and Internet Sharing's bridge are not the home network.
  assert.equal(pickLanAddress({ utun4: [nic("100.101.1.2")], bridge100: [nic("192.168.64.1")], en0: [nic("192.168.1.40")] }), "192.168.1.40");
  // Linux: Docker's bridge is not either.
  assert.equal(pickLanAddress({ docker0: [nic("172.17.0.1")], wlp2s0: [nic("192.168.0.7")] }), "192.168.0.7");
  assert.equal(pickLanAddress({ Ethernet: [nic("169.254.3.4")], "Wi-Fi": [nic("192.168.0.9")] }), "192.168.0.9", "a self-assigned address is never named");
  assert.equal(pickLanAddress({ en0: [{ ...nic("fe80::1"), family: "IPv6", scopeid: 0 }] }), undefined, "IPv6 only: no link");
  assert.equal(pickLanAddress({ lo0: [nic("127.0.0.1", true)] }), undefined);
});

test("Windows: a chat resumes in its own console window, in its folder, and each editor opens with its own command", () => {
  assert.equal(windowsResumeLine("C:\\Users\\Ana\\my app", "claude --resume abc"), '/d /s /k "cd /d "C:\\Users\\Ana\\my app" && claude --resume abc"', "the whole line runs in the new window");
  assert.equal(windowsResumeLine(undefined, "codex resume abc"), '/d /s /k "codex resume abc"');
  assert.equal(windowsResumeLine('C:\\a"b', "x"), '/d /s /k "cd /d "C:\\ab" && x"', "a quote cannot end the folder early");
  assert.equal(editorCommand("Cursor"), "cursor");
  assert.equal(editorCommand("Visual Studio Code"), "code");
  assert.equal(editorCommand(undefined), "code");
});

test("the page's mode classes (body.desktop, body.phone) are never reused by a part of the page", () => {
  // A settings panel once used ".phone" for itself: its "start hidden" rule hid the whole phone page.
  const css = fs.readFileSync(path.join(process.cwd(), "desktop", "ui", "ui.css"), "utf8");
  const clash = css.split("\n").filter((l) => /(^|[\s,}>+~])\.(phone|desktop)(?![\w-])/.test(l));
  assert.deepEqual(clash, []);
});

test("the phone link is parked: no setting turns it on, and the Station listens on this computer only", async () => {
  fs.mkdirSync(process.env.AIRBAND_HOME!, { recursive: true });
  fs.writeFileSync(path.join(process.env.AIRBAND_HOME!, "station-settings.json"), JSON.stringify({ phone: true }));
  const s = await start();
  assert.equal(s.snapshot().settings.phone, false, "an old saved setting does not turn it on");
  assert.equal((await s.setSettings({ phone: true })).phone, false);
  assert.equal(s.snapshot().phoneUrl, undefined, "no phone address is offered");
  const addr = (s as unknown as { server: http.Server }).server.address() as { address: string };
  assert.equal(addr.address, "127.0.0.1");
});

test("a brand-new chat's first answer counts as finished, so the companion comes back for it", async () => {
  const s = await start();
  const finished: string[] = [];
  s.on("finished", (f: { title: string }) => finished.push(f.title));
  // A new chat's first turn, through the real hook: it is listed only once that turn ends.
  const dir = tmp("airband-newchat-");
  const transcript = path.join(dir, "n1.jsonl");
  const line = (o: unknown) => JSON.stringify(o) + "\n";
  fs.writeFileSync(transcript, line({ type: "user", uuid: "u1", message: { role: "user", content: "tidy the billing page" } }));
  handle({ session_id: "n1", hook_event_name: "UserPromptSubmit", prompt: "tidy the billing page", transcript_path: transcript, cwd: dir });
  fs.appendFileSync(transcript, line({ type: "assistant", uuid: "a1", message: { id: "m-a1", role: "assistant", content: [{ type: "text", text: "Tidied the billing page." }], usage: { input_tokens: 10, output_tokens: 5 } } }));
  handle({ session_id: "n1", hook_event_name: "Stop", transcript_path: transcript, cwd: dir });
  forgetReads();
  s.refresh();
  assert.equal(finished.length, 1, "its first finish is told");
  s.refresh();
  assert.equal(finished.length, 1, "and only once");
});

test("the companion sleeps only when every chat is done, and wakes for what needs you", async () => {
  const { moodOf } = await import("../desktop/ui/companion/mood");
  const base = { dizzy: false, asking: false, talking: false, hello: false, cheering: false };
  const state = (chats: Partial<LiveChat>[], pending = 0) => ({ chats: chats.map(chat), pending: Array.from({ length: pending }, (_, i) => ({ id: `p${i}` })), finished: [] }) as unknown as Parameters<typeof moodOf>[0];
  assert.equal(moodOf(state([{ status: "working" }]), { ...base, asleep: false }), "working");
  assert.equal(moodOf(state([{ status: "working" }]), { ...base, asleep: true }), "working", "never asleep while a chat works");
  assert.equal(moodOf(state([{ status: "idle" }]), { ...base, asleep: true }), "resting");
  assert.equal(moodOf(state([{ status: "working" }], 1), { ...base, asleep: true }), "needs", "a request always wakes it");
  assert.equal(moodOf(state([{ status: "waiting" }]), { ...base, asleep: true }), "needs");
  assert.equal(moodOf(state([]), { ...base, asleep: true, cheering: true }), "done", "a finished chat wakes it");
  assert.equal(moodOf(state([]), { ...base, asleep: true, talking: true }), "talking");
});

test("a growing chat file is read only where it grew, and a rename there is still found", () => {
  const dir = tmp("airband-grow-");
  const file = path.join(dir, "c.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ type: "user", message: { content: "x".repeat(400_000) } })}\n`);
  const before = fs.statSync(file).size;
  fs.appendFileSync(file, `${JSON.stringify({ type: "custom-title", customTitle: "Seat sync" })}\n`);
  const after = fs.statSync(file).size;
  assert.equal(renamedTitle(file, after, before), "Seat sync", "found in the new part");
  assert.equal(renamedTitle(file, after, after), undefined, "nothing new: nothing read, the caller keeps the name it had");
  assert.equal(renamedTitle(file, after), "Seat sync", "a first look reads the tail");
});
