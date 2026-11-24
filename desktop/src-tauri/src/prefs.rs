//! The app's settings, ~/.airband/app.json. The keys in the file are camelCase and never change:
//! every version of the app reads the same file.
use crate::paths::{self, PREFS};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
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

/// A setting the Station's page may change, by the name the page uses.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrefKey {
    Sound,
    Notify,
    StartAtLogin,
    Tucked,
    Greeted,
}

/// The settings the Station's page knows, by the names it uses.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PagePrefs {
    pub sound: bool,
    pub notify: bool,
    pub start_at_login: bool,
    pub tucked: bool,
    pub greeted: bool,
}

impl Prefs {
    pub fn get(&self, key: PrefKey) -> bool {
        match key {
            PrefKey::Sound => self.sound,
            PrefKey::Notify => self.notify,
            PrefKey::StartAtLogin => self.start_at_login,
            PrefKey::Tucked => self.tucked,
            PrefKey::Greeted => self.greeted,
        }
    }

    pub fn set(&mut self, key: PrefKey, on: bool) {
        let field = match key {
            PrefKey::Sound => &mut self.sound,
            PrefKey::Notify => &mut self.notify,
            PrefKey::StartAtLogin => &mut self.start_at_login,
            PrefKey::Tucked => &mut self.tucked,
            PrefKey::Greeted => &mut self.greeted,
        };
        *field = on;
    }

    pub fn for_page(&self) -> PagePrefs {
        PagePrefs {
            sound: self.sound,
            notify: self.notify,
            start_at_login: self.start_at_login,
            tucked: self.tucked,
            greeted: self.greeted,
        }
    }

    /// The settings on this computer, or the defaults when there are none yet.
    pub fn load() -> Prefs {
        fs::read_to_string(paths::file(PREFS)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    /// Writes them beside the file, then swaps it in, so a crash never leaves half a file.
    pub fn save(&self) {
        let file = paths::file(PREFS);
        let _ = fs::create_dir_all(paths::home());
        if let Ok(t) = serde_json::to_string_pretty(self) {
            let tmp = file.with_extension("tmp");
            if fs::write(&tmp, t).is_ok() {
                let _ = fs::rename(tmp, file);
            }
        }
    }
}

/// Starts the app at login, or stops doing so. Never while developing: it would start the build.
pub fn apply_start_at_login(app: &AppHandle, on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) {
        return;
    }
    let l = app.autolaunch();
    let _ = if on { l.enable() } else { l.disable() };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_file_every_version_writes() {
        let p: Prefs =
            serde_json::from_str(r#"{"sound":false,"startAtLogin":false,"setUp":true,"windowAt":[10.0,20.0]}"#)
                .unwrap();
        assert!(!p.sound && p.notify && !p.start_at_login && p.set_up);
        assert_eq!(p.window_at, Some((10.0, 20.0)));
        let back = serde_json::to_value(&p).unwrap();
        for key in ["sound", "notify", "startAtLogin", "hidden", "tucked", "greeted", "setUp", "windowAt"] {
            assert!(back.get(key).is_some(), "{key}");
        }
    }

    #[test]
    fn the_page_names_its_settings_as_before() {
        let key: PrefKey = serde_json::from_str(r#""startAtLogin""#).unwrap();
        let mut p = Prefs::default();
        p.set(key, false);
        assert!(!p.get(PrefKey::StartAtLogin));
        let page = serde_json::to_value(p.for_page()).unwrap();
        let before = serde_json::json!({
            "sound": true, "notify": true, "startAtLogin": false, "tucked": false, "greeted": false
        });
        assert_eq!(page, before);
    }
}
