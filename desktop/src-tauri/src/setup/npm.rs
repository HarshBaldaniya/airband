//! Airband's engine, the `airband` package on npm.
use super::download::{download, fetch_text, sha512_b64, untar, Progress, Step};
use crate::engine;
use crate::error::Result;
use crate::paths::engine_dir;

/// Where npm says what its newest `airband` is.
const LATEST: &str = "https://registry.npmjs.org/airband/latest";
/// npm's own address: a tarball anywhere else is refused.
const REGISTRY: &str = "https://registry.npmjs.org/";
/// About how big the engine's download is, for the progress until curl knows.
const EXPECTED_SIZE: u64 = 1_600_000;

/// The newest engine on npm, as npm describes it.
pub struct NpmRelease {
    pub version: String,
    tarball: String,
    /// The tarball's sha512, base64 (npm's "integrity", without its "sha512-").
    integrity: String,
}

/// The engine's version, from its package.json.
pub fn engine_version() -> Option<String> {
    let pkg = engine::engine_js().parent()?.join("package.json");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(pkg).ok()?).ok()?;
    v["version"].as_str().map(String::from)
}

/// Asks npm for its newest engine.
pub fn latest() -> Result<NpmRelease> {
    let meta: serde_json::Value = serde_json::from_str(&fetch_text(LATEST)?).map_err(|_| "npm's answer didn't read")?;
    let version = meta["version"].as_str().ok_or("no version on npm")?.to_string();
    let tarball = meta["dist"]["tarball"].as_str().ok_or("no package on npm")?.to_string();
    let integrity = meta["dist"]["integrity"]
        .as_str()
        .and_then(|i| i.strip_prefix("sha512-"))
        .ok_or("no fingerprint on npm")?
        .to_string();
    if !tarball.starts_with(REGISTRY) {
        return Err("the package isn't on npm's own address".into());
    }
    Ok(NpmRelease { version, tarball, integrity })
}

/// The newest engine from npm, into ~/.airband/engine. With AIRBAND_ENGINE_DIR (development), the
/// engine there is used as it is.
pub fn engine_from_npm(progress: Progress) -> Result<String> {
    if std::env::var("AIRBAND_ENGINE_DIR").is_ok() {
        return engine_version().ok_or_else(|| "AIRBAND_ENGINE_DIR has no airband package".into());
    }
    install(&latest()?, progress)
}

/// Downloads `release`, checks it against npm's fingerprint, and puts it in place.
pub fn install(release: &NpmRelease, progress: Progress) -> Result<String> {
    let dir = engine_dir();
    std::fs::create_dir_all(&dir)?;
    let archive = dir.join(format!("airband-{}.tgz", release.version));
    download(progress, &release.tarball, &archive, Step::Engine, EXPECTED_SIZE)?;
    if sha512_b64(&archive)? != release.integrity {
        let _ = std::fs::remove_file(&archive);
        return Err("the download didn't match npm's fingerprint, so it was thrown away. Try again.".into());
    }
    // Unpacked beside the one in use, then swapped in, so a running Station never reads a half.
    let next = dir.join("next");
    let _ = std::fs::remove_dir_all(&next);
    untar(&archive, &next)?;
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_dir_all(dir.join("package"));
    std::fs::rename(next.join("package"), dir.join("package"))?;
    let _ = std::fs::remove_dir_all(&next);
    Ok(release.version.clone())
}
