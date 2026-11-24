//! The first-run setup tour: it looks at this computer (Node, Claude Code, Codex, Gemini CLI, VS Code,
//! Cursor), fetches what is missing that it can (Node from nodejs.org, Airband's engine from npm, each
//! checked against its published fingerprint), connects the agents, and shows how to use Roger.
//! Downloads use the computer's own curl and tar (on Windows 10 and 11 too), so the app stays small.
mod download;
mod node;
mod npm;
mod scan;

use crate::engine::{self};
use crate::process::hide_window;
use std::process::Command;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub use node::node_from_nodejs;
pub use npm::{engine_from_npm, engine_version, latest_engine};
pub use scan::{look, Scan};

pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("setup") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let b = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("setup.html".into()))
        .title("Set up Airband")
        .inner_size(500.0, 560.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .focused(true);
    // On a Mac: no title bar, the traffic lights over the page, as Apple's own setup windows.
    #[cfg(target_os = "macos")]
    let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let _ = b.build();
}

pub fn connect() -> Result<serde_json::Value, String> {
    let node = engine::node().ok_or("Node isn't there yet")?;
    let mut c = Command::new(&node);
    c.arg(engine::engine_js()).args(["setup", "--json"]).arg("--node").arg(&node);
    hide_window(&mut c);
    let out = c.output().map_err(|e| format!("couldn't start Airband's engine: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let start = text.find('{').ok_or("the engine said nothing")?;
    serde_json::from_str(&text[start..]).map_err(|_| "the engine's answer didn't read".into())
}
