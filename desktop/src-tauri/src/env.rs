//! The app's own environment variables.
use crate::logging::log;
#[cfg(windows)]
use crate::process::command;

/// The app's own environment, before anything reads it. macOS can hand an app the environment of an
/// earlier start (one from a test, or from inside an AI agent's terminal), and the engine inherits it.
/// Two kinds of variable are dropped: Airband's and the agents' folders when they point into a
/// temporary folder (only a test puts them there), and the variables of the AI agent session that
/// started the app, which belong to that session, not to Roger.
pub fn clean() {
    let temporary =
        |v: &str| ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"].iter().any(|t| v.starts_with(t));
    let mut dropped = vec![];
    for key in [
        "AIRBAND_HOME",
        "AIRBAND_DEBUG_DIR",
        "AIRBAND_ENGINE_DIR",
        "CLAUDE_CONFIG_DIR",
        "CODEX_HOME",
        "GEMINI_CLI_HOME",
    ] {
        if std::env::var(key).is_ok_and(|v| temporary(&v)) {
            std::env::remove_var(key);
            dropped.push(key.to_string());
        }
    }
    // A test's switch, never wanted by a person who opened the app.
    if !cfg!(debug_assertions) && std::env::var("AIRBAND_SKIP_SETUP").is_ok() {
        std::env::remove_var("AIRBAND_SKIP_SETUP");
        dropped.push("AIRBAND_SKIP_SETUP".into());
    }
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE"
            || key.starts_with("CLAUDE_CODE_")
            || key == "CLAUDE_PID"
            || key == "CLAUDE_AGENT_SDK_VERSION"
        {
            std::env::remove_var(&key);
            dropped.push(key);
        }
    }
    if !dropped.is_empty() {
        log(&format!("start: left out {} inherited from where the app was started", dropped.join(", ")));
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
            let out = command("reg").args(["query", key, "/v", "Path"]).output().ok()?;
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
