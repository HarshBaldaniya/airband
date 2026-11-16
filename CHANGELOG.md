# Changelog

## 0.0.2
- **Airband says what it's doing.** When a chat starts, one line in the agent's window: Airband
  is on, the map of the folder is ready, who the chat shares with, and which other chats worked
  there in the last 12 hours, with what to say to catch up. When another chat's work is added to
  your message, a line names it. Shown to you only, so they cost no tokens (Claude Code; Gemini
  CLI at the start). Turn them off with `airband notices off` or the `airband.notices` setting.

## 0.0.1 (first release)

Airband was called Crosstalk. Installing Airband moves a Crosstalk setup over by itself: its data
(`~/.crosstalk`), each agent's tools, hooks, skills and commands, Tab completion, and the old
`crosstalk` command, which `airband` replaces.

- **Tower**: every Claude Code, Codex and Gemini CLI chat as a card; connect chats so one gets the
  other's updates with its next message (Ping, Brief or Full).
- **Flightlog**: a short record of each chat (asks, what was done, files, commits, PRs).
- **Fuel**: plan limits as each agent reports them, and tokens per chat.
- **Map**: a board of your project's parts and files, built by a parser on your computer (TypeScript,
  JavaScript, Python, Go, Rust, Java, C#, Ruby, PHP). Agents query it through `airband_map`.
- **Commands**: ready-made commands for all three agents (plan, build, review, pr, tests and more),
  plus your own in `~/.airband/library/`.
- **Agent tools**: `airband_map`, `airband_flightlog` and `airband_notes` over MCP, with
  instructions agents read at the start of a session, and three skills they use by themselves
  (`airband-find-code`, `airband-recall`, `airband-catchup`).
- **One command to set up**: `npx airband` (or `npm i -g airband`) sets up every agent found and
  adds the `airband` command; `airband doctor`, `airband update`, `airband remove`. The same on
  macOS, Windows and Linux, with npm, pnpm, Yarn or Bun.
- **Agents don't stop to ask**: setup allows Airband's tools in Claude Code, Codex and Gemini CLI.
- **A full command line**: grouped help, `airband help <command>` with examples, `version`,
  `about`, `changelog`, `docs`, `bug`, `--json` for scripts, Tab completion for bash, zsh, fish and
  PowerShell, and "did you mean" for typos.
- **Light**: the parsers for Go, Rust, Java, C#, Ruby and PHP are fetched the first time a project
  needs them, checked against fingerprints built into Airband.
- **Claude Code plugin** and **Gemini CLI extension**, kept current by the agent itself.
- **Safe by default**: secrets are removed before anything is recorded or shared; what one chat
  sends another is fenced and marked as information, never instructions; settings files keep their
  permissions and are backed up; `~/.airband` is readable only by you.
