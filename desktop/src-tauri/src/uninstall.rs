//! Uninstalling Airband. Moving the app to the Bin runs no code, so Airband stayed in every agent:
//! its skills, hooks and tools, the `airband` command, and ~/.airband. "Uninstall Airband…" in the
//! menu takes all of it out. On a Mac the app does it itself. On Windows the menu opens the app's
//! uninstaller, which first runs `Airband.exe --uninstall` (windows/hooks.nsh), so Settings → Apps →
//! Uninstall does the same.
use crate::engine;
use crate::logging::{self, log};
use crate::macos::{self, Dialog, Icon};
use crate::paths::{home, user_home};
use crate::process::{self, command, find_command};
use crate::station::StationFile;
use tauri::AppHandle;

/// Takes Airband out of every agent and removes the `airband` command. `purge` also removes
/// ~/.airband (chat records, the map, the engine): to the Bin on a Mac, deleted elsewhere.
pub fn take_out(purge: bool) -> Vec<String> {
    let mut said = Vec::new();
    // The Station keeps running on its own (Roger's engine): it is stopped first.
    if let Some(pid) = StationFile::read().and_then(|s| s.pid) {
        process::kill(pid);
    }
    // The engine's own `remove`, with the engine the setup fetched, or else the `airband` command.
    let js = engine::engine_js();
    let run = match engine::node() {
        Some(node) if js.exists() => {
            let mut c = command(node);
            c.arg(&js);
            Some(c)
        }
        _ => find_command("airband").map(command),
    };
    match run {
        Some(mut c) => match c.args(["remove", "--command"]).output() {
            Ok(o) => said.extend(
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.starts_with("Your data stays"))
                    .map(String::from),
            ),
            Err(e) => said.push(format!("Couldn't run Airband's engine: {e}")),
        },
        None => said.push("No agent had Airband in it.".into()),
    }
    // Logged now: app.log is in ~/.airband, which may go next.
    for l in &said {
        log(&format!("uninstall: {l}"));
    }
    if purge {
        logging::stop();
        let dir = home();
        if dir.exists() {
            let r = if cfg!(target_os = "macos") {
                macos::move_to_trash(&dir, "Airband data").map(|_| ())
            } else {
                std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
            };
            said.push(match r {
                Ok(()) if cfg!(target_os = "macos") => "Airband's data moved to the Bin.".into(),
                Ok(()) => format!("Deleted {}.", dir.display()),
                Err(e) => format!("Couldn't remove {}: {e}", dir.display()),
            });
        }
    }
    said
}

/// What the person picked in the confirmation.
#[derive(PartialEq)]
enum Choice {
    Cancel,
    KeepData,
    Everything,
}

const TITLE: &str = "Uninstall Airband";
const KEEP_DATA: &str = "Keep my data";
const EVERYTHING: &str = "Remove everything";

fn ask() -> Choice {
    let answer = Dialog {
        title: TITLE,
        message: "Airband comes out of Claude Code, Codex and Gemini CLI, with its skills, its tools and the airband command, and the app moves to the Bin.\n\nYour chat records and the map can stay, or go to the Bin too.",
        buttons: &["Cancel", KEEP_DATA, EVERYTHING],
        default: EVERYTHING,
        cancel: Some("Cancel"),
        icon: Some(Icon::Caution),
    }
    .ask();
    match answer.ok().flatten().as_deref() {
        Some(EVERYTHING) => Choice::Everything,
        Some(KEEP_DATA) => Choice::KeepData,
        _ => Choice::Cancel,
    }
}

/// "Uninstall Airband…" in the menu.
pub fn start(app: &AppHandle) {
    if cfg!(windows) {
        // The app's own uninstaller asks, takes Airband out (its hook) and removes the app. It has
        // windows of its own, so it is started as it is.
        let uninstaller = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("uninstall.exe")));
        match uninstaller.filter(|u| u.exists()).map(|u| std::process::Command::new(u).spawn()) {
            Some(Ok(_)) => {
                engine::stop();
                app.exit(0);
            }
            _ => log("uninstall: the uninstaller isn't there"),
        }
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let choice = ask();
        if choice == Choice::Cancel {
            return;
        }
        engine::stop();
        take_out(choice == Choice::Everything);
        {
            use tauri_plugin_autostart::ManagerExt;
            let _ = app.autolaunch().disable();
        }
        // What macOS keeps for the app itself: its caches, web storage and saved window state.
        let id = app.config().identifier.clone();
        let library = user_home().join("Library");
        for (dir, name) in [
            ("Caches", id.clone()),
            ("WebKit", id.clone()),
            ("Application Support", id.clone()),
            ("HTTPStorages", id.clone()),
            ("HTTPStorages", format!("{id}.binarycookies")),
            ("Preferences", format!("{id}.plist")),
            ("Saved Application State", format!("{id}.savedState")),
        ] {
            let p = library.join(dir).join(&name);
            if p.exists() {
                let _ = macos::move_to_trash(&p, &format!("Airband {} {name}", dir.to_lowercase()));
            }
        }
        if let Some(bundle) = macos::app_bundle() {
            if let Err(e) = macos::move_to_trash(&bundle, "Airband.app") {
                log(&format!("uninstall: the app stays: {e}"));
            }
        }
        Dialog {
            title: TITLE,
            message: "Airband is uninstalled. Restart any open agent chats to finish.",
            buttons: &["OK"],
            default: "OK",
            cancel: None,
            icon: None,
        }
        .tell();
        app.exit(0);
    });
}
