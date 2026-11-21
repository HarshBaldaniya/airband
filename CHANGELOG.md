# Changelog

## 0.0.5
- **A desktop companion (Mac, Windows build on GitHub).** Roger floats in a corner of your screen. He
  shows each permission request and question from Claude Code and Codex, and you answer with a click.
  He cheers when a chat finishes, opens chats, passes your messages to them, and answers "what's
  happening?" from Airband's records. Drag him anywhere, tuck him away, or rename him: his name and
  look are settings. `npm run desktop:install` builds and installs the app, and on first start it sets
  up every agent.
- **Private by design.** The companion sees only your chats' records, and never reads your files or
  folders. **Look things up** (a setting, on at first) passes a question to Claude Code: a question
  about your chats gets only Airband's read-only flightlog, and any other question gets only web
  search. Neither gets file or shell tools, and nothing is saved as a chat.
- **Your phone, from anywhere.** In Roger's settings, choose **Link** next to **Your phone** and scan
  the code. Your phone shows what needs you, with big Allow, Always and Deny buttons, and what
  finished. It works on mobile data too. On an iPhone, add it to the Home Screen (iOS 16.4 or later)
  for alerts on the Lock Screen. On Android, Allow and Deny sit on the alert itself. The phone only
  buzzes when your computer is locked or idle for a minute.
- **Locked end to end.** The code holds a secret that only your computer and your phone know.
  Messages pass through Airband's relay on Cloudflare, locked with it, so the relay can't read them.
  Alerts go from your computer to your phone's push service, locked for that phone. A phone can
  answer requests and nothing else: it can't ask, message a chat or change settings. **Unlink** ends
  it at once.
- **No Node needed.** On a computer without Node, the app runs Airband's hook and tools itself.
- **Claude Code's permission requests** now pass through Airband's hook, which waits up to 110 s for
  the app and otherwise lets the terminal ask at once.

## 0.0.4
- **A simpler Writing page.** It is now only the switches, in two groups: how agents write, and
  what happens before anything goes out. "Hide AI credit lines" is one of them. The page uses
  Airband's own orange. The team-file section, "What the agent gets", "Check a file" and the list
  of past checks are gone. A project's `.airband.json` still works, and the page says when it
  overrides a switch. `airband writing check <file>` still checks a doc from a terminal or CI.
  Airband no longer keeps `~/.airband/writing-log.jsonl`.

## 0.0.3
- **Review pull requests from the map.** `airband_map` with `diff` (and `airband diff`) takes a
  branch, `main..feature` or a PR number. A number like `#128` is fetched from origin, and nothing
  is checked out. It lists every function, class and type the change added, changed, moved or
  removed. Each one comes with its callers and the tests that reach it. Removed code that something
  still calls is flagged.
- **Ask another project.** `in: "my-api"` (or `--in my-api`) sends any map question to
  another project you have mapped, by its folder's name.
- **Tickets, issues and designs are remembered.** Chat records keep Linear and Jira ids
  (`ENG-142`), GitHub PRs and issues (`#128`, links) and Figma links. They come from the person's
  words and the replies. So "what did we do for ENG-142" finds the chats that worked on it, in any
  agent.
- **Four new skills** agents use by themselves: `airband-review`, `airband-impact`,
  `airband-handoff` and `airband-ticket`.
- **A line after each Airband answer** (Claude Code). It says what Airband found and the tokens it
  saved against reading the files it points to, measured from their real size. It shows only when
  the saving is real. `airband notices off` hides it with the others.
- **Skills for every role, 15 in all.** The new ones:
  - `airband-onboard` explains a codebase to someone new.
  - `airband-debug` first checks whether an earlier chat saw the error.
  - `airband-test-plan` starts with the changes no test reaches.
  - `airband-progress` says where a ticket, feature or PR stands.
  - `airband-standup` and `airband-spend` write a standup and a spend report.
  - `airband-write-docs` and `airband-write-messages` hold the writing rules.
  
  `airband-review` is now a full review. It has three modes (your changes, your PR, someone else's
  PR), a sweep for what the diff leaves behind, and severity tags. It posts nothing without a yes.
  A person's own skill for the same job comes first.
- **Writing rules that switch on by themselves.** A chat asked for a doc (a PRD, a spec, a README)
  gets a few lines of docs rules, once. A chat asked for a message (Slack, email, a PR comment)
  gets the message rules. After an agent writes a doc file, Airband checks the new text (Claude
  Code and Gemini CLI). It names long sentences, semicolons, hype words, two-word verbs and filler. It also names lines that credit an AI tool
  ("Generated with …", "Co-Authored-By: Claude"), so what agents write reads as the person's.
  Short replies for every chat are one switch away (`airband writing replies on`). A team commits
  `.airband.json` to give everyone the same rules, with its own added.
- **Checked before it goes out.** An agent may be about to send a Slack message, an email, a PR
  description, a comment or a commit. Airband reads the words first (Claude Code and Gemini CLI). If
  they break the rules, the send is held once, with what to fix. A commit is held only for a line
  crediting an AI tool. The same words sent again go through. `airband writing before-send off`
  turns it off.
- **`airband writing ai-credit off`** stops Claude Code adding "Co-Authored-By: Claude" to commits
  and "Generated with Claude Code" to PRs. It sets Claude Code's own `attribution` setting after a
  backup, and `on` puts back what was there. The Writing page has the same switch.
- **A Writing page** in the VS Code extension (`E`, or "Airband: Open writing rules"). It has the
  switches and each open project's team file. It checks a file on the spot, and it lists what the
  checks found lately, with a click to the line.
- **`airband writing check <file>`** checks docs from a terminal or CI, and exits with 1 on findings.
- **`airband standup`**: what your chats did since yesterday, per project, in every agent.
- **`airband spend`**: tokens by project, agent, ticket and chat, for the last 7 days or any span.
- **Code left with no caller.** A PR's diff now lists code that only the removed code used.
- The VS Code extension no longer drops settings it doesn't know when it saves its own.

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
