//! The screens, Roger's window and the pointer, all in one unit, so that a drag and a landing line
//! up on every screen. On a Mac that is the system's points: each screen, the window and the
//! pointer are given in pixels of their own scale (the pointer in the main screen's), and
//! dividing each by its own scale gives the one space macOS lays screens out in. Elsewhere screen
//! pixels are already one space, and the window's scale turns them into the page's units.
use super::landing::Area;
use tauri::{Monitor, WebviewWindow};

/// A screen: all of it, and the part not under the menu bar, the Dock or the taskbar.
#[derive(Clone, Copy, Debug)]
pub struct Screen {
    pub whole: Area,
    pub work: Area,
}

fn scale_of(w: &WebviewWindow) -> f64 {
    w.scale_factor().unwrap_or(1.0)
}

/// Pixels given in `own` scale, in this module's unit.
fn units(px: f64, own: f64, window: f64) -> f64 {
    if cfg!(target_os = "macos") {
        px / own
    } else {
        px / window
    }
}

/// The window's top-left corner.
pub fn window_at(w: &WebviewWindow) -> Option<(f64, f64)> {
    let p = w.outer_position().ok()?;
    let s = scale_of(w);
    Some((units(p.x as f64, s, s), units(p.y as f64, s, s)))
}

/// Where the pointer is.
pub fn pointer(w: &WebviewWindow) -> Option<(f64, f64)> {
    let c = w.cursor_position().ok()?;
    let main = w.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let s = scale_of(w);
    Some((units(c.x, main, s), units(c.y, main, s)))
}

fn screen_of(m: &Monitor, window_scale: f64) -> Screen {
    let own = m.scale_factor();
    let area = |x: i32, y: i32, wd: u32, ht: u32| Area {
        x: units(x as f64, own, window_scale),
        y: units(y as f64, own, window_scale),
        w: units(wd as f64, own, window_scale),
        h: units(ht as f64, own, window_scale),
    };
    let (p, z, wa) = (m.position(), m.size(), m.work_area());
    Screen {
        whole: area(p.x, p.y, z.width, z.height),
        work: area(wa.position.x, wa.position.y, wa.size.width, wa.size.height),
    }
}

/// The screen a point is on; off every screen, the nearest one.
pub fn screen_at(w: &WebviewWindow, (x, y): (f64, f64)) -> Option<Screen> {
    let s = scale_of(w);
    let all: Vec<Screen> = w.available_monitors().ok()?.iter().map(|m| screen_of(m, s)).collect();
    let gap = |a: &Area| {
        let dx = (a.x - x).max(x - (a.x + a.w)).max(0.0);
        let dy = (a.y - y).max(y - (a.y + a.h)).max(0.0);
        dx.hypot(dy)
    };
    all.into_iter().min_by(|a, b| gap(&a.whole).total_cmp(&gap(&b.whole)))
}
