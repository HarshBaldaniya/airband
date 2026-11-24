// Airband's desktop app, small: the system's own web view (WebKit on macOS, WebView2 on Windows)
// instead of a browser of its own. It shows Roger's corner, the menu-bar or tray icon, and the
// first-run setup tour. The work is done by Airband's engine (the Station, `airband station`),
// which the setup tour fetches and this app keeps running.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod cli;
mod commands;
mod corner;
mod engine;
mod env;
mod install;
mod logging;
mod macos;
mod paths;
mod prefs;
mod process;
mod setup;
mod state;
mod station;
mod tray;
mod uninstall;
mod update;

fn main() {
    env::clean();
    if let Some(code) = cli::run() {
        std::process::exit(code);
    }
    // Started from the disk image: move to Applications and start from there.
    install::offer_move();
    app::run();
}
