//! On a Mac, dragging an app out of its disk image can't start it. So when Airband is started from
//! the disk image, it offers to move itself to Applications, starts again from there and ejects the
//! image: the setup tour begins with no second click. Started from anywhere else (Applications, or
//! a build folder while developing), it does nothing.

/// Returns only when Airband should go on starting from where it is.
#[cfg(target_os = "macos")]
pub fn offer_move() {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    let Ok(exe) = std::env::current_exe() else { return };
    // .../Airband.app/Contents/MacOS/airband
    let Some(bundle) = exe.ancestors().nth(3).map(Path::to_path_buf) else { return };
    if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
        return;
    }
    let path = bundle.to_string_lossy().to_string();
    // From a disk image: the image itself, or macOS's read-only copy of it (App Translocation).
    let from_image = path.starts_with("/Volumes/") || path.contains("/AppTranslocation/");
    if !from_image {
        return;
    }

    let ask = r#"display dialog "Move Airband to your Applications folder? It opens from there and sets itself up." with title "Airband" buttons {"Not now", "Move to Applications"} default button "Move to Applications" with icon note"#;
    let answer = Command::new("osascript").args(["-e", ask]).output();
    match &answer {
        Ok(o) => crate::log(&format!(
            "install: asked from {path}: {} {}",
            String::from_utf8_lossy(&o.stdout).trim(),
            String::from_utf8_lossy(&o.stderr).trim()
        )),
        Err(e) => crate::log(&format!("install: couldn't ask: {e}")),
    }
    let moving = matches!(&answer, Ok(o) if String::from_utf8_lossy(&o.stdout).contains("Move to Applications"));
    if !moving {
        return;
    }

    let dest = PathBuf::from("/Applications/Airband.app");
    // A copy already running from Applications is replaced, so it quits first.
    let _ = Command::new("pkill").args(["-f", "/Applications/Airband.app/Contents/MacOS/"]).status();
    let _ = std::fs::remove_dir_all(&dest);
    let copied = Command::new("ditto").arg(&bundle).arg(&dest).status().map(|s| s.success()).unwrap_or(false);
    if !copied {
        let tell = r#"display dialog "Airband couldn't move itself to Applications. Drag it there from this window instead." with title "Airband" buttons {"OK"} default button "OK" with icon caution"#;
        let _ = Command::new("osascript").args(["-e", tell]).status();
        return;
    }

    // The disk images that hold Airband, ejected once this copy has quit.
    let volumes: Vec<String> = std::fs::read_dir("/Volumes")
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|v| v.join("Airband.app").exists())
        .map(|v| format!("'{}'", v.to_string_lossy().replace('\'', "")))
        .collect();
    let eject = if volumes.is_empty() {
        String::new()
    } else {
        format!("; sleep 2; for v in {}; do hdiutil detach \"$v\" -quiet; done", volumes.join(" "))
    };
    let _ = Command::new("sh").args(["-c", &format!("sleep 1; open /Applications/Airband.app{eject}")]).spawn();
    std::process::exit(0);
}

#[cfg(not(target_os = "macos"))]
pub fn offer_move() {}
