// What every command gets: the words after its name, the common options already taken out, and
// how to name Airband in what it prints (`airband`, or the one-off form that started this run).
import { CodeMap } from "../codemap/index";
import { closest } from "./help";
import { globalUninstall, oneOff, ourCommand, startedBy, type OurCommand } from "./package-managers";
import { out, paint } from "./ui";

export interface Context {
  /** The command's name as the table has it; undefined for plain `airband`. */
  cmd?: string;
  /** What was typed for it (an alias, or a word that is no command). */
  first?: string;
  /** The arguments, with the common options taken out. A command takes out its own. */
  args: string[];
  /** Everything typed, as it was. */
  argv: string[];
  /** The words that are not options, joined. */
  rest: string;
  /** The folder it works in: --in, or this one. */
  folder: string;
  /** --in as typed, when given. */
  inArg?: string;
  asJson: boolean;
  hops: 1 | 2;
  limit?: number;
  /** The code map of `root` (the folder by default), brought up to date. */
  freshMap(root?: string): Promise<CodeMap>;
}

export type Handler = (c: Context) => number | Promise<number>;

/** The `airband` command, looked up once (it asks the login shell, so not for every command). */
let command: OurCommand | null | undefined;
export const theCommand = () => (command === undefined ? (command = ourCommand() ?? null) : command) ?? undefined;
/** The command was just installed: from now on Airband is `airband`. */
export const commandInstalled = (c: OurCommand) => void (command = c);

/** How to type Airband here: `airband` once that command exists, otherwise the one-off form of
 *  the package manager that started this run (npx, pnpm dlx, yarn dlx, bunx). */
export const self = () => (theCommand() ? "airband" : oneOff(startedBy()));

export const uninstallLine = (c: OurCommand) => {
  const u = globalUninstall(c.by, c.pkg);
  return [u.bin, ...u.args.filter((a) => !a.startsWith("--loglevel"))].join(" ");
};

/** Takes an option and its value out of the arguments. */
export function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

/** Takes a flag out of the arguments; true when it was there. */
export function flag(args: string[], ...names: string[]): boolean {
  let found = false;
  for (let i = args.length - 1; i >= 0; i--) {
    if (names.includes(args[i])) {
      args.splice(i, 1);
      found = true;
    }
  }
  return found;
}

export const json = (v: unknown) => out(JSON.stringify(v, null, 2));

export function usage(what: string): number {
  out(`Usage: ${self()} ${what}`);
  return 2;
}

export function unknownCommand(word: string): number {
  const near = closest(word);
  out(`Unknown command "${word}".${near ? ` Did you mean ${paint.bold(near)}?` : ""} Run ${self()} help for the list.`);
  return 2;
}

/** A fresh code map for `root`, read in one go (a command waits for it anyway). */
export async function freshMapOf(root: string): Promise<CodeMap> {
  const m = new CodeMap(root);
  await m.refresh({ yieldEvery: 1e9 });
  return m;
}
