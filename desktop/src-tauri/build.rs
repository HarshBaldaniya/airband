// Two things before Tauri's own build:
//
// - The app's commands, declared, so each window gets only the ones it needs (capabilities/):
//   Roger's corner the window commands, the setup tour the setup commands. A page from an address
//   (the Station's, on this computer) may only call what is named for it. scripts/check-commands.mjs
//   checks this list against the app, the capabilities and the pages.
// - The updater's public key and the releases' address, read from tauri.conf.json so they are
//   written in one place: the app checks the engine's signature with the same key
//   (src/setup/signature.rs).
const COMMANDS: &[&str] = &[
    "hit_areas",
    "drag",
    "prefs",
    "set_pref",
    "menu",
    "asleep",
    "come_back",
    "log_line",
    "scan",
    "install_node",
    "install_engine",
    "connect_agents",
    "finish",
    "open_url",
    "update_info",
    "install_update",
    "just_updated",
];

/// The updater's endpoint ends with this; what comes before it is the repository's releases.
const LATEST_JSON: &str = "/latest/download/latest.json";

fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let conf: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").expect("tauri.conf.json")).expect("its JSON");
    let updater = &conf["plugins"]["updater"];
    let key = updater["pubkey"].as_str().expect("plugins.updater.pubkey in tauri.conf.json");
    let releases = updater["endpoints"][0]
        .as_str()
        .and_then(|e| e.strip_suffix(LATEST_JSON))
        .expect("plugins.updater.endpoints[0] in tauri.conf.json, ending with /latest/download/latest.json");
    println!("cargo:rustc-env=AIRBAND_UPDATER_PUBKEY={key}");
    println!("cargo:rustc-env=AIRBAND_RELEASES={releases}/download");

    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("the app's commands");
}
