// Chats and commands: the Library, the Station, standups, spend, token reports and backups.
import * as path from "node:path";
import { backUp, restore } from "../../install/backup";
import { renderTokenReport, tokenReport } from "../../sessions/tokens";
import { renderSpend, renderWork, sinceDays, spendSince, workSince } from "../../sessions/worklog";
import { allCommands, suggest } from "../../library/index";
import { json, option, usage, type Handler } from "../context";
import { out, paint } from "../ui";

export const CHATS_COMMANDS: Record<string, Handler> = {
  commands: (c) => {
    const { rest } = c;
    const list = rest ? suggest(rest).map((s) => s.command) : allCommands();
    out(list.length ? list.map((c) => `/${c.name}  ${c.description}`).join("\n") : "No command fits; do it directly.");
    return 0;
  },
  tokens: (c) => {
    const { rest } = c;
    if (!rest) return usage("tokens <chat file (.jsonl)>");
    const file = path.resolve(rest);
    out(renderTokenReport(tokenReport(/[/\\]\.codex[/\\]|rollout-/.test(file) ? "codex" : "claude", file), path.basename(file)));
    return 0;
  },
  backup: (c) => {
    const { rest } = c;
    if (!rest) return usage("backup <folder>");
    const r = backUp(path.resolve(rest));
    out(`Backed up ${r.copied} new or changed of ${r.files} files to ${r.to}`);
    return 0;
  },
  restore: (c) => {
    const { rest } = c;
    if (!rest) return usage("restore <folder>");
    const r = restore(path.resolve(rest));
    out(r.from.length ? `Restored ${r.restored} files from ${r.from.join(", ")}${r.refused ? `. Left out ${r.refused} that didn't look like Airband's own` : ""}. Links between chats are never restored.` : `No Airband backup in ${rest}`);
    return 0;
  },
  mcp: (c) => {
    const { folder } = c;
    // The MCP server sits next to this file, both in a build and in ~/.airband.
    if (!process.env.AIRBAND_ROOT) process.env.AIRBAND_ROOT = folder;
    require(path.join(__dirname, "airband-mcp.js"));
    return -1;
  },
  standup: (c) => {
    const { asJson, args, inArg, folder } = c;
    const days = Number(option(args, "--days") ?? "") || 2;
    const since = sinceDays(days);
    // Every project by default: a standup covers all of a person's work. --in narrows it.
    const chats = workSince(since, inArg ? folder : undefined);
    if (asJson) json(chats);
    else out(renderWork(chats, since));
    return 0;
  },
  station: async () => {
    // The Station without the app: approvals in a browser, for any computer (the Mac app runs its own).
    const { Station } = await import("../../station/server");
    const station = new Station();
    try {
      await station.start();
    } catch (e) {
      out(`  ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    out(`\n  ${paint.ok("●")} Airband's Station is running.`);
    // A link that works once, for a moment: the Station's key itself never shows on screen.
    out(`  The companion's screen: http://127.0.0.1:${station.port}/app?c=${station.oneTimeCode()} ${paint.dim("(opens once, within 2 minutes)")}`);
    out(paint.dim(`  Permission requests from Claude Code and Codex come here while it runs. Ctrl+C stops it.\n`));
    const stop = () => void station.stop().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return -1;
  },
  spend: (c) => {
    const { asJson, args, inArg, folder } = c;
    const days = Number(option(args, "--days") ?? "") || 7;
    const since = sinceDays(days);
    const chats = spendSince(since, inArg ? folder : undefined);
    if (asJson) json(chats);
    else out(renderSpend(chats, since));
    return 0;
  },
};
