// Every command, in one table: the help page, `airband help <command>`, "did you mean" and tab
// completion for bash, zsh, fish and PowerShell are all drawn from it, so they never disagree.
import { VERSION } from "../core/version";
import { DOCS } from "./about";
import { columns, paint } from "./ui";

export type Group = "Get started" | "Find your way in code" | "Chats and commands" | "About";

export interface CommandInfo {
  name: string;
  group: Group;
  args?: string;
  summary: string;
  about?: string;
  options?: [string, string][];
  examples?: string[];
  aliases?: string[];
}

export const COMMANDS: CommandInfo[] = [
  {
    name: "setup",
    group: "Get started",
    summary: "Set up every agent on this computer, or set it up again",
    about: "Finds Claude Code, Codex and Gemini CLI and gives each one the tools, the commands, the skills and auto-sharing, and adds the airband command. Safe to run again: it only replaces its own entries, and backs up every settings file first. Plain `airband` does this when anything is missing.",
    options: [
      ["--agents <list>", "Only these: claude, codex, gemini (comma-separated)"],
      ["--no-sharing", "Leave auto-sharing (the hook) off"],
      ["--no-skills", "Leave out the skills"],
      ["--no-command", "Leave out the airband command"],
      ["--completion", "Turn on Tab completion without asking (--no-completion: don't ask)"],
      ["--verbose", "List every file it changed"],
    ],
    examples: ["airband setup", "airband setup --agents claude,codex", "airband setup --no-sharing"],
    aliases: ["install", "init"],
  },
  {
    name: "status",
    group: "Get started",
    summary: "What each agent has right now",
    options: [["--json", "As JSON, for scripts"]],
    examples: ["airband status", "airband status --json"],
  },
  {
    name: "doctor",
    group: "Get started",
    summary: "Check that everything works, with the fix for anything that doesn't",
    about: "Checks Node.js, Airband's files, a newer version, and for each agent: the tools, the skills and auto-sharing. Exits with 1 when something needs fixing, so it fits in CI.",
    options: [["--json", "As JSON, for scripts"]],
    examples: ["airband doctor"],
  },
  {
    name: "update",
    group: "Get started",
    summary: "Move to the newest version and refresh every agent",
    about: "Updates the airband command with the package manager that installed it (npm, pnpm, yarn or bun), then refreshes every agent.",
    options: [["--check", "Only say whether a newer version is out"]],
    examples: ["airband update", "airband update --check"],
    aliases: ["upgrade"],
  },
  {
    name: "notices",
    group: "Get started",
    args: "[on|off]",
    summary: "Turn the short Airband lines in your agent's window on or off",
    about: "When a chat starts, Airband shows one line: that it is on, the map is ready, who the chat shares with, and which other chats worked in the folder lately. When another chat's work is added to your message, it says so. They are shown to you only and cost no tokens (Claude Code and Gemini CLI). With nothing after it, says whether they are on.",
    examples: ["airband notices", "airband notices off", "airband notices on"],
  },
  {
    name: "writing",
    group: "Get started",
    args: "[docs|messages|replies|before-send|ai-credit on|off] | check <file>",
    summary: "Writing rules agents get when they write a doc or a message",
    about: "When a chat is asked for a doc (a PRD, a spec, a README) or a message (Slack, email, a PR comment), Airband adds a few lines of writing rules, once per chat. After an agent writes a doc file, it checks the new text and names long sentences, semicolons, hype words and filler. Before an agent sends a Slack message, an email, a PR or a commit, Airband checks the words and holds the send once if they break the rules (\"before-send\"; Claude Code and Gemini CLI). The same words sent again go through. \"replies\" asks every chat for short replies you can act on (off by default). \"ai-credit off\" stops Claude Code adding \"Co-Authored-By: Claude\" to commits and \"Generated with Claude Code\" to PRs (it sets Claude Code's own attribution setting, after a backup). With --project the choice goes in the project's .airband.json, which the team commits; it wins over each person's setting. \"check\" reads files and exits with 1 when something breaks the rules, so it fits in CI.",
    options: [
      ["--project", "Set it for the whole team, in this project's .airband.json"],
      ["--message", "With check: use the message rules (lists, greetings) instead of the docs rules"],
      ["--json", "As JSON, for scripts"],
    ],
    examples: ["airband writing", "airband writing replies on", "airband writing before-send off", "airband writing ai-credit off", "airband writing docs on --project", "airband writing check README.md docs/prd.md"],
  },
  {
    name: "remove",
    group: "Get started",
    summary: "Take Airband out of every agent",
    about: "Takes out the tools, the skills and the hook. Your flightlogs, map and own commands stay unless you add --purge.",
    options: [
      ["--purge", "Also delete ~/.airband (flightlogs, the map, your own commands)"],
      ["--command", "Also uninstall the airband command"],
    ],
    examples: ["airband remove", "airband remove --purge", "airband remove --command"],
    aliases: ["uninstall"],
  },
  {
    name: "find",
    group: "Find your way in code",
    args: "<words>",
    summary: "Where something is: ranked, with path:start-end",
    options: [["--limit <n>", "At most this many results"]],
    examples: ['airband find "rate limiter"', "airband find useAuth --limit 5"],
  },
  { name: "outline", group: "Find your way in code", args: "<path|name>", summary: "A folder, file or symbol, one level, with lines", examples: ["airband outline src/api", "airband outline RateLimiter"] },
  {
    name: "graph",
    group: "Find your way in code",
    args: "<name|path>",
    summary: "Who uses it and what it uses",
    options: [["--hops 2", "One more step out"]],
    examples: ["airband graph RateLimiter", "airband graph src/api/auth.ts --hops 2"],
  },
  {
    name: "diff",
    group: "Find your way in code",
    args: "[range|#PR]",
    summary: "What a branch or PR changed: functions, their callers, the tests",
    about: "Reads both ends from git without checking anything out. A pull request number is fetched from origin first. With nothing after it, compares this branch with the default one.",
    examples: ["airband diff", "airband diff #128", "airband diff main..feature/seats", "airband diff #120 --in my-api"],
  },
  { name: "overview", group: "Find your way in code", summary: "The project: commands, entry points, main parts, conventions", examples: ["airband overview"] },
  { name: "map", group: "Find your way in code", args: "[folder]", summary: "Build or refresh the code map (about 1 MB, no AI)", examples: ["airband map", "airband map ../other-project"] },
  {
    name: "check",
    group: "Find your way in code",
    args: "unused|docs",
    summary: "Unused code, or doc lines naming things that are gone",
    about: "`check docs` exits with 1 when a doc names a file, hook or script that no longer exists, so it can fail a CI step.",
    examples: ["airband check unused", "airband check docs"],
  },
  { name: "commands", group: "Chats and commands", args: "[words]", summary: "The ready-made commands, or the ones that fit a task", examples: ["airband commands", 'airband commands "review my branch"'] },
  {
    name: "station",
    group: "Chats and commands",
    summary: "Approve your chats' requests from a browser, without the Mac app",
    about: "Starts Airband's Station: it shows every chat, and while it runs, Claude Code and Codex send their permission requests to it. Answer them on the page it prints. The Airband app for Mac runs the same Station with its companion on your desktop.",
    options: [],
    examples: ["airband station"],
  },
  {
    name: "standup",
    group: "Chats and commands",
    summary: "What your chats did since yesterday, in every project and agent",
    about: "Reads every chat's flightlog (Claude Code, Codex, Gemini CLI): per project, each chat's asks and outcomes, the tickets and PRs it named, and what it left open. A start for a standup or a status update.",
    options: [
      ["--days <n>", "How many days back, today counting as 1 (default 2: yesterday and today)"],
      ["--in <project>", "Only one project"],
      ["--json", "As JSON, for scripts"],
    ],
    examples: ["airband standup", "airband standup --days 7", "airband standup --in my-api"],
  },
  {
    name: "spend",
    group: "Chats and commands",
    summary: "Tokens your AI chats spent, by project, agent, ticket and chat",
    about: "Adds up what each agent reported for every chat with a flightlog: new input, output and cache reads, by project, by agent, by the tickets and PRs the chats named, and the biggest chats. Read from the agents' own files; nothing is sent anywhere.",
    options: [
      ["--days <n>", "How many days back, today counting as 1 (default 7)"],
      ["--in <project>", "Only one project"],
      ["--json", "As JSON, for scripts"],
    ],
    examples: ["airband spend", "airband spend --days 30", "airband spend --in my-api"],
  },
  { name: "tokens", group: "Chats and commands", args: "<chat file>", summary: "Where a Claude Code or Codex chat's tokens went", examples: ["airband tokens ~/.claude/projects/my-app/1234.jsonl"] },
  { name: "backup", group: "Chats and commands", args: "<folder>", summary: "Copy session logs and your commands to a folder", examples: ["airband backup ~/Dropbox/airband"] },
  { name: "restore", group: "Chats and commands", args: "<folder>", summary: "Bring a backup back (merges; never loses anything)", examples: ["airband restore ~/Dropbox/airband"] },
  { name: "mcp", group: "Chats and commands", summary: "Run the MCP server, for an agent's settings", about: "Agents start this themselves. Speaks MCP over stdin and stdout; nothing listens on the network." },
  { name: "version", group: "About", summary: "This version, and whether a newer one is out", options: [["--json", "As JSON, for scripts"]], examples: ["airband version", "airband --version"] },
  { name: "about", group: "About", summary: "Version, system, where it is installed, and the links", options: [["--json", "As JSON, for scripts"]] },
  { name: "changelog", group: "About", summary: "What changed in this version", options: [["--all", "Every version"]], examples: ["airband changelog", "airband changelog --all"], aliases: ["whatsnew", "changes"] },
  { name: "docs", group: "About", summary: "Open the guide in your browser" },
  { name: "bug", group: "About", summary: "Report a problem: opens a GitHub issue with your version and system filled in", about: "Nothing is sent until you press Submit on GitHub. No file paths or names are included." },
  {
    name: "completion",
    group: "About",
    args: "<shell>",
    summary: "Tab completion for bash, zsh, fish or PowerShell",
    examples: [
      `echo 'eval "$(airband completion zsh)"' >> ~/.zshrc`,
      `echo 'eval "$(airband completion bash)"' >> ~/.bashrc`,
      "airband completion fish > ~/.config/fish/completions/airband.fish",
      "airband completion powershell | Out-String | Invoke-Expression   # add to $PROFILE",
    ],
  },
  { name: "help", group: "About", args: "[command]", summary: "Help for Airband, or for one command", examples: ["airband help", "airband help find", "airband find --help"] },
];

const GLOBAL_OPTIONS: [string, string][] = [
  ["--in <folder|project>", "Work on this folder, or a project already mapped by its name (default: the one you are in)"],
  ["--json", "Output as JSON (status, doctor, version, about)"],
  ["--no-color", "Plain text, no colour"],
  ["-h, --help", "Help for Airband or a command"],
  ["-v, --version", "The version"],
];

const GROUPS: Group[] = ["Get started", "Find your way in code", "Chats and commands", "About"];

/** Finds a command by its name or one of its aliases. */
export const commandInfo = (name: string) => COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));

/** `self` is how the person types Airband here: `airband`, or `npx airband` before it is installed. */
export function renderHelp(self: string): string {
  const head = (t: string) => paint.bold(t.toUpperCase());
  const parts = [
    `${paint.bold(`Airband ${VERSION}`)}`,
    "A map of your code, your other chats' records and ready-made commands, for Claude Code, Codex and Gemini CLI.",
    "",
    head("Usage"),
    `  ${self} [command] [options]`,
  ];
  // One column width for every group, so the page reads as one table.
  const label = (c: CommandInfo) => `${c.name}${c.args ? ` ${c.args}` : ""}`;
  const w = Math.max(...COMMANDS.map((c) => label(c).length), ...GLOBAL_OPTIONS.map(([a]) => a.length)) + 3;
  parts.push(`  ${self.padEnd(w + 2 - 2)}${paint.dim("Set up every agent, or show what each one has")}`);
  for (const g of GROUPS) parts.push("", head(g), columns(COMMANDS.filter((c) => c.group === g).map((c) => [label(c), c.summary]), 2, 3, w));
  parts.push("", head("Options"), columns(GLOBAL_OPTIONS, 2, 3, w));
  parts.push("", head("Learn more"), columns([["Help on a command", `${self} help <command>`], ["Guide", DOCS], ["Report a problem", `${self} bug`]], 2, 3, w));
  return parts.join("\n");
}

export function renderCommandHelp(c: CommandInfo, self: string): string {
  const head = (t: string) => paint.bold(t.toUpperCase());
  const swap = (t: string) => (self === "airband" ? t : t.replace(/^airband\b/, self));
  const parts = [`${paint.bold(`${self} ${c.name}${c.args ? ` ${c.args}` : ""}`)}`, "", c.summary + ".", ...(c.about ? ["", c.about] : [])];
  if (c.options?.length) parts.push("", head("Options"), columns(c.options));
  if (c.examples?.length) parts.push("", head("Examples"), c.examples.map((e) => `  ${swap(e)}`).join("\n"));
  if (c.aliases?.length) parts.push("", head("Also"), `  ${c.aliases.map((a) => `${self} ${a}`).join(", ")}`);
  return parts.join("\n");
}

/** The closest command to a mistyped one, when it is close enough to suggest. */
export function closest(word: string): string | undefined {
  const names = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  let best: string | undefined;
  let bestD = Infinity;
  for (const n of names) {
    const d = distance(word.toLowerCase(), n);
    if (d < bestD) [best, bestD] = [n, d];
  }
  return best && bestD <= Math.max(1, Math.floor(best.length / 3)) ? (commandInfo(best)?.name ?? best) : undefined;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return row[b.length];
}

// ---------------------------------------------------------------- tab completion

export const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type Shell = (typeof SHELLS)[number];

export function completion(shell: Shell): string {
  const names = COMMANDS.map((c) => c.name);
  const flags = ["--in", "--json", "--no-color", "--help", "--version"];
  if (shell === "bash") {
    return `# Airband tab completion for bash. Add to ~/.bashrc: eval "$(airband completion bash)"
_airband() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names.join(" ")}" -- "$cur") )
  elif [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${flags.join(" ")}" -- "$cur") )
  fi
}
complete -o default -F _airband airband
`;
  }
  if (shell === "zsh") {
    const q = (t: string) => t.replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/:/g, "\\:");
    return `#compdef airband
# Airband tab completion for zsh. Add to ~/.zshrc: eval "$(airband completion zsh)"
_airband() {
  local -a commands
  commands=(
${COMMANDS.map((c) => `    '${q(c.name)}:${q(c.summary)}'`).join("\n")}
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    _files
  fi
}
if (( $+functions[compdef] )); then compdef _airband airband; fi
`;
  }
  if (shell === "fish") {
    const q = (t: string) => t.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `# Airband tab completion for fish. Save as ~/.config/fish/completions/airband.fish
${COMMANDS.map((c) => `complete -c airband -n __fish_use_subcommand -f -a '${q(c.name)}' -d '${q(c.summary)}'`).join("\n")}
complete -c airband -l in -r -d 'Work on this folder'
complete -c airband -l json -d 'Output as JSON'
complete -c airband -l no-color -d 'Plain text'
`;
  }
  const q = (t: string) => t.replace(/'/g, "''");
  return `# Airband tab completion for PowerShell. Add to $PROFILE: airband completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName airband -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @(
${COMMANDS.map((c) => `    @('${q(c.name)}', '${q(c.summary)}')`).join(",\n")}
  )
  $n = $commandAst.CommandElements.Count
  if ($n -eq 1 -or ($n -eq 2 -and $wordToComplete)) {
    $commands | Where-Object { $_[0] -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_[0], $_[0], 'ParameterValue', $_[1])
    }
  }
}
`;
}
