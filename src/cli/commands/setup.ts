// Getting started: setting every agent up, saying how things stand, updating and removing,
// and the settings people change from a terminal.
import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig, setConfig } from "../../core/config";
import { claudeAiCreditShown, setClaudeAiCredit } from "../../core/hooks";
import { agentSummary, doctor, installedVersion, latestVersion, needsSetup, remove } from "../../core/setup";
import { newer, VERSION } from "../../core/version";
import { checkWriting, renderFindings, summarise } from "../../core/writing/check";
import { setProjectWriting, WRITING_KINDS, writingSettings, type WritingKind } from "../../core/writing/settings";
import { flag, json, self, theCommand, uninstallLine, usage, type Handler } from "../context";
import { printAgents, retireCommand, runSetup, update } from "../install";
import { turnCompletionOff } from "../shell";
import { out, paint } from "../ui";

export const SETUP_COMMANDS: Record<string, Handler> = {
  status: async (c) => {
    const { asJson, args, argv, cmd } = c;
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
  },
  setup: (c) => {
    const { args, argv } = c;
    return runSetup(args, argv);
  },
  doctor: async (c) => {
    const { asJson } = c;
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
  },
  update: (c) => {
    const { argv } = c;
    return update(argv.includes("--check"));
  },
  remove: async (c) => {
    const { argv } = c;
    for (const l of await remove({ purge: argv.includes("--purge") })) out(`  ${l}`);
    if (turnCompletionOff()) out("  Tab completion removed.");
    // --command (the desktop app's Uninstall) also takes out the `airband` command, with the
    // package manager that installed it.
    const ours = theCommand();
    const gone = !!ours && argv.includes("--command") && retireCommand(ours);
    if (gone) out("  The airband command removed.");
    out("\n  Restart open agent chats to finish. If you also use the VS Code extension, uninstall it in VS Code.");
    if (ours && !gone) out(`  ${paint.dim(`The airband command stays until: ${uninstallLine(ours)}`)}`);
    out("");
    return 0;
  },
  notices: (c) => {
    const { rest } = c;
    const want = rest.toLowerCase();
    if (want && want !== "on" && want !== "off") return usage("notices [on|off]");
    const on = want ? setConfig({ notices: want === "on" }).notices : readConfig().notices;
    out(on ? `${paint.ok("✓")} Airband's lines in your agent's window are on (when a chat starts, and when other chats' work is added).` : `Airband's lines in your agent's window are off. Turn them back on: ${self()} notices on`);
    return 0;
  },
  writing: (c) => {
    const { rest, asJson, folder, args } = c;
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
  },
};
