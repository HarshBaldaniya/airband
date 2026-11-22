// The first-run setup tour: it looks at this computer (Node, Claude Code, Codex, Gemini CLI, VS Code,
// Cursor), fetches what is missing that it can (Node from nodejs.org, Airband's engine from npm, each
// checked against its published fingerprint), connects the agents, and shows how to use Roger.
// Downloads use the computer's own curl and tar (on Windows 10 and 11 too), so the app stays small.
use crate::engine::{self, find_command, hide_window, version_of, NODE_MIN};
use crate::{home, save_prefs, State};
use base64::Engine as _;
use serde::Serialize;
use sha2::{Digest, Sha256, Sha512};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("setup") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let b = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("setup.html".into()))
        .title("Set up Airband")
        .inner_size(500.0, 560.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .focused(true);
    // On a Mac: no title bar, the traffic lights over the page, as Apple's own setup windows.
    #[cfg(target_os = "macos")]
    let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let _ = b.build();
}

#[derive(Serialize)]
pub struct Found {
    name: &'static str,
    found: bool,
    detail: Option<String>,
    /// Where to get it.
    link: &'static str,
}

#[derive(Serialize)]
pub struct Scan {
    os: &'static str,
    /// The Node found (Airband's own first), whatever its version.
    node: Option<String>,
    /// It is new enough for the engine.
    node_ok: bool,
    node_min: u32,
    /// The Node is the one Airband fetched.
    own_node: bool,
    engine: Option<String>,
    agents: Vec<Found>,
    editors: Vec<Found>,
}

fn app_exists(mac: &str, win_dirs: &[&str]) -> bool {
    if cfg!(target_os = "macos") {
        return Path::new(mac).exists() || home_dir().join("Applications").join(Path::new(mac).file_name().unwrap_or_default()).exists();
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let pf = std::env::var("ProgramFiles").unwrap_or_default();
    win_dirs.iter().any(|d| Path::new(&local).join(d).exists() || Path::new(&pf).join(d).exists())
}

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into()))
}

/// The engine's version, from its package.json.
pub fn engine_version() -> Option<String> {
    let pkg = engine::engine_js().parent()?.join("package.json");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(pkg).ok()?).ok()?;
    v["version"].as_str().map(String::from)
}

/// What is on this computer, and what is not.
#[tauri::command]
pub async fn scan() -> Scan {
    look()
}

pub fn look() -> Scan {
    let own = engine::own_node();
    let node = if own.exists() { Some(own.clone()) } else { engine::system_node() };
    let node_version = node.as_deref().and_then(version_of);
    let node_ok = node_version.as_deref().and_then(engine::major).is_some_and(|m| m >= NODE_MIN);
    let agent = |name: &'static str, cmd: &str, link: &'static str| {
        let p = find_command(cmd);
        Found { name, found: p.is_some(), detail: p.as_deref().and_then(version_of), link }
    };
    Scan {
        os: if cfg!(target_os = "macos") { "mac" } else if cfg!(windows) { "windows" } else { "linux" },
        node: node_version,
        node_ok,
        node_min: NODE_MIN,
        own_node: node.as_deref() == Some(own.as_path()),
        engine: engine_version(),
        agents: vec![
            agent("Claude Code", "claude", "https://claude.com/product/claude-code"),
            agent("Codex", "codex", "https://github.com/openai/codex"),
            agent("Gemini CLI", "gemini", "https://github.com/google-gemini/gemini-cli"),
        ],
        editors: vec![
            Found { name: "VS Code", found: app_exists("/Applications/Visual Studio Code.app", &["Programs\\Microsoft VS Code", "Microsoft VS Code"]), detail: None, link: "https://code.visualstudio.com" },
            Found { name: "Cursor", found: app_exists("/Applications/Cursor.app", &["Programs\\cursor", "cursor"]), detail: None, link: "https://cursor.com" },
        ],
    }
}

// ---- downloads ----

fn curl() -> Command {
    let mut c = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    c.args(["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "2"]);
    hide_window(&mut c);
    c
}

fn fetch_text(url: &str) -> Result<String, String> {
    let out = curl().arg(url).output().map_err(|e| format!("couldn't run curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("couldn't reach {}", url.split('/').nth(2).unwrap_or(url)));
    }
    String::from_utf8(out.stdout).map_err(|_| "an answer that isn't text".into())
}

/// Downloads `url` to `to`, telling the tour how far it is (by the file's size so far).
pub type Progress<'a> = &'a dyn Fn(&str, u64, u64);

fn download(progress: Progress, url: &str, to: &Path, step: &str, total: u64) -> Result<(), String> {
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

fn sha256_hex(file: &Path) -> Result<String, String> {
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    Ok(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

fn sha512_b64(file: &Path) -> Result<String, String> {
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(Sha512::digest(&bytes)))
}

fn untar(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    let mut c = Command::new("tar");
    c.arg(if archive.extension().and_then(|e| e.to_str()) == Some("zip") { "-xf" } else { "-xzf" }).arg(archive).arg("-C").arg(into);
    hide_window(&mut c);
    let out = c.output().map_err(|e| format!("couldn't run tar: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("couldn't unpack: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Node.js, the current long-term version, from nodejs.org into ~/.airband/runtime/node, checked
/// against nodejs.org's own list of fingerprints.
#[tauri::command]
pub async fn install_node(app: AppHandle) -> Result<String, String> {
    node_from_nodejs(&|step, got, total| {
        let _ = app.emit("setup-progress", serde_json::json!({ "step": step, "got": got, "total": total }));
    })
}

pub fn node_from_nodejs(progress: Progress) -> Result<String, String> {
    let index: serde_json::Value = serde_json::from_str(&fetch_text("https://nodejs.org/dist/index.json")?).map_err(|_| "nodejs.org's list didn't read")?;
    let lts = index.as_array().and_then(|a| a.iter().find(|r| r["lts"].is_string())).ok_or("no long-term Node version listed")?;
    let version = lts["version"].as_str().ok_or("no version")?.to_string();
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    let (name, inner) = if cfg!(windows) {
        (format!("node-{version}-win-{arch}.zip"), format!("node-{version}-win-{arch}"))
    } else {
        (format!("node-{version}-darwin-{arch}.tar.gz"), format!("node-{version}-darwin-{arch}"))
    };
    let base = format!("https://nodejs.org/dist/{version}");
    let sums = fetch_text(&format!("{base}/SHASUMS256.txt"))?;
    let want = sums.lines().find(|l| l.ends_with(&format!("  {name}"))).and_then(|l| l.split_whitespace().next()).ok_or("no fingerprint for this computer's Node")?.to_string();
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

/// Airband's engine, the latest npm package, into ~/.airband/engine, checked against npm's
/// published fingerprint (its sha512 "integrity").
#[tauri::command]
pub async fn install_engine(app: AppHandle) -> Result<String, String> {
    engine_from_npm(&|step, got, total| {
        let _ = app.emit("setup-progress", serde_json::json!({ "step": step, "got": got, "total": total }));
    })
}

/// The newest engine on npm.
pub fn latest_engine() -> Result<String, String> {
    let meta: serde_json::Value = serde_json::from_str(&fetch_text("https://registry.npmjs.org/airband/latest")?).map_err(|_| "npm's answer didn't read")?;
    meta["version"].as_str().map(String::from).ok_or_else(|| "no version on npm".into())
}

pub fn engine_from_npm(progress: Progress) -> Result<String, String> {
    if std::env::var("AIRBAND_ENGINE_DIR").is_ok() {
        return engine_version().ok_or_else(|| "AIRBAND_ENGINE_DIR has no airband package".into());
    }
    let meta: serde_json::Value = serde_json::from_str(&fetch_text("https://registry.npmjs.org/airband/latest")?).map_err(|_| "npm's answer didn't read")?;
    let version = meta["version"].as_str().ok_or("no version on npm")?.to_string();
    let tarball = meta["dist"]["tarball"].as_str().ok_or("no package on npm")?.to_string();
    let integrity = meta["dist"]["integrity"].as_str().and_then(|i| i.strip_prefix("sha512-")).ok_or("no fingerprint on npm")?.to_string();
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

/// Connects Airband to the agents found: its hook, tools and skills, and the `airband` command
/// (the engine's own setup, as `npx airband` runs it).
#[tauri::command]
pub async fn connect_agents() -> Result<serde_json::Value, String> {
    connect()
}

pub fn connect() -> Result<serde_json::Value, String> {
    let node = engine::node().ok_or("Node isn't there yet")?;
    let mut c = Command::new(&node);
    c.arg(engine::engine_js()).args(["setup", "--json"]).arg("--node").arg(&node);
    hide_window(&mut c);
    let out = c.output().map_err(|e| format!("couldn't start Airband's engine: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let start = text.find('{').ok_or("the engine said nothing")?;
    serde_json::from_str(&text[start..]).map_err(|_| "the engine's answer didn't read".into())
}

/// The tour is done: Roger comes, and the tour window goes.
#[tauri::command]
pub async fn finish(app: AppHandle) -> Result<(), String> {
    // Never refused: with something still missing, Airband waits in the menu bar, and
    // "Set up Airband…" there finishes it.
    let ready = engine::ready();
    {
        let state = app.state::<State>();
        let mut s = state.lock().unwrap();
        s.prefs.set_up = true;
        save_prefs(&s.prefs);
    }
    if ready && app.get_webview_window("main").is_none() {
        engine::start(&app);
    }
    crate::refresh_menu(&app);
    if let Some(w) = app.get_webview_window("setup") {
        let _ = w.close();
    }
    Ok(())
}

/// Opens a page in the browser: only https addresses.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links".into());
    }
    let mut c = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    hide_window(&mut c);
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}
