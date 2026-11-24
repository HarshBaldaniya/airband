use super::{FIG_H, FIG_PAD, FIG_W, WIN_H, WIN_W};
use crate::logging::log;
use crate::state::State;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Watches the pointer: over a clickable part the window takes clicks, elsewhere they go to the
/// windows behind; the eyes follow it. Slower while asleep.
pub fn watch_pointer(app: AppHandle, state: State) {
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
