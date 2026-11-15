// The command line: package managers, finding the airband command, help, completion and output.
// No test here installs anything or runs setup (setup is covered in setup.test.ts with temp homes).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { main } from "../src/cli/main";
import { closest, commandInfo, COMMANDS, completion, renderCommandHelp, renderHelp, SHELLS } from "../src/cli/help";
import { findOnPath, globalInstall, globalUninstall, oldCommand, oneOff, ourCommand, startedBy, temporary } from "../src/cli/pm";
import { bugUrl } from "../src/cli/about";
import { plain } from "../src/cli/ui";

before(() => {
  process.env.AIRBAND_NO_UPDATE_CHECK = "1";
  process.env.AIRBAND_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "airband-cli-"));
  plain();
});

/** Runs a command and returns what it printed. */
async function run(...argv: string[]): Promise<{ code: number; text: string }> {
  let text = "";
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    text += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await main(argv), text };
  } finally {
    process.stdout.write = write;
  }
}

test("each package manager is recognised from the user agent it sets", () => {
  assert.equal(startedBy("pnpm/9.12.0 npm/? node/v22.16.0 darwin arm64"), "pnpm");
  assert.equal(startedBy("yarn/4.5.0 npm/? node/v22.16.0 linux x64"), "yarn");
  assert.equal(startedBy("bun/1.1.30 npm/? node/v22.6.0 win32 x64"), "bun");
  assert.equal(startedBy("npm/10.9.0 node/v22.16.0 darwin arm64 workspaces/false"), "npm");
  assert.equal(startedBy(""), "npm");
  assert.equal(oneOff("npm"), "npx airband");
  assert.equal(oneOff("pnpm"), "pnpm dlx airband");
  assert.equal(oneOff("bun"), "bunx airband");
  assert.equal(oneOff("yarn", "yarn/4.5.0"), "yarn dlx airband");
  assert.equal(oneOff("yarn", "yarn/1.22.22"), "npx airband", "Yarn 1 has no dlx");
  assert.deepEqual(globalInstall("yarn", "airband@1.0.0", "yarn/4.5.0").bin, "npm", "Yarn 2+ has no global installs");
  assert.deepEqual(globalInstall("yarn", "airband@1.0.0", "yarn/1.22.22"), { bin: "yarn", args: ["global", "add", "airband@1.0.0"] });
  assert.deepEqual(globalUninstall("npm", "crosstalk-ai").args.filter((a) => !a.startsWith("--")), ["uninstall", "crosstalk-ai"]);
  assert.deepEqual(globalInstall("pnpm", "x").args, ["add", "--global", "x"]);
});

test("the airband command is ours only when it points at the airband package, and says who installed it; the old crosstalk command is found to be replaced", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airband-bin-"));
  const pkg = path.join(dir, "lib", "node_modules", "airband");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "airband.js"), "// cli");
  const linked = path.join(dir, "airband");
  // Windows needs Developer Mode or admin rights for a symlink; its npm writes a .cmd shim instead.
  let canLink = true;
  try {
    fs.symlinkSync(path.join(pkg, "airband.js"), linked);
  } catch {
    canLink = false;
  }
  if (canLink) assert.deepEqual(ourCommand(linked), { path: linked, by: "npm", pkg: "airband" });
  const cmdShim = path.join(dir, "airband.cmd");
  fs.writeFileSync(cmdShim, '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\airband\\airband.js" %*\r\n');
  assert.deepEqual(ourCommand(cmdShim), { path: cmdShim, by: "npm", pkg: "airband" });

  const shim = path.join(dir, "pnpm-shim");
  fs.writeFileSync(shim, '#!/bin/sh\nexec node "$basedir/global/5/.pnpm/airband@0.0.1/node_modules/airband/airband.js" "$@"\n');
  assert.deepEqual([ourCommand(shim)?.by, ourCommand(shim)?.pkg], ["pnpm", "airband"]);

  // The `crosstalk` command from Airband's earlier name (crosstalk-ai): found so setup can uninstall it.
  const old = path.join(dir, "old.cmd");
  fs.writeFileSync(old, '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\crosstalk-ai\\crosstalk.js" %*\r\n');
  assert.equal(oldCommand(old)?.pkg, "crosstalk-ai", "the crosstalk command from the old package");
  assert.equal(ourCommand(old), undefined, "it isn't Airband's command");

  // npm create / npx put the package's own .bin first on the PATH while they run: that one is temporary.
  const npxBin = path.join(dir, ".npm", "_npx", "0f41de45", "node_modules", ".bin");
  fs.mkdirSync(npxBin, { recursive: true });
  fs.copyFileSync(cmdShim, path.join(npxBin, "airband"));
  assert.equal(ourCommand(path.join(npxBin, "airband")), undefined, "a one-run copy isn't installed");
  for (const t of ["/x/node_modules/.bin/airband", "C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\1\\node_modules\\.bin\\airband.cmd", "/Users/a/Library/Caches/pnpm/dlx/abc/node_modules/.bin/airband", "/tmp/bunx-501-create-crosstalk/node_modules/.bin/airband"]) assert.ok(temporary(t), t);
  for (const t of ["/usr/local/bin/airband", "/Users/a/.bun/bin/airband", "/Users/a/Library/pnpm/airband", "C:\\Users\\a\\AppData\\Roaming\\npm\\airband.cmd"]) assert.ok(!temporary(t), t);

  // npx's temporary .bin comes first on the PATH; the installed command behind it must still be found.
  if (process.platform !== "win32") {
    const real = path.join(dir, "realbin");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "airband"), "#!/bin/sh\n");
    fs.writeFileSync(path.join(npxBin, "airband"), "#!/bin/sh\n");
    assert.equal(findOnPath("airband", { PATH: `${npxBin}:${real}` }, "darwin"), path.join(real, "airband"));
  }

  const other = path.join(dir, "someone-elses");
  fs.writeFileSync(other, "#!/bin/sh\necho another program called airband\n");
  assert.equal(ourCommand(other), undefined, "another program with the same name is not ours");
  assert.equal(ourCommand(path.join(dir, "missing")), undefined);
});

test("every command has a summary, help and a place in completion; aliases and typos find it", () => {
  for (const c of COMMANDS) {
    assert.ok(c.summary && !c.summary.endsWith("."), c.name);
    assert.match(renderCommandHelp(c, "airband"), new RegExp(`^airband ${c.name}`));
  }
  assert.equal(commandInfo("install")?.name, "setup");
  assert.equal(commandInfo("uninstall")?.name, "remove");
  assert.equal(commandInfo("upgrade")?.name, "update");
  assert.equal(closest("doctr"), "doctor");
  assert.equal(closest("statsu"), "status");
  assert.equal(closest("xyzzyplugh"), undefined);
  const page = renderHelp("airband");
  for (const c of COMMANDS) assert.ok(page.includes(c.name), c.name);
  for (const s of SHELLS) {
    const script = completion(s);
    for (const c of COMMANDS) assert.ok(script.includes(c.name), `${s}: ${c.name}`);
  }
  assert.ok(completion("zsh").includes("doesn'\\''t"), "zsh quotes apostrophes");
  assert.ok(completion("powershell").includes("doesn''t"), "PowerShell quotes apostrophes");
});

test("help, version, json and typos from the command line", async () => {
  assert.match((await run("--help")).text, /USAGE/);
  assert.match((await run("help", "find")).text, /EXAMPLES/);
  assert.match((await run("find", "--help")).text, /--limit/);
  assert.equal((await run("-v")).text.trim().split("\n")[0], `airband ${JSON.parse(fs.readFileSync("package.json", "utf8")).version}`);
  const v = JSON.parse((await run("version", "--json")).text);
  assert.ok(v.version && v.node && v.system);
  const typo = await run("doctr");
  assert.equal(typo.code, 2);
  assert.match(typo.text, /Did you mean doctor\?/);
  assert.equal((await run("completion", "fish")).code, 0);
  assert.equal((await run("completion", "tcsh")).code, 2);
});

test("a bug report carries the version and system, never paths", () => {
  const url = bugUrl({ version: "1.2.3", node: "22.0.0", system: "macOS 15.1 (Apple silicon)", files: "~/.airband", agents: ["Codex"], command: "/Users/someone/bin/airband", installedWith: "npm" });
  const body = decodeURIComponent(url.split("body=")[1]);
  assert.match(body, /Airband 1\.2\.3 · Node\.js 22\.0\.0 · macOS 15\.1/);
  assert.ok(!body.includes("/Users/someone"), "no file paths");
});

test("under node --test, nothing may change the real agent folders", async () => {
  const { guardRealHome } = await import("../src/core/paths");
  assert.ok(process.env.NODE_TEST_CONTEXT, "node --test marks its test processes");
  for (const d of [".claude/settings.json", ".claude.json", ".codex/config.toml", ".gemini/settings.json", ".agents/skills/x", ".airband/version.json"]) {
    assert.throws(() => guardRealHome(path.join(os.homedir(), d)), /A test tried to change/, d);
  }
  assert.doesNotThrow(() => guardRealHome(path.join(os.tmpdir(), "x", ".claude", "settings.json")));
});

test("Tab completion: on adds one marked line and a script; refresh keeps it current; off takes both out", async () => {
  const { completionOn, turnCompletionOff, turnCompletionOn } = await import("../src/cli/shell");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "airband-shell-"));
  process.env.AIRBAND_SHELL_HOME = home;
  const prevZdot = process.env.ZDOTDIR;
  delete process.env.ZDOTDIR;
  try {
    const rc = path.join(home, ".zshrc");
    fs.writeFileSync(rc, "export PATH=$HOME/bin:$PATH\n");
    assert.equal(completionOn("zsh"), false);
    turnCompletionOn("zsh");
    turnCompletionOn("zsh");
    const text = fs.readFileSync(rc, "utf8");
    assert.equal(text.match(/# Airband: Tab completion/g)?.length, 1, "added once");
    assert.ok(text.startsWith("export PATH=$HOME/bin:$PATH\n"), "the person's lines stay");
    assert.ok(completionOn("zsh"));
    turnCompletionOn("fish");
    assert.ok(fs.existsSync(path.join(home, ".config", "fish", "completions", "airband.fish")));
    assert.ok(turnCompletionOff());
    assert.equal(fs.readFileSync(rc, "utf8"), "export PATH=$HOME/bin:$PATH\n", "the startup file is back as it was");
    assert.ok(!completionOn("fish"));
  } finally {
    delete process.env.AIRBAND_SHELL_HOME;
    if (prevZdot) process.env.ZDOTDIR = prevZdot;
  }
});

test("what's new: the releases between two versions, from the changelog built in", async () => {
  const { changesSince, releases } = await import("../src/cli/changes");
  const log = "# Changelog\n\n## Unreleased\n\n- soon\n\n## 0.1.0\n\n- big\n\n## 0.0.3\n\n- small\n\n## 0.0.2\n\n- fix\n\n## 0.0.1 (first public version)\n\n- first\n";
  assert.deepEqual(releases(log).map((r) => r.version), ["0.1.0", "0.0.3", "0.0.2", "0.0.1"], "Unreleased is left out");
  assert.deepEqual(changesSince("0.0.2", "0.1.0", log).map((r) => r.version), ["0.1.0", "0.0.3"]);
  assert.equal(changesSince("0.0.2", "0.0.3", log)[0].notes, "- small");
  assert.ok(releases().some((r) => r.version === "0.0.1"), "the real changelog is built in");
});
