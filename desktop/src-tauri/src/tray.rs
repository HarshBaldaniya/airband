//! The menu-bar (macOS) or tray (Windows) icon's menu, also shown by a right-click on Roger.
use crate::corner::{self, is_visible, PageCommand};
use crate::paths::{self, STATION_SETTINGS};
use crate::prefs::PrefKey;
use crate::state::AppState;
use crate::update::{self, UpdateStep};
use crate::{engine, setup, uninstall};
use std::fs;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};

/// The icon's id.
pub const TRAY_ID: &str = "main";

/// The menu's items.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MenuId {
    Update,
    Setup,
    Toggle,
    Tuck,
    Settings,
    Sound,
    Notify,
    Login,
    Uninstall,
    Quit,
}

impl MenuId {
    const ALL: [MenuId; 10] = [
        MenuId::Update,
        MenuId::Setup,
        MenuId::Toggle,
        MenuId::Tuck,
        MenuId::Settings,
        MenuId::Sound,
        MenuId::Notify,
        MenuId::Login,
        MenuId::Uninstall,
        MenuId::Quit,
    ];

    fn id(self) -> &'static str {
        match self {
            MenuId::Update => "update",
            MenuId::Setup => "setup",
            MenuId::Toggle => "toggle",
            MenuId::Tuck => "tuck",
            MenuId::Settings => "settings",
            MenuId::Sound => "sound",
            MenuId::Notify => "notify",
            MenuId::Login => "login",
            MenuId::Uninstall => "uninstall",
            MenuId::Quit => "quit",
        }
    }

    fn from_id(id: &str) -> Option<MenuId> {
        MenuId::ALL.into_iter().find(|m| m.id() == id)
    }
}

/// The companion's name, from the engine's settings (for the menu).
fn companion_name() -> String {
    fs::read_to_string(paths::file(STATION_SETTINGS))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["companion"]["name"].as_str().map(String::from))
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Roger".into())
}

fn item(app: &AppHandle, id: MenuId, label: impl AsRef<str>, enabled: bool) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, id.id(), label, enabled, None::<&str>)
}

fn check(app: &AppHandle, id: MenuId, label: impl AsRef<str>, on: bool) -> tauri::Result<CheckMenuItem<Wry>> {
    CheckMenuItem::with_id(app, id.id(), label, true, on, None::<&str>)
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let p = app.state::<AppState>().lock().unwrap().prefs.clone();
    let name = companion_name();
    let items = Menu::new(app)?;
    let newer = update::current();
    if let Some(v) = &newer.version {
        let label = match (newer.installing, newer.step, newer.progress) {
            (true, Some(UpdateStep::Downloading), Some(p)) => format!("Downloading Airband {v} · {p}%"),
            (true, Some(UpdateStep::Installing), _) => format!("Installing Airband {v}…"),
            (true, Some(UpdateStep::Restarting), _) => "Starting again…".to_string(),
            (true, _, _) => format!("Updating to {v}…"),
            _ => format!("Update to Airband {v}"),
        };
        items.append(&item(app, MenuId::Update, label, !newer.installing)?)?;
        items.append(&PredefinedMenuItem::separator(app)?)?;
    }
    if !p.set_up || !engine::was_ready() {
        items.append(&item(app, MenuId::Setup, "Set up Airband…", true)?)?;
    } else {
        let shown = is_visible(app) && !p.hidden;
        items.append(&item(
            app,
            MenuId::Toggle,
            if shown { format!("Hide {name}") } else { format!("Show {name}") },
            true,
        )?)?;
        let tuck = if p.tucked { format!("Bring {name} back") } else { format!("Tuck {name} away") };
        items.append(&item(app, MenuId::Tuck, tuck, true)?)?;
        items.append(&item(app, MenuId::Settings, "Settings…", true)?)?;
        items.append(&PredefinedMenuItem::separator(app)?)?;
        items.append(&check(app, MenuId::Sound, "Sounds", p.sound)?)?;
        items.append(&check(app, MenuId::Notify, format!("{name} comes back when a chat needs you"), p.notify)?)?;
        items.append(&check(app, MenuId::Login, "Start at login", p.start_at_login)?)?;
        items.append(&PredefinedMenuItem::separator(app)?)?;
        items.append(&item(app, MenuId::Setup, "Run the setup tour again…", true)?)?;
    }
    // Moving the app to the Bin would leave Airband in every agent: this takes it all out.
    if cfg!(any(target_os = "macos", windows)) {
        items.append(&item(app, MenuId::Uninstall, "Uninstall Airband…", true)?)?;
    }
    items.append(&item(app, MenuId::Quit, "Quit Airband", true)?)?;
    Ok(items)
}

/// Builds the menu again, to show what changed.
pub fn refresh_menu(app: &AppHandle) {
    if let (Some(tray), Ok(m)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(m));
    }
}

pub fn menu_event(app: &AppHandle, id: &str) {
    let Some(id) = MenuId::from_id(id) else { return };
    let p = app.state::<AppState>().lock().unwrap().prefs.clone();
    let flip = |key: PrefKey| corner::set_pref(app, key, !p.get(key));
    match id {
        MenuId::Toggle if is_visible(app) && !p.hidden => corner::hide(app),
        MenuId::Toggle => corner::show(app, false),
        MenuId::Tuck => flip(PrefKey::Tucked),
        MenuId::Settings => {
            corner::show(app, false);
            corner::tell(app, PageCommand::Settings);
        }
        MenuId::Sound => flip(PrefKey::Sound),
        MenuId::Notify => flip(PrefKey::Notify),
        MenuId::Login => flip(PrefKey::StartAtLogin),
        MenuId::Setup => setup::open(app),
        MenuId::Update => update::install(app),
        MenuId::Uninstall => uninstall::start(app),
        MenuId::Quit => {
            engine::stop();
            app.exit(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_menu_id_reads_back() {
        for m in MenuId::ALL {
            assert_eq!(MenuId::from_id(m.id()), Some(m));
        }
        assert_eq!(MenuId::from_id("nope"), None);
    }
}
