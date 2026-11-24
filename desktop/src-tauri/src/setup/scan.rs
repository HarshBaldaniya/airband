//! What is on this computer, and what is not.
use super::engine_version;
use crate::engine::{self, NODE_MIN};
use crate::paths::user_home;
use crate::process::{find_command, major, version_of};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Found {
    name: &'static str,
    found: bool,
    detail: Option<String>,
    /// Where to get it.
    link: &'static str,
}

#[derive(Serialize)]
pub struct Scan {
    os: &'static str,
    /// The Node found (Airband's own first), whatever its version.
    node: Option<String>,
    /// It is new enough for the engine.
    node_ok: bool,
    node_min: u32,
    /// The Node is the one Airband fetched.
    own_node: bool,
    engine: Option<String>,
    agents: Vec<Found>,
    editors: Vec<Found>,
}

fn app_exists(mac: &str, win_dirs: &[&str]) -> bool {
    if cfg!(target_os = "macos") {
        return Path::new(mac).exists()
            || user_home().join("Applications").join(Path::new(mac).file_name().unwrap_or_default()).exists();
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let pf = std::env::var("ProgramFiles").unwrap_or_default();
    win_dirs.iter().any(|d| Path::new(&local).join(d).exists() || Path::new(&pf).join(d).exists())
}

pub fn look() -> Scan {
    let own = engine::own_node();
    let node = if own.exists() { Some(own.clone()) } else { find_command("node") };
    let node_version = node.as_deref().and_then(version_of);
    let node_ok = node_version.as_deref().and_then(major).is_some_and(|m| m >= NODE_MIN);
    let agent = |name: &'static str, cmd: &str, link: &'static str| {
        let p = find_command(cmd);
        Found { name, found: p.is_some(), detail: p.as_deref().and_then(version_of), link }
    };
    Scan {
        os: if cfg!(target_os = "macos") {
            "mac"
        } else if cfg!(windows) {
            "windows"
        } else {
            "linux"
        },
        node: node_version,
        node_ok,
        node_min: NODE_MIN,
        own_node: node.as_deref() == Some(own.as_path()),
        engine: engine_version(),
        agents: vec![
            agent("Claude Code", "claude", "https://claude.com/product/claude-code"),
            agent("Codex", "codex", "https://developers.openai.com/codex/cli"),
            agent("Gemini CLI", "gemini", "https://geminicli.com"),
        ],
        editors: vec![
            Found {
                name: "VS Code",
                found: app_exists(
                    "/Applications/Visual Studio Code.app",
                    &["Programs\\Microsoft VS Code", "Microsoft VS Code"],
                ),
                detail: None,
                link: "https://code.visualstudio.com",
            },
            Found {
                name: "Cursor",
                found: app_exists("/Applications/Cursor.app", &["Programs\\cursor", "cursor"]),
                detail: None,
                link: "https://cursor.com",
            },
        ],
    }
}
