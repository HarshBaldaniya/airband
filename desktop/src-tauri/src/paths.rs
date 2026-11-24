//! Where Airband keeps its files.
use std::path::PathBuf;

/// ~/.airband, or AIRBAND_HOME.
pub fn home() -> PathBuf {
    if let Ok(h) = std::env::var("AIRBAND_HOME") {
        return PathBuf::from(h);
    }
    let base = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".airband")
}
