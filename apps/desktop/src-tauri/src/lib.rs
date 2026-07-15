#![allow(deprecated, unexpected_cfgs)]
#![allow(clippy::items_after_test_module, clippy::too_many_arguments)]

mod commands;
mod menu;
mod preview;
mod startup;
mod tray;
mod windows;

use commands::descriptors::DescriptorGridJobRegistry;
use commands::source_editing::{OpenedSourceRegistry, SourceEditRegistry};
use preview::grid_store::GridRuntimeRegistry;
use std::path::PathBuf;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    disable_macos_state_restoration();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let cwd = Some(PathBuf::from(cwd));
            let session_dir = startup::agent_session_from_argv(argv.clone(), cwd.clone());
            let paths = startup::file_args_from_argv(argv, cwd);
            show_and_emit_open_documents(app, paths);
            startup::emit_agent_session(app, session_dir);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(GridRuntimeRegistry::default())
        .manage(DescriptorGridJobRegistry::default())
        .manage(OpenedSourceRegistry::default())
        .manage(SourceEditRegistry::default())
        .manage(startup::PendingOpenDocuments::default())
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            let launch_mode = startup::LaunchMode::current(&argv);
            let startup_paths = startup::file_args_from_argv(argv, std::env::current_dir().ok());
            #[cfg(target_os = "macos")]
            app.set_activation_policy(if launch_mode.is_register() && startup_paths.is_empty() {
                tauri::ActivationPolicy::Accessory
            } else {
                tauri::ActivationPolicy::Regular
            });
            menu::configure_menu(app)?;
            tray::configure_tray(app)?;
            if let Some(window) = app.get_webview_window(windows::MAIN_WINDOW_LABEL) {
                windows::attach_window_cleanup(app.handle(), &window);
            }
            if !startup_paths.is_empty() {
                show_and_emit_open_documents(app.handle(), startup_paths);
            } else if launch_mode.is_register() {
                tray::hide_main_window(app.handle());
            }
            let app_handle = app.handle().clone();
            app.on_menu_event(move |app, event| match event.id().0.as_str() {
                "settings.open" => {
                    menu::emit_to_focused_window(app, menu::MENU_OPEN_SETTINGS_EVENT)
                }
                "edit.undo" => menu::emit_to_focused_window(app, menu::MENU_UNDO_EVENT),
                "edit.redo" => menu::emit_to_focused_window(app, menu::MENU_REDO_EVENT),
                "file.new-window" => {
                    let _ = windows::open_new_workspace_window(app);
                }
                "file.open" => menu::emit_to_focused_window(app, menu::MENU_OPEN_FILES_EVENT),
                "file.open-recent" => {
                    menu::emit_to_focused_window(app, menu::MENU_OPEN_RECENT_EVENT)
                }
                "file.save-source" => {
                    menu::emit_to_focused_window(app, menu::MENU_SAVE_SOURCE_EVENT)
                }
                "file.reveal-active" => {
                    menu::emit_to_focused_window(app, menu::MENU_REVEAL_ACTIVE_EVENT)
                }
                "file.copy-active-path" => {
                    menu::emit_to_focused_window(app, menu::MENU_COPY_ACTIVE_PATH_EVENT)
                }
                "file.show-active-metadata" => {
                    menu::emit_to_focused_window(app, menu::MENU_SHOW_ACTIVE_METADATA_EVENT)
                }
                "file.export-preview-png" => {
                    menu::emit_to_focused_window(app, menu::MENU_EXPORT_PREVIEW_PNG_EVENT)
                }
                "file.export-preview-svg" => {
                    menu::emit_to_focused_window(app, menu::MENU_EXPORT_PREVIEW_SVG_EVENT)
                }
                "maintenance.clear-preview-cache" => {
                    menu::emit_to_focused_window(app, menu::MENU_CLEAR_PREVIEW_CACHE_EVENT)
                }
                "maintenance.reset-quick-look" => {
                    menu::emit_to_focused_window(app, menu::MENU_RESET_QUICK_LOOK_EVENT)
                }
                "maintenance.open-logs" => {
                    menu::emit_to_focused_window(app, menu::MENU_OPEN_LOGS_EVENT)
                }
                "updater.check" => {
                    menu::emit_to_focused_window(app, menu::MENU_CHECK_UPDATES_EVENT)
                }
                _ => {}
            });
            #[cfg(target_os = "macos")]
            if let Some(window) = app_handle.get_webview_window(windows::MAIN_WINDOW_LABEL) {
                let _ = window.set_decorations(true);
                let _ = window.set_shadow(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent_integration::agent_integration_status,
            commands::chemical_editors::finder_icon_path,
            commands::chemical_editors::list_chemical_editor_targets,
            commands::chemical_editors::open_in_chemical_editor,
            commands::descriptors::descriptor_runtime_status,
            commands::descriptors::descriptor_runtime_install,
            commands::descriptors::descriptor_calculate,
            commands::descriptors::descriptor_calculate_grid,
            commands::descriptors::descriptor_start_grid,
            commands::descriptors::descriptor_grid_job_status,
            commands::descriptors::descriptor_cancel_grid,
            commands::descriptors::descriptor_grid_summary,
            commands::startup::startup_documents,
            commands::startup::startup_agent_session,
            commands::documents::pick_open_targets,
            commands::documents::classify_open_paths,
            commands::documents::open_documents,
            commands::documents::list_project_structure_files,
            commands::folding_results::read_folding_result_bundle,
            commands::text_files::read_text_file,
            commands::text_files::open_text_files,
            commands::documents::read_structure_text,
            commands::documents::fetch_pdb_structure,
            commands::source_editing::open_source_edit_session,
            commands::source_editing::inspect_source_edit_session,
            commands::source_editing::reload_source_edit_session,
            commands::source_editing::save_source_document,
            commands::source_editing::reconcile_source_commit,
            commands::source_editing::close_source_edit_session,
            commands::source_editing::close_opened_source_document,
            commands::conformer::conformer_status,
            commands::conformer::prepare_conformer_job,
            commands::conformer::run_conformer_job,
            commands::conformer::cancel_conformer_job,
            commands::documents::generate_3d_conformer,
            commands::documents::open_text_structure,
            commands::documents::fetch_remote_structure,
            commands::documents::open_delimited_grid_document,
            commands::documents::open_docking_document,
            commands::documents::open_merged_collection,
            commands::documents::append_to_molecule_collection,
            commands::documents::create_molecule_collection,
            commands::documents::save_molecule_collection_as,
            commands::documents::save_text_as,
            commands::documents::render_xyzrender_sheet_item,
            commands::documents::render_xyzrender_sheet_items,
            commands::grid::grid_fetch_page,
            commands::grid::grid_append_records,
            commands::grid::grid_delimited_columns,
            commands::grid::grid_append_delimited_records,
            commands::grid::grid_close_runtime,
            commands::mdsmooth::run_mdsmooth,
            commands::documents::sync_viewer_preferences,
            commands::preview_cache::clear_preview_cache,
            commands::runtime_doctor::external_runtime_doctor,
            commands::shell::export_diagnostics_bundle,
            commands::shell::open_logs_folder,
            commands::shell::open_external_url,
            commands::shell::existing_paths,
            commands::shell::open_new_workspace_window,
            commands::shell::read_external_preview_svg,
            commands::shell::read_viewer_runtime_file_base64,
            commands::shell::reveal_path,
            commands::shell::write_base64_file,
            commands::shell::write_text_file,
            commands::quicklook::reset_quick_look,
            commands::pubchem::open_pubchem_search,
            commands::updater::install_update,
            commands::xtb::xtb_status,
            commands::xtb::select_xtb_executable,
            commands::xtb::install_xtb,
            commands::xtb::run_xtb_job,
            commands::xtb::cancel_xtb_job,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Burrete Tauri application")
        .run(|app, event| {
            if let RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.exists())
                    .map(|path| path.to_string_lossy().to_string())
                    .collect();
                show_and_emit_open_documents(app, paths);
            }
        });
}

fn show_and_emit_open_documents<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    let window_label = windows::focused_window_label(app)
        .unwrap_or_else(|| windows::MAIN_WINDOW_LABEL.to_string());
    if !paths.is_empty() {
        let _ = windows::show_window(app, &window_label);
    }
    startup::signal_open_documents_for_window(app, &window_label, paths);
}

#[cfg(target_os = "macos")]
fn disable_macos_state_restoration() {
    use cocoa::base::{id, NO, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;

    unsafe fn nsstring(value: &str) -> Option<id> {
        use objc::{class, msg_send, sel, sel_impl};
        let c_value = CString::new(value).ok()?;
        let string: id = msg_send![class!(NSString), alloc];
        let string: id = msg_send![string, initWithUTF8String: c_value.as_ptr()];
        Some(msg_send![string, autorelease])
    }

    unsafe {
        let defaults: id = msg_send![class!(NSUserDefaults), standardUserDefaults];
        let Some(ignore_state_key) = nsstring("ApplePersistenceIgnoreState") else {
            return;
        };
        let Some(keep_windows_key) = nsstring("NSQuitAlwaysKeepsWindows") else {
            return;
        };
        let _: () = msg_send![defaults, setBool: YES forKey: ignore_state_key];
        let _: () = msg_send![defaults, setBool: NO forKey: keep_windows_key];
        let _: () = msg_send![defaults, synchronize];
    }
}
