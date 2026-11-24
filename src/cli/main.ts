// Airband from a terminal, on any computer: setup for every agent, and the same code map, commands
// and session tools as the extension, for CI, cloud agents and machines without VS Code. The same on
// macOS, Windows and Linux. Every command is described once, in ./help.ts, and run by the handler of
// the same name in ./commands.
import * as fs from "node:fs";
import * as path from "node:path";
import { findProject } from "../codemap/where";
import { airbandHome } from "../core/paths";
import { updateChecksOff } from "../core/setup";
import { newer, VERSION } from "../core/version";
import { ABOUT_COMMANDS } from "./commands/about";
import { CHATS_COMMANDS } from "./commands/chats";
import { CODE_COMMANDS } from "./commands/code";
import { SETUP_COMMANDS } from "./commands/setup";
import { flag, freshMapOf, option, self, unknownCommand, type Context, type Handler } from "./context";
import { commandInfo, renderCommandHelp } from "./help";
import { out, plain } from "./ui";

/** Every command's handler, by its name in the help table. */
export const HANDLERS: Record<string, Handler> = { ...SETUP_COMMANDS, ...CODE_COMMANDS, ...CHATS_COMMANDS, ...ABOUT_COMMANDS };

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
  const c: Context = { cmd, first, args, argv, rest, folder, inArg, asJson, hops, limit, freshMap: (root = folder) => freshMapOf(root) };
  // Plain `airband` is status, which sets up whatever needs it.
  const handler = cmd === undefined ? HANDLERS.status : HANDLERS[cmd];
  return handler ? handler(c) : unknownCommand(first ?? "");
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
