// Airband's engine: the Station (`airband station`), run with Node. The app starts it, waits for
// it to write ~/.airband/station.json, opens Roger's corner on its page, and starts it again if it
// stops. The engine is the npm package the setup tour fetched (or AIRBAND_ENGINE_DIR, for
// development). Node is the computer's own, or the one the setup tour fetched.
use crate::corner::open_corner;
use crate::paths::home;
use crate::process::{find_command, hide_window, major, version_of};
use std::path::PathBuf;
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

/// The oldest Node.js the engine runs on (its package.json "engines").
pub const NODE_MIN: u32 = 20;

/// The Node the engine runs with: the one Airband fetched, or the computer's own when it is new
/// enough. An older one is never used: the engine would stop at once.
pub fn node() -> Option<PathBuf> {
    let own = own_node();
    if own.exists() {
        return Some(own);
    }
    find_command("node").filter(|p| version_of(p).as_deref().and_then(major).is_some_and(|m| m >= NODE_MIN))
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
                crate::logging::log(&format!("engine: using the Station that already runs (process {pid})"));
                open(&app, port, &token);
                while alive(pid) {
                    std::thread::sleep(Duration::from_secs(2));
                }
                crate::logging::log("engine: that Station stopped");
                continue;
            }
            let Some(node) = node() else {
                crate::logging::log("engine: no Node.js");
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
                crate::logging::log("engine: couldn't start");
                return;
            };
            crate::logging::log(&format!("engine: started (process {})", child.id()));
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
                crate::logging::log("engine: starting again on the new version");
                tries = 0;
                continue;
            }
            crate::logging::log("engine: stopped by itself");
            // A Station that ran a good while before stopping isn't one that can't start.
            if started.elapsed() > Duration::from_secs(600) {
                tries = 0;
            }
            tries += 1;
            if tries >= 5 || (!opened && tries >= 2) {
                crate::logging::log("engine: gave up starting it again");
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

pub fn stop() {
    if let Some(mut c) = CHILD.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}
