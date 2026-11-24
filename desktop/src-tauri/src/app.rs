//! The app itself: its plugins, the menu-bar icon, the commands pages may call, and what happens
//! at start and at exit.
use crate::corner::{self, is_visible, watch_pointer, PageCommand};
use crate::logging::log;
use crate::prefs::{apply_start_at_login, Prefs};
use crate::state::{lock, AppState, Hooks, Shared};
use crate::tray::{self, build_menu, menu_event, TRAY_ID};
use crate::{commands, engine, setup, update};
use std::sync::{Arc, Mutex};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

/// Shows Roger, or opens and closes his panel, from anywhere.
const SHORTCUT: &str = "Alt+CommandOrControl+R";

/// What the modules below the app call when something changed.
const HOOKS: Hooks = Hooks { menu_changed: tray::refresh_menu, station_up: |app, url| corner::open_corner(app, &url) };

/// `airband --update` (in a terminal, or sent to the running app): update the app.
fn wants_update(args: &[String]) -> bool {
    args.iter().any(|a| a == "--update")
}

/// The global shortcut: Roger comes, or his panel opens or closes.
fn on_shortcut(app: &AppHandle) {
    let tucked = lock(&app.state::<AppState>()).prefs.tucked;
    if !is_visible(app) || tucked {
        corner::show(app, true)
    } else {
        corner::tell(app, PageCommand::Toggle);
    }
}

pub fn run() {
    let state: AppState = Arc::new(Mutex::new(Shared::new(Prefs::load())));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // `airband --update` while Airband runs: the running one updates.
            if wants_update(&args) {
                update::check_and_install(app);
                return;
            }
            // Opened again: show what is there instead of a second copy.
            if corner::window(app).is_some() {
                corner::show(app, true);
            } else {
                setup::open(app);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            // The shortcut itself is registered in `setup`: one another app already holds must not
            // stop Airband from starting.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        on_shortcut(app);
                    }
                })
                .build(),
        )
        .manage(state.clone())
        .manage(HOOKS)
        .invoke_handler(tauri::generate_handler![
            commands::log_line,
            commands::hit_areas,
            commands::drag,
            commands::prefs,
            commands::set_pref,
            commands::menu,
            commands::asleep,
            commands::come_back,
            commands::scan,
            commands::install_node,
            commands::install_engine,
            commands::connect_agents,
            commands::finish,
            commands::open_url,
            commands::update_info,
            commands::install_update,
            commands::just_updated,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            // `--update` in a terminal: update the app, say what happened, and stop.
            if wants_update(&std::env::args().collect::<Vec<_>>()) {
                tauri::async_runtime::spawn(async move {
                    let code = update::from_terminal(&handle).await;
                    handle.exit(code);
                });
                return Ok(());
            }
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let tray_icon = if cfg!(target_os = "macos") {
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
            } else {
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-color.png"))?
            };
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Airband")
                .menu(&build_menu(&handle)?)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, e| menu_event(app, e.id().as_ref()))
                .build(app)?;
            let p = lock(&state).prefs.clone();
            apply_start_at_login(&handle, p.start_at_login);
            watch_pointer(handle.clone(), state.clone());
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = handle.global_shortcut().register(SHORTCUT) {
                    log(&format!("start: the shortcut {SHORTCUT} is taken, so Airband has none: {e}"));
                }
            }
            // Set up: the engine starts and the corner opens. Not yet: the setup tour. Whether
            // Node and the engine are there runs the login shell, so it is looked at off the main
            // thread.
            if p.set_up {
                let h = handle.clone();
                std::thread::spawn(move || {
                    if engine::ready() {
                        engine::start(&h);
                    } else {
                        let a = h.clone();
                        let _ = h.run_on_main_thread(move || setup::open(&a));
                    }
                });
            } else {
                setup::open(&handle);
            }
            // Newer engines by themselves, a newer app with one click.
            update::watch(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Airband could not start")
        .run(|_app, e| match e {
            // Closing the setup tour or the corner keeps the app in the menu bar.
            tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
            tauri::RunEvent::Exit => engine::stop(),
            _ => {}
        });
}
