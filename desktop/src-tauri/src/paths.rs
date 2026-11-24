//! Where Airband keeps its files. The names are read by the engine and by earlier versions of the
//! app too, so they never change.
use std::path::PathBuf;

/// The app's settings.
pub const PREFS: &str = "app.json";
/// The app's own log.
pub const APP_LOG: &str = "app.log";
/// What the engine writes to its error output.
pub const ENGINE_LOG: &str = "engine.log";
/// Written by a running Station: its port, key and process.
pub const STATION: &str = "station.json";
/// The engine's settings (the companion's name is read from it).
pub const STATION_SETTINGS: &str = "station-settings.json";
/// Written just before an app update goes in place, read once by the new app.
pub const UPDATED: &str = "updated.json";

/// The person's home folder: HOME, or USERPROFILE on Windows.
pub fn user_home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into()))
}

/// ~/.airband, or AIRBAND_HOME.
pub fn home() -> PathBuf {
    match std::env::var("AIRBAND_HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => user_home().join(".airband"),
    }
}

/// A file in ~/.airband.
pub fn file(name: &str) -> PathBuf {
    home().join(name)
}

/// Where the engine package is unpacked: ~/.airband/engine.
pub fn engine_dir() -> PathBuf {
    home().join("engine")
}

/// Where the Node.js the setup fetched is unpacked: ~/.airband/runtime.
pub fn runtime_dir() -> PathBuf {
    home().join("runtime")
}
