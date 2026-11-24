//! Keeping Airband current, with as little for the person to do as can be.
//!
//! - The engine (the hook, the tools, the skills and Roger's screens) is the `airband` npm package.
//!   When npm has a newer one, the app fetches it, checks npm's fingerprint, sets the agents up with
//!   it as the setup tour does (the `airband` command too) and starts the Station again on it.
//!   Nothing to click.
//! - The app itself: when its latest GitHub release is newer, it is fetched, its signature checked
//!   against the public key in tauri.conf.json, put in place and started again. A small update
//!   (only the last number changes) does this by itself, once Roger is asleep, so it never
//!   interrupts. A big one (a new middle number before 1.0, a new first number after) waits for
//!   the person: the menu offers "Update to …" and Roger's panel shows Update. The app fetches the
//!   file itself, so the system doesn't ask to allow a download, as it does for one from a browser.
//!
//! Both are looked at a minute after the app starts, then every six hours.
use crate::corner::{self, event};
use crate::error::Result;
use crate::logging::log;
use crate::paths::{self, UPDATED};
use crate::state::{hooks, lock, AppState};
use crate::{engine, setup};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// The first look for updates, after the app starts.
const FIRST_CHECK: Duration = Duration::from_secs(60);
/// Then a look every six hours.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// How often a small update waiting for Roger to sleep looks again.
const QUIET_LOOK: Duration = Duration::from_secs(60);
/// Reaching GitHub's download servers: the whole time to connect, split across their addresses,
/// so one that never answers is left after a few seconds for the next. A network that blocks one
/// of GitHub's four addresses left the download waiting on it for ever.
const CONNECT_WITHIN: Duration = Duration::from_secs(20);
/// A download that receives nothing for this long has stalled, and is tried again.
const STALLED_AFTER: Duration = Duration::from_secs(30);
/// How many times a download is tried before the panel says it didn't finish.
const DOWNLOAD_TRIES: u32 = 3;
/// "Starting again…" stays on screen this long before the app restarts.
const RESTART_PAUSE: Duration = Duration::from_millis(700);

/// Where an app update is.
#[derive(Clone, Copy, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateStep {
    Downloading,
    Installing,
    Restarting,
}

/// A newer app, as the menu and Roger's panel show it.
#[derive(Clone, Serialize)]
pub struct AppUpdate {
    /// The newer version, when there is one.
    pub version: Option<String>,
    pub installing: bool,
    pub step: Option<UpdateStep>,
    /// How much of the download is in, 0 to 100, when its size is known.
    pub progress: Option<u8>,
    /// What went wrong the last time, in words for the person.
    pub error: Option<String>,
    /// A small update: it installs by itself once Roger is asleep, so the panel offers nothing.
    pub automatic: bool,
}

static NOW: Mutex<AppUpdate> = Mutex::new(AppUpdate {
    version: None,
    installing: false,
    step: None,
    progress: None,
    error: None,
    automatic: false,
});

pub fn current() -> AppUpdate {
    lock(&NOW).clone()
}

/// The menu and Roger's panel show what changed.
fn tell(app: &AppHandle) {
    tell_panel(app);
    (hooks(app).menu_changed)(app);
}

fn tell_panel(app: &AppHandle) {
    if let Some(w) = corner::window(app) {
        let _ = w.emit(event::UPDATE, current());
    }
}

fn set_step(app: &AppHandle, step: UpdateStep) {
    lock(&NOW).step = Some(step);
    tell(app);
}

/// The version this app was just updated to, once: Roger says so after the restart.
pub fn just_updated(app: &AppHandle) -> Option<String> {
    let f = paths::file(UPDATED);
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

/// Whether going from `have` to `new` is a big update, one the person chooses to install: a new
/// first number, or before 1.0 a new middle number. Anything else installs by itself.
pub fn big_update(have: &str, new: &str) -> bool {
    let parts = |v: &str| {
        let mut p = v.trim().trim_start_matches('v').split(['.', '-', '+']).map(|x| x.parse::<u64>().unwrap_or(0));
        (p.next().unwrap_or(0), p.next().unwrap_or(0))
    };
    let ((a, b), (c, d)) = (parts(have), parts(new));
    a != c || (a == 0 && b != d)
}

/// The updater, with time limits: without them a connection that never opens waits for ever.
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<tauri_plugin_updater::Updater> {
    app.updater_builder().configure_client(|c| c.connect_timeout(CONNECT_WITHIN).read_timeout(STALLED_AFTER)).build()
}

/// Looks for both kinds of update now and then, in the background.
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK);
        loop {
            engine_update(&app);
            tauri::async_runtime::block_on(check_app(&app));
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

// ---- the engine: by itself ----

fn engine_update(app: &AppHandle) {
    let set_up = lock(&app.state::<AppState>()).prefs.set_up;
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
    let Ok(updater) = updater(app) else { return };
    match updater.check().await {
        Ok(Some(u)) => {
            let fresh = {
                let mut now = lock(&NOW);
                let fresh = now.version.as_deref() != Some(u.version.as_str());
                now.version = Some(u.version.clone());
                fresh
            };
            let automatic = !big_update(&app.package_info().version.to_string(), &u.version);
            lock(&NOW).automatic = automatic;
            if fresh {
                log(&format!(
                    "update: Airband {} is out{}",
                    u.version,
                    if automatic { ", installing it once Roger is asleep" } else { "" }
                ));
                tell(app);
                if automatic {
                    install_when_quiet(app);
                }
            }
        }
        Ok(None) => {}
        Err(e) => log(&format!("update: couldn't look for a newer app: {e}")),
    }
}

/// A small update installs once Roger is asleep: every chat done, nothing waiting for the person,
/// so the few seconds the app takes to start again interrupt nothing.
fn install_when_quiet(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        let (asleep, installing) = (lock(&app.state::<AppState>()).asleep, lock(&NOW).installing);
        if installing {
            return;
        }
        if asleep {
            log("update: Roger is asleep, installing the update");
            install(&app);
            return;
        }
        std::thread::sleep(QUIET_LOOK);
    });
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
        let mut now = lock(&NOW);
        if now.installing {
            return;
        }
        now.installing = true;
        now.step = Some(UpdateStep::Downloading);
        now.progress = None;
        now.error = None;
    }
    tell(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // A failed or stalled download is tried again, from the start, before the panel says so.
        let mut tries = 0;
        let done = loop {
            tries += 1;
            match download_and_install(&app).await {
                Ok(v) => break Ok(v),
                Err(e) if tries < DOWNLOAD_TRIES => {
                    log(&format!("update: the download stopped ({e}), trying again"));
                    {
                        let mut now = lock(&NOW);
                        now.step = Some(UpdateStep::Downloading);
                        now.progress = None;
                    }
                    tell(&app);
                }
                Err(e) => break Err(e),
            }
        };
        match done {
            Ok(v) => {
                log(&format!("update: Airband {v} installed, starting it"));
                set_step(&app, UpdateStep::Restarting);
                // "Starting again…" stays a moment; the pause and the engine's stop wait on a
                // blocking thread, not on the runtime's.
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    std::thread::sleep(RESTART_PAUSE);
                    engine::stop();
                    app.restart();
                })
                .await;
            }
            Err(e) => {
                log(&format!("update: the app didn't update: {e}"));
                {
                    let mut now = lock(&NOW);
                    now.installing = false;
                    now.step = None;
                    now.progress = None;
                    now.error = Some("The update didn't download. Check the connection, then try again.".into());
                }
                tell(&app);
            }
        }
    });
}

async fn download_and_install(app: &AppHandle) -> Result<String> {
    let u = updater(app)?.check().await?.ok_or("this is already the newest")?;
    let mut got: u64 = 0;
    let (a, b) = (app.clone(), app.clone());
    let to = u.version.clone();
    u.download_and_install(
        move |chunk, total| {
            got += chunk as u64;
            let Some(total) = total.filter(|t| *t > 0) else { return };
            let pct = ((got * 100) / total).min(100) as u8;
            let was = lock(&NOW).progress.replace(pct);
            if was != Some(pct) {
                tell_panel(&a);
                // The menu is built again only now and then.
                if pct / 10 != was.unwrap_or(0) / 10 {
                    (hooks(&a).menu_changed)(&a);
                }
            }
        },
        move || {
            // On Windows the installer takes over from here and starts the new app itself.
            let _ = std::fs::write(paths::file(UPDATED), serde_json::json!({ "to": to }).to_string());
            set_step(&b, UpdateStep::Installing);
        },
    )
    .await?;
    Ok(u.version)
}

/// `airband --update` in a terminal: the same update, with what happened printed.
pub async fn from_terminal(app: &AppHandle) -> i32 {
    let have = app.package_info().version.to_string();
    let found = match updater(app) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_update_installs_by_itself_and_a_big_one_waits_for_the_person() {
        assert!(!big_update("0.2.0", "0.2.1"));
        assert!(!big_update("0.2.3", "0.2.10"));
        assert!(big_update("0.1.6", "0.2.0"));
        assert!(big_update("0.9.4", "1.0.0"));
        assert!(!big_update("1.2.0", "1.3.0"));
        assert!(big_update("1.9.0", "2.0.0"));
        assert!(!big_update("v0.2.0", "0.2.1-beta.1"));
    }

    #[test]
    fn compares_versions_as_numbers() {
        assert!(newer("0.1.10", "0.1.9"));
        assert!(newer("v1.0.0", "0.9.9"));
        assert!(!newer("0.1.6", "0.1.6"));
        assert!(!newer("0.1.6-beta", "0.1.6"));
    }

    #[test]
    fn the_panel_reads_the_step_as_before() {
        assert_eq!(serde_json::to_string(&UpdateStep::Downloading).unwrap(), r#""downloading""#);
    }
}
