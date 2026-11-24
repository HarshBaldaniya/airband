//! Airband's engine, the `airband` package on npm.
use super::download::{download, fetch_text, sha512_b64, untar, Progress};
use crate::engine;
use crate::paths::home;

/// The engine's version, from its package.json.
pub fn engine_version() -> Option<String> {
    let pkg = engine::engine_js().parent()?.join("package.json");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(pkg).ok()?).ok()?;
    v["version"].as_str().map(String::from)
}

/// The newest engine on npm.
pub fn latest_engine() -> Result<String, String> {
    let meta: serde_json::Value = serde_json::from_str(&fetch_text("https://registry.npmjs.org/airband/latest")?)
        .map_err(|_| "npm's answer didn't read")?;
    meta["version"].as_str().map(String::from).ok_or_else(|| "no version on npm".into())
}

pub fn engine_from_npm(progress: Progress) -> Result<String, String> {
    if std::env::var("AIRBAND_ENGINE_DIR").is_ok() {
        return engine_version().ok_or_else(|| "AIRBAND_ENGINE_DIR has no airband package".into());
    }
    let meta: serde_json::Value = serde_json::from_str(&fetch_text("https://registry.npmjs.org/airband/latest")?)
        .map_err(|_| "npm's answer didn't read")?;
    let version = meta["version"].as_str().ok_or("no version on npm")?.to_string();
    let tarball = meta["dist"]["tarball"].as_str().ok_or("no package on npm")?.to_string();
    let integrity = meta["dist"]["integrity"]
        .as_str()
        .and_then(|i| i.strip_prefix("sha512-"))
        .ok_or("no fingerprint on npm")?
        .to_string();
    if !tarball.starts_with("https://registry.npmjs.org/") {
        return Err("the package isn't on npm's own address".into());
    }
    let dir = home().join("engine");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let archive = dir.join(format!("airband-{version}.tgz"));
    download(progress, &tarball, &archive, "engine", 1_600_000)?;
    if sha512_b64(&archive)? != integrity {
        let _ = std::fs::remove_file(&archive);
        return Err("the download didn't match npm's fingerprint, so it was thrown away. Try again.".into());
    }
    // Unpacked beside the one in use, then swapped in, so a running Station never reads a half.
    let next = dir.join("next");
    let _ = std::fs::remove_dir_all(&next);
    untar(&archive, &next)?;
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_dir_all(dir.join("package"));
    std::fs::rename(next.join("package"), dir.join("package")).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&next);
    Ok(version)
}
