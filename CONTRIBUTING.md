# Contributing to Airband

Thanks for helping. Issues and pull requests are welcome.

## Set up

```bash
git clone https://github.com/HarshBaldaniya/airband.git
cd airband
npm install
npm run build              # builds dist/
npm run install:vscode     # builds, packages and installs the extension into your VS Code
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

## How a change reaches main

Nobody pushes to `main` directly, the owner included:

1. Fork the repository, or make a branch if you can push to it.
2. Open a pull request against `main`.
3. The tests run on Ubuntu, macOS and Windows. All three must pass.
4. The owner reviews it (`.github/CODEOWNERS`). A push after the approval needs a new one.
5. Every comment is resolved, and the branch is up to date with `main`. Then it is merged.

A pull request from a fork runs its checks only after the owner approves the run. It never gets
the repository's secrets. Only the owner can create, move or delete a release tag (`v*`).

## How the repository is laid out

| Folder | What lives there |
|---|---|
| `src/adapters/` | Reading each agent's own session files (Claude Code, Codex, Gemini CLI) |
| `src/core/` | What everything else builds on: the agent table, paths, JSON, text, units, running programs, settings, the old names (`legacy.ts`) |
| `src/sessions/` | Flightlogs (`record/`), standups and spend, token reports, plan limits, which app a chat runs in, live status |
| `src/sharing/` | Channels between chats: connections, inboxes, cursors, what a chat is sent, the notices people see, project notes |
| `src/writing/` | The writing rules: when a chat gets them, the checker, and holding a message once |
| `src/install/` | Setting up each agent: tools, hooks, skills, moving an old setup over, backups |
| `src/hook/` | The small script agents run after each reply: status, sharing, writing checks, permission requests |
| `src/mcp/` | The three tools agents call |
| `src/codemap/` | The Map: parsing, imports, search, diffs, modules |
| `src/library/` | The ready-made commands (`content/*.md` is each command's text) |
| `src/cli/` | The `airband` command |
| `src/station/` | The Station: the local server Roger and the phone page talk to |
| `src/remote/` | The end-to-end lock and Web Push for the iPhone link |
| `src/vscode/` | The VS Code extension: the controller, the message router, one service per job (chats, sharing, opening chats, plans, setup, the Map and Commands pages) and the webview protocol |
| `webview-ui/` | The extension's pages (React): `app/` (the shell and its contexts), `sidebar/`, `board/` (the tabs and the Tower), `pages/` (Fuel, Map, Commands, Writing), `components/`, `lib/` and `styles/` (one file per area, in cascade order) |
| `companion/` | Roger's screens (React), served by the Station: `figure/` (Roger himself), `state/` (his mood and words), `api/` (the Station and the desktop app), `components/`, `views/` (the desktop corner), `phone/` (the iPhone app) |
| `shared/` | What every screen shares: the agents' logos, the time-ago rounding, the brand and status colours |
| `desktop/` | The desktop app (Tauri and Rust) and its setup tour (`desktop/tour/`); see [desktop/README.md](desktop/README.md) |
| `relay/` | The Cloudflare Worker that carries the locked iPhone messages |
| `skills/` | The skills set up in each agent |
| `site/` | The website, [airband.harshbaldaniya.com](https://airband.harshbaldaniya.com); see [site/README.md](site/README.md) |
| `docs/` | The user guides linked from the README |
| `npm/` | The npm package's README |
| `scripts/` | Build, packaging and release scripts |
| `test/` | Tests (`node --test`) |
| `bin/mcp.cjs` | Starts Airband's tools for the Claude Code plugin and the Gemini CLI extension |
| `.claude-plugin/`, `gemini-extension.json` | The Claude Code plugin and the Gemini CLI extension |
| `.vscode/` | **Run Airband** (F5) and its build task, for working on the extension |

## Releasing

One version lives in `package.json`. `.claude-plugin/plugin.json`, `gemini-extension.json` and the
desktop app's Cargo files keep copies, and the desktop app's `tauri.conf.json` reads it from
`package.json`. `node scripts/check-release.mjs` fails CI when a copy differs. Write the notes for
the next version under `## Unreleased` in CHANGELOG.md as you go: they are built into Airband, and
shown after an update and by `airband changelog`.

```bash
npm run set-version -- 0.1.0   # sets it everywhere, and turns "## Unreleased" into "## 0.1.0"
npm test
npm run publish:npm             # publishes airband (npm asks you to confirm in the browser)
git commit -am "0.1.0" && git tag -a v0.1.0 -m "0.1.0" && git push --follow-tags
```

Publish to npm before pushing the tag, for two reasons:

- The plugin and the Gemini extension start the tools through `bin/mcp.cjs`. It fetches
  `airband@<version>` when it isn't on the computer yet, so that version has to exist.
- The tag's workflow signs the engine npm serves for that version (below). With nothing on npm, that
  job fails, and installed apps keep the engine they have.

Check the plugin with `claude plugin validate .`.

The tag runs the "Desktop app" workflow:

1. It builds the desktop app's downloads and attaches them to the tag's GitHub release, with the
   signed update files.
2. It signs `airband-<version>.tgz` from npm with the updater's key and attaches
   `airband-engine-<version>.tgz.sig`. The desktop app installs an engine from npm only when this
   signature checks out ([desktop/README.md](desktop/README.md#the-engines-signature)).
3. Once both are up, it attaches `latest.json`, which installed apps read to update themselves.

Signing needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (see [desktop/README.md](desktop/README.md#updates)). To sign
an engine by hand, run `node scripts/sign-engine.mjs <version>` with the key in
`TAURI_SIGNING_PRIVATE_KEY`, then attach `desktop/release/airband-engine-<version>.tgz.sig` to the
release. To build the app on a Mac instead, see [desktop/README.md](desktop/README.md).
After the release's files are up, deploy the website again (`cd site && npm run deploy`): it reads
the version and the file sizes from the release.

## Style

- Plain words in the interface: say what a thing does for the person, not how it works.
- Every page works from a narrow sidebar to a wide screen.
- No new runtime dependency without a reason in the pull request.
- Airband never runs an AI model of its own and never reads a login or a token file.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
