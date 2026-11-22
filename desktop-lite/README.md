# Airband desktop app (small)

The desktop app people download: about 2 MB on a Mac, 1.5 MB on Windows. It is Tauri 2 on the
system's own web view (WKWebView on macOS, WebView2 on Windows). It holds no copy of Airband: the
first start's setup tour fetches Node.js (if needed) and the `airband` npm package, each checked
against its publisher's fingerprint, then runs `airband station` and shows Roger from it.

| Path | What it is |
|---|---|
| `src-tauri/src/main.rs` | The window, Roger's corner, click-through, the menu, the settings |
| `src-tauri/src/engine.rs` | Starts the Station, reuses one already running, restarts it if it stops |
| `src-tauri/src/setup.rs` | The tour's work: the scan, the downloads, connecting the agents |
| `src-tauri/capabilities/` | What each window may call: the tour its commands, Roger's page its own |
| `ui-src/` | The setup tour's screens (React), built into `ui/` |

Files live in `~/.airband`: `desktop-lite.json` (settings), `desktop-lite.log` (what it did),
`runtime/node` (its own Node.js, when it fetched one) and `engine/package` (the engine).

## Build

From the repository's root, with Rust installed:

```bash
npm ci && npm --prefix desktop-lite ci
npm run lite:build                  # both Mac downloads, into desktop-lite/release/
npm run lite:build:windows          # the Windows installer, on Windows
npm run lite:build:windows-on-mac   # the Windows installer, from a Mac
```

Building for Windows on a Mac needs `brew install nsis llvm lld`, `cargo install cargo-xwin` and
`rustup target add x86_64-pc-windows-msvc`. cargo-xwin downloads Microsoft's Windows build files
on its first run, which accepts their license.

`AIRBAND_ENGINE_DIR=<folder>` runs a local engine (a built `npm-dist/`) instead of the one from
npm. The app itself takes `--check scan|node|engine|connect` and runs that one step of the setup.
