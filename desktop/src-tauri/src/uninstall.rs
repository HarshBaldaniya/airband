// Uninstalling Airband. Moving the app to the Bin runs no code, so Airband stayed in every agent:
// its skills, hooks and tools, the `airband` command, and ~/.airband. "Uninstall Airband…" in the
// menu takes all of it out. On a Mac the app does it itself. On Windows the menu opens the app's
// uninstaller, which first runs `Airband.exe --uninstall` (windows/hooks.nsh), so Settings → Apps →
// Uninstall does the same.
use crate::engine::{self, hide_window};
use crate::{home, log};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

/// Takes Airband out of every agent and removes the `airband` command. `purge` also removes
/// ~/.airband (chat records, the map, the engine): to the Bin on a Mac, deleted elsewhere.
pub fn take_out(purge: bool) -> Vec<String> {
    let mut said = Vec::new();
    stop_station();
    // The engine's own `remove`, with the engine the setup fetched, or else the `airband` command.
    let js = engine::engine_js();
    let run = match engine::node() {
        Some(node) if js.exists() => {
            let mut c = Command::new(node);
            c.arg(&js);
            Some(c)
        }
        _ => engine::find_command("airband").map(Command::new),
    };
    match run {
        Some(mut c) => {
            c.args(["remove", "--command"]);
            hide_window(&mut c);
            match c.output() {
                Ok(o) => said.extend(
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty() && !l.starts_with("Your data stays"))
                        .map(String::from),
                ),
                Err(e) => said.push(format!("Couldn't run Airband's engine: {e}")),
            }
        }
        None => said.push("No agent had Airband in it.".into()),
    }
    // Logged now: app.log is in ~/.airband, which may go next.
    for l in &said {
        log(&format!("uninstall: {l}"));
    }
    if purge {
        crate::LOG_OFF.store(true, std::sync::atomic::Ordering::Relaxed);
        let dir = home();
        if dir.exists() {
            let r = if cfg!(target_os = "macos") {
                to_bin(&dir, "Airband data").map(|_| ())
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

/// The Station keeps running on its own (Roger's engine): it is stopped first.
fn stop_station() {
    let Some(pid) = std::fs::read_to_string(home().join("station.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["pid"].as_u64())
    else {
        return;
    };
    let mut c = if cfg!(windows) {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    } else {
        let mut c = Command::new("kill");
        c.arg(pid.to_string());
        c
    };
    hide_window(&mut c);
    let _ = c.output();
}

/// Moves a file or folder to the Bin, under `name` (with a number when one is already there).
fn to_bin(path: &Path, name: &str) -> Result<PathBuf, String> {
    let bin = PathBuf::from(std::env::var("HOME").map_err(|e| e.to_string())?).join(".Trash");
    let mut to = bin.join(name);
    for n in 2.. {
        if !to.exists() {
            break;
        }
        to = bin.join(format!("{name} {n}"));
    }
    match std::fs::rename(path, &to) {
        Ok(()) => Ok(to),
        // Another disk, or a folder the Bin can't be renamed into: Finder moves it.
        Err(_) => {
            let ok = Command::new("osascript")
                .args([
                    "-e",
                    "on run argv",
                    "-e",
                    "tell application \"Finder\" to delete (POSIX file (item 1 of argv) as alias)",
                    "-e",
                    "end run",
                    &path.to_string_lossy(),
                ])
                .output()
                .is_ok_and(|o| o.status.success());
            if ok {
                Ok(bin)
            } else {
                Err("it couldn't be moved to the Bin".into())
            }
        }
    }
}

/// What the person picked in the confirmation.
#[derive(PartialEq)]
enum Choice {
    Cancel,
    KeepData,
    Everything,
}

fn ask() -> Choice {
    let say = "Airband comes out of Claude Code, Codex and Gemini CLI, with its skills, its tools and the airband command, and the app moves to the Bin.\n\nYour chat records and the map can stay, or go to the Bin too.";
    let script = format!(
        "display dialog \"{}\" with title \"Uninstall Airband\" buttons {{\"Cancel\", \"Keep my data\", \"Remove everything\"}} default button \"Remove everything\" cancel button \"Cancel\" with icon caution",
        say.replace('"', "\\\"")
    );
    let out = Command::new("osascript").args(["-e", &script]).output();
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    if text.contains("Remove everything") {
        Choice::Everything
    } else if text.contains("Keep my data") {
        Choice::KeepData
    } else {
        Choice::Cancel
    }
}

/// "Uninstall Airband…" in the menu.
pub fn start(app: &AppHandle) {
    if cfg!(windows) {
        // The app's own uninstaller asks, takes Airband out (its hook) and removes the app.
        let uninstaller = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("uninstall.exe")));
        match uninstaller.filter(|u| u.exists()).map(|u| Command::new(u).spawn()) {
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
        let lib = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library");
        for (dir, name) in [
            ("Caches", "dev.airband.app"),
            ("WebKit", "dev.airband.app"),
            ("Application Support", "dev.airband.app"),
            ("HTTPStorages", "dev.airband.app"),
            ("HTTPStorages", "dev.airband.app.binarycookies"),
            ("Preferences", "dev.airband.app.plist"),
            ("Saved Application State", "dev.airband.app.savedState"),
        ] {
            let p = lib.join(dir).join(name);
            if p.exists() {
                let _ = to_bin(&p, &format!("Airband {} {name}", dir.to_lowercase()));
            }
        }
        // The app itself: …/Airband.app/Contents/MacOS/airband.
        if let Some(bundle) = std::env::current_exe()
            .ok()
            .and_then(|e| e.ancestors().nth(3).map(Path::to_path_buf))
            .filter(|b| b.extension().is_some_and(|x| x == "app"))
        {
            if let Err(e) = to_bin(&bundle, "Airband.app") {
                log(&format!("uninstall: the app stays: {e}"));
            }
        }
        let _ = Command::new("osascript").args(["-e", "display dialog \"Airband is uninstalled. Restart any open agent chats to finish.\" with title \"Uninstall Airband\" buttons {\"OK\"} default button \"OK\"" ]).output();
        app.exit(0);
    });
}
