// Writing rules that switch on by themselves: once per chat, only for an ask that needs them, set
// by the person or by the team's .airband.json; and the check of what an agent wrote in a doc.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handle } from "../src/hook/airband-hook";
import { setConfig } from "../src/core/updates";
import {
  briefFor,
  checkWriting,
  DOCS_BRIEF,
  forgetGiven,
  MESSAGES_BRIEF,
  notYetGiven,
  REPLIES_BRIEF,
  setProjectWriting,
  summarise,
  writingFor,
  writingSettings,
  writtenDoc,
} from "../src/core/writing";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let project = "";

beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-writing-");
  process.env.AIRBAND_CLAUDE_SETTINGS = path.join(tmp("airband-claude-"), "settings.json");
  project = path.join(tmp("airband-proj-"), "my-app");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(path.join(project, "docs"));
});

const context = (out: string | undefined) => (out ? (JSON.parse(out).hookSpecificOutput?.additionalContext as string | undefined) : undefined);
const line = (out: string | undefined) => (out ? (JSON.parse(out).systemMessage as string | undefined) : undefined);

test("an ask for a doc or a message gets those rules; other asks get none", () => {
  const s = writingSettings(project);
  assert.deepEqual(writingFor("Write a PRD for the seat limits", s), ["docs"]);
  assert.deepEqual(writingFor("draft a slack message to the team about the outage", s), ["messages"]);
  assert.deepEqual(writingFor("update the README and announce it in Slack", s), ["docs", "messages"]);
  assert.deepEqual(writingFor("fix the failing test in seats.ts", s), []);
  assert.deepEqual(writingFor("rename syncSeats to syncSeatCount", s), []);
  assert.equal(s.replies, false, "short replies are off unless chosen");
});

test("the person's switches, and the team's file winning where it says something", () => {
  setConfig({ writing: { docs: false, messages: true, replies: true } });
  assert.deepEqual(writingFor("write the spec", writingSettings(project)), []);
  const file = setProjectWriting(path.join(project, "docs"), "docs", true);
  assert.equal(file, path.join(project, ".airband.json"), "the file goes at the repository's root");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.writing.rules = ["Write British English.", 42, "  "];
  raw.other = "kept";
  fs.writeFileSync(file, JSON.stringify(raw));
  const s = writingSettings(path.join(project, "docs"));
  assert.equal(s.docs, true);
  assert.equal(s.messages, true);
  assert.equal(s.replies, true);
  assert.deepEqual(s.rules, ["Write British English."], "only words count as rules");
  assert.match(briefFor(["docs"], s), /This team's own writing rules \(from \.airband\.json\):\n- Write British English\./);
  setProjectWriting(project, "messages", false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).other, "kept", "the rest of the file stays");
  assert.equal(writingSettings(project).messages, false);
  // Outside the project, the person's own settings again.
  assert.equal(writingSettings(tmp("airband-elsewhere-")).docs, false);
});

test("each kind goes to a chat once, and again after its context is cleared", () => {
  assert.deepEqual(notYetGiven("s1", ["docs"]), ["docs"]);
  assert.deepEqual(notYetGiven("s1", ["docs", "messages"]), ["messages"]);
  assert.deepEqual(notYetGiven("s1", ["docs"]), []);
  assert.deepEqual(notYetGiven("s2", ["docs"]), ["docs"], "another chat is its own");
  forgetGiven("s1");
  assert.deepEqual(notYetGiven("s1", ["docs"]), ["docs"]);
});

test("the briefs are short: a few lines, not a skill", () => {
  for (const b of [DOCS_BRIEF, MESSAGES_BRIEF, REPLIES_BRIEF]) assert.ok(b.length / 4 < 250, `${b.length / 4} tokens`);
  // And they follow their own rules.
  assert.deepEqual(checkWriting(DOCS_BRIEF).filter((f) => f.rule !== "phrasal" && f.rule !== "filler"), []);
});

test("the checker names long sentences, semicolons, hype, two-word verbs and filler, by line", () => {
  const text = [
    "---",
    "title: a very long front matter line that is not prose and has many many many many words in it",
    "---",
    "# A heading that is long but is a heading and so it is not checked at all by the rules here",
    "",
    "Our seamless sync makes the seat count right; it also runs in order to keep invoices in step.",
    "",
    "When the job starts it reads every member of every team and every seat they hold and then it writes the new count for each team into the table.",
    "",
    "```ts",
    "const a = 1; const b = 2; // seamless, robust",
    "```",
    "",
    "| a; b | c |",
    "",
    'We avoid words like "seamless" and "kick off". We kick off the job at noon.',
    "Run `npm test; npm run lint` first. Then check the logs.",
  ].join("\n");
  const found = checkWriting(text);
  const at = (rule: string) => found.filter((f) => f.rule === rule).map((f) => f.line);
  assert.deepEqual(at("semicolon"), [6]);
  assert.deepEqual(at("hype"), [6]);
  assert.deepEqual(at("filler"), [6]);
  assert.deepEqual(at("long"), [8]);
  assert.deepEqual(at("phrasal"), [16], "a quoted word is named, not used; the second use counts");
  assert.match(summarise(found), /1 semicolon \(line 6\)/);
});

test("messages: empty greetings and lists over five", () => {
  const msg = ["Hi team, hope you're all doing well!", "", "Can you review PR #128 by Friday?", "", "- a", "- b", "- c", "- d", "- e", "- f", "", "Let me know if you have any questions."].join("\n");
  const found = checkWriting(msg, "messages");
  assert.deepEqual(
    found.map((f) => [f.rule, f.line]),
    [
      ["pleasantry", 1],
      ["list", 5],
      ["pleasantry", 12],
    ],
  );
  assert.deepEqual(checkWriting("Can you review PR #128 by Friday?\n\n1. Read it\n2. Approve it", "messages"), []);
});

test("text reads as the person's: lines crediting an AI tool are named, quotes and code are not", () => {
  const pr = [
    "Seat sync now rejects negative counts.",
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    "Drafted with ChatGPT.",
    "As an AI language model, I think this is fine.",
    "",
    'Our rule: no "Generated with Claude" lines.',
    "```",
    "git commit -m 'x' # Co-Authored-By: Codex",
    "```",
    "Co-Authored-By: Asha Rao <asha@example.com>",
  ].join("\n");
  for (const kind of ["docs", "messages"] as const) {
    assert.deepEqual(checkWriting(pr, kind).filter((f) => f.rule === "ai").map((f) => f.line), [3, 4, 5, 6], kind);
  }
  assert.match(DOCS_BRIEF, /no "Generated with" or "Co-Authored-By" lines naming an AI tool/);
  assert.match(MESSAGES_BRIEF, /no "Generated with" lines or other credit to an AI tool/);
});

test("what an agent wrote is read from its write or edit, for doc files only", () => {
  assert.deepEqual(writtenDoc("Write", { file_path: "/p/docs/prd.md", content: "x" }), { file: "/p/docs/prd.md", text: "x" });
  assert.deepEqual(writtenDoc("Edit", { file_path: "/p/README.md", old_string: "a", new_string: "b" }), { file: "/p/README.md", text: "b" });
  assert.equal(writtenDoc("MultiEdit", { file_path: "/p/a.md", edits: [{ new_string: "one" }, { new_string: "two" }] })?.text, "one\n\ntwo");
  assert.equal(writtenDoc("write_file", { file_path: "/p/a.mdx", content: "y" })?.text, "y", "Gemini CLI's names");
  assert.equal(writtenDoc("Write", { file_path: "/p/src/a.ts", content: "x" }), undefined);
  assert.equal(writtenDoc("Write", { file_path: "/p/node_modules/x/README.md", content: "x" }), undefined);
  assert.equal(writtenDoc("Write", { file_path: "/p/LICENSE.md", content: "x" }), undefined);
  assert.equal(writtenDoc("Read", { file_path: "/p/a.md" }), undefined);
});

test("the hook adds the rules once per chat, in each agent's shape", () => {
  const ask = (tool: "claude" | "codex" | "gemini", id: string, prompt: string) =>
    handle({ hook_event_name: tool === "gemini" ? "BeforeAgent" : "UserPromptSubmit", session_id: id, cwd: project, prompt }, Date.now(), tool);
  const first = ask("claude", "c1", "Write a PRD for seat limits");
  assert.equal(context(first), DOCS_BRIEF);
  assert.equal(line(first), "↪ Airband added its docs writing rules to this chat");
  assert.equal(ask("claude", "c1", "now tighten the PRD"), undefined, "not twice");
  assert.equal(ask("claude", "c1", "fix the test"), undefined);
  const codex = JSON.parse(ask("codex", "x1", "post the update in slack")!);
  assert.equal(codex.hookSpecificOutput.additionalContext, MESSAGES_BRIEF);
  assert.equal(codex.systemMessage, undefined, "Codex has no place for a line");
  const gemini = JSON.parse(ask("gemini", "g1", "write the README")!);
  assert.equal(gemini.hookSpecificOutput.hookEventName, "BeforeAgent");
  // Off: nothing.
  setConfig({ writing: { docs: false, messages: false, replies: false } });
  assert.equal(ask("claude", "c2", "Write a PRD"), undefined);
});

test("short replies, when chosen, are asked for at every start and after a compaction", () => {
  const start = (source: string) => handle({ hook_event_name: "SessionStart", session_id: "c1", cwd: project, source }, Date.now(), "claude");
  assert.doesNotMatch(context(start("startup")) ?? "", /short replies/);
  setConfig({ writing: { docs: true, messages: true, replies: true } });
  assert.match(context(start("startup"))!, /^The person asked Airband for short replies/);
  assert.match(context(start("compact"))!, /short replies/);
});

test("after an agent writes a doc, it hears what breaks the rules, and the person gets one line", () => {
  const file = path.join(project, "docs", "prd.md");
  const text = "# Seats\n\nOur seamless sync keeps counts right; it runs nightly.\n";
  fs.writeFileSync(file, `Intro line that was already here.\n\n${text}`);
  const post = (tool: "claude" | "gemini" | "codex", name: string) =>
    handle({ hook_event_name: tool === "gemini" ? "AfterTool" : "PostToolUse", session_id: "c1", cwd: project, tool_name: name, tool_input: { file_path: file, new_string: text }, tool_response: {} }, Date.now(), tool);
  const out = post("claude", "Edit");
  assert.match(context(out)!, /^Airband checked the text you just wrote in docs\/prd\.md/);
  assert.match(context(out)!, /docs\/prd\.md:5 {2}semicolon/, "lines are the file's own");
  assert.equal(line(out), "↪ Airband checked docs/prd.md: 1 semicolon (line 5), 1 hype word (line 5)");
  const gem = JSON.parse(post("gemini", "replace")!);
  assert.equal(gem.hookSpecificOutput.hookEventName, "AfterTool");
  assert.equal(gem.systemMessage, undefined);
  assert.equal(post("codex", "Edit"), undefined);
  // Clean text: nothing at all.
  assert.equal(handle({ hook_event_name: "PostToolUse", cwd: project, tool_name: "Write", tool_input: { file_path: file, content: "# Seats\n\nThe sync runs every night.\n" } }, Date.now(), "claude"), undefined);
  // Notices off: the agent still hears it, the person sees no line.
  setConfig({ notices: false });
  assert.equal(line(post("claude", "Edit")), undefined);
  assert.ok(context(post("claude", "Edit")));
  // Docs rules off: no check.
  setConfig({ writing: { docs: false, messages: true, replies: false } });
  assert.equal(post("claude", "Edit"), undefined);
});
