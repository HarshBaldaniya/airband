//! Watching the pointer, which a window that lets clicks through never hears about.
use super::{event, window, FIG_H, FIG_PAD, FIG_W, WIN_H, WIN_W};
use crate::logging::log;
use crate::state::{AppState, Side, Vertical};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// How often the pointer is looked at, awake and asleep.
const POLL_AWAKE: Duration = Duration::from_millis(60);
const POLL_ASLEEP: Duration = Duration::from_millis(400);

/// Further than this from the figure, the eyes look ahead again.
const EYES_REACH: f64 = 700.0;
/// How far away, sideways and up or down, the eyes look all the way to that side.
const EYES_RANGE_X: f64 = 360.0;
const EYES_RANGE_Y: f64 = 280.0;
/// How much of the way to the pointer the eyes move each look: they ease, never jump.
const EYES_EASE: f64 = 0.22;
/// The eyes move in steps of 1/20, so a pointer that barely moves sends nothing.
const EYES_STEPS: f64 = 20.0;

/// Watches the pointer: over a clickable part the window takes clicks, elsewhere they go to the
/// windows behind; the eyes follow it. Slower while asleep.
pub fn watch_pointer(app: AppHandle, state: AppState) {
    std::thread::spawn(move || {
        let mut eased = (0.0f64, 0.0f64);
        let mut last = String::new();
        // Where the pointer is over Roger, for the page's own hover: a window that is not in
        // front gets no mouse-moved events, so after a click that opened another app, :hover
        // would stay on the row that was clicked.
        let mut last_point = String::new();
        loop {
            let asleep = state.lock().unwrap().asleep;
            std::thread::sleep(if asleep { POLL_ASLEEP } else { POLL_AWAKE });
            let Some(w) = window(&app) else { continue };
            if !w.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(c), Ok(pos), Ok(scale)) = (app.cursor_position(), w.outer_position(), w.scale_factor()) else {
                continue;
            };
            let (cx, cy) = ((c.x - pos.x as f64) / scale, (c.y - pos.y as f64) / scale);
            let (over, side, vertical, passing) = {
                let s = state.lock().unwrap();
                (s.hits.iter().any(|r| r.contains(cx, cy)), s.side, s.vertical, s.passing)
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
                let at = if over { serde_json::json!({ "x": cx, "y": cy }) } else { serde_json::Value::Null };
                let _ = w.emit(event::POINTER, at);
            }
            if asleep {
                continue;
            }
            let (dx, dy) = look_at(cx, cy, side, vertical);
            eased.0 += (dx - eased.0) * EYES_EASE;
            eased.1 += (dy - eased.1) * EYES_EASE;
            let (qx, qy) = ((eased.0 * EYES_STEPS).round() / EYES_STEPS, (eased.1 * EYES_STEPS).round() / EYES_STEPS);
            let key = format!("{qx:.2},{qy:.2}");
            if key != last {
                last = key;
                let _ = w.emit(event::CURSOR, serde_json::json!({ "dx": qx, "dy": qy }));
            }
        }
    });
}

/// Where the eyes look, -1 to 1 each way, for a pointer at (x, y) in the window.
fn look_at(x: f64, y: f64, side: Side, vertical: Vertical) -> (f64, f64) {
    let fx = if side == Side::Right { WIN_W - FIG_PAD - FIG_W / 2.0 } else { FIG_PAD + FIG_W / 2.0 };
    let fy = if vertical == Vertical::Bottom { WIN_H - FIG_PAD - FIG_H / 2.0 } else { FIG_PAD + FIG_H / 2.0 };
    if (x - fx).hypot(y - fy) > EYES_REACH {
        return (0.0, 0.0);
    }
    (((x - fx) / EYES_RANGE_X).clamp(-1.0, 1.0), ((y - fy) / EYES_RANGE_Y).clamp(-1.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_eyes_follow_a_near_pointer_and_rest_for_a_far_one() {
        let fx = WIN_W - FIG_PAD - FIG_W / 2.0;
        let fy = WIN_H - FIG_PAD - FIG_H / 2.0;
        assert_eq!(look_at(fx, fy, Side::Right, Vertical::Bottom), (0.0, 0.0));
        assert_eq!(look_at(fx - EYES_RANGE_X, fy, Side::Right, Vertical::Bottom), (-1.0, 0.0));
        assert_eq!(look_at(fx - 2.0 * EYES_RANGE_X, fy, Side::Right, Vertical::Bottom), (0.0, 0.0));
    }
}
