// Airband's desktop app, small: the system's own web view (WebKit on macOS, WebView2 on Windows)
// instead of a browser of its own. It shows Roger's corner, the menu-bar or tray icon, and the
// first-run setup tour. The work is done by Airband's engine (the Station, `airband station`),
// which the setup tour fetches and this app keeps running.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod install;
mod setup;
mod uninstall;
mod update;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The window: a fixed size, so nothing resizes or flickers; empty parts let clicks through.
const WIN_W: f64 = 424.0;
const WIN_H: f64 = 700.0;
/// Where the figure sits in it (logical pixels), for the eyes that follow the pointer.
const FIG_W: f64 = 104.0;
const FIG_H: f64 = 125.0;
const FIG_PAD: f64 = 10.0;

/// Shows Roger, or opens and closes his panel, from anywhere.
const SHORTCUT: &str = "Alt+CommandOrControl+R";

/// ~/.airband, or AIRBAND_HOME.
pub fn home() -> PathBuf {
    if let Ok(h) = std::env::var("AIRBAND_HOME") {
        return PathBuf::from(h);
    }
    let base = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".airband")
}

/// Set once Airband is being uninstalled.
pub static LOG_OFF: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A short log of what the app did (~/.airband/app.log), for when something goes wrong.
/// Kept small: started again past 200 KB.
pub fn log(line: &str) {
    use std::io::Write;
    // Uninstalling: ~/.airband is going, and a log line would make it again.
    if LOG_OFF.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let f = home().join("app.log");
    let _ = fs::create_dir_all(home());
    if fs::metadata(&f).map(|m| m.len() > 200_000).unwrap_or(false) {
        let _ = fs::remove_file(&f);
    }
    if let Ok(mut out) = fs::OpenOptions::new().create(true).append(true).open(&f) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(out, "{secs} {line}");
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub sound: bool,
    pub notify: bool,
    pub start_at_login: bool,
    pub hidden: bool,
    pub tucked: bool,
    pub greeted: bool,
    /// The setup tour was finished on this computer.
    pub set_up: bool,
    /// Where the window was left (logical pixels).
    pub window_at: Option<(f64, f64)>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            sound: true,
            notify: true,
            start_at_login: true,
            hidden: false,
            tucked: false,
            greeted: false,
            set_up: false,
            window_at: None,
        }
    }
}

fn prefs_file() -> PathBuf {
    home().join("app.json")
}

/// The app's settings. Versions up to 0.0.10 kept them in desktop-lite.json: read once, so an
/// upgrade keeps them, and the next save writes app.json.
fn load_prefs() -> Prefs {
    [prefs_file(), home().join("desktop-lite.json")]
        .iter()
        .find_map(|f| fs::read_to_string(f).ok().and_then(|t| serde_json::from_str(&t).ok()))
        .unwrap_or_default()
}

pub fn save_prefs(p: &Prefs) {
    let _ = fs::create_dir_all(home());
    if let Ok(t) = serde_json::to_string_pretty(p) {
        let tmp = prefs_file().with_extension("tmp");
        if fs::write(&tmp, t).is_ok() {
            let _ = fs::rename(tmp, prefs_file());
        }
    }
}

#[derive(Deserialize, Clone, Copy)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// What the app keeps while it runs.
pub struct Shared {
    pub prefs: Prefs,
    /// The screen's clickable parts (logical pixels in the window).
    hits: Vec<Rect>,
    /// Clicks pass through right now.
    passing: bool,
    asleep: bool,
    /// Which way the cards open: towards the middle of the screen.
    side: &'static str,
    vertical: &'static str,
    last_move: Option<Instant>,
}

pub type State = Arc<Mutex<Shared>>;

/// The prefs the screen knows (the same names as the larger app's).
fn prefs_view(p: &Prefs) -> serde_json::Value {
    serde_json::json!({ "sound": p.sound, "notify": p.notify, "startAtLogin": p.start_at_login, "tucked": p.tucked, "greeted": p.greeted })
}

/// The companion's name, from the engine's settings (for the menu).
fn companion_name() -> String {
    fs::read_to_string(home().join("station-settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["companion"]["name"].as_str().map(String::from))
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Roger".into())
}

// ---- the window ----

/// What the Station's page is given in place of the larger app's preload: the same bridge, by
/// invoke and events. Only on the Station's own page, on this computer.
const BRIDGE: &str = r#"
(() => {
  if (location.hostname !== "127.0.0.1" || !window.__TAURI_INTERNALS__) return;
  const T = window.__TAURI_INTERNALS__;
  // A call the app refuses is written to its log, never lost.
  const invoke = (cmd, args) => T.invoke(cmd, args || {}).catch((e) => { if (cmd !== "log_line") T.invoke("log_line", { line: `bridge: ${cmd} refused: ${e}` }).catch(() => {}); });
  const on = (event, cb) => T.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler: T.transformCallback((e) => cb(e.payload)) });
  window.airbandDesktop = {
    nativeDrag: true,
    setHit: () => {},
    setHitAreas: (rects) => invoke("hit_areas", { rects }),
    dragStart: () => invoke("drag"),
    dragMove: () => {},
    dragEnd: () => {},
    onPlace: (cb) => on("place", cb),
    onCursor: (cb) => on("cursor", cb),
    onPointer: (cb) => on("pointer", cb),
    onCommand: (cb) => on("command", cb),
    onPrefs: (cb) => on("prefs", cb),
    qr: async () => undefined,
    prefs: () => invoke("prefs"),
    setPref: (key, on) => invoke("set_pref", { key, on }),
    showMenu: () => invoke("menu"),
    hide: () => invoke("hide"),
    setAsleep: (asleep) => invoke("asleep", { asleep }),
    comeBack: () => invoke("come_back"),
    update: () => invoke("update_info"),
    onUpdate: (cb) => on("update", cb),
    installUpdate: () => invoke("install_update"),
    justUpdated: () => invoke("just_updated"),
  };
})();
"#;

fn work_area(w: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let m = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten())?;
    let s = m.scale_factor();
    let a = m.work_area();
    Some((a.position.x as f64 / s, a.position.y as f64 / s, a.size.width as f64 / s, a.size.height as f64 / s))
}

/// Puts the window where it was left, or at the bottom right; keeps it on the screen.
fn place(w: &WebviewWindow, state: &State) {
    let Some((ax, ay, aw, ah)) = work_area(w) else { return };
    let at = state.lock().unwrap().prefs.window_at;
    let (mut x, mut y) = at.unwrap_or((ax + aw - WIN_W, ay + ah - WIN_H));
    x = x.clamp(ax - WIN_W + FIG_W + 2.0 * FIG_PAD, ax + aw - FIG_W - 2.0 * FIG_PAD);
    y = y.clamp(ay - WIN_H + FIG_H + 2.0 * FIG_PAD, ay + ah - FIG_H - 2.0 * FIG_PAD);
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    tell_place(w, state, x, y, (ax, ay, aw, ah));
}

fn tell_place(w: &WebviewWindow, state: &State, x: f64, y: f64, (ax, ay, aw, ah): (f64, f64, f64, f64)) {
    let side = if x + WIN_W / 2.0 > ax + aw / 2.0 { "right" } else { "left" };
    let vertical = if y + WIN_H / 2.0 > ay + ah / 2.0 { "bottom" } else { "top" };
    {
        let mut s = state.lock().unwrap();
        s.side = side;
        s.vertical = vertical;
    }
    let _ = w.emit("place", serde_json::json!({ "side": side, "vertical": vertical }));
}

/// After a drag: near an edge, it settles against it; then where it is, is kept.
fn settle(w: &WebviewWindow, state: &State) {
    let Some((ax, ay, aw, ah)) = work_area(w) else { return };
    let Ok(pos) = w.outer_position() else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let (mut x, mut y) = (pos.x as f64 / scale, pos.y as f64 / scale);
    if (ax + aw) - (x + WIN_W) < 80.0 {
        x = ax + aw - WIN_W;
    } else if x - ax < 80.0 {
        x = ax;
    }
    if (ay + ah) - (y + WIN_H) < 80.0 {
        y = ay + ah - WIN_H;
    } else if y - ay < 80.0 {
        y = ay;
    }
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    {
        let mut s = state.lock().unwrap();
        s.prefs.window_at = Some((x, y));
        save_prefs(&s.prefs);
    }
    tell_place(w, state, x, y, (ax, ay, aw, ah));
}

/// Roger's corner, on the Station's page.
pub fn open_corner(app: &AppHandle, url: &str) {
    let state = app.state::<State>().inner().clone();
    let Ok(target) = url.parse() else { return };
    if let Some(w) = app.get_webview_window("main") {
        // Only a new address loads the page again: the same one is left as it is.
        if w.url().map(|u| u.as_str() != url).unwrap_or(true) {
            log("corner: a new address, loading it");
            let _ = w.navigate(target);
        }
        return;
    }
    log(&format!("corner: opening {}", url.split('?').next().unwrap_or(url)));
    let hidden = state.lock().unwrap().prefs.hidden;
    let place_state = state.clone();
    let Ok(w) = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target))
        .title("Airband")
        .inner_size(WIN_W, WIN_H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        // Hidden, a page is suspended after about five minutes, so Roger never heard that a chat
        // finished or needed you, and never came back. It is light while hidden (asleep, it draws
        // nothing), so it keeps running.
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .visible(false)
        .initialization_script(BRIDGE)
        .on_page_load(move |w, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                place(&w, &place_state);
                let p = place_state.lock().unwrap().prefs.clone();
                let _ = w.emit("prefs", prefs_view(&p));
                if !p.hidden {
                    let _ = w.show();
                }
                // The menu was made while the window was still hidden (it shows only once its
                // page loads), so it said "Show Roger" with Roger on screen.
                let a = w.app_handle().clone();
                let _ = w.app_handle().run_on_main_thread(move || refresh_menu(&a));
            }
        })
        .build()
    else {
        return;
    };
    let _ = w.set_ignore_cursor_events(true);
    state.lock().unwrap().passing = true;
    let moved_state = state.clone();
    let moved_w = w.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::Moved(_) = e {
            moved_state.lock().unwrap().last_move = Some(Instant::now());
            let (st, win) = (moved_state.clone(), moved_w.clone());
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(450));
                let quiet =
                    st.lock().unwrap().last_move.map(|t| t.elapsed() >= Duration::from_millis(420)).unwrap_or(false);
                if quiet {
                    st.lock().unwrap().last_move = None;
                    settle(&win, &st);
                }
            });
        }
    });
    if hidden {
        let _ = w.hide();
    }
    refresh_menu(app);
}

/// Watches the pointer: over a clickable part the window takes clicks, elsewhere they go to the
/// windows behind; the eyes follow it. Slower while asleep.
fn watch_pointer(app: AppHandle, state: State) {
    std::thread::spawn(move || {
        let mut eased = (0.0f64, 0.0f64);
        let mut last = String::new();
        // Where the pointer is over Roger, for the page's own hover: a window that is not in
        // front gets no mouse-moved events, so after a click that opened another app, :hover
        // would stay on the row that was clicked.
        let mut last_point = String::new();
        loop {
            let asleep = state.lock().unwrap().asleep;
            std::thread::sleep(Duration::from_millis(if asleep { 400 } else { 60 }));
            let Some(w) = app.get_webview_window("main") else { continue };
            if !w.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(c), Ok(pos), Ok(scale)) = (app.cursor_position(), w.outer_position(), w.scale_factor()) else {
                continue;
            };
            let (cx, cy) = ((c.x - pos.x as f64) / scale, (c.y - pos.y as f64) / scale);
            let (over, side, vertical, passing) = {
                let s = state.lock().unwrap();
                (
                    s.hits.iter().any(|r| cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height),
                    s.side,
                    s.vertical,
                    s.passing,
                )
            };
            if over == passing {
                let _ = w.set_ignore_cursor_events(!over);
                state.lock().unwrap().passing = !over;
                log(&format!(
                    "pointer: {} at {cx:.0},{cy:.0}",
                    if over { "over Roger: takes clicks" } else { "away: clicks pass through" }
                ));
            }
            let point = if over { format!("{cx:.0},{cy:.0}") } else { String::new() };
            if point != last_point {
                last_point = point;
                let _ = w.emit(
                    "pointer",
                    if over { serde_json::json!({ "x": cx, "y": cy }) } else { serde_json::Value::Null },
                );
            }
            if asleep {
                continue;
            }
            let fx = if side == "right" { WIN_W - FIG_PAD - FIG_W / 2.0 } else { FIG_PAD + FIG_W / 2.0 };
            let fy = if vertical == "bottom" { WIN_H - FIG_PAD - FIG_H / 2.0 } else { FIG_PAD + FIG_H / 2.0 };
            let far = ((cx - fx).powi(2) + (cy - fy).powi(2)).sqrt() > 700.0;
            let tx = if far { 0.0 } else { ((cx - fx) / 360.0).clamp(-1.0, 1.0) };
            let ty = if far { 0.0 } else { ((cy - fy) / 280.0).clamp(-1.0, 1.0) };
            eased.0 += (tx - eased.0) * 0.22;
            eased.1 += (ty - eased.1) * 0.22;
            let (qx, qy) = ((eased.0 * 20.0).round() / 20.0, (eased.1 * 20.0).round() / 20.0);
            let key = format!("{qx:.2},{qy:.2}");
            if key != last {
                last = key;
                let _ = w.emit("cursor", serde_json::json!({ "dx": qx, "dy": qy }));
            }
        }
    });
}

fn show(app: &AppHandle, open: bool) {
    let state = app.state::<State>().inner().clone();
    let Some(w) = app.get_webview_window("main") else { return };
    let was = w.is_visible().unwrap_or(false);
    {
        let mut s = state.lock().unwrap();
        s.prefs.hidden = false;
        if open {
            s.prefs.tucked = false;
        }
        save_prefs(&s.prefs);
        let _ = w.emit("prefs", prefs_view(&s.prefs));
    }
    let _ = w.show();
    if !was {
        let _ = w.emit("command", "arrive");
    }
    if open {
        let _ = w.set_focus();
        let _ = w.emit("command", "open");
    }
    refresh_menu(app);
}

fn hide_corner(app: &AppHandle) {
    let state = app.state::<State>().inner().clone();
    {
        let mut s = state.lock().unwrap();
        s.prefs.hidden = true;
        save_prefs(&s.prefs);
    }
    if let Some(w) = app.get_webview_window("main") {
        // The screen fades out, then the window goes: never a cut.
        let _ = w.emit("command", "leave");
        let w2 = w.clone();
        let st = state.clone();
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(260));
            if st.lock().unwrap().prefs.hidden {
                let _ = w2.hide();
                let _ = a.run_on_main_thread({
                    let a = a.clone();
                    move || refresh_menu(&a)
                });
            }
        });
    }
}

fn set_pref_inner(app: &AppHandle, key: &str, on: bool) {
    let state = app.state::<State>().inner().clone();
    let view = {
        let mut s = state.lock().unwrap();
        match key {
            "sound" => s.prefs.sound = on,
            "notify" => s.prefs.notify = on,
            "startAtLogin" => s.prefs.start_at_login = on,
            "tucked" => s.prefs.tucked = on,
            "greeted" => s.prefs.greeted = on,
            _ => return,
        }
        save_prefs(&s.prefs);
        prefs_view(&s.prefs)
    };
    if key == "startAtLogin" {
        login_item(app, on);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("prefs", view);
    }
    refresh_menu(app);
}

fn login_item(app: &AppHandle, on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) {
        return;
    }
    let l = app.autolaunch();
    let _ = if on { l.enable() } else { l.disable() };
}

// ---- the menu ----

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let p = app.state::<State>().lock().unwrap().prefs.clone();
    let name = companion_name();
    let visible = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let items = Menu::new(app)?;
    let newer = update::current();
    if let Some(v) = &newer.version {
        let label = match (newer.installing, newer.step, newer.progress) {
            (true, Some("downloading"), Some(p)) => format!("Downloading Airband {v} · {p}%"),
            (true, Some("installing"), _) => format!("Installing Airband {v}…"),
            (true, Some("restarting"), _) => "Starting again…".to_string(),
            (true, _, _) => format!("Updating to {v}…"),
            _ => format!("Update to Airband {v}"),
        };
        items.append(&MenuItem::with_id(app, "update", label, !newer.installing, None::<&str>)?)?;
        items.append(&PredefinedMenuItem::separator(app)?)?;
    }
    if !p.set_up || !engine::was_ready() {
        items.append(&MenuItem::with_id(app, "setup", "Set up Airband…", true, None::<&str>)?)?;
    } else {
        items.append(&MenuItem::with_id(
            app,
            "toggle",
            if visible && !p.hidden { format!("Hide {name}") } else { format!("Show {name}") },
            true,
            None::<&str>,
        )?)?;
        items.append(&MenuItem::with_id(
            app,
            "tuck",
            if p.tucked { format!("Bring {name} back") } else { format!("Tuck {name} away") },
            true,
            None::<&str>,
        )?)?;
        items.append(&MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?)?;
        items.append(&PredefinedMenuItem::separator(app)?)?;
        items.append(&CheckMenuItem::with_id(app, "sound", "Sounds", true, p.sound, None::<&str>)?)?;
        items.append(&CheckMenuItem::with_id(
            app,
            "notify",
            format!("{name} comes back when a chat needs you"),
            true,
            p.notify,
            None::<&str>,
        )?)?;
        items.append(&CheckMenuItem::with_id(app, "login", "Start at login", true, p.start_at_login, None::<&str>)?)?;
        items.append(&PredefinedMenuItem::separator(app)?)?;
        items.append(&MenuItem::with_id(app, "setup", "Run the setup tour again…", true, None::<&str>)?)?;
    }
    // Moving the app to the Bin would leave Airband in every agent: this takes it all out.
    if cfg!(any(target_os = "macos", windows)) {
        items.append(&MenuItem::with_id(app, "uninstall", "Uninstall Airband…", true, None::<&str>)?)?;
    }
    items.append(&MenuItem::with_id(app, "quit", "Quit Airband", true, None::<&str>)?)?;
    Ok(items)
}

pub fn refresh_menu(app: &AppHandle) {
    if let (Some(tray), Ok(m)) = (app.tray_by_id("main"), build_menu(app)) {
        let _ = tray.set_menu(Some(m));
    }
}

fn menu_event(app: &AppHandle, id: &str) {
    let p = app.state::<State>().lock().unwrap().prefs.clone();
    match id {
        "toggle" => {
            let visible = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
            if visible && !p.hidden {
                hide_corner(app)
            } else {
                show(app, false)
            }
        }
        "tuck" => set_pref_inner(app, "tucked", !p.tucked),
        "settings" => {
            show(app, false);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.emit("command", "settings");
            }
        }
        "sound" => set_pref_inner(app, "sound", !p.sound),
        "notify" => set_pref_inner(app, "notify", !p.notify),
        "login" => set_pref_inner(app, "startAtLogin", !p.start_at_login),
        "setup" => setup::open(app),
        "update" => update::install(app),
        "uninstall" => uninstall::start(app),
        "quit" => {
            engine::stop(app);
            app.exit(0);
        }
        _ => {}
    }
}

// ---- what the screen asks for ----

#[tauri::command]
fn log_line(line: String) {
    log(&line.chars().take(300).collect::<String>());
}

#[tauri::command]
fn hit_areas(rects: Vec<Rect>, state: tauri::State<State>) {
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
fn drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn prefs(state: tauri::State<State>) -> serde_json::Value {
    prefs_view(&state.lock().unwrap().prefs)
}

#[tauri::command]
fn set_pref(app: AppHandle, key: String, on: bool) {
    set_pref_inner(&app, &key, on);
}

#[tauri::command]
fn menu(app: AppHandle, window: WebviewWindow) {
    if let Ok(m) = build_menu(&app) {
        let _ = window.popup_menu(&m);
    }
}

#[tauri::command]
fn hide(app: AppHandle) {
    hide_corner(&app);
}

#[tauri::command]
fn asleep(asleep: bool, state: tauri::State<State>) {
    state.lock().unwrap().asleep = asleep;
}

/// A newer app, if there is one (Roger's panel shows it).
#[tauri::command]
fn update_info() -> update::AppUpdate {
    update::current()
}

/// Update the app now (the panel's Update button).
#[tauri::command]
fn install_update(app: AppHandle) {
    update::install(&app);
}

/// The version the app was just updated to, once, so Roger can say it after the restart.
#[tauri::command]
fn just_updated(app: AppHandle) -> Option<String> {
    update::just_updated(&app)
}

/// A request or a finished chat came: hidden or tucked away, the companion comes back.
#[tauri::command]
fn come_back(app: AppHandle) {
    let p = app.state::<State>().lock().unwrap().prefs.clone();
    if !p.notify {
        return;
    }
    let visible = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if !visible || p.hidden {
        log("corner: a chat finished or needs you: coming back");
        show(&app, false);
    }
    if p.tucked {
        set_pref_inner(&app, "tucked", false);
    }
}

/// `--check scan|node|engine|connect`: runs one setup step and prints what it found, without any
/// window. For testing on a computer, and in CI.
fn self_check() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    // The Windows uninstaller runs this first (windows/hooks.nsh): Airband comes out of every agent.
    if args.iter().any(|a| a == "--uninstall") {
        for l in uninstall::take_out(args.iter().any(|a| a == "--purge")) {
            println!("{l}");
        }
        return Some(0);
    }
    let what = args.iter().position(|a| a == "--check").and_then(|i| args.get(i + 1))?.clone();
    let print = |r: Result<serde_json::Value, String>| match r {
        Ok(v) => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            0
        }
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    };
    let progress = |step: &str, got: u64, total: u64| eprintln!("{step}: {got} of about {total} bytes");
    Some(match what.as_str() {
        "scan" => print(serde_json::to_value(setup::look()).map_err(|e| e.to_string())),
        "node" => print(setup::node_from_nodejs(&progress).map(serde_json::Value::from)),
        "engine" => print(setup::engine_from_npm(&progress).map(serde_json::Value::from)),
        "connect" => print(setup::connect()),
        _ => {
            eprintln!("--check scan, node, engine or connect");
            2
        }
    })
}

/// The app's own environment, before anything reads it. macOS can hand an app the environment of an
/// earlier start (one from a test, or from inside an AI agent's terminal), and the engine inherits it.
/// Two kinds of variable are dropped: Airband's and the agents' folders when they point into a
/// temporary folder (only a test puts them there), and the variables of the AI agent session that
/// started the app, which belong to that session, not to Roger.
fn clean_environment() {
    let temporary =
        |v: &str| ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"].iter().any(|t| v.starts_with(t));
    let mut dropped = vec![];
    for key in [
        "AIRBAND_HOME",
        "AIRBAND_DEBUG_DIR",
        "AIRBAND_ENGINE_DIR",
        "CLAUDE_CONFIG_DIR",
        "CODEX_HOME",
        "GEMINI_CLI_HOME",
    ] {
        if std::env::var(key).is_ok_and(|v| temporary(&v)) {
            std::env::remove_var(key);
            dropped.push(key.to_string());
        }
    }
    // A test's switch, never wanted by a person who opened the app.
    if !cfg!(debug_assertions) && std::env::var("AIRBAND_SKIP_SETUP").is_ok() {
        std::env::remove_var("AIRBAND_SKIP_SETUP");
        dropped.push("AIRBAND_SKIP_SETUP".into());
    }
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE"
            || key.starts_with("CLAUDE_CODE_")
            || key == "CLAUDE_PID"
            || key == "CLAUDE_AGENT_SDK_VERSION"
        {
            std::env::remove_var(&key);
            dropped.push(key);
        }
    }
    if !dropped.is_empty() {
        log(&format!("start: left out {} inherited from where the app was started", dropped.join(", ")));
    }
}

fn main() {
    clean_environment();
    if let Some(code) = self_check() {
        std::process::exit(code);
    }
    // Started from the disk image: move to Applications and start from there.
    install::offer_move();
    let state: State = Arc::new(Mutex::new(Shared {
        prefs: load_prefs(),
        hits: vec![],
        passing: true,
        asleep: false,
        side: "right",
        vertical: "bottom",
        last_move: None,
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // `airband --update` while Airband runs: the running one updates.
            if args.iter().any(|a| a == "--update") {
                update::check_and_install(app);
                return;
            }
            // Opened again: show what is there instead of a second copy.
            if app.get_webview_window("main").is_some() {
                show(app, true);
            } else {
                setup::open(app);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            // The shortcut itself is registered in `setup`: one another app already holds must not
            // stop Airband from starting.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let p = app.state::<State>().lock().unwrap().prefs.clone();
                        let visible = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
                        if !visible || p.tucked {
                            show(app, true)
                        } else if let Some(w) = app.get_webview_window("main") {
                            let _ = w.emit("command", "toggle");
                        }
                    }
                })
                .build(),
        )
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            log_line,
            hit_areas,
            drag,
            prefs,
            set_pref,
            menu,
            hide,
            asleep,
            come_back,
            setup::scan,
            setup::install_node,
            setup::install_engine,
            setup::connect_agents,
            setup::finish,
            setup::open_url,
            update_info,
            install_update,
            just_updated,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            // `--update` in a terminal: update the app, say what happened, and stop.
            if std::env::args().any(|a| a == "--update") {
                tauri::async_runtime::spawn(async move {
                    let code = update::from_terminal(&handle).await;
                    handle.exit(code);
                });
                return Ok(());
            }
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let tray_icon = if cfg!(target_os = "macos") {
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
            } else {
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-color.png"))?
            };
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Airband")
                .menu(&build_menu(&handle)?)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, e| menu_event(app, e.id().as_ref()))
                .build(app)?;
            let p = state.lock().unwrap().prefs.clone();
            login_item(&handle, p.start_at_login);
            watch_pointer(handle.clone(), state.clone());
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = handle.global_shortcut().register(SHORTCUT) {
                    log(&format!("start: the shortcut {SHORTCUT} is taken, so Airband has none: {e}"));
                }
            }
            // Set up: the engine starts and the corner opens. Not yet: the setup tour.
            if p.set_up && engine::ready() {
                engine::start(&handle);
            } else {
                setup::open(&handle);
            }
            // Newer engines by themselves, a newer app with one click.
            update::watch(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Airband could not start")
        .run(|app, e| match e {
            // Closing the setup tour or the corner keeps the app in the menu bar.
            tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
            tauri::RunEvent::Exit => engine::stop(app),
            _ => {}
        });
}
