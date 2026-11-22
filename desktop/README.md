# Desktop app

The Airband desktop app: about 2 MB on a Mac and 1.5 MB on Windows. It is a Tauri 2 app on the
system's own web view (WKWebView on macOS, WebView2 on Windows) and holds no copy of Airband itself.
The first start's setup tour fetches Node.js (if needed) and the `airband` npm package, each checked
against its publisher's fingerprint, then the app runs `airband station` and shows Roger from it.

For using the app, see [docs/desktop-app.md](../docs/desktop-app.md).

## Layout

| Path | What it is |
|---|---|
| `src-tauri/src/main.rs` | The window, Roger's corner, click-through, the menu and the settings |
| `src-tauri/src/engine.rs` | Starts the Station, reuses one already running, restarts it if it stops |
| `src-tauri/src/setup.rs` | The tour's work: the scan, the downloads, connecting the agents |
| `src-tauri/capabilities/` | What each window may call: the tour its commands, Roger's page its own |
| `tour/` | The setup tour's screens (React), built into `ui/setup.js` |
| `ui/` | The tour's page, served from the app |

Roger's own screens live in [`companion/`](../companion) at the repository root: the Station serves
them to this app and to the iPhone.

The app keeps its files in `~/.airband`: `app.json` (settings), `app.log` (what it did),
`runtime/node` (its own Node.js, when it fetched one) and `engine/` (the engine).

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

Releases are built in CI: every `v*` tag runs the "Desktop app" workflow, which builds the three
downloads and attaches them to the tag's GitHub release.

## Development

`AIRBAND_ENGINE_DIR=<folder>` runs a local engine (a built `npm-dist/`) instead of the one from npm.
The app itself takes `--check scan|node|engine|connect` and runs that one step of the setup.
