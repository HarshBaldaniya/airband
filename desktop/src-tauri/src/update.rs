//! Keeping Airband current, with as little for the person to do as can be.
//!
//! - The engine (the hook, the tools, the skills and Roger's screens) is the `airband` npm package.
//!   When npm has a newer one, the app fetches it, checks npm's fingerprint, sets the agents up with
//!   it as the setup tour does (the `airband` command too) and starts the Station again on it.
//!   Nothing to click.
//! - The app itself: when its latest GitHub release is newer, the menu offers "Update to …" and
//!   Roger's panel says so. One click downloads it, checks its signature against the public key in
//!   tauri.conf.json, puts it in place and starts it again. The app fetches the file itself, so the
//!   system doesn't ask to allow a download, as it does for one from a browser.
//!
//! Both are looked at a minute after the app starts, then every six hours.
use crate::logging::log;
use crate::state::State;
use crate::tray::refresh_menu;
use crate::{engine, setup};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// A newer app, as the menu and Roger's panel show it.
#[derive(Clone, Serialize)]
pub struct AppUpdate {
    /// The newer version, when there is one.
    pub version: Option<String>,
    pub installing: bool,
    /// While installing: "downloading", "installing", then "restarting".
    pub step: Option<&'static str>,
    /// How much of the download is in, 0 to 100, when its size is known.
    pub progress: Option<u8>,
    /// What went wrong the last time, in words for the person.
    pub error: Option<String>,
}

static NOW: Mutex<AppUpdate> =
    Mutex::new(AppUpdate { version: None, installing: false, step: None, progress: None, error: None });

pub fn current() -> AppUpdate {
    NOW.lock().unwrap().clone()
}

/// The menu and Roger's panel show what changed.
fn tell(app: &AppHandle) {
    tell_panel(app);
    refresh_menu(app);
}

fn tell_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("update", current());
    }
}

fn set_step(app: &AppHandle, step: &'static str) {
    NOW.lock().unwrap().step = Some(step);
    tell(app);
}

/// Written just before the new app goes in place, so the new app can say it is the new one.
fn marker() -> std::path::PathBuf {
    crate::paths::file(crate::paths::UPDATED)
}

/// The version this app was just updated to, once: Roger says so after the restart.
pub fn just_updated(app: &AppHandle) -> Option<String> {
    let f = marker();
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).ok()?).ok()?;
    let _ = std::fs::remove_file(&f);
    let to = v["to"].as_str()?.to_string();
    (to == app.package_info().version.to_string()).then_some(to)
}

/// "0.1.10" is newer than "0.1.9".
pub fn newer(a: &str, b: &str) -> bool {
    let parts = |v: &str| {
        v.trim()
            .trim_start_matches('v')
            .split(['.', '-', '+'])
            .take(3)
            .map(|x| x.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    parts(a) > parts(b)
}

/// Looks for both kinds of update now and then, in the background.
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        loop {
            engine_update(&app);
            tauri::async_runtime::block_on(check_app(&app));
            std::thread::sleep(Duration::from_secs(6 * 60 * 60));
        }
    });
}

// ---- the engine: by itself ----

fn engine_update(app: &AppHandle) {
    let set_up = app.state::<State>().lock().unwrap().prefs.set_up;
    if !set_up || std::env::var("AIRBAND_ENGINE_DIR").is_ok() || !engine::ready() {
        return;
    }
    let (Some(have), Ok(latest)) = (setup::engine_version(), setup::latest_engine()) else { return };
    if !newer(&latest.version, &have) {
        return;
    }
    log(&format!("update: engine {have} to {}", latest.version));
    match setup::install_engine(&latest, &|_, _, _| {}) {
        Ok(v) => {
            match setup::connect() {
                Ok(_) => log("update: agents set up with the new engine"),
                Err(e) => log(&format!("update: setting up the agents failed: {e}")),
            }
            engine::restart();
            log(&format!("update: engine {v} in place"));
        }
        Err(e) => log(&format!("update: the engine didn't download: {e}")),
    }
}

// ---- the app: one click ----

async fn check_app(app: &AppHandle) {
    let Ok(updater) = app.updater() else { return };
    match updater.check().await {
        Ok(Some(u)) => {
            let fresh = {
                let mut now = NOW.lock().unwrap();
                let fresh = now.version.as_deref() != Some(u.version.as_str());
                now.version = Some(u.version.clone());
                fresh
            };
            if fresh {
                log(&format!("update: Airband {} is out", u.version));
                tell(app);
            }
        }
        Ok(None) => {}
        Err(e) => log(&format!("update: couldn't look for a newer app: {e}")),
    }
}

/// `airband --update` while Airband runs: look now, and update only when there is a newer app.
pub fn check_and_install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        check_app(&app).await;
        if current().version.is_some() {
            install(&app);
        } else {
            log("update: asked to update, and this is the newest");
        }
    });
}

/// Downloads the newer app, checks it, puts it in place and starts it.
pub fn install(app: &AppHandle) {
    {
        let mut now = NOW.lock().unwrap();
        if now.installing {
            return;
        }
        now.installing = true;
        now.step = Some("downloading");
        now.progress = None;
        now.error = None;
    }
    tell(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match download_and_install(&app).await {
            Ok(v) => {
                log(&format!("update: Airband {v} installed, starting it"));
                set_step(&app, "restarting");
                std::thread::sleep(Duration::from_millis(700));
                engine::stop();
                app.restart();
            }
            Err(e) => {
                log(&format!("update: the app didn't update: {e}"));
                {
                    let mut now = NOW.lock().unwrap();
                    now.installing = false;
                    now.step = None;
                    now.progress = None;
                    now.error = Some("The update didn't finish. Try again in a moment.".into());
                }
                tell(&app);
            }
        }
    });
}

async fn download_and_install(app: &AppHandle) -> Result<String, String> {
    let u = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "this is already the newest".to_string())?;
    let mut got: u64 = 0;
    let (a, b) = (app.clone(), app.clone());
    let to = u.version.clone();
    u.download_and_install(
        move |chunk, total| {
            got += chunk as u64;
            let Some(total) = total.filter(|t| *t > 0) else { return };
            let pct = ((got * 100) / total).min(100) as u8;
            let was = NOW.lock().unwrap().progress.replace(pct);
            if was != Some(pct) {
                tell_panel(&a);
                // The menu is built again only now and then.
                if pct / 10 != was.unwrap_or(0) / 10 {
                    refresh_menu(&a);
                }
            }
        },
        move || {
            // On Windows the installer takes over from here and starts the new app itself.
            let _ = std::fs::write(marker(), serde_json::json!({ "to": to }).to_string());
            set_step(&b, "installing");
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(u.version)
}

/// `airband --update` in a terminal: the same update, with what happened printed.
pub async fn from_terminal(app: &AppHandle) -> i32 {
    let have = app.package_info().version.to_string();
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => {
            eprintln!("error: {e}");
            return 1;
        }
    };
    match found {
        Ok(None) => {
            println!("Airband {have} is the newest.");
            0
        }
        Ok(Some(u)) => {
            println!("Updating Airband {have} to {}…", u.version);
            match u.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => {
                    println!("Airband {} is installed. Open Airband to start it.", u.version);
                    0
                }
                Err(e) => {
                    eprintln!("error: {e}");
                    1
                }
            }
        }
        Err(e) => {
            eprintln!("error: couldn't look for a newer app: {e}");
            1
        }
    }
}
