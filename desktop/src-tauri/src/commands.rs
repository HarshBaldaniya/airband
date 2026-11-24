//! Everything a page may ask the app, as Tauri commands. Each one is also named in build.rs and
//! granted to its window in capabilities/ (scripts/check-commands.mjs checks the four agree).
use crate::corner::{is_visible, set_pref_inner, show};
use crate::engine;
use crate::logging::log;
use crate::prefs::{prefs_view, save_prefs};
use crate::setup::{self, Scan};
use crate::state::{Rect, State};
use crate::tray::build_menu;
use crate::update;
use tauri::{AppHandle, Manager, WebviewWindow};

// ---- Roger's corner ----

#[tauri::command]
pub fn log_line(line: String) {
    log(&line.chars().take(300).collect::<String>());
}

#[tauri::command]
pub fn hit_areas(rects: Vec<Rect>, state: tauri::State<State>) {
    let mut s = state.lock().unwrap();
    if s.hits.is_empty() && !rects.is_empty() {
        log(&format!(
            "corner: clickable parts arrived ({}), first at {:.0},{:.0} {:.0}x{:.0}",
            rects.len(),
            rects[0].x,
            rects[0].y,
            rects[0].width,
            rects[0].height
        ));
    }
    s.hits = rects;
}

#[tauri::command]
pub fn drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub fn prefs(state: tauri::State<State>) -> serde_json::Value {
    prefs_view(&state.lock().unwrap().prefs)
}

#[tauri::command]
pub fn set_pref(app: AppHandle, key: String, on: bool) {
    set_pref_inner(&app, &key, on);
}

#[tauri::command]
pub fn menu(app: AppHandle, window: WebviewWindow) {
    if let Ok(m) = build_menu(&app) {
        let _ = window.popup_menu(&m);
    }
}

#[tauri::command]
pub fn asleep(asleep: bool, state: tauri::State<State>) {
    state.lock().unwrap().asleep = asleep;
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
    let p = app.state::<State>().lock().unwrap().prefs.clone();
    if !p.notify {
        return;
    }
    if !is_visible(&app) || p.hidden {
        log("corner: a chat finished or needs you: coming back");
        show(&app, false);
    }
    if p.tucked {
        set_pref_inner(&app, "tucked", false);
    }
}

// ---- the setup tour ----

/// What is on this computer, and what is not.
#[tauri::command]
pub async fn scan() -> Scan {
    setup::look()
}

/// Node.js, the current long-term version, from nodejs.org into ~/.airband/runtime/node, checked
/// against nodejs.org's own list of fingerprints.
#[tauri::command]
pub async fn install_node(app: AppHandle) -> Result<String, String> {
    setup::node_from_nodejs(&setup::progress_to(&app))
}

/// Airband's engine, the latest npm package, into ~/.airband/engine, checked against npm's
/// published fingerprint (its sha512 "integrity").
#[tauri::command]
pub async fn install_engine(app: AppHandle) -> Result<String, String> {
    setup::engine_from_npm(&setup::progress_to(&app))
}

/// Connects Airband to the agents found: its hook, tools and skills, and the `airband` command
/// (the engine's own setup, as `npx airband` runs it).
#[tauri::command]
pub async fn connect_agents() -> Result<serde_json::Value, String> {
    setup::connect()
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
    crate::tray::refresh_menu(&app);
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
    crate::process::open_url(&url).map_err(|e| e.to_string())
}
