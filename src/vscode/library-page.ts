// The Commands page: the Library's commands, a search over them, running, copying and opening one,
// and starting a command of the person's own.
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FromWebview, ToWebview } from "./protocol";
import { allCommands, STARTER_DESCRIPTION, suggest, userLibraryDir } from "../library/index";
import { openClaude } from "./open";
import { libraryView } from "./view-models";

type LibraryMessage = Extract<FromWebview, { type: "library" | "librarySuggest" | "libraryRun" | "libraryCopy" | "libraryOpen" | "libraryNew" }>;

export async function libraryMessage(m: LibraryMessage, reply: (msg: ToWebview) => void): Promise<void> {
  switch (m.type) {
    case "library":
      return reply({ type: "library", data: libraryView() });
    case "librarySuggest":
      return reply({ type: "librarySuggest", q: m.q, names: suggest(m.q, allCommands(), 6).map((x) => x.command.name) });
    case "libraryRun":
      return openClaude(undefined, `/airband:${m.name} `);
    case "libraryCopy":
      // The page shows that it copied: no toast on top of it.
      return vscode.env.clipboard.writeText(m.text ?? `/airband:${m.name}`);
    case "libraryOpen": {
      const c = allCommands().find((x) => x.name === m.name);
      if (c && c.source !== "builtin") await vscode.window.showTextDocument(vscode.Uri.file(c.source));
      return;
    }
    case "libraryNew":
      return newCommand();
  }
}

/** Starts a command of the person's own, in ~/.airband/library, from a short template. */
async function newCommand(): Promise<void> {
  const dir = userLibraryDir();
  fs.mkdirSync(dir, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(dir, `my-command${n > 1 ? `-${n}` : ""}.md`))) n++;
  const name = `my-command${n > 1 ? `-${n}` : ""}`;
  const file = path.join(dir, `${name}.md`);
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ntitle: My command\ndescription: ${STARTER_DESCRIPTION}\nargs: topic* = What to work on; style = How to write it (default: short and plain)\ntriggers: words, someone, might, type\n---\nWork on {{topic}}, written {{style}}.\n\n1. First step.\n2. Second step.\n`,
  );
  await vscode.window.showTextDocument(vscode.Uri.file(file));
  void vscode.window.showInformationMessage("Your own command: private to this computer, and live in every agent as soon as you save it. Rename it with the name: line.");
}
