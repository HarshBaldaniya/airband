//! The app itself: its plugins, the menu-bar icon, the commands pages may call, and what happens
//! at start and at exit.
use crate::corner::{is_visible, show, watch_pointer};
use crate::logging::log;
use crate::prefs::{load_prefs, login_item};
use crate::state::{Shared, State};
use crate::tray::{build_menu, menu_event};
use crate::{commands, engine, setup, update};
use std::sync::{Arc, Mutex};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

/// Shows Roger, or opens and closes his panel, from anywhere.
const SHORTCUT: &str = "Alt+CommandOrControl+R";

pub fn run() {
    let state: State = Arc::new(Mutex::new(Shared {
        prefs: load_prefs(),
        hits: vec![],
        passing: true,
        asleep: false,
        side: "right",
        vertical: "bottom",
        last_move: None,
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // `airband --update` while Airband runs: the running one updates.
            if args.iter().any(|a| a == "--update") {
                update::check_and_install(app);
                return;
            }
            // Opened again: show what is there instead of a second copy.
            if app.get_webview_window("main").is_some() {
                show(app, true);
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
                        let p = app.state::<State>().lock().unwrap().prefs.clone();
                        if !is_visible(app) || p.tucked {
                            show(app, true)
                        } else if let Some(w) = app.get_webview_window("main") {
                            let _ = w.emit("command", "toggle");
                        }
                    }
                })
                .build(),
        )
        .manage(state.clone())
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
            if std::env::args().any(|a| a == "--update") {
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
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Airband")
                .menu(&build_menu(&handle)?)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, e| menu_event(app, e.id().as_ref()))
                .build(app)?;
            let p = state.lock().unwrap().prefs.clone();
            login_item(&handle, p.start_at_login);
            watch_pointer(handle.clone(), state.clone());
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = handle.global_shortcut().register(SHORTCUT) {
                    log(&format!("start: the shortcut {SHORTCUT} is taken, so Airband has none: {e}"));
                }
            }
            // Set up: the engine starts and the corner opens. Not yet: the setup tour.
            if p.set_up && engine::ready() {
                engine::start(&handle);
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
