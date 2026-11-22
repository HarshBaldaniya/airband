// The app's own commands, declared, so each window gets only the ones it needs (capabilities/):
// Roger's corner the window commands, the setup tour the setup commands. A page from an address
// (the Station's, on this computer) may only call what is named for it.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "hit_areas", "drag", "prefs", "set_pref", "menu", "hide", "asleep", "come_back", "log_line",
        "scan", "install_node", "install_engine", "connect_agents", "finish", "open_url",
    ])))
    .expect("the app's commands");
}
