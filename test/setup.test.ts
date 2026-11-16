// `airband setup | doctor | remove` and the skills. Every agent home is a temporary folder, and
// Claude Code's own command is never run (claudeCli: null): the real agents are never touched.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { agentSummary, claudePluginInstalled, doctor, installedVersion, needsSetup, newer, npmCommand, remove, setup, VERSION } from "../src/core/setup";
import { installSkills, removeSkills, SKILLS, skillsDir, skillsState } from "../src/core/skills";
import { agentStates, codexPromptsDir } from "../src/core/toolkit";
import { moveOldHome } from "../src/core/migrate";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let dist = "";

beforeEach(() => {
  const home = tmp("airband-setup-");
  process.env.AIRBAND_HOME = path.join(home, ".airband");
  process.env.CODEX_HOME = path.join(home, ".codex");
  process.env.AIRBAND_GEMINI_HOME = path.join(home, ".gemini");
  process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
  process.env.AIRBAND_CLAUDE_JSON = path.join(home, ".claude.json");
  process.env.AIRBAND_CLAUDE_SETTINGS = path.join(home, ".claude", "settings.json");
  process.env.AIRBAND_CLAUDE_SKILLS = path.join(home, ".claude", "skills");
  process.env.AIRBAND_AGENTS_SKILLS = path.join(home, ".agents", "skills");
  for (const d of [".claude", ".codex", ".gemini"]) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.writeFileSync(path.join(home, ".gemini", "settings.json"), "{}");
  // A stand-in for the built files setup copies into ~/.airband.
  dist = tmp("airband-dist-");
  for (const f of ["airband-mcp.js", "airband-hook.js", "airband.js"]) fs.writeFileSync(path.join(dist, f), "// built");
  fs.mkdirSync(path.join(dist, "wasm"));
  fs.writeFileSync(path.join(dist, "wasm", "tree-sitter.wasm"), "");
});

test("setup: every agent found gets tools, skills and auto-sharing; doctor then finds nothing to fix", async () => {
  const r = await setup({ fromDir: dist, claudeCli: null });
  assert.deepEqual(r.agents.sort(), ["claude", "codex", "gemini"]);
  assert.ok(r.codexTrust, "Codex is told to trust the new hook");
  assert.equal(installedVersion(), VERSION);
  assert.ok(agentStates().every((a) => a.tools), "every agent has the tools");
  assert.deepEqual(skillsState("claude"), { installed: SKILLS.length, current: SKILLS.length });
  assert.deepEqual(skillsState("codex"), { installed: SKILLS.length, current: SKILLS.length });
  const checks = doctor();
  assert.deepEqual(checks.filter((c) => c.ok !== true), [], JSON.stringify(checks.filter((c) => c.ok !== true)));
});

test("setup twice changes nothing more; remove takes out every entry but keeps the data", async () => {
  await setup({ fromDir: dist, claudeCli: null });
  const claudeJson = fs.readFileSync(process.env.AIRBAND_CLAUDE_JSON!, "utf8");
  await setup({ fromDir: dist, claudeCli: null });
  assert.equal(fs.readFileSync(process.env.AIRBAND_CLAUDE_JSON!, "utf8"), claudeJson);
  await remove({ claudeCli: null });
  assert.ok(agentStates().every((a) => !a.tools));
  assert.equal(skillsState("claude").installed, 0);
  assert.ok(fs.existsSync(path.join(process.env.AIRBAND_HOME!, "version.json")), "data stays without --purge");
  await remove({ purge: true, claudeCli: null });
  assert.ok(!fs.existsSync(process.env.AIRBAND_HOME!));
});

test("--agents limits setup; --no-sharing leaves hooks off, and doctor says how to turn them on", async () => {
  await setup({ fromDir: dist, claudeCli: null, agents: ["codex"], sharing: false });
  const states = Object.fromEntries(agentStates().map((a) => [a.id, a.tools]));
  assert.deepEqual(states, { claude: false, codex: true, gemini: false });
  const off = doctor().find((c) => c.what === "Codex: auto-sharing off");
  assert.ok(off && off.ok === "warn" && /airband setup --agents codex/.test(off.fix ?? ""));
});

test("skills never replace a person's own skill of the same name, and refresh when Airband's text changes", () => {
  const own = path.join(skillsDir("claude"), "airband-recall");
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, "SKILL.md"), "my own");
  installSkills(["claude"]);
  assert.equal(fs.readFileSync(path.join(own, "SKILL.md"), "utf8"), "my own");
  assert.equal(skillsState("claude").installed, SKILLS.length - 1);
  // An older Airband's text counts as not current.
  fs.writeFileSync(path.join(skillsDir("claude"), "airband-find-code", "SKILL.md"), "old");
  assert.equal(skillsState("claude").current, SKILLS.length - 2);
  removeSkills(["claude"]);
  assert.ok(fs.existsSync(own), "the person's own skill stays");
});

test("every skill has a name matching its folder and a description that says when to use it", () => {
  for (const s of SKILLS) {
    const front = /^---\n([\s\S]*?)\n---/.exec(s.text)?.[1] ?? "";
    assert.match(front, new RegExp(`^name: ${s.name}$`, "m"));
    const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
    assert.match(description, /Use when/);
    assert.ok(description.length < 400, `${s.name}: keep the description short (${description.length})`);
    // Plain YAML: " #" starts a comment and ": " a new key, which cut the description short.
    assert.doesNotMatch(description, /\s#|: /, `${s.name}: no " #" or ": " in a plain description`);
  }
});

test("with the Claude Code plugin installed, setup leaves Claude's tools and skills to the plugin", async () => {
  const plugins = path.join(process.env.CLAUDE_CONFIG_DIR!, "plugins");
  fs.mkdirSync(plugins, { recursive: true });
  fs.writeFileSync(path.join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "airband@airband": [{ scope: "user" }] } }));
  assert.ok(claudePluginInstalled());
  await setup({ fromDir: dist, claudeCli: null });
  assert.equal(agentStates().find((a) => a.id === "claude")!.tools, false);
  assert.equal(skillsState("claude").installed, 0);
  assert.equal(skillsState("codex").installed, SKILLS.length);
  assert.ok(doctor().some((c) => c.ok === true && /from the Airband plugin/.test(c.what)));
});

test("versions compare as numbers", () => {
  assert.ok(newer("0.0.10", "0.0.9"));
  assert.ok(newer("1.0.0", "0.9.9"));
  assert.ok(!newer("0.1.0", "0.1.0"));
  assert.ok(!newer("0.0.1", "0.0.2"));
});

test("the bare command knows when setup is needed, and the summary says what each agent has", async () => {
  assert.ok(needsSetup(), "nothing set up yet");
  await setup({ fromDir: dist, claudeCli: null, sharing: false });
  assert.ok(!needsSetup(), "auto-sharing off is a choice, not something to fix");
  const rows = agentSummary();
  assert.deepEqual(rows.map((r) => r.id).sort(), ["claude", "codex", "gemini"]);
  assert.ok(rows.every((r) => r.tools && !r.sharing));
  assert.equal(rows.find((r) => r.id === "gemini")?.skills, null);
  assert.equal(rows.find((r) => r.id === "codex")?.skills, true);
  // A skill from an older version is something to fix.
  fs.writeFileSync(path.join(skillsDir("codex"), SKILLS[0].name, "SKILL.md"), "old text");
  assert.ok(needsSetup());
  assert.match(doctor(undefined, "npx airband").find((c) => /older version/.test(c.what))?.fix ?? "", /^Run: npx airband$/);
});

test("npm and npx start the same way on macOS, Windows and Linux", () => {
  const c = npmCommand("npm", ["--version"]);
  const r = spawnSync(c.cmd, c.args, { encoding: "utf8", shell: c.shell, windowsHide: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("the plugin's launcher runs the copy in ~/.airband when it is this version or newer", () => {
  const home = process.env.AIRBAND_HOME!;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "airband-mcp.js"), 'process.stdout.write("local copy")');
  fs.writeFileSync(path.join(home, "version.json"), JSON.stringify({ version: VERSION }));
  const r = spawnSync(process.execPath, [path.resolve("bin", "mcp.cjs")], { encoding: "utf8", env: { ...process.env, AIRBAND_HOME: home }, timeout: 20_000 });
  assert.equal(r.stdout, "local copy", r.stderr);
  for (const f of [".claude-plugin/plugin.json", "gemini-extension.json"]) {
    const s = JSON.parse(fs.readFileSync(f, "utf8")).mcpServers.airband;
    assert.equal(s.command, "node", `${f} starts node, never a bare npx (Windows can't)`);
    assert.match(s.args[0], /bin.+mcp\.cjs$/);
  }
});

test("setup lets every agent use the tools without asking each time; an older setup is caught and fixed; remove takes it out", async () => {
  await setup({ fromDir: dist, claudeCli: null });
  assert.ok(agentStates().filter((a) => a.present).every((a) => a.allowed), JSON.stringify(agentStates()));
  const claude = JSON.parse(fs.readFileSync(process.env.AIRBAND_CLAUDE_SETTINGS!, "utf8"));
  assert.ok(claude.permissions.allow.includes("mcp__airband"));
  assert.ok(!needsSetup());

  // As 0.0.2 left it: Codex without the approval line.
  const toml = path.join(process.env.CODEX_HOME!, "config.toml");
  fs.writeFileSync(toml, fs.readFileSync(toml, "utf8").replace(/^default_tools_approval_mode.*\n/m, ""));
  assert.ok(needsSetup(), "an agent that asks before each use needs setup");
  assert.match(doctor().find((c) => /Codex: tools connected, but it asks/.test(c.what))?.fix ?? "", /^Run: airband/);
  await setup({ fromDir: dist, claudeCli: null });
  assert.ok(!needsSetup());

  await remove({ claudeCli: null });
  const after = JSON.parse(fs.readFileSync(process.env.AIRBAND_CLAUDE_SETTINGS!, "utf8"));
  assert.ok(!(after.permissions?.allow ?? []).includes("mcp__airband"), "remove takes the rule out");
});

test("a computer set up as Crosstalk moves to Airband: data, tools, hooks, skills, rules and commands, nothing left behind", async () => {
  const home = path.dirname(process.env.AIRBAND_HOME!);
  const old = path.join(home, ".crosstalk");
  // Crosstalk's data, and its entries in every agent.
  fs.mkdirSync(path.join(old, "flightlogs"), { recursive: true });
  fs.writeFileSync(path.join(old, "flightlogs", "abc.json"), '{"id":"abc"}');
  fs.writeFileSync(path.join(old, "version.json"), '{"version":"0.0.2"}');
  fs.writeFileSync(path.join(old, "crosstalk-hook.js"), "// old");
  const oldHook = `"node" "${path.join(old, "crosstalk-hook.js")}" claude || true`;
  fs.writeFileSync(process.env.AIRBAND_CLAUDE_SETTINGS!, JSON.stringify({ permissions: { allow: ["Bash(ls)", "mcp__crosstalk"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: oldHook }] }] } }));
  fs.writeFileSync(process.env.AIRBAND_CLAUDE_JSON!, JSON.stringify({ mcpServers: { crosstalk: { command: "node", args: ["x"] }, other: { command: "y" } } }));
  fs.writeFileSync(path.join(process.env.CODEX_HOME!, "config.toml"), 'model = "gpt-5"\n\n[mcp_servers.crosstalk]\ncommand = "node"\nargs = ["x"]\n');
  fs.mkdirSync(codexPromptsDir(), { recursive: true });
  fs.writeFileSync(path.join(codexPromptsDir(), "review.md"), "old");
  fs.writeFileSync(path.join(codexPromptsDir(), "gone-command.md"), "old");
  fs.writeFileSync(path.join(codexPromptsDir(), ".crosstalk-manifest"), "review.md\ngone-command.md\n");
  fs.writeFileSync(path.join(process.env.AIRBAND_GEMINI_HOME!, "settings.json"), JSON.stringify({ mcpServers: { crosstalk: { command: "node" } } }));
  for (const dir of [skillsDir("claude"), skillsDir("codex")]) {
    fs.mkdirSync(path.join(dir, "crosstalk-recall"), { recursive: true });
    fs.writeFileSync(path.join(dir, "crosstalk-recall", ".crosstalk"), "");
  }
  fs.mkdirSync(path.join(skillsDir("claude"), "crosstalk-own"), { recursive: true }); // the person's own: stays

  moveOldHome(process.env.AIRBAND_HOME!, [old]);
  await setup({ fromDir: dist, claudeCli: null });

  assert.ok(!fs.existsSync(old), "~/.crosstalk is gone");
  assert.ok(fs.existsSync(path.join(process.env.AIRBAND_HOME!, "flightlogs", "abc.json")), "its records moved");
  assert.equal(installedVersion(), VERSION, "the old version stamp didn't come along");
  const claude = JSON.parse(fs.readFileSync(process.env.AIRBAND_CLAUDE_SETTINGS!, "utf8"));
  assert.deepEqual(claude.permissions.allow, ["Bash(ls)", "mcp__airband"]);
  const hooks = JSON.stringify(claude.hooks);
  assert.ok(!hooks.includes("crosstalk-hook.js") && hooks.includes("airband-hook.js"), "the old hook was replaced, not doubled");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(process.env.AIRBAND_CLAUDE_JSON!, "utf8")).mcpServers).sort(), ["airband", "other"]);
  const toml = fs.readFileSync(path.join(process.env.CODEX_HOME!, "config.toml"), "utf8");
  assert.ok(!toml.includes("mcp_servers.crosstalk") && toml.includes("[mcp_servers.airband]") && toml.startsWith('model = "gpt-5"'));
  assert.ok(!fs.existsSync(path.join(codexPromptsDir(), ".crosstalk-manifest")) && !fs.existsSync(path.join(codexPromptsDir(), "gone-command.md")));
  assert.notEqual(fs.readFileSync(path.join(codexPromptsDir(), "review.md"), "utf8"), "old", "the command file is Airband's now");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(process.env.AIRBAND_GEMINI_HOME!, "settings.json"), "utf8")).mcpServers), ["airband"]);
  for (const dir of [skillsDir("claude"), skillsDir("codex")]) assert.ok(!fs.existsSync(path.join(dir, "crosstalk-recall")) && fs.existsSync(path.join(dir, "airband-recall")));
  assert.ok(fs.existsSync(path.join(skillsDir("claude"), "crosstalk-own")), "a folder that isn't Crosstalk's stays");
  assert.ok(!needsSetup());
});
