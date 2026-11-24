//! A short log of what the app did (~/.airband/app.log), for when something goes wrong.
use crate::paths::{self, APP_LOG};
use std::fs;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// The log is started again once it is past this size, so it stays small.
const MAX_BYTES: u64 = 200_000;

/// Set once Airband is being uninstalled: ~/.airband is going, and a log line would make it again.
static STOPPED: AtomicBool = AtomicBool::new(false);

/// Writes one line, after the time in seconds.
pub fn log(line: &str) {
    if STOPPED.load(Ordering::Relaxed) {
        return;
    }
    let f = paths::file(APP_LOG);
    let _ = fs::create_dir_all(paths::home());
    if fs::metadata(&f).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = fs::remove_file(&f);
    }
    if let Ok(mut out) = fs::OpenOptions::new().create(true).append(true).open(&f) {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(out, "{secs} {line}");
    }
}

/// No more lines from here on.
pub fn stop() {
    STOPPED.store(true, Ordering::Relaxed);
}
