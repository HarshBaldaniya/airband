# Changelog

## 0.1.4
- **Open and Review go to the very chat, Terminal first.** For Claude Code, Codex and Gemini CLI:
  - A chat running in Terminal or iTerm: its own tab comes forward.
  - A chat running in VS Code: its window comes forward, with that exact Claude Code chat in it.
  - A Claude Code chat that isn't running, with its folder open in a VS Code window: it opens in
    that same window (its repository's, for a git worktree).
  - Anything else: it is resumed in a new Terminal window.
  Roger never opens a second VS Code window, and never opens Cursor or another editor for a chat.
- **Hover works straight after a click.** Rows and buttons light up under the pointer even while
  another app is in front. Before, the row you clicked stayed lit until you clicked Roger again.
- **Message only where it arrives.** The Message button shows only on a chat that is working, the
  one time every agent takes it in straight away.
- **Each tab lists its chats by name,** so rows stay put as they update.
- **The menu bar says Hide Roger when Roger is on screen.** After the app started, it said Show Roger.
- **Hidden Roger comes back when a chat finishes or needs you,** however long it was hidden. macOS
  paused a hidden Roger after about five minutes, so it missed them. It now keeps watching.
- **Every part of Roger's panel takes clicks.** Its clickable parts are measured again whenever the
  panel changes size, so a row, a tab or a button never lets a click through to the window behind.
- **A message to a running chat reaches it now.** Sent from Roger to a chat that is working, it goes
  in after the chat's next step (Claude Code, Gemini CLI) or before it stops (Codex), and the chat
  acts on it. Roger says when it will arrive.
- **Roger sees every running chat, in every folder.** Chats too big for the hook to read as a reply
  ends (ones started before Airband, say) used to wait for the VS Code extension. The app now reads
  them itself in the background, a slice at a time, so chats in any folder or git worktree show up
  within a minute, with no extension. Worktree chats show their repository's name.
- **Only real work counts as working.** With the hook on, a chat's file being touched (an agent
  writes a title into an old chat now and then) no longer puts it under Working.
- **A long list scrolls inside Roger's panel,** its last row fading so it is clear there is more.
- **The app keeps to its own folder.** Opened with a test's or an AI agent session's settings (macOS can pass
  on the environment of an earlier start), it now leaves them out, so Roger always watches your real
  chats and your agents stay connected to `~/.airband`.

## 0.1.3
- **The `airband` command follows the app.** When the app updates its engine, an older `airband`
  command is updated to the same version.

## 0.1.2
- **Install the app in one line.** `curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh` on
  a Mac, `irm https://airband.harshbaldaniya.com/install.ps1 | iex` on Windows: it installs Airband
  and opens it, with no warning to click through.
- **The Mac app moves itself to Applications** when it is opened from its disk image, and starts
  again from there.
- **The app keeps itself up to date.** Its engine (your agents' tools, skills and Roger's screens)
  updates by itself. When a newer app is out, the menu and Roger's panel offer **Update**: one click
  downloads it, checks its signature and starts it again.
- **The app's setup adds the `airband` command too**, as `npx airband` does: one setup gives you
  Roger, your agents' tools and skills, and the command in any new terminal.

## 0.1.1
- **An easier npm page.** A quick start with what setup prints, the commands in one place, and the
  other ways to install.

## 0.1.0
- **A website.** [airband.harshbaldaniya.com](https://airband.harshbaldaniya.com) has the downloads
  for your computer, a one-page guide, what's new and privacy.
- **Clearer documentation.** A shorter README, guides for each part in `docs/`, and a new npm page.
- **One desktop app.** The 2 MB app is now the only desktop app; the old 108 MB one is retired. Its
  settings are kept in `~/.airband/app.json`, and settings from earlier versions carry over.

## 0.0.10
- **A desktop app of about 2 MB.** Downloads for Macs with Apple silicon (2.0 MB) and Intel (2.1
  MB), and a Windows installer (1.4 MB), in place of the 108 MB app. It runs on the computer's own
  web view, and Roger's corner and menu work as before.
- **Setup in the app.** The first start opens a short tour: it finds your AI coding tools, Node.js
  and Airband's engine, gets what is missing from its official source (Node.js from nodejs.org,
  the engine from npm), checks each download's fingerprint before it runs, and connects your tools.
- **Nothing blocks the setup.** A missing or old Node.js (Airband needs 20 or newer), no AI coding
  tool yet, or a failed download each say what they need, with a link. Continue still works, and
  "Set up Airband…" in the menu finishes it later.
- **Click-through around Roger.** Only Roger and his panel take clicks; the rest of his corner lets
  them through to the window behind.
- `airband setup --json --node <path>`, for the app: it sets up every agent with that Node and
  answers in JSON.

## 0.0.9
- **Alerts with a real summary.** A finished chat's alert on your iPhone says what happened, then
  up to three key points, about 300 characters at most. You can read the result without going back
  to your Mac.
- **"Your turn" when a chat waits for you.** A turn that ends by handing you the next step (a
  question, "your step", "only you can") now says "your turn" instead of "is done", followed by
  exactly what to do. The Mac's card and the iPhone's Done list say it too. The alert's title names
  the project.
- **Working shows all the time.** While a chat works, Roger's antenna keeps a soft glow, and its
  radio waves ripple out every 15 seconds.

## 0.0.8
- **Roger answers as himself.** Ask who he is, who built him or what runs him, and he says he is
  Airband's helper, built by Harsh Baldaniya. Look-ups speak as Roger too, and a line such as "I'm
  Claude, made by Anthropic" is replaced by his own.
- **He understands chat spelling.** "who r u", "where do u live" and "who builds u" work like the
  full words. Two questions in one message get both answers, in order.
- **More to ask him.** Where he lives, how old he is, why he is called Roger, whether he sleeps, his
  favourite colour, food, music, movie and place, the time and the date.
- **A moment to think.** Every answer, even one he knows by heart, shows his thinking card first,
  then its words come in one after another.
- **Quick asks.** Under the Ask box: "What's happening?", "What did I do today?" and "Tell me a
  joke", one click each.

## 0.0.7
- **Roger stays awake while a chat works.** He falls asleep only when every chat is done: none
  working, none waiting for you, and two quiet minutes after the last one finished. Asleep on the
  way looked like nothing was running.

## 0.0.6
- **Roger falls asleep when nothing is for you.** After two quiet minutes he sleeps, even while chats
  work. A request, a finished chat, or your pointer on him wakes him. Before, his clock stood still
  in a quiet hour, so he almost never slept.
- **Asleep, he breathes.** Now and then he takes a slow breath, three "z"s float up over his head,
  and a sleep bubble swells at his mouth.
- **Working, he is on air.** When a chat works, his antenna glows and radio waves ripple out from it.
- **Light on your Mac.** Asleep, Roger uses about 3.5% of one core and about 120 MB in all,
  against 17% if his sleep moves never stopped. His moves play as short scenes, so nothing runs all
  day. Asleep, he stops following the pointer and skips updates that change nothing he shows.
  Hidden for a minute, his screen is released, about 135 MB, and made again when he comes back.
  While your Mac is locked or asleep, every animation pauses.
- **Less work in the background.** The Mac app no longer loads Claude's SDK at start (it is loaded
  only for "what did I do today?"). A working chat's file is read only where it grew.

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
- **Your iPhone, from anywhere (Mac and iPhone only).** In Roger's settings, choose **Link** next to
  **Your phone** and scan the code with your iPhone. Add Airband to the Home Screen (iOS 16.4 or
  later) and it links by itself. Your iPhone shows what needs you, with big Allow, Always and Deny
  buttons, what is working, and what finished today with a short summary. Alerts reach the Lock
  Screen for every request and finished chat. That is **Alert my phone always**, on at first. Turned
  off, alerts come only when your Mac is locked or idle. **Test** sends a pretend request and says
  what happened.
- **One Mac, one iPhone, nobody else.** The code works once, for 10 minutes. The first iPhone to use
  it gets a secret of its own, and the code is deleted at once, so a photo of it is worth nothing.
  To change iPhones, unlink and link again. Only a Mac offers the link, alerts go only through
  Apple's push service, and other phones and computers are turned away.
- **Locked end to end.** Messages pass through Airband's relay on Cloudflare locked with that
  secret, so the relay can't read them. Alerts go from your Mac to Apple, locked for your iPhone.
  Your iPhone gets no folder paths, and it can answer requests and nothing else: it can't ask,
  message a chat or change settings. **Unlink**, on either side, ends it on both at once.
- **Free, with limits of its own.** The relay runs on Cloudflare's free plan, which never charges:
  past its daily limit it stops until the next day. Your Mac sends its state only while the iPhone
  app is open, at most once a second and 3,000 times a day.
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
