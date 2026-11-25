//! Downloads with the computer's own curl, checked, and unpacked with its own tar.
use crate::error::Result;
use crate::process::command;
use base64::Engine as _;
use serde::Serialize;
use sha2::{Digest, Sha256, Sha512};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

/// How often a download's size so far is looked at, for its progress.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// What is downloading, as the tour names its lines.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Node,
    Engine,
}

impl Step {
    pub fn name(self) -> &'static str {
        match self {
            Step::Node => "node",
            Step::Engine => "engine",
        }
    }
}

/// Told how far a download is: the step, the bytes so far, and about how many there will be.
pub type Progress<'a> = &'a dyn Fn(Step, u64, u64);

/// curl, https only, with a modern TLS and a couple of retries.
fn curl() -> Command {
    let mut c = command(if cfg!(windows) { "curl.exe" } else { "curl" });
    c.args(["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "2"]);
    c
}

pub fn fetch_text(url: &str) -> Result<String> {
    let out = curl().arg(url).output().map_err(|e| format!("couldn't run curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("couldn't reach {}", url.split('/').nth(2).unwrap_or(url)).into());
    }
    String::from_utf8(out.stdout).map_err(|_| "an answer that isn't text".into())
}

/// Downloads `url` to `to`, telling `progress` how far it is (by the file's size so far, against
/// `total`, about the size it will be).
pub fn download(progress: Progress, url: &str, to: &Path, step: Step, total: u64) -> Result<()> {
    let _ = std::fs::remove_file(to);
    let mut child = curl().arg("-o").arg(to).arg(url).spawn().map_err(|e| format!("couldn't run curl: {e}"))?;
    loop {
        std::thread::sleep(PROGRESS_EVERY);
        let got = std::fs::metadata(to).map(|m| m.len()).unwrap_or(0);
        progress(step, got, total);
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err("the download stopped. Check the internet connection and try again.".into());
            }
            return Ok(());
        }
    }
}

pub fn sha256_hex(file: &Path) -> Result<String> {
    let bytes = std::fs::read(file)?;
    Ok(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

pub fn sha512_b64(file: &Path) -> Result<String> {
    let bytes = std::fs::read(file)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(Sha512::digest(&bytes)))
}

/// Unpacks a .tar.gz, .tgz or .zip (Windows' own tar reads zips too).
pub fn untar(archive: &Path, into: &Path) -> Result<()> {
    std::fs::create_dir_all(into)?;
    let zip = archive.extension().and_then(|e| e.to_str()) == Some("zip");
    let out = command("tar")
        .arg(if zip { "-xf" } else { "-xzf" })
        .arg(archive)
        .arg("-C")
        .arg(into)
        .output()
        .map_err(|e| format!("couldn't run tar: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("couldn't unpack: {}", String::from_utf8_lossy(&out.stderr).trim()).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The checks every download goes through give the published digests, whatever version of
    /// sha2 and base64 is in use: "abc" is the standard test vector.
    #[test]
    fn digests_match_the_published_ones() {
        let file = std::env::temp_dir().join(format!("airband-digest-{}", std::process::id()));
        std::fs::write(&file, b"abc").unwrap();
        let sha256 = sha256_hex(&file).unwrap();
        let sha512 = sha512_b64(&file).unwrap();
        std::fs::remove_file(&file).unwrap();
        assert_eq!(sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(sha512, "3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==");
    }
}
