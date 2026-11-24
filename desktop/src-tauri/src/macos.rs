//! What only a Mac has: its dialogs, its Bin, and the .app bundle the app runs from. Built on every
//! system so the code that calls it behind `cfg!` checks is too; some of it only macOS calls.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use crate::paths::user_home;
use crate::process::command;
use std::path::{Path, PathBuf};

/// The picture a dialog shows beside its words.
#[derive(Clone, Copy)]
pub enum Icon {
    Note,
    Caution,
}

/// A macOS dialog (AppleScript's `display dialog`).
pub struct Dialog<'a> {
    pub title: &'a str,
    pub message: &'a str,
    pub buttons: &'a [&'a str],
    /// The button Return presses.
    pub default: &'a str,
    /// The button Escape presses: it answers as a cancel.
    pub cancel: Option<&'a str>,
    pub icon: Option<Icon>,
}

/// An AppleScript string, quoted.
fn quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

impl Dialog<'_> {
    /// Shows the dialog and waits. Ok(Some(button)) is the button pressed; Ok(None) a cancel (the
    /// cancel button, or Escape). The message goes to AppleScript as an argument, never as code.
    pub fn ask(&self) -> Result<Option<String>, String> {
        let buttons = self.buttons.iter().map(|b| quoted(b)).collect::<Vec<_>>().join(", ");
        let mut script = format!(
            "display dialog (item 1 of argv) with title {} buttons {{{buttons}}} default button {}",
            quoted(self.title),
            quoted(self.default)
        );
        if let Some(c) = self.cancel {
            script += &format!(" cancel button {}", quoted(c));
        }
        match self.icon {
            Some(Icon::Note) => script += " with icon note",
            Some(Icon::Caution) => script += " with icon caution",
            None => {}
        }
        let out = command("osascript")
            .args(["-e", "on run argv", "-e", &script, "-e", "end run", self.message])
            .output()
            .map_err(|e| format!("couldn't ask: {e}"))?;
        let said = String::from_utf8_lossy(&out.stdout);
        match said.trim().strip_prefix("button returned:") {
            Some(button) if out.status.success() => Ok(Some(button.to_string())),
            _ if self.cancel.is_some() || !out.status.success() => Ok(None),
            _ => Err(format!("no answer: {}", String::from_utf8_lossy(&out.stderr).trim())),
        }
    }

    /// Shows the dialog and waits, for a dialog that only tells.
    pub fn tell(&self) {
        let _ = self.ask();
    }
}

/// Moves a file or folder to the Bin, under `name` (with a number when one is already there).
/// Returns where it went.
pub fn move_to_trash(path: &Path, name: &str) -> Result<PathBuf, String> {
    let bin = user_home().join(".Trash");
    let mut to = bin.join(name);
    for n in 2.. {
        if !to.exists() {
            break;
        }
        to = bin.join(format!("{name} {n}"));
    }
    if std::fs::rename(path, &to).is_ok() {
        return Ok(to);
    }
    // Another disk, or a folder the Bin can't be renamed into: Finder moves it.
    let finder = [
        "-e",
        "on run argv",
        "-e",
        "tell application \"Finder\" to delete (POSIX file (item 1 of argv) as alias)",
        "-e",
        "end run",
    ];
    let moved = command("osascript").args(finder).arg(path).output().is_ok_and(|o| o.status.success());
    if moved {
        Ok(bin)
    } else {
        Err("it couldn't be moved to the Bin".into())
    }
}

/// The .app bundle the app runs from (…/Airband.app/Contents/MacOS/airband), if it runs from one.
pub fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.ancestors().nth(3)?.to_path_buf();
    bundle.extension().is_some_and(|x| x == "app").then_some(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_applescript_strings() {
        assert_eq!(quoted(r#"Say "hi" \ bye"#), r#""Say \"hi\" \\ bye""#);
    }
}
