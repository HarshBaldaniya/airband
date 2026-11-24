//! Airband's engine: the Station (`airband station`), run with Node. The app starts it, waits for
//! it to write ~/.airband/station.json, opens Roger's corner on its page, and starts it again if it
//! stops. The engine is the npm package the setup tour fetched (or AIRBAND_ENGINE_DIR, for
//! development). Node is the computer's own, or the one the setup tour fetched.
use crate::logging::log;
use crate::paths::{self, engine_dir, runtime_dir, ENGINE_LOG};
use crate::process::{command, find_command, is_alive, major, version_of};
use crate::state::{hooks, lock};
use crate::station::StationFile;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// The engine is stopped on purpose, to start again on newer files (after an update).
static RESTART: AtomicBool = AtomicBool::new(false);

/// How long a new Station has to write station.json, and how often it is looked for.
const STATION_WAIT: Duration = Duration::from_secs(15);
const STATION_POLL: Duration = Duration::from_millis(100);
/// How often a running Station is checked on.
const WATCH_EVERY: Duration = Duration::from_secs(1);
/// How often a Station started elsewhere is checked on.
const OTHER_STATION_EVERY: Duration = Duration::from_secs(2);
/// A pause before starting one again that stopped by itself.
const RESTART_PAUSE: Duration = Duration::from_secs(2);
/// Starting again stops after this many tries in a row, or fewer if it never opened its page.
const MAX_TRIES: u32 = 5;
const MAX_TRIES_NEVER_OPENED: u32 = 2;
/// A Station that ran this long before stopping isn't one that can't start: the tries count again.
const HEALTHY_RUN: Duration = Duration::from_secs(600);

/// The engine's command line (airband.js).
pub fn engine_js() -> PathBuf {
    if let Ok(d) = std::env::var("AIRBAND_ENGINE_DIR") {
        return PathBuf::from(d).join("airband.js");
    }
    engine_dir().join("package").join("airband.js")
}

/// The Node the setup tour fetched, if it did.
pub fn own_node() -> PathBuf {
    let dir = runtime_dir().join("node");
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

/// Tells the app the Station is up, so Roger's corner opens on its page.
fn open(app: &AppHandle, station: &StationFile) {
    let Some(url) = station.page() else { return };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || (hooks(&a).station_up)(&a, url));
}

/// Starts the engine and opens the corner on its page. A Station that already runs (an earlier
/// start, the command line) is used as it is; ours is started again only if it stops by itself.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut tries = 0;
        loop {
            // One already runs: use it, and look again only when it stops.
            let running = StationFile::read().filter(|s| s.page().is_some() && s.pid.is_some_and(is_alive));
            if let Some(station) = running {
                let pid = station.pid.unwrap_or_default();
                log(&format!("engine: using the Station that already runs (process {pid})"));
                open(&app, &station);
                while is_alive(pid) {
                    std::thread::sleep(OTHER_STATION_EVERY);
                }
                log("engine: that Station stopped");
                continue;
            }
            let Some(node) = node() else {
                log("engine: no Node.js");
                return;
            };
            let since = SystemTime::now() - Duration::from_secs(1);
            let errors =
                std::fs::File::create(paths::file(ENGINE_LOG)).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
            let mut c = command(&node);
            c.arg(engine_js()).arg("station").stdin(Stdio::null()).stdout(Stdio::null()).stderr(errors);
            let Ok(child) = c.spawn() else {
                log("engine: couldn't start");
                return;
            };
            log(&format!("engine: started (process {})", child.id()));
            let started = std::time::Instant::now();
            *lock(&CHILD) = Some(child);
            let mut opened = false;
            for _ in 0..STATION_WAIT.as_millis() / STATION_POLL.as_millis() {
                std::thread::sleep(STATION_POLL);
                if let Some(station) = StationFile::written_since(since).filter(|s| s.page().is_some()) {
                    open(&app, &station);
                    opened = true;
                    break;
                }
                let exited = lock(&CHILD).as_mut().map(|c| c.try_wait().ok().flatten().is_some()).unwrap_or(true);
                if exited {
                    break;
                }
            }
            // Watch it: if it stops on its own, start it again (a few times, then stop trying).
            loop {
                std::thread::sleep(WATCH_EVERY);
                let mut guard = lock(&CHILD);
                let Some(child) = guard.as_mut() else { return };
                if child.try_wait().ok().flatten().is_some() {
                    *guard = None;
                    break;
                }
            }
            if RESTART.swap(false, Ordering::Relaxed) {
                log("engine: starting again on the new version");
                tries = 0;
                continue;
            }
            log("engine: stopped by itself");
            // A Station that ran a good while before stopping isn't one that can't start.
            if started.elapsed() > HEALTHY_RUN {
                tries = 0;
            }
            tries += 1;
            if tries >= MAX_TRIES || (!opened && tries >= MAX_TRIES_NEVER_OPENED) {
                log("engine: gave up starting it again");
                return;
            }
            std::thread::sleep(RESTART_PAUSE);
        }
    });
}

/// Starts our Station again on the engine's newest files: it is stopped, and the watcher in
/// `start` starts it again. A Station started elsewhere (the command line) is left as it is.
pub fn restart() {
    if let Some(c) = lock(&CHILD).as_mut() {
        RESTART.store(true, Ordering::Relaxed);
        let _ = c.kill();
    }
}

/// Stops our Station, when the app quits or is replaced.
pub fn stop() {
    if let Some(mut c) = lock(&CHILD).take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}
