//! The menu-bar (macOS) or tray (Windows) icon's menu, also shown by a right-click on Roger.
use crate::corner::{hide_corner, set_pref_inner, show};
use crate::paths::home;
use crate::state::State;
use crate::{engine, setup, uninstall, update};
use std::fs;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager};

/// The companion's name, from the engine's settings (for the menu).
fn companion_name() -> String {
    fs::read_to_string(home().join("station-settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["companion"]["name"].as_str().map(String::from))
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Roger".into())
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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

pub fn menu_event(app: &AppHandle, id: &str) {
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
            engine::stop();
            app.exit(0);
        }
        _ => {}
    }
}
