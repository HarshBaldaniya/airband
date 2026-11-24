// An agent can have Airband's hook in its settings and still skip it (Codex runs a hook only once
// the person trusts it). The hook notes each run, and the doctor tells such an agent apart.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hookLastRan, hookSkipped, noteHookRan } from "../src/install/hook-health";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let settings = "";
let rollout = "";
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-health-home-");
  const codex = tmp("airband-health-codex-");
  process.env.CODEX_HOME = codex;
  settings = path.join(codex, "hooks.json");
  fs.writeFileSync(settings, "{}");
  const day = path.join(codex, "sessions", "2026", "11", "24");
  fs.mkdirSync(day, { recursive: true });
  rollout = path.join(day, "rollout-2026-11-24T10-00-00-01a1fe92-880c-7bb3-9db5-687369b71640.jsonl");
});
const at = (file: string, ms: number) => fs.utimesSync(file, ms / 1000, ms / 1000);

test("each run is noted, at most once a minute", () => {
  noteHookRan("codex", 1_000_000);
  noteHookRan("codex", 1_030_000);
  assert.equal(hookLastRan("codex"), 1_000_000);
  noteHookRan("codex", 1_070_000);
  assert.equal(hookLastRan("codex"), 1_070_000);
});

test("Codex chats well after the hook was set up, with no run of it, mean Codex skips it", () => {
  const now = Date.now();
  at(settings, now - 60 * 60_000);
  fs.writeFileSync(rollout, "{}\n");
  at(rollout, now);
  assert.equal(hookSkipped("codex", settings), true, "never ran since it was set up");
  noteHookRan("codex", now - 60_000);
  assert.equal(hookSkipped("codex", settings), false, "it runs");
  // A chat from before the hook was set up says nothing.
  at(rollout, now - 2 * 60 * 60_000);
  fs.rmSync(path.join(process.env.AIRBAND_HOME!, "hooks-ran.json"));
  assert.equal(hookSkipped("codex", settings), false);
});
