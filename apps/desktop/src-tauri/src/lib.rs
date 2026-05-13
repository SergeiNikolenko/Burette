mod commands;
mod menu;
mod preview;
mod startup;
mod tray;

use std::path::PathBuf;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            startup::emit_open_documents(
                app,
                startup::file_args_from_argv(argv, Some(PathBuf::from(cwd))),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            menu::configure_menu(app)?;
            tray::configure_tray(app)?;
            let app_handle = app.handle().clone();
            app.on_menu_event(move |app, event| match event.id().0.as_str() {
                "settings.open" => {
                    menu::emit_to_focused_window(app, menu::MENU_OPEN_SETTINGS_EVENT)
                }
                "file.open" => menu::emit_to_focused_window(app, menu::MENU_OPEN_FILES_EVENT),
                _ => {}
            });
            #[cfg(target_os = "macos")]
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.set_decorations(true);
                let _ = window.set_shadow(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::startup::startup_documents,
            commands::documents::open_documents,
            commands::preview_cache::clear_preview_cache,
            commands::shell::open_logs_folder,
            commands::shell::open_external_url,
            commands::quicklook::reset_quick_look,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Burrete Tauri application")
        .run(|app, event| {
            if let RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_file())
                    .map(|path| path.to_string_lossy().to_string())
                    .collect();
                startup::emit_open_documents(app, paths);
            }
        });
}
