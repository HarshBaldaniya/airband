//! Roger's corner: a borderless, see-through window on the Station's page, that stays on top and
//! lets clicks through everywhere but on what the page draws.
mod pointer;

use crate::logging::log;
use crate::prefs::{login_item, prefs_view, save_prefs};
use crate::state::State;
use crate::tray::refresh_menu;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub use pointer::watch_pointer;

/// The window: a fixed size, so nothing resizes or flickers; empty parts let clicks through.
pub const WIN_W: f64 = 424.0;

pub const WIN_H: f64 = 700.0;
/// Where the figure sits in it (logical pixels), for the eyes that follow the pointer.
pub const FIG_W: f64 = 104.0;

pub const FIG_H: f64 = 125.0;

pub const FIG_PAD: f64 = 10.0;

/// Roger's window is on screen.
pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

/// What the Station's page is given to reach the app (bridge.js).
const BRIDGE: &str = include_str!("bridge.js");

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

pub fn show(app: &AppHandle, open: bool) {
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

pub fn hide_corner(app: &AppHandle) {
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

pub fn set_pref_inner(app: &AppHandle, key: &str, on: bool) {
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
