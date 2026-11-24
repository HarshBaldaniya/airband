//! ~/.airband/station.json: what a running Station (the engine's server) says about itself.
use crate::paths::{self, STATION};
use serde::Deserialize;
use std::time::SystemTime;

#[derive(Deserialize, Debug, PartialEq)]
pub struct StationFile {
    pub port: Option<u16>,
    /// The key the Station's page needs in its address.
    pub token: Option<String>,
    pub pid: Option<u32>,
}

impl StationFile {
    /// The file as it is, if there is one that reads.
    pub fn read() -> Option<StationFile> {
        serde_json::from_str(&std::fs::read_to_string(paths::file(STATION)).ok()?).ok()
    }

    /// The file, only if it was written at `since` or later.
    pub fn written_since(since: SystemTime) -> Option<StationFile> {
        let written = std::fs::metadata(paths::file(STATION)).and_then(|m| m.modified()).ok()?;
        (written >= since).then(StationFile::read).flatten()
    }

    /// Where Roger's corner opens: the Station's page for the desktop, on this computer.
    pub fn page(&self) -> Option<String> {
        Some(format!("http://127.0.0.1:{}/app?mode=desktop&t={}", self.port?, self.token.as_deref()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_station_writes() {
        let f: StationFile = serde_json::from_str(r#"{"port":4123,"token":"k","pid":77,"version":"0.1.6"}"#).unwrap();
        assert_eq!(f.page().as_deref(), Some("http://127.0.0.1:4123/app?mode=desktop&t=k"));
        assert_eq!(f.pid, Some(77));
    }

    #[test]
    fn a_file_without_a_port_has_no_page() {
        let f: StationFile = serde_json::from_str(r#"{"pid":77}"#).unwrap();
        assert_eq!(f.page(), None);
        assert_eq!(f.pid, Some(77));
    }
}
