<p align="center">
  <img src="https://raw.githubusercontent.com/HarshBaldaniya/airband/main/media/airband-wordmark-light.png" alt="Airband" width="240">
</p>

<p align="center">
  Connect your Claude Code, Codex and Gemini CLI chats, so each one knows what the others did.
</p>

<p align="center">
  <a href="https://airband.harshbaldaniya.com">Website</a> ·
  <a href="https://github.com/HarshBaldaniya/airband#documentation">Documentation</a> ·
  <a href="https://github.com/HarshBaldaniya/airband">GitHub</a>
</p>

## Install

```bash
npx airband
```

This finds Claude Code, Codex and Gemini CLI on your computer, sets each one up, and adds the
`airband` command. Every settings file it touches is backed up first. Restart your agent chats
afterwards. In Codex, type `/hooks` once and trust Airband's hook.

To install the command first: `npm i -g airband`, then run `airband`. With other package managers:
`pnpm dlx airband`, `yarn dlx airband` or `bunx airband`.

Requires Node.js 20 or newer. Works on macOS (Apple silicon and Intel), Windows 10 and 11, and Linux.

## What your agents get

- **A map of your code.** `airband_map` finds code by name or meaning, outlines a file, shows who
  uses what and reviews a branch or pull request, in a few hundred tokens instead of a search
  through files.
- **Each other's work.** `airband_flightlog` reads what your other chats did, in any agent, and
  `airband_notes` leaves notes for the next chat in a project.
- **15 skills** they use by themselves: find code, check a change's impact, review a PR, debug,
  onboard, write a test plan, pick up a ticket, say where work stands, write a standup, show AI
  spend, recall past work, catch up, hand off, and write docs and messages.
- **Writing rules** when they write a doc or a message, and a check of what they wrote.

The three tools add under 400 tokens of definitions in all.

## Commands

| Command | What it does |
|---|---|
| `airband` | Show what each agent has, and set up anything missing |
| `airband doctor` | Check that everything works, with the exact fix for anything that doesn't |
| `airband update` | Move to the newest version and refresh every agent |
| `airband remove` | Take Airband out of every agent (`--purge` also deletes its data) |
| `airband find "rate limiter"` | Where something is in your code; also `outline`, `graph`, `overview` |
| `airband diff #128` | What a pull request or branch changed, who calls it, which tests reach it |
| `airband standup` | What your chats did since yesterday (`--days 7` for a week) |
| `airband spend` | Tokens spent by project, agent, ticket and chat |
| `airband station` | Requests and chats in a browser |
| `airband help` | Every command |

## Desktop app

Roger, Airband's desktop companion, shows when a chat needs you and what a finished chat did, with
alerts on your iPhone from a Mac. Download it for Mac or Windows (about 2 MB) from
[airband.harshbaldaniya.com](https://airband.harshbaldaniya.com/download/).

## Privacy

Airband runs on your computer. It needs no account, sends no telemetry and never reads a login,
token or key file. Its data stays in `~/.airband`. See
[Privacy and security](https://github.com/HarshBaldaniya/airband/blob/main/docs/privacy.md).

## License

[MIT](https://github.com/HarshBaldaniya/airband/blob/main/LICENSE) © Harsh Baldaniya
