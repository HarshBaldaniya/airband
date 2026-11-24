# Desktop app

The Airband desktop app: about 3 MB on a Mac and 2 MB on Windows. It is a Tauri 2 app on the
system's own web view (WKWebView on macOS, WebView2 on Windows) and holds no copy of Airband itself.
The first start's setup tour fetches Node.js (if needed) and the `airband` npm package, each checked
before it runs, then the app runs `airband station` and shows Roger from it.

For using the app, see [docs/desktop-app.md](../docs/desktop-app.md).

## Layout

| Path | What it is |
|---|---|
| `src-tauri/src/main.rs` | Starts things: cleans the environment, runs a flag, offers the move to Applications, then the app |
| `src-tauri/src/app.rs` | The app's wiring: plugins, the shortcut, the menu-bar icon, the commands, start and exit |
| `src-tauri/src/cli.rs` | `--uninstall [--purge]` and `--check scan\|node\|engine\|connect` (`--update` is in `app.rs`) |
| `src-tauri/src/commands.rs` | Every command a page may call, as thin wrappers |
| `src-tauri/src/corner/` | Roger's window: placing and settling it, showing and hiding it, the pointer watcher (`pointer.rs`), the page's bridge (`bridge.js`) |
| `src-tauri/src/tray.rs` | The menu, in the menu bar or tray and on a right-click |
| `src-tauri/src/engine.rs` | Starts the Station, reuses one already running, restarts it if it stops |
| `src-tauri/src/setup/` | The tour's work: the scan, curl and tar, Node.js, the engine from npm and its signature |
| `src-tauri/src/update.rs` | Engine updates by themselves, app updates with one click |
| `src-tauri/src/install.rs` | On a Mac, moving itself from the disk image to Applications |
| `src-tauri/src/uninstall.rs` | Taking Airband out of every agent, and the app off the computer |
| `src-tauri/src/state.rs`, `prefs.rs`, `paths.rs` | What the app keeps while it runs, its settings, and every file name in `~/.airband` |
| `src-tauri/src/station.rs`, `process.rs`, `env.rs`, `macos.rs` | `station.json`; other programs; the environment and Windows' PATH; Mac dialogs and the Bin |
| `src-tauri/src/error.rs`, `logging.rs` | The one error type (its words are what the tour shows), and `app.log` |
| `src-tauri/build.rs` | Declares the commands, and embeds the updater's public key for the engine's signature |
| `src-tauri/capabilities/` | What each window may call: the tour its commands, Roger's page its own |
| `src-tauri/windows/hooks.nsh` | The Windows uninstaller's step that runs `--uninstall` first |
| `downloads.json` | The release files' names, which the release scripts, the site and the app read |
| `tour/` | The setup tour's screens (React), built into `ui/setup.js` |
| `ui/` | The tour's page, served from the app |

Roger's own screens live in [`companion/`](../companion) at the repository root: the Station serves
them to this app and to the iPhone.

Each command a page may call is named in four places: `app.rs` (which hands it to `commands.rs`),
`build.rs`, `capabilities/` and the page. `node scripts/check-commands.mjs` checks they agree. CI
runs it.

The app keeps its files in `~/.airband`. Their names are in `paths.rs`:

| File | What it holds |
|---|---|
| `app.json` | The app's settings |
| `app.log` | What the app did |
| `engine.log` | The engine's errors |
| `updated.json` | The version an app update put in place, until the new app has read it |
| `runtime/node` | Its own Node.js, when it fetched one |
| `engine/` | The engine |

## Build

From the repository root, with Rust installed:

```bash
npm ci && npm --prefix desktop ci
npm run app:build                  # both Mac downloads, into desktop/release/
npm run app:build:windows          # the Windows installer, on Windows
npm run app:build:windows-on-mac   # the Windows installer, from a Mac
```

Building for Windows on a Mac needs `brew install nsis llvm lld`, `cargo install cargo-xwin` and
`rustup target add x86_64-pc-windows-msvc`. cargo-xwin downloads Microsoft's Windows build files on
its first run, which accepts their license.

Before a pull request, in `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D
warnings` and `cargo test`. The "Desktop checks" workflow runs the same on macOS and Windows.

Releases are built in CI. Every `v*` tag runs the "Desktop app" workflow. It builds the three
downloads, signs the engine of that version, and attaches them to the tag's GitHub release.

The version is `package.json`'s: `tauri.conf.json` reads it from there, and `npm run set-version`
sets the Cargo files' copy. `node scripts/check-release.mjs` (in CI) fails when a copy differs.

## Updates

An installed app updates itself (`src-tauri/src/update.rs`):

- **The engine** (hook, tools, skills, Roger's screens) follows npm by itself. A minute after the
  app starts, and every six hours, it fetches a newer `airband` package, checks it (below), sets
  the agents up with it and starts the Station again. Nothing to click.
- **The app** reads `latest.json` from the latest GitHub release. When it names a newer version,
  the menu shows **Update to Airband x.y.z** and Roger's panel shows **Update**. One click downloads
  the file, checks its signature, puts it in place and starts the app again. `airband --update` (the
  app's own binary) does the same from a terminal.

Update files are signed with a key of the maintainer's: the private key is
`~/.tauri/airband-updater.key` and the repository secret `TAURI_SIGNING_PRIVATE_KEY` (with
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), and its public half is `plugins.updater.pubkey` in
`tauri.conf.json`. An installed app takes only files signed with that key, so keep a copy of it
somewhere safe: without it, installed apps can't take a newer one. `npm run app:build` signs with
the key in `~/.tauri`; a build without it stops at the signing step.

### The engine's signature

npm's fingerprint only proves a download is the file npm meant. Anyone who can publish to npm can
publish a new file with its own fingerprint. So the engine is signed too, with the same key:

1. The release workflow's `engine` job runs `scripts/sign-engine.mjs` for the tag's version. It
   downloads `airband-<version>.tgz` from npm and checks npm's sha512. Then it signs the file with
   `tauri signer sign --app-version <version>`, which writes the version into the signed comment.
2. It attaches `airband-engine-<version>.tgz.sig` to that version's GitHub release. `latest.json`
   goes up only after it, so no app is offered a version whose engine it can't check.
3. The app checks every engine before it installs it, from the setup tour or a background update
   (`src-tauri/src/setup/signature.rs`). It fetches the signature from the release of the same
   version. The tarball must match it under the public key built into the app. (`build.rs` embeds
   `plugins.updater.pubkey`.) The signed comment must name that version.
4. With no good signature, nothing is installed. A background update tries again later. The tour
   says the engine couldn't be verified and offers **Check again**.

Two things are not done yet. The Mac app is ad-hoc signed (`signingIdentity: "-"`), not with an
Apple Developer ID, so macOS asks before its first start. Node.js is checked against
`SHASUMS256.txt` from the same server it comes from, not against the Node.js release team's GPG
signature of that file.

## Development

`AIRBAND_ENGINE_DIR=<folder>` runs a local engine (a built `npm-dist/`) instead of the one from npm,
with no signature check. The app itself takes `--check scan|node|engine|connect` and runs that one
step of the setup.
