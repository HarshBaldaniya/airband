// Which app a chat runs in (a terminal, VS Code, the Claude app, the Codex app), read from its own
// file, and the Claude app's list of its Code-tab chats, so Open shows a chat where it lives.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chatApp, claudeAppChats, claudeAppLink, claudeAppOf, codexAppLink, codexAppOf } from "../src/core/apps";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const j = (o: unknown) => JSON.stringify(o) + "\n";

test("Claude Code's entrypoint names the app", () => {
  assert.equal(claudeAppOf("claude-desktop"), "claude-app");
  assert.equal(claudeAppOf("claude-vscode"), "vscode");
  assert.equal(claudeAppOf("cli"), "terminal");
  assert.equal(claudeAppOf("sdk-cli"), undefined);
  assert.equal(claudeAppOf(undefined), undefined);
});

test("Codex's originator names the app", () => {
  assert.equal(codexAppOf("Codex Desktop"), "codex-app");
  assert.equal(codexAppOf("codex_vscode"), "vscode");
  assert.equal(codexAppOf("codex-tui"), "terminal");
  assert.equal(codexAppOf("codex_cli_rs"), "terminal");
  assert.equal(codexAppOf("codex_exec"), undefined);
});

test("a Claude chat counts as where its newest line ran", () => {
  const file = path.join(tmp("airband-apps-"), "c.jsonl");
  fs.writeFileSync(file, j({ type: "user", entrypoint: "claude-vscode" }) + j({ type: "assistant", entrypoint: "claude-vscode" }));
  assert.equal(chatApp("claude", file), "vscode");
  // Opened later in the Claude app's Code tab.
  fs.appendFileSync(file, j({ type: "user", entrypoint: "claude-desktop" }));
  assert.equal(chatApp("claude", file), "claude-app");
});

test("a Codex chat counts as where it started", () => {
  const file = path.join(tmp("airband-apps-"), "rollout.jsonl");
  fs.writeFileSync(file, j({ type: "session_meta", payload: { id: "019a", cwd: "/w", originator: "Codex Desktop", source: "vscode" } }));
  assert.equal(chatApp("codex", file), "codex-app");
  assert.equal(chatApp("codex", path.join(os.tmpdir(), "no-such-file.jsonl")), undefined);
});

test("the Claude app's Code-tab chats, by Claude Code's chat id, archived ones left out", () => {
  const dir = tmp("airband-claude-app-");
  const org = path.join(dir, "claude-code-sessions", "acct", "org");
  fs.mkdirSync(org, { recursive: true });
  fs.writeFileSync(path.join(org, "local_aaa.json"), JSON.stringify({ sessionId: "local_aaa", cliSessionId: "chat-1", isArchived: false }));
  fs.writeFileSync(path.join(org, "local_bbb.json"), JSON.stringify({ sessionId: "local_bbb", cliSessionId: "chat-2", isArchived: true }));
  fs.writeFileSync(path.join(org, "local_ccc.json"), "{ half written");
  fs.writeFileSync(path.join(org, "deleted_ddd"), "");
  const chats = claudeAppChats(dir);
  assert.deepEqual([...chats], [["chat-1", "local_aaa"]]);
  assert.deepEqual([...claudeAppChats(path.join(dir, "missing"))], []);
});

test("the apps' own links", () => {
  assert.equal(claudeAppLink("local_9a5f"), "claude://code/continue?session=local_9a5f");
  assert.equal(codexAppLink("019a-b"), "codex://threads/019a-b");
});

test("a chat running in the Claude app is in the Claude app, not in its agent's own bundle", { skip: process.platform !== "darwin" && "macOS only" }, async () => {
  process.env.CLAUDE_CONFIG_DIR = tmp("airband-apps-claude-");
  const { runningIn } = await import("../src/station/open");
  const id = "2bfb367e-3b4e-4be5-ba0f-d8ecdf8717e4";
  const agent = "/Users/me/Library/Application Support/Claude/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude";
  const procs = new Map([
    [3, { ppid: 2, tty: "??", comm: agent, args: `${agent} --resume ${id}` }],
    [2, { ppid: 1, tty: "??", comm: "/Applications/Claude.app/Contents/Helpers/disclaimer", args: "disclaimer" }],
    [1, { ppid: 0, tty: "??", comm: "/Applications/Claude.app/Contents/MacOS/Claude", args: "Claude" }],
  ]);
  assert.deepEqual(runningIn({ id, agent: "claude", cwd: "/work/app" }, procs), { app: "/Applications/Claude.app", vscode: false });
});
