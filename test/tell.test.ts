// A message the person sends a chat through the app (Roger) reaches it as soon as it can take it:
// after its next tool step while it works (Claude Code, Gemini CLI), or before it stops (every
// agent). A linked chat's update still waits for the next message. And Roger opens the very chat.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handle } from "../src/hook/handle";
import { FROM_PERSON, PERSON_ASK } from "../src/hook/sharing";
import { appendInbox, readInbox } from "../src/sharing/inbox";
import { tellText } from "../src/station/manager";
import { claudeChatLink, editorFolder, folderNames, isVSCode, tabScript, vscodeFolderFor } from "../src/station/open";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ID = "5e1f0c2a-7d3b-4c8e-9a41-2b6d8e0f3c17";
let file = "";
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-tell-home-");
  process.env.CLAUDE_CONFIG_DIR = tmp("airband-tell-claude-");
  process.env.AIRBAND_NO_STATION = "1";
  delete process.env.AIRBAND_COMPANION;
  file = path.join(process.env.CLAUDE_CONFIG_DIR!, "chat.jsonl");
  fs.writeFileSync(file, "");
});

const fromPerson = (text: string) => appendInbox(ID, { from: { id: FROM_PERSON, tool: "Claude", title: "You, via the Airband app" }, at: 1, kind: "update", text: tellText(text) });
const fromLinked = (text: string) => appendInbox(ID, { connectionId: "k1", from: { id: "other", tool: "Codex", title: "Billing fix" }, at: 1, kind: "update", text });

test("while a Claude Code chat works, the person's message goes in after its next tool step", () => {
  fromPerson("Stop and use the new API instead.");
  const out = JSON.parse(handle({ session_id: ID, transcript_path: file, hook_event_name: "PostToolUse", cwd: "/work/app", tool_name: "Bash" }, 5)!);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /Stop and use the new API instead/);
  assert.match(out.hookSpecificOutput.additionalContext, new RegExp(PERSON_ASK.slice(0, 30)));
  assert.deepEqual(readInbox(ID), []);
});

test("an agent the chat started never takes the person's message: the chat's own next step does", () => {
  fromPerson("Use the staging database.");
  // Claude Code runs the hook inside the chat's agents, under the chat's own id.
  const agentFile = path.join(path.dirname(file), "chat", "subagents", "agent-a1.jsonl");
  assert.equal(handle({ session_id: ID, transcript_path: agentFile, agent_id: "a1", hook_event_name: "PostToolUse", cwd: "/work/app", tool_name: "Bash" }, 5), undefined);
  assert.equal(handle({ session_id: ID, transcript_path: agentFile, hook_event_name: "PostToolUse", cwd: "/work/app", tool_name: "Bash" }, 5), undefined, "known by its file too");
  assert.equal(readInbox(ID).length, 1, "still waiting for the chat");
  const out = JSON.parse(handle({ session_id: ID, transcript_path: file, hook_event_name: "PostToolUse", cwd: "/work/app", tool_name: "Bash" }, 6)!);
  assert.match(out.hookSpecificOutput.additionalContext, /Use the staging database/);
});

test("a linked chat's update still waits for the next message, not the next tool step", () => {
  fromLinked("Seats now sync on every plan change.");
  assert.equal(handle({ session_id: ID, transcript_path: file, hook_event_name: "PostToolUse", cwd: "/work/app", tool_name: "Bash" }, 5), undefined);
  assert.equal(readInbox(ID).length, 1);
});

test("Codex takes the person's message as it stops, and carries on with it", () => {
  fromPerson("Also update the docs.");
  assert.equal(handle({ session_id: ID, transcript_path: file, hook_event_name: "PostToolUse", cwd: "/work/app" }, 5, "codex"), undefined);
  const out = JSON.parse(handle({ session_id: ID, transcript_path: file, hook_event_name: "Stop", cwd: "/work/app", stop_hook_active: false }, 6, "codex")!);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /Also update the docs/);
  assert.deepEqual(readInbox(ID), []);
});

test("Roger opens the very Claude chat, in the window of its repository", () => {
  assert.equal(claudeChatLink("/Applications/Visual Studio Code.app", ID), `vscode://anthropic.claude-code/open?session=${ID}`);
  assert.equal(claudeChatLink("/Applications/Cursor.app", ID), `cursor://anthropic.claude-code/open?session=${ID}`);
  assert.equal(claudeChatLink("/Applications/Visual Studio Code.app", "not-an-id; rm -rf"), undefined);
  assert.equal(claudeChatLink("/Applications/Terminal.app", ID), undefined);
  assert.equal(editorFolder("/Users/me/shop-frontend/.claude/worktrees/usage-fe-sync"), "/Users/me/shop-frontend");
  assert.equal(editorFolder("/Users/me/shop-frontend"), "/Users/me/shop-frontend");
});

test("Roger finds the VS Code window that has the chat's folder open, by the names VS Code reports", () => {
  const status = "Version: Code 1.106\n|  Window (shop-frontend)\n|    Folder (glyphcast-frontend): 2098 files\n|    Folder (shop-frontend): more than 20000 files\n";
  const names = folderNames(status);
  assert.deepEqual(names, ["glyphcast-frontend", "shop-frontend"]);
  assert.equal(vscodeFolderFor("/Users/me/shop-frontend/.claude/worktrees/audit", names), "/Users/me/shop-frontend");
  assert.equal(vscodeFolderFor("/Users/me/shop-frontend/packages/ui", names), "/Users/me/shop-frontend");
  // Not open in VS Code: Terminal.
  assert.equal(vscodeFolderFor("/Users/me/shop-backend", names), undefined);
});

test("only VS Code counts as an open editor; other editors are never opened for a chat", () => {
  assert.equal(isVSCode("/Applications/Visual Studio Code.app"), true);
  assert.equal(isVSCode("Visual Studio Code - Insiders"), true);
  assert.equal(isVSCode("/Applications/Cursor.app"), false);
  assert.equal(isVSCode(undefined), false);
});

test("a chat running in Terminal or iTerm brings forward its very tab, found by its terminal device", () => {
  const terminal = tabScript("/System/Applications/Utilities/Terminal.app")!;
  assert.match(terminal, /tell application "Terminal"/);
  assert.match(terminal, /tty of t is item 1 of argv/);
  assert.match(tabScript("/Applications/iTerm.app")!, /tell application "iTerm2"/);
  assert.equal(tabScript("/Applications/Warp.app"), undefined);
});
