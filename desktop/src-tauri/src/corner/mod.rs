//! Roger's corner: a borderless, see-through window on the Station's page, that stays on top and
//! lets clicks through everywhere but on what the page draws.
mod landing;
mod pointer;

use crate::logging::log;
use crate::prefs::{apply_start_at_login, PrefKey};
use crate::state::{hooks, lock, save_prefs, AppState, Side, Vertical};
use landing::{Area, Spot};
use serde::Serialize;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

/// Where the mouse button can't be asked, a drag is over once the window has not moved for this long.
const MOVE_SETTLES_AFTER: Duration = Duration::from_millis(450);
/// How often a drag looks at the mouse button, and a glide moves the window: a frame or two.
const DRAG_LOOK: Duration = Duration::from_millis(12);
const GLIDE_STEP: Duration = Duration::from_millis(8);
/// Landing on the other half of the screen, Roger fades out this fast, moves to his window's other
/// side while unseen, and pops back.
const HOP_OUT: Duration = Duration::from_millis(110);
const HOP_DOCK: Duration = Duration::from_millis(60);
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
    /// Fade out quickly: he is about to move to the window's other side.
    Hop,
    /// Pop back in, on his new side.
    Land,
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

/// The port of the Station the corner shows. The corner's window may show only the Station's own
/// pages: its page can call the app (capabilities/corner.json), so a link or a redirect to anywhere
/// else, another server on this computer included, is refused.
static STATION_PORT: AtomicU16 = AtomicU16::new(0);

/// `url` is one of the Station's pages, or an empty frame.
fn is_station_page(url: &Url, station_port: u16) -> bool {
    url.scheme() == "about"
        || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(station_port))
}

fn allow_navigation(url: &Url) -> bool {
    let allowed = is_station_page(url, STATION_PORT.load(Ordering::Relaxed));
    if !allowed {
        log(&format!("corner: refused to leave the Station for {}", url.origin().ascii_serialization()));
    }
    allowed
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

/// Puts Roger where he was left, or at the bottom right, wholly on the screen.
fn place(w: &WebviewWindow, state: &AppState) {
    let Some(a) = work_area(w) else { return };
    let (figure_at, window_at) = {
        let s = lock(state);
        (s.prefs.figure_at, s.prefs.window_at)
    };
    let at = match (figure_at, window_at) {
        (Some((x, y)), _) => Spot { x, y },
        // Saved by an older app: the window's place, with the cards opening as they did then.
        (None, Some(win)) => {
            let side = if win.0 + WIN_W / 2.0 > a.x + a.w / 2.0 { Side::Right } else { Side::Left };
            let vertical = if win.1 + WIN_H / 2.0 > a.y + a.h / 2.0 { Vertical::Bottom } else { Vertical::Top };
            landing::figure_in(win, side, vertical)
        }
        (None, None) => Spot { x: f64::MAX, y: f64::MAX },
    };
    let at = landing::on_screen(at, a);
    let (side, vertical) = landing::dock_for(at, a);
    move_window(w, landing::window_for(at, side, vertical));
    tell_place(w, state, side, vertical);
}

fn tell_place(w: &WebviewWindow, state: &AppState, side: Side, vertical: Vertical) {
    {
        let mut s = lock(state);
        s.side = side;
        s.vertical = vertical;
    }
    let _ = w.emit(event::PLACE, serde_json::json!({ "side": side, "vertical": vertical }));
}

/// When the app last moved the window itself (ms since it started): a move this soon after is the
/// app's own (placing it, a glide), not a drag, and starts no landing.
static OWN_MOVE_AT: AtomicU64 = AtomicU64::new(0);
const OWN_MOVE_MS: u64 = 150;

fn clock_ms() -> u64 {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64 + OWN_MOVE_MS
}

fn move_window(w: &WebviewWindow, (x, y): (f64, f64)) {
    OWN_MOVE_AT.store(clock_ms(), Ordering::Relaxed);
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
}

/// The window glides to `to`, eased, a few milliseconds a step.
fn glide(w: &WebviewWindow, from: (f64, f64), to: (f64, f64)) {
    let distance = (to.0 - from.0).hypot(to.1 - from.1);
    if distance < 0.5 {
        return;
    }
    let time = landing::glide_time(distance);
    let start = std::time::Instant::now();
    loop {
        let t = (start.elapsed().as_secs_f64() / time.as_secs_f64()).min(1.0);
        let k = landing::ease(t);
        move_window(w, (from.0 + (to.0 - from.0) * k, from.1 + (to.1 - from.1) * k));
        if t >= 1.0 {
            break;
        }
        std::thread::sleep(GLIDE_STEP);
    }
}

/// After a drag: Roger glides to where he lands, pulled onto any edge near him, and the cards
/// open towards the middle from there. Landing on the other half of the screen, he hops to his
/// window's other side first, unseen, so he never jumps across it. Where he is, is kept.
fn land(w: &WebviewWindow, state: &AppState) {
    let Some(a) = work_area(w) else { return };
    let Ok(pos) = w.outer_position() else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let win = (pos.x as f64 / scale, pos.y as f64 / scale);
    let (side, vertical) = {
        let s = lock(state);
        (s.side, s.vertical)
    };
    let now = landing::figure_in(win, side, vertical);
    let to = landing::landing(now, a);
    let (new_side, new_vertical) = landing::dock_for(to, a);
    let mut from = win;
    if (new_side, new_vertical) != (side, vertical) {
        let app = w.app_handle();
        tell(app, PageCommand::Hop);
        std::thread::sleep(HOP_OUT);
        from = landing::window_for(now, new_side, new_vertical);
        move_window(w, from);
        tell_place(w, state, new_side, new_vertical);
        std::thread::sleep(HOP_DOCK);
        tell(app, PageCommand::Land);
    }
    glide(w, from, landing::window_for(to, new_side, new_vertical));
    {
        let mut s = lock(state);
        s.prefs.figure_at = Some((to.x, to.y));
        s.prefs.window_at = Some(landing::window_for(to, new_side, new_vertical));
    }
    save_prefs(state);
}

/// Waits for each drag to end, then lands Roger. A drag is over the moment the button is let go;
/// where the button can't be asked, once the window has stood still for a moment.
fn watch_drags(w: WebviewWindow, state: AppState, moves: mpsc::Receiver<()>) {
    while moves.recv().is_ok() {
        loop {
            match crate::macos::left_button_down() {
                Some(true) => std::thread::sleep(DRAG_LOOK),
                Some(false) => break,
                None => {
                    if moves.recv_timeout(MOVE_SETTLES_AFTER).is_err() {
                        break;
                    }
                }
            }
        }
        land(&w, &state);
        // Moves that came while it landed were its own.
        while moves.try_recv().is_ok() {}
    }
}

/// Roger's corner, on the Station's page.
pub fn open_corner(app: &AppHandle, url: &str) {
    let state = app.state::<AppState>().inner().clone();
    let Ok(target) = Url::parse(url) else { return };
    let port = target.port().unwrap_or(0);
    if port == 0 || !is_station_page(&target, port) {
        log("corner: not the Station's address, left closed");
        return;
    }
    STATION_PORT.store(port, Ordering::Relaxed);
    if let Some(w) = window(app) {
        // Only a new address loads the page again: the same one is left as it is.
        if w.url().map(|u| u.as_str() != url).unwrap_or(true) {
            log("corner: a new address, loading it");
            let _ = w.navigate(target);
        }
        return;
    }
    log(&format!("corner: opening {}", url.split('?').next().unwrap_or(url)));
    let hidden = lock(&state).prefs.hidden;
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
        .on_navigation(allow_navigation)
        .on_page_load(move |w, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                place(&w, &place_state);
                let p = lock(&place_state).prefs.clone();
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
    lock(&state).passing = true;
    // One thread lands Roger after each drag. The window's own moves (placing it, a glide) are
    // not a drag.
    let (moved, moves) = mpsc::channel::<()>();
    let (drag_w, drag_state) = (w.clone(), state.clone());
    std::thread::spawn(move || watch_drags(drag_w, drag_state, moves));
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::Moved(_) = e {
            if clock_ms().saturating_sub(OWN_MOVE_AT.load(Ordering::Relaxed)) > OWN_MOVE_MS {
                let _ = moved.send(());
            }
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
    let view = {
        let mut s = lock(&state);
        s.prefs.hidden = false;
        if open {
            s.prefs.tucked = false;
        }
        s.prefs.for_page()
    };
    save_prefs(&state);
    let _ = w.emit(event::PREFS, view);
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
    lock(&state).prefs.hidden = true;
    save_prefs(&state);
    if let Some(w) = window(app) {
        let _ = w.emit(event::COMMAND, PageCommand::Leave);
        let st = state.clone();
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(FADE_OUT);
            if lock(&st).prefs.hidden {
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
        let mut s = lock(&state);
        s.prefs.set(key, on);
        s.prefs.for_page()
    };
    save_prefs(&state);
    if key == PrefKey::StartAtLogin {
        apply_start_at_login(app, on);
    }
    if let Some(w) = window(app) {
        let _ = w.emit(event::PREFS, view);
    }
    (hooks(app).menu_changed)(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_corner_shows_only_the_stations_pages() {
        let ok = |u: &str| is_station_page(&Url::parse(u).unwrap(), 4123);
        assert!(ok("http://127.0.0.1:4123/app?mode=desktop&t=k"));
        assert!(ok("http://127.0.0.1:4123/other"));
        assert!(ok("about:blank"));
        assert!(!ok("http://127.0.0.1:4124/app"));
        assert!(!ok("http://localhost:4123/app"));
        assert!(!ok("https://127.0.0.1:4123/app"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("file:///etc/passwd"));
    }
}
