//! The app's own short log, ~/.airband/app.log.
use crate::paths::home;
use std::fs;

/// Set once Airband is being uninstalled.
pub static LOG_OFF: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A short log of what the app did (~/.airband/app.log), for when something goes wrong.
/// Kept small: started again past 200 KB.
pub fn log(line: &str) {
    use std::io::Write;
    // Uninstalling: ~/.airband is going, and a log line would make it again.
    if LOG_OFF.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let f = home().join("app.log");
    let _ = fs::create_dir_all(home());
    if fs::metadata(&f).map(|m| m.len() > 200_000).unwrap_or(false) {
        let _ = fs::remove_file(&f);
    }
    if let Ok(mut out) = fs::OpenOptions::new().create(true).append(true).open(&f) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(out, "{secs} {line}");
    }
}
