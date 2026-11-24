//! Other programs: finding them, and running them without a console window on Windows.
use std::path::{Path, PathBuf};
use std::process::Command;

/// A command's full path: on the PATH, or where its installer usually puts it (the engine's
/// `findCommand` looks in the same places, so the setup tour and Roger agree).
pub fn find_command(name: &str) -> Option<PathBuf> {
    crate::env::refresh_path();
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

pub fn hide_window(c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let _ = c;
}
