# Contributing to Airband

Thanks for helping. Issues and pull requests are welcome.

## Set up

```bash
git clone https://github.com/HarshBaldaniya/airband.git
cd airband
npm install
npm run build              # builds dist/
npm run install:vscode     # builds, packages and installs into your VS Code
```

Reload VS Code after installing. To debug, open the folder in VS Code and run **Run Airband**
(F5): a second window opens with the extension loaded from source.

## Before you open a pull request

```bash
npm run typecheck
npm test
```

Tests never touch your real `~/.airband`, `~/.claude`, `~/.codex` or `~/.gemini`: they point every
path at a temporary folder. Keep it that way in new tests. A few tests read real Claude Code chats
when `AIRBAND_TEST_DIR` names a folder that has some; otherwise they are skipped.

## How the code is laid out

| Folder | What lives there |
|---|---|
| `src/adapters/` | Reading each agent's own session files (Claude Code, Codex, Gemini CLI) |
| `src/core/` | Flightlogs, channels and inboxes, plan limits, tokens, the agents' toolkit |
| `src/hook/` | The small script agents run after each reply |
| `src/codemap/` | The Map: parsing, imports, search, modules |
| `src/mcp/` | The three tools agents call |
| `src/library/` | The commands (`content/*.md` is each command's text) |
| `src/vscode/` | The extension: the sidebar, the board pages and the services |
| `webview-ui/` | The pages (React): Tower, Fuel, Map, Commands, the sidebar |

## Releasing

One version lives in `package.json`, `.claude-plugin/plugin.json`, `gemini-extension.json` and
both desktop apps (`desktop/`, and `desktop-lite/`: its `package.json`, `tauri.conf.json` and Cargo
files).
Write the notes for the next version under `## Unreleased` in CHANGELOG.md as you go: they are built
into Airband, and shown after an update and by `airband changelog`.

```bash
npm run set-version -- 0.0.3   # sets it everywhere, and turns "## Unreleased" into "## 0.0.3"
npm test
npm run publish:npm             # publishes airband (npm asks you to confirm in the browser)
git commit -am "0.0.3" && git tag -a v0.0.3 -m "0.0.3" && git push --follow-tags
```

Publish to npm before pushing the tag: the plugin and the Gemini extension start the tools through
`bin/mcp.cjs`, which fetches `airband@<version>` when it isn't on the computer yet, so that
version has to exist. Check the plugin with
`claude plugin validate .`.

The tag builds the desktop app's downloads (the "Desktop app (small)" workflow) and attaches them
to the tag's GitHub release. To build them on a Mac instead, see `desktop-lite/README.md`.

## Style

- Plain words in the interface: say what a thing does for the person, not how it works.
- Every page works from a narrow sidebar to a wide screen.
- No new runtime dependency without a reason in the pull request.
- Airband never runs an AI model of its own and never reads a login or a token file.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
