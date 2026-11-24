//! Other programs: finding them, running them (with no console window on Windows), and the
//! processes they leave running.
use crate::paths::user_home;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Windows' CREATE_NO_WINDOW: a console program started by the app opens no window of its own.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command to run. On Windows it opens no console window, which every program the app runs
/// (curl, tar, node, reg ...) would otherwise flash on screen.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// A command's full path: on the PATH, or where its installer usually puts it (the engine's
/// `findCommand` looks in the same places, so the setup tour and Roger agree).
pub fn find_command(name: &str) -> Option<PathBuf> {
    crate::env::refresh_path();
    on_path(name).or_else(|| usual_places(name).into_iter().find(|p| p.is_file()))
}

fn on_path(name: &str) -> Option<PathBuf> {
    let out = if cfg!(windows) {
        command("where").arg(name).output().ok()?
    } else {
        // The person's login shell, where nvm and Homebrew put their folders on the PATH.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        command(shell).args(["-lc", "command -v \"$1\"", "sh", name]).output().ok()?
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
    let home = user_home();
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

/// What a command says to `--version`, first line.
pub fn version_of(cmd: &Path) -> Option<String> {
    let out = command(cmd).arg("--version").output().ok()?;
    let t = String::from_utf8_lossy(&out.stdout).trim().lines().next()?.to_string();
    (!t.is_empty()).then_some(t)
}

/// "v22.3.0" is 22.
pub fn major(version: &str) -> Option<u32> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

/// The process is still running.
pub fn is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if cfg!(windows) {
        let out = command("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output();
        out.is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
    } else {
        command("kill").args(["-0", &pid.to_string()]).output().is_ok_and(|o| o.status.success())
    }
}

/// Asks the process to stop (on Windows, with the processes it started).
pub fn kill(pid: u32) {
    let _ = if cfg!(windows) {
        command("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output()
    } else {
        command("kill").arg(pid.to_string()).output()
    };
}

/// Opens a web page in the person's browser.
pub fn open_url(url: &str) -> std::io::Result<()> {
    let mut c = if cfg!(target_os = "macos") {
        command("open")
    } else if cfg!(windows) {
        let mut c = command("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else {
        command("xdg-open")
    };
    c.arg(url).spawn().map(|_| ())
}
