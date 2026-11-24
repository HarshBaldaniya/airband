// About Airband: its version, the links, the changelog, completion scripts and help.
import { openUrl } from "../../core/process";
import { latestVersion } from "../../core/setup";
import { newer, VERSION } from "../../core/version";
import { aboutInfo, bugUrl, CHANGELOG, DOCS, REPO } from "../about";
import { releases } from "../changes";
import { json, self, theCommand, unknownCommand, type Handler } from "../context";
import { commandInfo, completion, renderCommandHelp, renderHelp, SHELLS, type Shell } from "../help";
import { columns, out, paint } from "../ui";

export const ABOUT_COMMANDS: Record<string, Handler> = {
  version: async (c) => {
    const { asJson } = c;
    const latest = await latestVersion({ timeoutMs: 2500 });
    if (asJson) {
      json(aboutInfo(theCommand(), latest));
      return 0;
    }
    out(`airband ${VERSION}`);
    if (latest && newer(latest, VERSION)) out(`${paint.warn(`${latest} is out.`)} Run: ${self()} update  ${paint.dim(CHANGELOG)}`);
    return 0;
  },
  about: async (c) => {
    const { asJson } = c;
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
  },
  docs: () => {
    out(`Opening the guide: ${DOCS}`);
    if (process.stdout.isTTY) openUrl(DOCS);
    return 0;
  },
  bug: () => {
    const url = bugUrl(aboutInfo(theCommand()));
    out("Opening a new GitHub issue with your version and system filled in. Nothing is sent until you press Submit.");
    out(paint.dim(url));
    if (process.stdout.isTTY) openUrl(url);
    return 0;
  },
  completion: (c) => {
    const { rest } = c;
    const shell = rest.toLowerCase() as Shell;
    if (!SHELLS.includes(shell)) {
      out(renderCommandHelp(commandInfo("completion")!, self()));
      return rest ? 2 : 0;
    }
    process.stdout.write(completion(shell));
    return 0;
  },
  changelog: (c) => {
    const { argv } = c;
    const all = argv.includes("--all");
    const list = all ? releases() : releases().filter((r) => r.version === VERSION);
    if (!list.length) {
      out(`No notes for Airband ${VERSION}. All changes: ${CHANGELOG}`);
      return 0;
    }
    for (const r of list) out(`\n${paint.bold(`Airband ${r.version}`)}\n\n${r.notes}`);
    out(all ? "" : `\n${paint.dim(`Earlier versions: ${self()} changelog --all`)}\n`);
    return 0;
  },
  help: (c) => {
    const { rest } = c;
    const about = rest ? commandInfo(rest) : undefined;
    if (rest && !about) return unknownCommand(rest);
    out(about ? renderCommandHelp(about, self()) : renderHelp(self()));
    return 0;
  },
};
