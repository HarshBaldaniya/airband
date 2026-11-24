//! Downloads with the computer's own curl, checked, and unpacked with its own tar.
use crate::process::hide_window;
use base64::Engine as _;
use sha2::{Digest, Sha256, Sha512};
use std::path::Path;
use std::process::Command;

fn curl() -> Command {
    let mut c = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    c.args(["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "2"]);
    hide_window(&mut c);
    c
}

pub fn fetch_text(url: &str) -> Result<String, String> {
    let out = curl().arg(url).output().map_err(|e| format!("couldn't run curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("couldn't reach {}", url.split('/').nth(2).unwrap_or(url)));
    }
    String::from_utf8(out.stdout).map_err(|_| "an answer that isn't text".into())
}

/// Downloads `url` to `to`, telling the tour how far it is (by the file's size so far).
pub type Progress<'a> = &'a dyn Fn(&str, u64, u64);

pub fn download(progress: Progress, url: &str, to: &Path, step: &str, total: u64) -> Result<(), String> {
    let _ = std::fs::remove_file(to);
    let mut child = curl().arg("-o").arg(to).arg(url).spawn().map_err(|e| format!("couldn't run curl: {e}"))?;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let got = std::fs::metadata(to).map(|m| m.len()).unwrap_or(0);
        progress(step, got, total);
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err("the download stopped. Check the internet connection and try again.".into());
            }
            return Ok(());
        }
    }
}

pub fn sha256_hex(file: &Path) -> Result<String, String> {
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    Ok(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

pub fn sha512_b64(file: &Path) -> Result<String, String> {
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(Sha512::digest(&bytes)))
}

pub fn untar(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    let mut c = Command::new("tar");
    c.arg(if archive.extension().and_then(|e| e.to_str()) == Some("zip") { "-xf" } else { "-xzf" })
        .arg(archive)
        .arg("-C")
        .arg(into);
    hide_window(&mut c);
    let out = c.output().map_err(|e| format!("couldn't run tar: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("couldn't unpack: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}
