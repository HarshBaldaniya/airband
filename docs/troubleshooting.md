[← Airband](../README.md)

# Troubleshooting and FAQ

Start with `airband doctor`: it checks everything and prints the fix for anything that isn't right.

## Troubleshooting

<details>
<summary><strong>Start here: <code>airband doctor</code></strong></summary>

It checks Node.js, Airband's files, and for each agent the tools, the skills and auto-sharing, and
prints the exact fix for anything that isn't right.
</details>

<details>
<summary><strong>The app doesn't show a newer version</strong></summary>

It looks a minute after it starts, then every six hours. To update now, run this in Terminal:
`/Applications/Airband.app/Contents/MacOS/airband --update`. On Windows:
`& "$env:LOCALAPPDATA\Airband\airband.exe" --update`. What happened is in `~/.airband/app.log`
(lines starting with `update:`).

</details>

<details>
<summary><strong>A connected chat doesn't receive updates</strong></summary>

Updates arrive with the chat's **next** message, not instantly (unless `airband.autoDeliver` is on).
Check that auto-sharing is on with `airband doctor`. In Codex, type `/hooks` and trust Airband's
hooks: Codex runs a hook only after you trust it, asks again whenever it changes, and until then
skips it without a word. `airband doctor` says when Codex chats ran without it.
</details>

<details>
<summary><strong>The Map is empty or out of date</strong></summary>

Run **Airband: Read the code again for the map** in VS Code, or `airband map` in a terminal. The folder
needs code in one of the supported languages.
</details>

<details>
<summary><strong>Plan limits don't show for an agent</strong></summary>

Fuel shows only what each agent reports. Codex's limits come from its chat records, so they appear
after you have used Codex.
</details>

<details>
<summary><strong>Moving from Crosstalk</strong></summary>

Airband was called Crosstalk. `npx airband` moves a Crosstalk setup over by itself: its data, each
agent's tools, hooks, skills and commands, Tab completion, and the old `crosstalk` command.
</details>

<details>
<summary><strong>macOS says Airband "is damaged and can't be opened"</strong></summary>

Downloads before the signed 0.1.1 build were not signed as a whole, and macOS calls such an app
damaged. Download it again from the [website](https://airband.harshbaldaniya.com/download/), or run
`xattr -cr /Applications/Airband.app` once in Terminal and open it.
</details>

## FAQ

**Does it cost tokens?** Notes between chats are short (Ping is one line per ask) and travel with
messages you were sending anyway. The agent tools add under 400 tokens of definitions.

**Which agents are supported?** Claude Code, Codex and Gemini CLI.

**Does it work in Cursor or Windsurf?** They are built on VS Code, so the extension should; they are not
tested yet. Reports are welcome.

**Do I need VS Code?** No. `npx airband` sets up the agents, the sharing and the tools on its own; the
extension adds the boards.
