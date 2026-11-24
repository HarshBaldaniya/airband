//! Node.js from nodejs.org.
use super::download::{download, fetch_text, sha256_hex, untar, Progress};
use crate::paths::home;

pub fn node_from_nodejs(progress: Progress) -> Result<String, String> {
    let index: serde_json::Value = serde_json::from_str(&fetch_text("https://nodejs.org/dist/index.json")?)
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
    let base = format!("https://nodejs.org/dist/{version}");
    let sums = fetch_text(&format!("{base}/SHASUMS256.txt"))?;
    let want = sums
        .lines()
        .find(|l| l.ends_with(&format!("  {name}")))
        .and_then(|l| l.split_whitespace().next())
        .ok_or("no fingerprint for this computer's Node")?
        .to_string();
    let runtime = home().join("runtime");
    std::fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let archive = runtime.join(&name);
    download(progress, &format!("{base}/{name}"), &archive, "node", 50_000_000)?;
    if sha256_hex(&archive)? != want {
        let _ = std::fs::remove_file(&archive);
        return Err("the download didn't match nodejs.org's fingerprint, so it was thrown away. Try again.".into());
    }
    let _ = std::fs::remove_dir_all(runtime.join(&inner));
    untar(&archive, &runtime)?;
    let _ = std::fs::remove_file(&archive);
    let dest = runtime.join("node");
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(runtime.join(&inner), &dest).map_err(|e| e.to_string())?;
    Ok(version)
}
