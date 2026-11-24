//! Roger's corner: a borderless, see-through window on the Station's page, that stays on top and
//! lets clicks through everywhere but on what the page draws.
mod pointer;

use crate::logging::log;
use crate::prefs::{apply_start_at_login, PrefKey};
use crate::state::{hooks, AppState, Side, Vertical};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub use pointer::watch_pointer;

/// The corner's window label (capabilities/corner.json grants the Station's page to it).
pub const LABEL: &str = "main";

/// The window: a fixed size, so nothing resizes or flickers; empty parts let clicks through.
pub const WIN_W: f64 = 424.0;
pub const WIN_H: f64 = 700.0;
/// Where the figure sits in it (logical pixels), for the eyes that follow the pointer.
pub const FIG_W: f64 = 104.0;
pub const FIG_H: f64 = 125.0;
pub const FIG_PAD: f64 = 10.0;

/// Left this close to an edge after a drag, the window settles against it.
const SNAP_DISTANCE: f64 = 80.0;
/// A drag is over once the window has not moved for this long.
const MOVE_SETTLES_AFTER: Duration = Duration::from_millis(450);
const MOVE_QUIET: Duration = Duration::from_millis(420);
/// How long the page takes to fade Roger out before the window goes.
const FADE_OUT: Duration = Duration::from_millis(260);

/// The events the page listens to (bridge.js).
pub mod event {
    /// Which way the cards open: `{ side, vertical }`.
    pub const PLACE: &str = "place";
    /// Where the eyes look: `{ dx, dy }`, each -1 to 1.
    pub const CURSOR: &str = "cursor";
    /// Where the pointer is over the window, or null.
    pub const POINTER: &str = "pointer";
    /// Something for the page to do: a [`super::PageCommand`].
    pub const COMMAND: &str = "command";
    /// The settings changed.
    pub const PREFS: &str = "prefs";
    /// A newer app: its update's state.
    pub const UPDATE: &str = "update";
}

/// What the app asks the page to do.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PageCommand {
    /// Roger comes on screen.
    Arrive,
    /// Roger fades out: the window is about to go.
    Leave,
    /// Open the panel.
    Open,
    /// Open or close the panel.
    Toggle,
    /// Open the panel on its settings.
    Settings,
}

/// Roger's window, once it exists.
pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Roger's window is on screen.
pub fn is_visible(app: &AppHandle) -> bool {
    window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

/// Asks the page to do something.
pub fn tell(app: &AppHandle, what: PageCommand) {
    if let Some(w) = window(app) {
        let _ = w.emit(event::COMMAND, what);
    }
}

/// What the Station's page is given to reach the app (bridge.js).
const BRIDGE: &str = include_str!("bridge.js");

/// The screen's area without the menu bar and the Dock or taskbar (logical pixels).
#[derive(Clone, Copy)]
struct Area {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn work_area(w: &WebviewWindow) -> Option<Area> {
    let m = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten())?;
    let s = m.scale_factor();
    let a = m.work_area();
    Some(Area {
        x: a.position.x as f64 / s,
        y: a.position.y as f64 / s,
        w: a.size.width as f64 / s,
        h: a.size.height as f64 / s,
    })
}

/// Puts the window where it was left, or at the bottom right; keeps it on the screen.
fn place(w: &WebviewWindow, state: &AppState) {
    let Some(a) = work_area(w) else { return };
    let at = state.lock().unwrap().prefs.window_at;
    let (mut x, mut y) = at.unwrap_or((a.x + a.w - WIN_W, a.y + a.h - WIN_H));
    x = x.clamp(a.x - WIN_W + FIG_W + 2.0 * FIG_PAD, a.x + a.w - FIG_W - 2.0 * FIG_PAD);
    y = y.clamp(a.y - WIN_H + FIG_H + 2.0 * FIG_PAD, a.y + a.h - FIG_H - 2.0 * FIG_PAD);
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    tell_place(w, state, x, y, a);
}

fn tell_place(w: &WebviewWindow, state: &AppState, x: f64, y: f64, a: Area) {
    let side = if x + WIN_W / 2.0 > a.x + a.w / 2.0 { Side::Right } else { Side::Left };
    let vertical = if y + WIN_H / 2.0 > a.y + a.h / 2.0 { Vertical::Bottom } else { Vertical::Top };
    {
        let mut s = state.lock().unwrap();
        s.side = side;
        s.vertical = vertical;
    }
    let _ = w.emit(event::PLACE, serde_json::json!({ "side": side, "vertical": vertical }));
}

/// After a drag: near an edge, it settles against it; then where it is, is kept.
fn settle(w: &WebviewWindow, state: &AppState) {
    let Some(a) = work_area(w) else { return };
    let Ok(pos) = w.outer_position() else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let (mut x, mut y) = (pos.x as f64 / scale, pos.y as f64 / scale);
    if (a.x + a.w) - (x + WIN_W) < SNAP_DISTANCE {
        x = a.x + a.w - WIN_W;
    } else if x - a.x < SNAP_DISTANCE {
        x = a.x;
    }
    if (a.y + a.h) - (y + WIN_H) < SNAP_DISTANCE {
        y = a.y + a.h - WIN_H;
    } else if y - a.y < SNAP_DISTANCE {
        y = a.y;
    }
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    {
        let mut s = state.lock().unwrap();
        s.prefs.window_at = Some((x, y));
        s.prefs.save();
    }
    tell_place(w, state, x, y, a);
}

/// Roger's corner, on the Station's page.
pub fn open_corner(app: &AppHandle, url: &str) {
    let state = app.state::<AppState>().inner().clone();
    let Ok(target) = url.parse() else { return };
    if let Some(w) = window(app) {
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
    let Ok(w) = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(target))
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
                let _ = w.emit(event::PREFS, p.for_page());
                if !p.hidden {
                    let _ = w.show();
                }
                // The menu was made while the window was still hidden (it shows only once its
                // page loads), so it said "Show Roger" with Roger on screen.
                let a = w.app_handle().clone();
                let _ = w.app_handle().run_on_main_thread(move || (hooks(&a).menu_changed)(&a));
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
                std::thread::sleep(MOVE_SETTLES_AFTER);
                let quiet = st.lock().unwrap().last_move.map(|t| t.elapsed() >= MOVE_QUIET).unwrap_or(false);
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
    (hooks(app).menu_changed)(app);
}

/// Shows Roger; `open` also opens his panel and brings him back from tucked away.
pub fn show(app: &AppHandle, open: bool) {
    let state = app.state::<AppState>().inner().clone();
    let Some(w) = window(app) else { return };
    let was = w.is_visible().unwrap_or(false);
    {
        let mut s = state.lock().unwrap();
        s.prefs.hidden = false;
        if open {
            s.prefs.tucked = false;
        }
        s.prefs.save();
        let _ = w.emit(event::PREFS, s.prefs.for_page());
    }
    let _ = w.show();
    if !was {
        let _ = w.emit(event::COMMAND, PageCommand::Arrive);
    }
    if open {
        let _ = w.set_focus();
        let _ = w.emit(event::COMMAND, PageCommand::Open);
    }
    (hooks(app).menu_changed)(app);
}

/// Hides Roger: the page fades him out, then the window goes. Never a cut.
pub fn hide(app: &AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    {
        let mut s = state.lock().unwrap();
        s.prefs.hidden = true;
        s.prefs.save();
    }
    if let Some(w) = window(app) {
        let _ = w.emit(event::COMMAND, PageCommand::Leave);
        let st = state.clone();
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(FADE_OUT);
            if st.lock().unwrap().prefs.hidden {
                let _ = w.hide();
                let _ = a.run_on_main_thread({
                    let a = a.clone();
                    move || (hooks(&a).menu_changed)(&a)
                });
            }
        });
    }
}

/// Changes one setting, and tells the page and the menu.
pub fn set_pref(app: &AppHandle, key: PrefKey, on: bool) {
    let state = app.state::<AppState>().inner().clone();
    let view = {
        let mut s = state.lock().unwrap();
        s.prefs.set(key, on);
        s.prefs.save();
        s.prefs.for_page()
    };
    if key == PrefKey::StartAtLogin {
        apply_start_at_login(app, on);
    }
    if let Some(w) = window(app) {
        let _ = w.emit(event::PREFS, view);
    }
    (hooks(app).menu_changed)(app);
}
