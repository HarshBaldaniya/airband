// Sharing between linked chats in every direction: Claude Code, Codex and Gemini CLI to each
// other and to another chat of their own kind, at every level (a line per ask, a brief, the words
// themselves). Each reply that ends reaches the linked chat once, in order, nothing dropped and
// nothing twice, and it arrives in the shape that chat's agent reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handle } from "../src/hook/handle";
import { AGENT_IDS, type AgentId } from "../src/core/agents";
import { addConnection, readConnections, readInbox, setCursor, setLevel } from "../src/core/store";
import { endOf } from "../src/hook/sharing";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const j = (o: unknown) => JSON.stringify(o) + "\n";
const day = new Date().toISOString();
const NAME = { claude: "Claude", codex: "Codex", gemini: "Gemini" } as const;
/** Each agent's names for "a message arrived" and "a reply ended". */
const EVENTS: Record<AgentId, { ask: string; stop: string }> = {
  claude: { ask: "UserPromptSubmit", stop: "Stop" },
  codex: { ask: "UserPromptSubmit", stop: "Stop" },
  gemini: { ask: "BeforeAgent", stop: "AfterAgent" },
};

/** A chat file in the agent's own format, with what was said in it. */
function chatFile(tool: AgentId, id: string, root: string) {
  let file: string;
  let n = 0;
  if (tool === "gemini") {
    const chats = path.join(process.env.AIRBAND_GEMINI_TMP!, "app", "chats");
    fs.mkdirSync(chats, { recursive: true });
    file = path.join(chats, `session-x-${id.slice(0, 8)}.jsonl`);
    fs.writeFileSync(file, j({ sessionId: id, startTime: day }));
  } else if (tool === "codex") {
    file = path.join(tmp("airband-share-codex-"), `rollout-2026-11-24T10-00-00-${id}.jsonl`);
    fs.writeFileSync(file, j({ type: "session_meta", payload: { id, cwd: root } }));
  } else {
    file = path.join(tmp("airband-share-claude-"), `${id}.jsonl`);
    fs.writeFileSync(file, "");
  }
  const say = (ask: string, did: string) => {
    n++;
    if (tool === "gemini") fs.appendFileSync(file, j({ id: `u${n}`, timestamp: day, type: "user", content: [{ text: ask }] }) + j({ id: `a${n}`, timestamp: day, type: "gemini", content: did }));
    else if (tool === "codex") {
      const msg = (role: string, text: string) => j({ type: "response_item", timestamp: day, payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] } });
      fs.appendFileSync(file, msg("user", ask) + msg("assistant", did));
    } else
      fs.appendFileSync(
        file,
        j({ type: "user", uuid: `u${n}`, timestamp: day, message: { role: "user", content: ask } }) +
          j({ type: "assistant", uuid: `a${n}`, timestamp: day, message: { id: `m${n}`, role: "assistant", content: [{ type: "text", text: did }] } }),
      );
  };
  return { file, say };
}

const TOOLS = AGENT_IDS;
const LEVELS = ["ping", "brief", "full"] as const;

for (const from of TOOLS)
  for (const to of TOOLS)
    for (const level of LEVELS)
      test(`${NAME[from]} → ${NAME[to]}, ${level}: every reply arrives once, in order, in ${NAME[to]}'s shape`, () => {
        process.env.AIRBAND_HOME = tmp("airband-share-home-");
        process.env.AIRBAND_CLAUDE_SETTINGS = path.join(tmp("airband-share-settings-"), "settings.json");
        process.env.AIRBAND_GEMINI_TMP = tmp("airband-share-gemini-");
        const root = "/work/shop-frontend";
        const A = { id: `${from.slice(0, 3)}a1111-0000-4000-8000-000000000001`, tool: NAME[from], title: "Sender" };
        const B = { id: `${to.slice(0, 3)}b2222-0000-4000-8000-000000000002`, tool: NAME[to], title: "Receiver" };
        const a = chatFile(from, A.id, root);
        chatFile(to, B.id, root);

        // Something said before the link is the link's context, not an update.
        a.say("Before the link", "Old work");
        addConnection(A, B);
        setLevel(readConnections().map((c) => c.id), level);
        setCursor(A.id, endOf(from, a.file));

        const stop = (did: string) => handle({ session_id: A.id, transcript_path: a.file, hook_event_name: EVENTS[from].stop, cwd: root, last_assistant_message: did, prompt_response: did, stop_hook_active: false }, Date.now(), from);

        a.say("Rename /users to /accounts", "Renamed the route in api.ts to /accounts.");
        stop("Renamed the route in api.ts to /accounts.");
        a.say("Add rate limits", "Added rate limits: 60 a minute per account.");
        stop("Added rate limits: 60 a minute per account.");
        // A reply-end with nothing new sends nothing.
        stop("Added rate limits: 60 a minute per account.");

        const inbox = readInbox(B.id);
        assert.equal(inbox.length, 2, "one update per reply, none twice");
        assert.match(inbox[0].text, /accounts/);
        assert.match(inbox[1].text, /rate limits/i);
        assert.doesNotMatch(inbox.map((i) => i.text).join("\n"), /Old work/, "what was said before the link is not resent");

        // The receiver's next message gets both, in its agent's shape, and the inbox empties.
        const out = handle({ session_id: B.id, hook_event_name: EVENTS[to].ask, cwd: root, prompt: "next" }, Date.now(), to);
        assert.ok(out, "the waiting updates are delivered");
        const o = JSON.parse(out!);
        assert.equal(o.hookSpecificOutput.hookEventName, to === "gemini" ? "BeforeAgent" : "UserPromptSubmit");
        const ctx: string = o.hookSpecificOutput.additionalContext;
        assert.ok(ctx.indexOf("accounts") !== -1 && ctx.indexOf("accounts") < ctx.search(/rate limits/i), "both, the older first");
        if (to === "codex") assert.equal(o.systemMessage, undefined, "Codex takes no line for the person here");
        assert.equal(readInbox(B.id).length, 0);
        assert.equal(handle({ session_id: B.id, hook_event_name: EVENTS[to].ask, cwd: root, prompt: "again" }, Date.now(), to), undefined, "delivered once");
        delete process.env.AIRBAND_GEMINI_TMP;
      });
