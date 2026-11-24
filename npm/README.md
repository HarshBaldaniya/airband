<p align="center">
  <img src="https://raw.githubusercontent.com/HarshBaldaniya/airband/main/media/airband-wordmark-light.png" alt="Airband" width="180">
</p>

<p align="center">
  Connect your Claude Code, Codex and Gemini CLI chats, so each one knows what the others did.<br>
  <a href="https://airband.harshbaldaniya.com">Website</a> ·
  <a href="https://github.com/HarshBaldaniya/airband#documentation">Docs</a> ·
  <a href="https://github.com/HarshBaldaniya/airband">GitHub</a>
</p>

## Quick start

```bash
npx airband
```

```text
  Airband  setting up your agents

  ✓ Claude Code   tools · skills · auto-sharing
  ✓ Codex         tools · skills · auto-sharing
  ✓ Gemini CLI    tools · auto-sharing
  ✓ airband       the command, in any new terminal

  Done. Restart open agent chats to pick it up.
```

Every settings file it touches is backed up first. In Codex, type `/hooks` and trust Airband's
hooks: Codex skips a hook until you do, and `airband doctor` tells you if it does. Needs Node.js 20
or newer, on macOS, Windows or Linux.

## What it does

- **Chats share their work.** When a chat finishes a reply, the chats connected to it get a short
  note with their next message: what was asked, what was done, which files changed.
- **Agents get a map of your code.** Finding something costs a few hundred tokens instead of a
  search through files. Three tools, under 400 tokens of definitions.
- **15 skills agents use by themselves,** from reviewing a pull request to writing a standup.
- **Roger, the desktop companion,** shows what each chat is doing, and asks you its permissions and
  questions. A chat running many agents is one chat, working until its last agent ends.

## Commands

```bash
airband               # what each agent has; set up anything missing
airband doctor        # check everything, with the exact fix for anything wrong
airband update        # move to the newest version and refresh every agent
airband remove        # take Airband out of every agent (--purge deletes its data,
                      #   --command uninstalls the airband command too)

airband find "x"      # where something is in your code (also outline, graph)
airband diff #128     # what a pull request changed, who calls it, which tests reach it
airband standup       # what your chats did since yesterday
airband spend         # tokens by project, agent, ticket and chat
airband help          # every command
```

## Other ways in

- **Desktop app** for Mac and Windows, about 3 MB: Roger, a companion that shows when a chat needs
  you. One line installs it and opens it:

  ```bash
  curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh     # Mac, in Terminal
  irm https://airband.harshbaldaniya.com/install.ps1 | iex          # Windows, in PowerShell
  ```

  Or [download it](https://airband.harshbaldaniya.com/download/). To remove it, choose
  **Uninstall Airband…** in its menu: that takes Airband out of every agent too.
- **Claude Code plugin:** `/plugin install airband --marketplace HarshBaldaniya/airband`
- **Gemini CLI extension:** `gemini extensions install https://github.com/HarshBaldaniya/airband`
- **VS Code extension:** from the [latest release](https://github.com/HarshBaldaniya/airband/releases/latest)

## Privacy

Runs on your computer. No account, no telemetry, and it never reads a login, token or key file.
[Details](https://github.com/HarshBaldaniya/airband/blob/main/docs/privacy.md)

---

MIT © [Harsh Baldaniya](https://harshbaldaniya.com)
