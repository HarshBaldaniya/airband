//! Everything a page may ask the app, as Tauri commands. Each one is also named in build.rs and
//! granted to its window in capabilities/ (scripts/check-commands.mjs checks the four agree).
use crate::corner::{self, is_visible};
use crate::engine;
use crate::error::{Error, Result};
use crate::logging::log;
use crate::prefs::{PagePrefs, PrefKey};
use crate::setup::{self, Scan};
use crate::state::{lock, save_prefs, AppState, Rect};
use crate::tray::{build_menu, refresh_menu};
use crate::update;
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// A line from the page is cut to this many characters before it is logged.
const LOG_LINE_MAX_CHARS: usize = 300;

// ---- Roger's corner ----

/// Something the page wants in the app's log (a call the app refused, mostly).
#[tauri::command]
pub fn log_line(line: String) {
    log(&line.chars().take(LOG_LINE_MAX_CHARS).collect::<String>());
}

/// Where the page's clickable parts are now.
#[tauri::command]
pub fn hit_areas(rects: Vec<Rect>, state: State<AppState>) {
    let (first, count) = (rects.first().copied(), rects.len());
    let arrived = std::mem::replace(&mut lock(&state).hits, rects).is_empty();
    if let (true, Some(r)) = (arrived, first) {
        log(&format!(
            "corner: clickable parts arrived ({count}), first at {:.0},{:.0} {:.0}x{:.0}",
            r.x, r.y, r.width, r.height
        ));
    }
}

/// A drag starts on the figure: the system moves the window from here.
#[tauri::command]
pub fn drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub fn prefs(state: State<AppState>) -> PagePrefs {
    lock(&state).prefs.for_page()
}

#[tauri::command]
pub fn set_pref(app: AppHandle, key: PrefKey, on: bool) {
    corner::set_pref(&app, key, on);
}

/// The app's menu, at the pointer (a right-click on the figure).
#[tauri::command]
pub fn menu(app: AppHandle, window: WebviewWindow) {
    if let Ok(m) = build_menu(&app) {
        let _ = window.popup_menu(&m);
    }
}

/// Asleep, the pointer is looked at less often.
#[tauri::command]
pub fn asleep(asleep: bool, state: State<AppState>) {
    lock(&state).asleep = asleep;
}

/// A newer app, if there is one (Roger's panel shows it).
#[tauri::command]
pub fn update_info() -> update::AppUpdate {
    update::current()
}

/// Update the app now (the panel's Update button).
#[tauri::command]
pub fn install_update(app: AppHandle) {
    update::install(&app);
}

/// The version the app was just updated to, once, so Roger can say it after the restart.
#[tauri::command]
pub fn just_updated(app: AppHandle) -> Option<String> {
    update::just_updated(&app)
}

/// A request or a finished chat came: hidden or tucked away, the companion comes back.
#[tauri::command]
pub fn come_back(app: AppHandle) {
    let p = lock(&app.state::<AppState>()).prefs.clone();
    if !p.notify {
        return;
    }
    if !is_visible(&app) || p.hidden {
        log("corner: a chat finished or needs you: coming back");
        corner::show(&app, false);
    }
    if p.tucked {
        corner::set_pref(&app, PrefKey::Tucked, false);
    }
}

// ---- the setup tour ----
//
// Each of these runs programs, downloads or waits: on the runtime's blocking threads, never on
// the one that answers the pages.

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| Error::from(format!("the work stopped: {e}")))?
}

/// What is on this computer, and what is not.
#[tauri::command]
pub async fn scan() -> Result<Scan> {
    blocking(|| Ok(setup::look())).await
}

/// Node.js, the current long-term version, from nodejs.org into ~/.airband/runtime/node, checked
/// against nodejs.org's own list of fingerprints.
#[tauri::command]
pub async fn install_node(app: AppHandle) -> Result<String> {
    blocking(move || setup::node_from_nodejs(&setup::progress_to(&app))).await
}

/// Airband's engine, the latest npm package, into ~/.airband/engine, checked against npm's
/// published fingerprint (its sha512 "integrity").
#[tauri::command]
pub async fn install_engine(app: AppHandle) -> Result<String> {
    blocking(move || setup::engine_from_npm(&setup::progress_to(&app))).await
}

/// Connects Airband to the agents found: its hook, tools and skills, and the `airband` command.
#[tauri::command]
pub async fn connect_agents() -> Result<serde_json::Value> {
    blocking(setup::connect).await
}

/// The tour is done: Roger comes, and the tour window goes. Never refused: with something still
/// missing, Airband waits in the menu bar, and "Set up Airband…" there finishes it.
#[tauri::command]
pub async fn finish(app: AppHandle) -> Result<()> {
    let ready = blocking(|| Ok(engine::ready())).await?;
    let state = app.state::<AppState>();
    lock(&state).prefs.set_up = true;
    save_prefs(&state);
    if ready && corner::window(&app).is_none() {
        engine::start(&app);
    }
    refresh_menu(&app);
    setup::close(&app);
    Ok(())
}

/// Opens a page in the browser: only https addresses.
#[tauri::command]
pub fn open_url(url: String) -> Result<()> {
    if !url.starts_with("https://") {
        return Err("only https links".into());
    }
    Ok(crate::process::open_url(&url)?)
}
