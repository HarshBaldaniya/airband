//! The app's settings, ~/.airband/app.json.
use crate::paths::{self, PREFS};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub sound: bool,
    pub notify: bool,
    pub start_at_login: bool,
    pub hidden: bool,
    pub tucked: bool,
    pub greeted: bool,
    /// The setup tour was finished on this computer.
    pub set_up: bool,
    /// Where the window was left (logical pixels).
    pub window_at: Option<(f64, f64)>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            sound: true,
            notify: true,
            start_at_login: true,
            hidden: false,
            tucked: false,
            greeted: false,
            set_up: false,
            window_at: None,
        }
    }
}

fn prefs_file() -> PathBuf {
    paths::file(PREFS)
}

/// The app's settings, or the defaults when there are none yet.
pub fn load_prefs() -> Prefs {
    fs::read_to_string(prefs_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save_prefs(p: &Prefs) {
    let _ = fs::create_dir_all(paths::home());
    if let Ok(t) = serde_json::to_string_pretty(p) {
        let tmp = prefs_file().with_extension("tmp");
        if fs::write(&tmp, t).is_ok() {
            let _ = fs::rename(tmp, prefs_file());
        }
    }
}

/// The prefs the Station's page knows, by the names it uses.
pub fn prefs_view(p: &Prefs) -> serde_json::Value {
    serde_json::json!({ "sound": p.sound, "notify": p.notify, "startAtLogin": p.start_at_login, "tucked": p.tucked, "greeted": p.greeted })
}

pub fn login_item(app: &AppHandle, on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) {
        return;
    }
    let l = app.autolaunch();
    let _ = if on { l.enable() } else { l.disable() };
}
