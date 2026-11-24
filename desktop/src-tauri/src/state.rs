//! What the app keeps while it runs, and how the modules below the app tell it what happened.
use crate::prefs::Prefs;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tauri::{AppHandle, Manager};

/// A part of the page that takes clicks (logical pixels in the window).
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }
}

/// Which way Roger's cards open, towards the middle of the screen.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Vertical {
    Top,
    Bottom,
}

/// What the app keeps while it runs.
pub struct Shared {
    pub prefs: Prefs,
    /// The screen's clickable parts.
    pub hits: Vec<Rect>,
    /// Clicks pass through right now.
    pub passing: bool,
    pub asleep: bool,
    pub side: Side,
    pub vertical: Vertical,
}

impl Shared {
    pub fn new(prefs: Prefs) -> Self {
        Shared { prefs, hits: vec![], passing: true, asleep: false, side: Side::Right, vertical: Vertical::Bottom }
    }
}

pub type AppState = Arc<Mutex<Shared>>;

/// Locks a mutex. A thread that panicked while holding it leaves the data as it was, which is
/// still good to use: the app goes on rather than panicking on every lock after.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Writes the settings as they are now. The file is written outside the state's lock, so the
/// pointer watcher and the page's calls never wait on the disk; one save runs at a time, and each
/// writes the newest settings, so the last one written is always the newest.
pub fn save_prefs(state: &AppState) {
    static SAVING: Mutex<()> = Mutex::new(());
    let _one_at_a_time = lock(&SAVING);
    let prefs = lock(state).prefs.clone();
    prefs.save();
}

/// How the modules below the app tell it something happened, without knowing the menu or the
/// corner: app.rs fills these in.
#[derive(Clone, Copy)]
pub struct Hooks {
    /// Something the menu shows has changed (an update, the setup, the engine).
    pub menu_changed: fn(&AppHandle),
    /// The Station is up at this address: Roger's corner opens on it.
    pub station_up: fn(&AppHandle, String),
}

pub fn hooks(app: &AppHandle) -> Hooks {
    *app.state::<Hooks>().inner()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rect_holds_its_edges() {
        let r = Rect { x: 10.0, y: 10.0, width: 5.0, height: 5.0 };
        assert!(r.contains(10.0, 15.0) && r.contains(12.0, 12.0));
        assert!(!r.contains(9.9, 12.0) && !r.contains(12.0, 15.1));
    }

    #[test]
    fn sides_reach_the_page_as_words() {
        assert_eq!(serde_json::to_string(&Side::Right).unwrap(), r#""right""#);
        assert_eq!(serde_json::to_string(&Vertical::Top).unwrap(), r#""top""#);
    }
}
