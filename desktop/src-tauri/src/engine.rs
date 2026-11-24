// Airband's engine: the Station (`airband station`), run with Node. The app starts it, waits for
// it to write ~/.airband/station.json, opens Roger's corner on its page, and starts it again if it
// stops. The engine is the npm package the setup tour fetched (or AIRBAND_ENGINE_DIR, for
// development). Node is the computer's own, or the one the setup tour fetched.
use crate::{home, open_corner};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

static CHILD: Mutex<Option<Child>> = Mutex::new(None);
/// The engine is stopped on purpose, to start again on newer files (after an update).
static RESTART: AtomicBool = AtomicBool::new(false);

/// The engine's command line (airband.js).
pub fn engine_js() -> PathBuf {
    if let Ok(d) = std::env::var("AIRBAND_ENGINE_DIR") {
        return PathBuf::from(d).join("airband.js");
    }
    home().join("engine").join("package").join("airband.js")
}

/// The Node the setup tour fetched, if it did.
pub fn own_node() -> PathBuf {
    let dir = home().join("runtime").join("node");
    if cfg!(windows) {
        dir.join("node.exe")
    } else {
        dir.join("bin").join("node")
    }
}

/// The computer's own `node`, through the person's login shell (where nvm and Homebrew put it).
pub fn system_node() -> Option<PathBuf> {
    find_command("node")
}

/// A command's full path: on the PATH, or where its installer usually puts it (the engine's
/// `findCommand` looks in the same places, so the setup tour and Roger agree).
pub fn find_command(name: &str) -> Option<PathBuf> {
    refresh_path();
    on_path(name).or_else(|| usual_places(name).into_iter().find(|p| p.is_file()))
}

fn on_path(name: &str) -> Option<PathBuf> {
    let out = if cfg!(windows) {
        let mut c = Command::new("where");
        c.arg(name);
        hide_window(&mut c);
        c.output().ok()?
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        Command::new(shell).args(["-lc", &format!("command -v {name}")]).output().ok()?
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let runs = |l: &str| {
        let l = l.to_ascii_lowercase();
        cfg!(not(windows)) || l.ends_with(".exe") || l.ends_with(".cmd")
    };
    let line = text.lines().map(str::trim).find(|l| !l.is_empty() && runs(l))?;
    let p = PathBuf::from(line);
    p.exists().then_some(p)
}

fn usual_places(name: &str) -> Vec<PathBuf> {
    let home = PathBuf::from(std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default());
    if cfg!(windows) {
        let env = |k: &str, or: PathBuf| std::env::var(k).map(PathBuf::from).unwrap_or(or);
        let roaming = env("APPDATA", home.join("AppData").join("Roaming"));
        let local = env("LOCALAPPDATA", home.join("AppData").join("Local"));
        let programs = env("ProgramFiles", PathBuf::from("C:\\Program Files"));
        vec![
            roaming.join("npm").join(format!("{name}.cmd")),
            home.join(".local").join("bin").join(format!("{name}.exe")),
            local.join("Microsoft").join("WinGet").join("Links").join(format!("{name}.exe")),
            programs.join("nodejs").join(format!("{name}.exe")),
        ]
    } else {
        vec![
            home.join(".local").join("bin").join(name),
            PathBuf::from(format!("/opt/homebrew/bin/{name}")),
            PathBuf::from(format!("/usr/local/bin/{name}")),
            PathBuf::from(format!("/usr/bin/{name}")),
        ]
    }
}

/// Windows gives a program the PATH of the moment it started. A tool installed since then (Claude
/// Code's installer adds %USERPROFILE%\.local\bin, npm adds its own folder) is only in the
/// registry, so "Check again" never found it. The PATH is read again from there, and each new
/// folder is added after what the app already had. The engine and the terminals Roger opens get it too.
pub fn refresh_path() {
    #[cfg(windows)]
    {
        let read = |key: &str| -> Option<String> {
            let mut c = Command::new("reg");
            c.args(["query", key, "/v", "Path"]);
            hide_window(&mut c);
            let out = c.output().ok()?;
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            let line = text.lines().find(|l| l.contains("REG_"))?;
            let value = line[line.find("REG_")?..].split_once(char::is_whitespace)?.1.trim().to_string();
            Some(expand(&value, |k| std::env::var(k).ok()))
        };
        let now = std::env::var("PATH").unwrap_or_default();
        let saved = [r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment", r"HKCU\Environment"]
            .iter()
            .filter_map(|k| read(k))
            .collect::<Vec<_>>()
            .join(";");
        let merged = merge_path(&now, &saved);
        if merged != now {
            std::env::set_var("PATH", merged);
        }
    }
}

/// `%NAME%` replaced by its value. An unknown one is left as it is.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn expand(value: &str, var: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        let after = &rest[a + 1..];
        match after.find('%') {
            Some(b) => {
                let name = &after[..b];
                match (!name.is_empty()).then(|| var(name)).flatten() {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&format!("%{name}%")),
                }
                rest = &after[b + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The PATH the app has, then each folder of `saved` it lacks. Folders compare as Windows compares
/// them: case and a last backslash do not count.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn merge_path(now: &str, saved: &str) -> String {
    let key = |d: &str| d.trim().trim_end_matches(['\\', '/']).to_ascii_lowercase();
    let mut seen: Vec<String> = now.split(';').map(key).filter(|d| !d.is_empty()).collect();
    let mut out = now.trim_end_matches(';').to_string();
    for d in saved.split(';').map(str::trim).filter(|d| !d.is_empty()) {
        if !seen.contains(&key(d)) {
            seen.push(key(d));
            if !out.is_empty() {
                out.push(';');
            }
            out.push_str(d);
        }
    }
    out
}

/// The oldest Node.js the engine runs on (its package.json "engines").
pub const NODE_MIN: u32 = 20;

/// What a command says to `--version`, first line.
pub fn version_of(cmd: &Path) -> Option<String> {
    let mut c = Command::new(cmd);
    c.arg("--version");
    hide_window(&mut c);
    let out = c.output().ok()?;
    let t = String::from_utf8_lossy(&out.stdout).trim().lines().next()?.to_string();
    (!t.is_empty()).then_some(t)
}

/// "v22.3.0" is 22.
pub fn major(version: &str) -> Option<u32> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

/// The Node the engine runs with: the one Airband fetched, or the computer's own when it is new
/// enough. An older one is never used: the engine would stop at once.
pub fn node() -> Option<PathBuf> {
    let own = own_node();
    if own.exists() {
        return Some(own);
    }
    system_node().filter(|p| version_of(p).as_deref().and_then(major).is_some_and(|m| m >= NODE_MIN))
}

static READY: AtomicBool = AtomicBool::new(false);

/// Node and the engine are both there.
pub fn ready() -> bool {
    let r = engine_js().exists() && node().is_some();
    READY.store(r, Ordering::Relaxed);
    r
}

/// What `ready()` last found, without looking again (for the menu).
pub fn was_ready() -> bool {
    READY.load(Ordering::Relaxed)
}

pub fn hide_window(c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let _ = c;
}

/// The Station's port, key and process, once it has written them (since `since`).
fn station_info(since: SystemTime) -> Option<(u16, String, u32)> {
    let f = home().join("station.json");
    let fresh = std::fs::metadata(&f).and_then(|m| m.modified()).map(|t| t >= since).unwrap_or(false);
    if !fresh {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(f).ok()?).ok()?;
    Some((v["port"].as_u64()? as u16, v["token"].as_str()?.to_string(), v["pid"].as_u64().unwrap_or(0) as u32))
}

/// A process is still running.
fn alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let mut c = if cfg!(windows) {
        let mut c = Command::new("tasklist");
        c.args(["/FI", &format!("PID eq {pid}"), "/NH"]);
        c
    } else {
        let mut c = Command::new("kill");
        c.args(["-0", &pid.to_string()]);
        c
    };
    hide_window(&mut c);
    match c.output() {
        Ok(o) if cfg!(windows) => String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()),
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

fn open(app: &AppHandle, port: u16, token: &str) {
    let url = format!("http://127.0.0.1:{port}/app?mode=desktop&t={token}");
    let a = app.clone();
    let _ = app.run_on_main_thread(move || open_corner(&a, &url));
}

/// Starts the engine and opens the corner on its page. A Station that already runs (an earlier
/// start, the command line) is used as it is; ours is started again only if it stops by itself.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut tries = 0;
        loop {
            // One already runs: use it, and look again only when it stops.
            if let Some((port, token, pid)) = station_info(SystemTime::UNIX_EPOCH).filter(|(_, _, pid)| alive(*pid)) {
                crate::log(&format!("engine: using the Station that already runs (process {pid})"));
                open(&app, port, &token);
                while alive(pid) {
                    std::thread::sleep(Duration::from_secs(2));
                }
                crate::log("engine: that Station stopped");
                continue;
            }
            let Some(node) = node() else {
                crate::log("engine: no Node.js");
                return;
            };
            let since = SystemTime::now() - Duration::from_secs(1);
            let log = std::fs::File::create(home().join("engine.log")).ok();
            let mut c = Command::new(&node);
            c.arg(engine_js()).arg("station").stdin(Stdio::null()).stdout(Stdio::null());
            match log {
                Some(f) => c.stderr(f),
                None => c.stderr(Stdio::null()),
            };
            hide_window(&mut c);
            let Ok(child) = c.spawn() else {
                crate::log("engine: couldn't start");
                return;
            };
            crate::log(&format!("engine: started (process {})", child.id()));
            let started = std::time::Instant::now();
            *CHILD.lock().unwrap() = Some(child);
            let mut opened = false;
            for _ in 0..150 {
                std::thread::sleep(Duration::from_millis(100));
                if let Some((port, token, _)) = station_info(since) {
                    open(&app, port, &token);
                    opened = true;
                    break;
                }
                let exited =
                    CHILD.lock().unwrap().as_mut().map(|c| c.try_wait().ok().flatten().is_some()).unwrap_or(true);
                if exited {
                    break;
                }
            }
            // Watch it: if it stops on its own, start it again (a few times, then stop trying).
            loop {
                std::thread::sleep(Duration::from_millis(1000));
                let mut guard = CHILD.lock().unwrap();
                let Some(child) = guard.as_mut() else { return };
                if child.try_wait().ok().flatten().is_some() {
                    *guard = None;
                    break;
                }
            }
            if RESTART.swap(false, Ordering::Relaxed) {
                crate::log("engine: starting again on the new version");
                tries = 0;
                continue;
            }
            crate::log("engine: stopped by itself");
            // A Station that ran a good while before stopping isn't one that can't start.
            if started.elapsed() > Duration::from_secs(600) {
                tries = 0;
            }
            tries += 1;
            if tries >= 5 || (!opened && tries >= 2) {
                crate::log("engine: gave up starting it again");
                return;
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

/// Starts our Station again on the engine's newest files: it is stopped, and the watcher in
/// `start` starts it again. A Station started elsewhere (the command line) is left as it is.
pub fn restart() {
    if let Some(c) = CHILD.lock().unwrap().as_mut() {
        RESTART.store(true, Ordering::Relaxed);
        let _ = c.kill();
    }
}

pub fn stop(_app: &AppHandle) {
    if let Some(mut c) = CHILD.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_variables() {
        let var = |k: &str| (k == "USERPROFILE").then(|| "C:\\Users\\me".to_string());
        assert_eq!(expand("%USERPROFILE%\\.local\\bin;%NOPE%\\x;50%", var), "C:\\Users\\me\\.local\\bin;%NOPE%\\x;50%");
    }

    #[test]
    fn adds_only_new_folders() {
        assert_eq!(
            merge_path(r"C:\Windows;C:\npm\", r"c:\windows\;C:\npm;C:\Users\me\.local\bin;"),
            r"C:\Windows;C:\npm\;C:\Users\me\.local\bin"
        );
        assert_eq!(merge_path("", "C:\\a"), "C:\\a");
    }
}
