//! On a Mac, dragging an app out of its disk image can't start it. So when Airband is started from
//! the disk image, it offers to move itself to Applications, starts again from there and ejects the
//! image: the setup tour begins with no second click. Started from anywhere else (Applications, or
//! a build folder while developing), it does nothing.

/// Returns only when Airband should go on starting from where it is.
#[cfg(target_os = "macos")]
pub fn offer_move() {
    use crate::logging::log;
    use crate::macos::{app_bundle, Dialog, Icon};
    use crate::process::command;

    const APPLICATIONS_COPY: &str = "/Applications/Airband.app";
    const MOVE: &str = "Move to Applications";

    let Some(bundle) = app_bundle() else { return };
    let path = bundle.to_string_lossy().to_string();
    // From a disk image: the image itself, or macOS's read-only copy of it (App Translocation).
    let from_image = path.starts_with("/Volumes/") || path.contains("/AppTranslocation/");
    if !from_image {
        return;
    }

    let answer = Dialog {
        title: "Airband",
        message: "Move Airband to your Applications folder? It opens from there and sets itself up.",
        buttons: &["Not now", MOVE],
        default: MOVE,
        cancel: None,
        icon: Some(Icon::Note),
    }
    .ask();
    log(&format!("install: asked from {path}: {answer:?}"));
    if answer.ok().flatten().as_deref() != Some(MOVE) {
        return;
    }

    // A copy already running from Applications is replaced, so it quits first.
    let _ = command("pkill").args(["-f", &format!("{APPLICATIONS_COPY}/Contents/MacOS/")]).status();
    let _ = std::fs::remove_dir_all(APPLICATIONS_COPY);
    let copied = command("ditto").arg(&bundle).arg(APPLICATIONS_COPY).status().is_ok_and(|s| s.success());
    if !copied {
        Dialog {
            title: "Airband",
            message: "Airband couldn't move itself to Applications. Drag it there from this window instead.",
            buttons: &["OK"],
            default: "OK",
            cancel: None,
            icon: Some(Icon::Caution),
        }
        .tell();
        return;
    }

    // The disk images that hold Airband, ejected once this copy has quit. They go to the shell as
    // arguments, never inside its script.
    let volumes = std::fs::read_dir("/Volumes")
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|v| v.join("Airband.app").exists());
    let script = r#"sleep 1; open "$0"; sleep 2; for v in "$@"; do hdiutil detach "$v" -quiet; done"#;
    let _ = command("sh").args(["-c", script, APPLICATIONS_COPY]).args(volumes).spawn();
    std::process::exit(0);
}

#[cfg(not(target_os = "macos"))]
pub fn offer_move() {}
