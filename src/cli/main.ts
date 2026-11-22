// Airband from a terminal, on any computer: setup for every agent, and the same code map, commands
// and session tools as the extension, for CI, cloud agents and machines without VS Code. The same on
// macOS, Windows and Linux. Every command is described once, in ./help.ts.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { airbandHome } from "../core/paths";
import { CodeMap } from "../codemap/index";
import { diffReport, renderDiff } from "../codemap/diff";
import { findProject } from "../codemap/where";
import { backUp, restore } from "../core/backup";
import { renderTokenReport, tokenReport } from "../core/tokens";
import { allCommands, suggest } from "../library/index";
import { agentSummary, doctor, installedVersion, latestVersion, needsSetup, newer, NPM_PACKAGE, remove, setup, updateChecksOff, VERSION, type AgentSummary } from "../core/setup";
import type { AgentId } from "../core/toolkit";
import { aboutInfo, bugUrl, CHANGELOG, DOCS, openUrl, REPO } from "./about";
import { closest, commandInfo, completion, renderCommandHelp, renderHelp, SHELLS, type Shell } from "./help";
import { globalInstall, globalUninstall, oldCommand, oneOff, ourCommand, pmCommand, startedBy, type OurCommand, type PackageManager } from "./pm";
import { columns, out, paint, plain } from "./ui";
import { readConfig, setConfig } from "../core/updates";
import { changesSince, releases } from "./changes";
import { claudeAiCreditShown, setClaudeAiCredit } from "../core/hooks";
import { checkWriting, renderFindings, setProjectWriting, summarise, WRITING_KINDS, writingSettings, type WritingKind } from "../core/writing";
import { renderSpend, renderWork, sinceDays, spendSince, workSince } from "../core/worklog";
import { completionOn, currentShell, refreshCompletion, turnCompletionOff, turnCompletionOn } from "./shell";
import * as readline from "node:readline/promises";

/** The `airband` command, looked up once (it asks the login shell, so not for every command). */
let command: OurCommand | null | undefined;
const theCommand = () => (command === undefined ? (command = ourCommand() ?? null) : command) ?? undefined;

/** How to type Airband here: `airband` once that command exists, otherwise the one-off form of
 *  the package manager that started this run (npx, pnpm dlx, yarn dlx, bunx). */
const self = () => (theCommand() ? "airband" : oneOff(startedBy()));

const uninstallLine = (c: OurCommand) => {
  const u = globalUninstall(c.by, c.pkg);
  return [u.bin, ...u.args.filter((a) => !a.startsWith("--loglevel"))].join(" ");
};

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

/** Takes a flag out of the arguments; true when it was there. */
function flag(args: string[], ...names: string[]): boolean {
  let found = false;
  for (let i = args.length - 1; i >= 0; i--) {
    if (names.includes(args[i])) {
      args.splice(i, 1);
      found = true;
    }
  }
  return found;
}

const json = (v: unknown) => out(JSON.stringify(v, null, 2));

export async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  if (flag(args, "--no-color", "--no-colour")) plain();
  const asJson = flag(args, "--json");
  const wantsHelp = flag(args, "-h", "--help");
  const wantsVersion = args[0] === "-v" || args[0] === "--version";
  let first = wantsVersion ? (args.shift(), "version") : args[0]?.startsWith("-") ? undefined : args.shift();
  if (wantsHelp && !first) first = "help";
  const info = first ? commandInfo(first) : undefined;
  const cmd = info?.name ?? first;
  if (wantsHelp && info && cmd !== "help") {
    out(renderCommandHelp(info, self()));
    return 0;
  }
  // --in takes a folder, or the name of a project already mapped ("my-api").
  const inArg = option(args, "--in");
  let folder = path.resolve(inArg ?? process.cwd());
  if (inArg && !fs.existsSync(folder)) {
    const p = findProject(inArg);
    if (typeof p === "string") {
      out(p);
      return 1;
    }
    folder = p.root;
  }
  const hops = option(args, "--hops") === "2" ? 2 : 1;
  const limit = Number(option(args, "--limit") ?? "") || undefined;
  const rest = args.filter((a) => !a.startsWith("--")).join(" ").trim();

  const freshMap = async (root = folder) => {
    const m = new CodeMap(root);
    await m.refresh({ yieldEvery: 1e9 });
    return m;
  };

  switch (cmd) {
    case "map": {
      const root = path.resolve(rest || folder);
      const m = new CodeMap(root);
      const s = await m.refresh({ yieldEvery: 1e9 });
      out(`${root}: ${s.files} files, ${s.decls} declarations; read ${s.parsed}, ${s.removed} gone, in ${(s.ms / 1000).toFixed(1)} s${s.bytes ? `, ${(s.bytes / 1024).toFixed(0)} KB` : ""}`);
      return 0;
    }
    case "find":
      if (!rest) return usage("find <words or a name>");
      out((await freshMap()).find(rest, { limit, budget: 600 }));
      return 0;
    case "outline":
      if (!rest) return usage("outline <path or name>");
      out((await freshMap()).outline(rest, 1200));
      return 0;
    case "graph":
      if (!rest) return usage("graph <name or path>");
      out((await freshMap()).graphOf(rest, hops as 1 | 2, 1200));
      return 0;
    case "overview":
      out((await freshMap()).overview(1200));
      return 0;
    case "diff": {
      const r = await diffReport(await freshMap(), rest);
      if (typeof r === "string") {
        out(r);
        return 1;
      }
      out(asJson ? JSON.stringify(r, null, 2) : renderDiff(r, 4000));
      return 0;
    }
    case "check": {
      const m = await freshMap();
      if (rest === "unused") out(m.unusedText(3000));
      else if (rest === "docs") {
        const stale = m.staleDocs();
        out(stale.length ? stale.map((d) => `${d.file}:${d.line}  ${d.missing} (${d.kind}) no longer exists`).join("\n") : "Every file, hook and script the docs name exists.");
        // A stale doc line fails a CI step on purpose.
        return stale.length ? 1 : 0;
      } else return usage("check unused|docs");
      return 0;
    }
    case "commands": {
      const list = rest ? suggest(rest).map((s) => s.command) : allCommands();
      out(list.length ? list.map((c) => `/${c.name}  ${c.description}`).join("\n") : "No command fits; do it directly.");
      return 0;
    }
    case "tokens": {
      if (!rest) return usage("tokens <chat file (.jsonl)>");
      const file = path.resolve(rest);
      out(renderTokenReport(tokenReport(/[/\\]\.codex[/\\]|rollout-/.test(file) ? "codex" : "claude", file), path.basename(file)));
      return 0;
    }
    case "backup": {
      if (!rest) return usage("backup <folder>");
      const r = backUp(path.resolve(rest));
      out(`Backed up ${r.copied} new or changed of ${r.files} files to ${r.to}`);
      return 0;
    }
    case "restore": {
      if (!rest) return usage("restore <folder>");
      const r = restore(path.resolve(rest));
      out(r.from.length ? `Restored ${r.restored} files from ${r.from.join(", ")}` : `No Airband backup in ${rest}`);
      return 0;
    }
    case "mcp":
      // The MCP server sits next to this file, both in a build and in ~/.airband.
      if (!process.env.AIRBAND_ROOT) process.env.AIRBAND_ROOT = folder;
      require(path.join(__dirname, "airband-mcp.js"));
      return -1;
    case undefined:
    case "status": {
      // The one command to remember: sets up what needs it, otherwise says how things stand.
      if (cmd === undefined && !asJson && needsSetup()) return runSetup(args, argv);
      const list = agentSummary();
      if (asJson) {
        json({ version: VERSION, installed: installedVersion() ?? null, setUp: !needsSetup(), agents: list });
        return 0;
      }
      const iv = installedVersion();
      if (iv && newer(iv, VERSION)) out(`\n  ${paint.dim(`Airband ${iv} is installed; this copy is ${VERSION}.`)}`);
      printAgents(list);
      const latest = await latestVersion({ timeoutMs: 1500 });
      if (latest && newer(latest, iv ?? VERSION)) out(`\n  ${paint.warn("!")} Airband ${latest} is out. Run: ${self()} update`);
      out(needsSetup() ? `\n  Something needs setting up. Run: ${self()}\n` : `\n  Everything is set up. ${paint.dim(`${self()} help lists every command.`)}\n`);
      return 0;
    }
    case "setup":
      return runSetup(args, argv);
    case "doctor": {
      const checks = doctor(await latestVersion({ timeoutMs: 2500 }), self());
      const bad = checks.filter((c) => c.ok === false).length;
      if (asJson) {
        json({ ok: bad === 0, version: VERSION, checks });
        return bad ? 1 : 0;
      }
      out(`\n  ${paint.bold(`Airband ${installedVersion() ?? VERSION}`)}\n`);
      for (const c of checks) {
        out(`  ${c.ok === true ? paint.ok("✓") : c.ok === "warn" ? paint.warn("!") : paint.bad("✗")} ${c.what}`);
        if (c.ok !== true && c.fix) out(`    ${paint.dim(c.fix)}`);
      }
      out(bad ? `\n  ${bad} thing${bad === 1 ? "" : "s"} to fix.\n` : "\n  Everything works.\n");
      return bad ? 1 : 0;
    }
    case "update":
      return update(argv.includes("--check"));
    case "remove": {
      for (const l of await remove({ purge: argv.includes("--purge") })) out(`  ${l}`);
      if (turnCompletionOff()) out("  Tab completion removed.");
      out("\n  Restart open agent chats to finish. If you also use the VS Code extension, uninstall it in VS Code.");
      const c = theCommand();
      if (c) out(`  ${paint.dim(`The airband command stays until: ${uninstallLine(c)}`)}`);
      out("");
      return 0;
    }
    case "notices": {
      const want = rest.toLowerCase();
      if (want && want !== "on" && want !== "off") return usage("notices [on|off]");
      const on = want ? setConfig({ notices: want === "on" }).notices : readConfig().notices;
      out(on ? `${paint.ok("✓")} Airband's lines in your agent's window are on (when a chat starts, and when other chats' work is added).` : `Airband's lines in your agent's window are off. Turn them back on: ${self()} notices on`);
      return 0;
    }
    case "writing": {
      const [what, want, ...files] = rest.split(/\s+/).filter(Boolean);
      if (what === "check") {
        const asMessage = flag(args, "--message", "--messages");
        const paths = [want, ...files].filter(Boolean);
        if (!paths.length) return usage("writing check <file> [--message]");
        let bad = 0;
        const all: Record<string, unknown> = {};
        for (const p of paths) {
          let text: string;
          try {
            text = fs.readFileSync(path.resolve(p), "utf8");
          } catch {
            out(`${p}: no such file`);
            bad++;
            continue;
          }
          const found = checkWriting(text, asMessage ? "messages" : "docs");
          all[p] = found;
          if (asJson) continue;
          if (!found.length) out(`${paint.ok("✓")} ${p} reads clean.`);
          else out(`${p}: ${summarise(found, 7)}\n${renderFindings(found, p)}`);
          if (found.length) bad++;
        }
        if (asJson) json(all);
        // Findings fail the run, so it fits in CI.
        return bad ? 1 : 0;
      }
      const forProject = flag(args, "--project", "--team");
      if (what === "ai-credit") {
        if (want !== "on" && want !== "off") return usage("writing ai-credit on|off");
        setClaudeAiCredit(want === "on");
        out(want === "off" ? `${paint.ok("✓")} Claude Code no longer adds "Co-Authored-By: Claude" to commits or "Generated with Claude Code" to PRs. New chats pick it up.` : `Claude Code adds its AI-credit lines again (its default).`);
        return 0;
      }
      if (what) {
        const key = what === "before-send" ? "beforeSend" : what;
        if (!(WRITING_KINDS.includes(key as WritingKind) || key === "beforeSend") || (want !== "on" && want !== "off")) return usage("writing [docs|messages|replies|before-send on|off] [--project] | writing check <file>");
        if (forProject) out(`${paint.ok("✓")} Written to ${setProjectWriting(folder, key as WritingKind | "beforeSend", want === "on")}. Commit it so the whole team gets the same rules.`);
        else setConfig({ writing: { ...readConfig().writing, [key]: want === "on" } });
      }
      const s = writingSettings(folder);
      if (asJson) {
        json(s);
        return 0;
      }
      const line = (k: WritingKind, about: string) => out(`  ${s[k] ? paint.ok("on ") : paint.dim("off")}  ${k.padEnd(11)} ${about}`);
      out("Writing rules Airband adds when a chat needs them:");
      line("docs", "PRDs, specs, READMEs, PR descriptions; and a check after a doc is written");
      line("messages", "Slack, email, PR and ticket comments, announcements");
      line("replies", "short replies you can act on, in every chat");
      out(`  ${s.beforeSend ? paint.ok("on ") : paint.dim("off")}  ${"before-send".padEnd(11)} check a message, PR or commit before it goes out, and hold it once to fix`);
      const credit = claudeAiCreditShown();
      out(`  ${credit ? paint.dim("on ") : paint.ok("off")}  ${"ai-credit".padEnd(11)} Claude Code's own "Co-Authored-By: Claude" and "Generated with Claude Code" lines`);
      if (s.project) out(paint.dim(`  This project's ${path.relative(folder, s.project) || s.project} sets the team's choices${s.rules.length ? ` and ${s.rules.length} rules of its own` : ""}.`));
      out(paint.dim(`  Change: ${self()} writing replies on · ${self()} writing ai-credit off · for the team: ${self()} writing docs on --project · check a file: ${self()} writing check README.md`));
      return 0;
    }
    case "standup": {
      const days = Number(option(args, "--days") ?? "") || 2;
      const since = sinceDays(days);
      // Every project by default: a standup covers all of a person's work. --in narrows it.
      const chats = workSince(since, inArg ? folder : undefined);
      if (asJson) json(chats);
      else out(renderWork(chats, since));
      return 0;
    }
    case "station": {
      // The Station without the app: approvals in a browser, for any computer (the Mac app runs its own).
      const { Station } = await import("../station");
      const station = new Station();
      if (flag(args, "--phone")) out(paint.dim("  The phone link comes with Airband's iPhone app. Until then, answer on this computer."));
      try {
        await station.start();
      } catch (e) {
        out(`  ${e instanceof Error ? e.message : String(e)}`);
        return 1;
      }
      const s = station.snapshot();
      out(`\n  ${paint.ok("●")} Airband's Station is running.`);
      out(`  The companion's screen: http://127.0.0.1:${station.port}/app?t=${station.token}`);
      if (s.settings.phone) out(`  On your phone (same Wi-Fi): ${station.phoneUrl() ?? "no network address found"}`);
      out(paint.dim(`  Permission requests from Claude Code and Codex come here while it runs. Ctrl+C stops it.\n`));
      const stop = () => void station.stop().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return -1;
    }
    case "spend": {
      const days = Number(option(args, "--days") ?? "") || 7;
      const since = sinceDays(days);
      const chats = spendSince(since, inArg ? folder : undefined);
      if (asJson) json(chats);
      else out(renderSpend(chats, since));
      return 0;
    }
    case "version": {
      const latest = await latestVersion({ timeoutMs: 2500 });
      if (asJson) {
        json(aboutInfo(theCommand(), latest));
        return 0;
      }
      out(`airband ${VERSION}`);
      if (latest && newer(latest, VERSION)) out(`${paint.warn(`${latest} is out.`)} Run: ${self()} update  ${paint.dim(CHANGELOG)}`);
      return 0;
    }
    case "about": {
      const a = aboutInfo(theCommand(), await latestVersion({ timeoutMs: 2500 }));
      if (asJson) {
        json({ ...a, license: "MIT", homepage: REPO, docs: DOCS, changelog: CHANGELOG });
        return 0;
      }
      const state = !a.latest ? paint.dim("couldn't check for a newer one") : newer(a.latest, a.version) ? paint.warn(`${a.latest} is out: ${self()} update`) : paint.ok("the newest");
      out(`\n  ${paint.bold(`Airband ${a.version}`)}`);
      out(`  ${paint.dim("A map of your code, your other chats' records and ready-made commands, for every agent.")}\n`);
      out(
        columns([
          ["Version", `${a.version} · ${state}`],
          ["Node.js", a.node],
          ["System", a.system],
          ["Files", `${a.files}${a.filesVersion && a.filesVersion !== a.version ? ` (${a.filesVersion})` : ""}`],
          ["Command", a.command ? `${a.command} · ${a.installedWith}` : paint.dim(`not installed (${self()} setup adds it)`)],
          ["Agents", a.agents.join(", ") || paint.dim("none found")],
        ]),
      );
      out("");
      out(columns([["Guide", DOCS], ["Changes", CHANGELOG], ["Problems", `${self()} bug`], ["License", "MIT © Harsh Baldaniya"]]));
      out("");
      return 0;
    }
    case "docs":
      out(`Opening the guide: ${DOCS}`);
      if (process.stdout.isTTY) openUrl(DOCS);
      return 0;
    case "bug": {
      const url = bugUrl(aboutInfo(theCommand()));
      out("Opening a new GitHub issue with your version and system filled in. Nothing is sent until you press Submit.");
      out(paint.dim(url));
      if (process.stdout.isTTY) openUrl(url);
      return 0;
    }
    case "completion": {
      const shell = rest.toLowerCase() as Shell;
      if (!SHELLS.includes(shell)) {
        out(renderCommandHelp(commandInfo("completion")!, self()));
        return rest ? 2 : 0;
      }
      process.stdout.write(completion(shell));
      return 0;
    }
    case "changelog": {
      const all = argv.includes("--all");
      const list = all ? releases() : releases().filter((r) => r.version === VERSION);
      if (!list.length) {
        out(`No notes for Airband ${VERSION}. All changes: ${CHANGELOG}`);
        return 0;
      }
      for (const r of list) out(`\n${paint.bold(`Airband ${r.version}`)}\n\n${r.notes}`);
      out(all ? "" : `\n${paint.dim(`Earlier versions: ${self()} changelog --all`)}\n`);
      return 0;
    }
    case "help": {
      const about = rest ? commandInfo(rest) : undefined;
      if (rest && !about) return unknown(rest);
      out(about ? renderCommandHelp(about, self()) : renderHelp(self()));
      return 0;
    }
    default:
      return unknown(first ?? "");
  }

  function unknown(word: string): number {
    const near = closest(word);
    out(`Unknown command "${word}".${near ? ` Did you mean ${paint.bold(near)}?` : ""} Run ${self()} help for the list.`);
    return 2;
  }

  function usage(what: string): number {
    out(`Usage: ${self()} ${what}`);
    return 2;
  }

  async function update(checkOnly: boolean): Promise<number> {
    const latest = await latestVersion({ force: true, timeoutMs: 6000 });
    if (!latest) {
      out(`  Couldn't reach npm. Try again when you are online.`);
      return 1;
    }
    const current = !newer(latest, VERSION);
    if (checkOnly) {
      out(current ? `Airband ${VERSION} is the newest.` : `Airband ${latest} is out (you have ${VERSION}). Run: ${self()} update  ${paint.dim(CHANGELOG)}`);
      return 0;
    }
    if (current) {
      // Already the newest: refresh every agent from this copy, in case anything drifted.
      await setup({ fromDir: __dirname });
      out(`\n  ${paint.ok("✓")} Airband ${VERSION} is the newest, and every agent is refreshed.\n`);
      return 0;
    }
    out(`\n  Updating Airband ${VERSION} → ${latest} ...\n`);
    const spec = `${NPM_PACKAGE}@${latest}`;
    const c = theCommand();
    if (c) {
      // The airband command: update it with the package manager that installed it, then let the
      // new version set every agent up.
      const g = globalInstall(c.by, spec);
      const code = run(pmCommand(g.bin, g.args));
      if (code !== 0) {
        out(`\n  ${paint.bad("✗")} ${g.bin} couldn't update it. Try: ${[g.bin, ...g.args].join(" ")}`);
        return code;
      }
      const win = process.platform === "win32";
      return run(win ? { cmd: `"${c.path}" setup --no-command`, args: [], shell: true } : { cmd: c.path, args: ["setup", "--no-command"], shell: false });
    }
    const pm = startedBy();
    const once: [PackageManager | "npx", string[]] =
      pm === "pnpm" ? ["pnpm", ["dlx", spec, "setup"]] : pm === "bun" ? ["bun", ["x", spec, "setup"]] : pm === "yarn" && !/^yarn\/1\./.test(process.env.npm_config_user_agent ?? "") ? ["yarn", ["dlx", spec, "setup"]] : ["npx", ["-y", spec, "setup"]];
    return run(pmCommand(...once));
  }

  async function runSetup(rest: string[], all: string[]): Promise<number> {
    const agents = option(rest, "--agents")?.split(",").map((a) => a.trim().toLowerCase()).filter((a): a is AgentId => a === "claude" || a === "codex" || a === "gemini");
    if (!all.includes("--json")) out(`\n  ${paint.bold(`Airband ${VERSION}`)}  ${paint.dim("setting up your agents")}`);
    // The version that was set up before this one, to say what changed once it's done.
    const before = installedVersion();
    // `--node <path>`: the Node the hook and tools run with (the desktop app's own, when the computer has none).
    const node = option(rest, "--node");
    const r = await setup({ fromDir: __dirname, agents, sharing: !all.includes("--no-sharing"), skills: !all.includes("--no-skills"), ...(node ? { node } : {}) });
    // `--json`: what the desktop app's setup tour reads.
    if (all.includes("--json")) {
      json({ version: VERSION, agents: r.agents, codexTrust: r.codexTrust, lines: r.lines, list: agentSummary() });
      return r.agents.length ? 0 : 1;
    }
    if (!r.agents.length) {
      out(`\n  No Claude Code, Codex or Gemini CLI found on this computer. Install one, then run: ${self()}\n`);
      return 1;
    }
    // The details (what changed, which files were backed up) only when asked, or when something failed.
    const details = all.includes("--verbose") ? r.lines : r.lines.filter((l) => /couldn't|failed|error/i.test(l));
    if (details.length) out(`\n${details.map((l) => `  ${paint.dim(l)}`).join("\n")}`);
    const list = agentSummary();
    printAgents(list);
    // Like pip: after the first `npm create airband`, plain `airband` works in any terminal.
    if (!all.includes("--no-command")) {
      const c = addCommand();
      const pad = Math.max(...list.map((a) => a.name.length)) + 3;
      if (c === true) out(`  ${paint.ok("✓")} ${"airband".padEnd(pad)}the command, in any new terminal`);
      else if (c) out(`  ${paint.warn("!")} ${"airband".padEnd(pad)}${paint.dim(`couldn't add the command (${c}); ${self()} does the same`)}`);
    }
    if (retireOldCommand()) out(`  ${paint.ok("✓")} ${"crosstalk".padEnd(Math.max(...list.map((a) => a.name.length)) + 3)}${paint.dim("the old command, replaced by airband")}`);
    await completionStep(all, Math.max(...list.map((a) => a.name.length)) + 3);
    if (r.codexTrust) out(`\n  ${paint.warn("!")} One step left for Codex: type /hooks in Codex and trust Airband's hook.`);
    const news = before && newer(VERSION, before) ? changesSince(before, VERSION) : [];
    if (news.length) {
      out(`\n  ${paint.bold(`What's new since ${before}`)}`);
      for (const n of news) out(`\n  ${paint.accent(n.version)}\n${n.notes.split("\n").map((l) => `  ${l}`).join("\n")}`);
    }
    out(`\n  Done. Restart open agent chats to pick it up.`);
    out(`  ${paint.dim(`Check any time: ${self()} doctor · every command: ${self()} help`)}\n`);
    return list.every((a) => a.tools) ? 0 : 1;
  }

  /** Tab completion: kept current where it is on; offered once, with a question, where it isn't.
   *  --completion turns it on without asking, --no-completion leaves it alone; no terminal, no question. */
  async function completionStep(all: string[], pad: number): Promise<void> {
    if (all.includes("--no-completion")) return;
    refreshCompletion();
    const shell = currentShell();
    if (!shell || completionOn(shell)) return;
    let yes = all.includes("--completion");
    if (!yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) return;
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const a = (await rl.question(`  ? ${"Tab".padEnd(pad)}complete airband commands in ${shell}? ${paint.dim("(Y/n)")} `)).trim().toLowerCase();
        yes = a === "" || a === "y" || a === "yes";
      } finally {
        rl.close();
      }
    }
    if (!yes) return;
    try {
      turnCompletionOn(shell);
      out(`  ${paint.ok("✓")} ${"Tab".padEnd(pad)}completion in ${shell}, in any new terminal`);
    } catch (err) {
      out(`  ${paint.warn("!")} ${"Tab".padEnd(pad)}${paint.dim(`couldn't turn on completion (${err instanceof Error ? err.message : String(err)})`)}`);
    }
  }

  function printAgents(list: AgentSummary[]): void {
    if (!list.length) {
      out(`\n  No Claude Code, Codex or Gemini CLI found. Install one, then run: ${self()}`);
      return;
    }
    const width = Math.max(...list.map((a) => a.name.length)) + 3;
    out("");
    for (const a of list) {
      const has = [a.plugin ? "tools and skills (plugin)" : a.tools ? "tools" : "", a.skills ? "skills" : "", a.sharing ? "auto-sharing" : ""].filter(Boolean);
      const off = [!a.tools ? "tools missing" : "", a.skills === false ? "no skills" : "", !a.sharing ? "auto-sharing off" : ""].filter(Boolean);
      out(`  ${a.tools ? paint.ok("✓") : paint.bad("✗")} ${a.name.padEnd(width)}${has.join(" · ")}${off.length ? paint.dim(`${has.length ? " · " : ""}${off.join(" · ")}`) : ""}`);
    }
  }

  /** Installs this version as the `airband` command, with the package manager that started this
   *  run (npm when that one can't: Yarn 2+, or pnpm without a global folder). True when added, a
   *  reason when it couldn't be, undefined when it was already there. */
  function addCommand(): true | string | undefined {
    if (theCommand()) return undefined;
    const spec = process.env.AIRBAND_PACKAGE_SPEC || `${NPM_PACKAGE}@${VERSION}`;
    const tries = [startedBy(), "npm" as const].filter((pm, i, all) => all.indexOf(pm) === i);
    let why = "";
    for (const pm of tries) {
      const g = globalInstall(pm, spec);
      const c = pmCommand(g.bin, g.args);
      const r = spawnSync(c.cmd, c.args, { encoding: "utf8", shell: c.shell, windowsHide: true, timeout: 180_000 });
      if (r.status === 0) {
        // Installed: from now on it is `airband` (this run's PATH may still show the temporary one first).
        command = { path: "airband", by: g.bin === "npm" ? "npm" : pm, pkg: NPM_PACKAGE };
        return true;
      }
      why = `${r.stderr ?? ""}${r.stdout ?? ""}`;
    }
    return /EEXIST/.test(why)
      ? "another airband command is in the way"
      : /EACCES|EPERM|permission/i.test(why)
        ? "global installs need admin rights here"
        : /E404|404/.test(why)
          ? "not on npm yet"
          : "the install failed";
  }

  /** Uninstalls the `crosstalk` command left by Airband's earlier name (crosstalk-ai), with the
   *  package manager that installed it. True when one was removed. */
  function retireOldCommand(): boolean {
    const old = oldCommand();
    if (!old) return false;
    const u = globalUninstall(old.by, old.pkg);
    const c = pmCommand(u.bin, u.args);
    return spawnSync(c.cmd, c.args, { encoding: "utf8", shell: c.shell, windowsHide: true, timeout: 120_000 }).status === 0;
  }

  function run(c: { cmd: string; args: string[]; shell: boolean }): number {
    return spawnSync(c.cmd, c.args, { stdio: "inherit", shell: c.shell, windowsHide: true }).status ?? 1;
  }
}

/** After an everyday command in a terminal: one line when a newer version is out. It reads only the
 *  answer kept from the last daily check, so a command is never slowed down by a network call. */
export function updateNote(cmd: string | undefined): void {
  const quiet = ["mcp", "update", "upgrade", "version", "--version", "-v", "about", "doctor", "setup", "install", "init", "status", "completion", "help", "--help", "-h"];
  if (!process.stderr.isTTY || !cmd || quiet.includes(cmd) || process.argv.includes("--json") || updateChecksOff()) return;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(airbandHome(), "update-check.json"), "utf8")) as { latest?: string };
    if (c.latest && newer(c.latest, VERSION)) process.stderr.write(`\nAirband ${c.latest} is out (you have ${VERSION}). Run: ${self()} update\n`);
  } catch {
    // No check yet.
  }
}

