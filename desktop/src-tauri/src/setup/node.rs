//! Node.js from nodejs.org: the current long-term version, into ~/.airband/runtime/node, checked
//! against nodejs.org's own list of fingerprints (SHASUMS256.txt).
use super::download::{download, fetch_text, sha256_hex, untar, Progress, Step};
use crate::error::Result;
use crate::paths::runtime_dir;

const DIST: &str = "https://nodejs.org/dist";
/// About how big Node's download is, for the progress until curl knows.
const EXPECTED_SIZE: u64 = 50_000_000;

pub fn node_from_nodejs(progress: Progress) -> Result<String> {
    let index: serde_json::Value = serde_json::from_str(&fetch_text(&format!("{DIST}/index.json"))?)
        .map_err(|_| "nodejs.org's list didn't read")?;
    let lts = index
        .as_array()
        .and_then(|a| a.iter().find(|r| r["lts"].is_string()))
        .ok_or("no long-term Node version listed")?;
    let version = lts["version"].as_str().ok_or("no version")?.to_string();
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    let (name, inner) = if cfg!(windows) {
        (format!("node-{version}-win-{arch}.zip"), format!("node-{version}-win-{arch}"))
    } else {
        (format!("node-{version}-darwin-{arch}.tar.gz"), format!("node-{version}-darwin-{arch}"))
    };
    let base = format!("{DIST}/{version}");
    let sums = fetch_text(&format!("{base}/SHASUMS256.txt"))?;
    let want = sums
        .lines()
        .find(|l| l.ends_with(&format!("  {name}")))
        .and_then(|l| l.split_whitespace().next())
        .ok_or("no fingerprint for this computer's Node")?
        .to_string();
    let runtime = runtime_dir();
    std::fs::create_dir_all(&runtime)?;
    let archive = runtime.join(&name);
    download(progress, &format!("{base}/{name}"), &archive, Step::Node, EXPECTED_SIZE)?;
    if sha256_hex(&archive)? != want {
        let _ = std::fs::remove_file(&archive);
        return Err("the download didn't match nodejs.org's fingerprint, so it was thrown away. Try again.".into());
    }
    let _ = std::fs::remove_dir_all(runtime.join(&inner));
    untar(&archive, &runtime)?;
    let _ = std::fs::remove_file(&archive);
    let dest = runtime.join("node");
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(runtime.join(&inner), &dest)?;
    Ok(version)
}
