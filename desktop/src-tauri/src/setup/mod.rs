//! The first-run setup tour: it looks at this computer (Node, Claude Code, Codex, Gemini CLI, VS Code,
//! Cursor), fetches what is missing that it can (Node from nodejs.org, Airband's engine from npm, each
//! checked against its published fingerprint), connects the agents, and shows how to use Roger.
//! Downloads use the computer's own curl and tar (on Windows 10 and 11 too), so the app stays small.
mod download;
mod node;
mod npm;
mod scan;

use crate::engine;
use crate::error::Result;
use crate::process::command;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub use download::Step;
pub use node::node_from_nodejs;
pub use npm::{engine_from_npm, engine_version};
pub use npm::{install as install_engine, latest as latest_engine};
pub use scan::{look, Scan};

/// The tour's window label (capabilities/default.json grants the tour's commands to it).
pub const LABEL: &str = "setup";
/// The tour's window, in logical pixels.
const SIZE: (f64, f64) = (500.0, 560.0);
/// How far a download is: `{ step, got, total }`.
const PROGRESS_EVENT: &str = "setup-progress";

/// Turns a download's progress into the tour's progress events.
pub fn progress_to(app: &AppHandle) -> impl Fn(Step, u64, u64) + '_ {
    move |step, got, total| {
        let _ = app.emit(PROGRESS_EVENT, serde_json::json!({ "step": step, "got": got, "total": total }));
    }
}

/// Opens the setup tour, or brings it to the front.
pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("setup.html".into()))
        .title("Set up Airband")
        .inner_size(SIZE.0, SIZE.1)
        .resizable(false)
        .maximizable(false)
        .center()
        .focused(true);
    // On a Mac: no title bar, the traffic lights over the page, as Apple's own setup windows.
    #[cfg(target_os = "macos")]
    let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let _ = b.build();
}

/// Closes the setup tour, if it is open.
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

/// Connects Airband to the agents found: its hook, tools and skills, and the `airband` command
/// (the engine's own setup, as `npx airband` runs it). Returns what the engine says it did.
pub fn connect() -> Result<serde_json::Value> {
    let node = engine::node().ok_or("Node isn't there yet")?;
    let out = command(&node)
        .arg(engine::engine_js())
        .args(["setup", "--json"])
        .arg("--node")
        .arg(&node)
        .output()
        .map_err(|e| format!("couldn't start Airband's engine: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let start = text.find('{').ok_or("the engine said nothing")?;
    serde_json::from_str(&text[start..]).map_err(|_| "the engine's answer didn't read".into())
}
