#![allow(deprecated, unexpected_cfgs)]
#![allow(clippy::items_after_test_module, clippy::too_many_arguments)]

mod commands;
mod compute;
#[cfg(target_os = "macos")]
mod macos;
mod menu;
mod preview;
mod startup;
mod tray;
mod windows;

use commands::descriptors::DescriptorGridJobRegistry;
use commands::recent_documents::RecentDocumentsRegistry;
use commands::source_editing::{OpenedSourceRegistry, SourceEditRegistry};
use preview::grid_store::GridRuntimeRegistry;
use std::path::PathBuf;
use tauri::{Manager, RunEvent};

pub fn run_compute_service() -> Result<(), String> {
    compute::service::run_compute_service()
}

pub fn run_compute_dev_backend() -> Result<(), String> {
    compute::dev_backend::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    disable_macos_state_restoration();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if menu::exit_transition_is_active(app) {
                return;
            }
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
        .manage(RecentDocumentsRegistry::default())
        .manage(startup::PendingOpenDocuments::default())
        .setup(|app| {
            let compute_coordinator = app
                .path()
                .app_data_dir()
                .map(|app_data| {
                    let resource_root = app.path().resource_dir().ok();
                    let metal_runtime_root =
                        resource_root.as_ref().map(|root| root.join("ComputeMetal"));
                    let viewer_runtime_root =
                        resource_root.as_ref().map(|root| root.join("ViewerWeb"));
                    compute::coordinator::ComputeCoordinator::initialize_with_service(
                        app_data.join("compute"),
                        metal_runtime_root,
                        viewer_runtime_root,
                        packaged_compute_service_path(),
                    )
                })
                .unwrap_or_else(|error| {
                    compute::coordinator::ComputeCoordinator::unavailable(format!(
                        "compute app-data directory is unavailable: {error}"
                    ))
                });
            app.manage(compute_coordinator);
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
            if launch_mode.is_register() && startup_paths.is_empty() {
                tray::hide_main_window(app.handle());
            } else {
                let initial_app = app.handle().clone();
                let initial_workspace = move || {
                    if startup_paths.is_empty() {
                        if let Err(error) = windows::focus_or_create_workspace_window(
                            &initial_app,
                            Some(windows::MAIN_WINDOW_LABEL),
                        ) {
                            eprintln!("failed to create the initial Burrete workspace: {error}");
                        }
                    } else {
                        show_and_emit_open_documents(&initial_app, startup_paths);
                    }
                };
                #[cfg(target_os = "macos")]
                macos::after_current_appkit_event(initial_workspace);
                #[cfg(not(target_os = "macos"))]
                app.handle().run_on_main_thread(initial_workspace)?;
            }
            app.on_menu_event(|app, event| menu::handle_event(app, event.id().0.as_str()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compute::commands::compute_capabilities,
            compute::commands::compute_register_inline_source,
            compute::commands::compute_align_grid_poses,
            compute::commands::compute_evaluate_grid_semiempirical,
            compute::commands::compute_submit_job,
            compute::commands::compute_begin_conformer_submission,
            compute::commands::compute_submit_conformer_chunk,
            compute::commands::compute_execute_conformer_distance,
            compute::commands::compute_execute_conformer_stereo,
            compute::commands::compute_validate_conformer_reference,
            compute::commands::compute_publish_conformer,
            compute::commands::compute_begin_cluster_execution,
            compute::commands::compute_submit_fingerprint_chunk,
            compute::commands::compute_execute_cluster,
            compute::commands::compute_execute_chemical_space,
            compute::commands::compute_publish_cluster,
            compute::commands::compute_get_job,
            compute::commands::compute_list_jobs,
            compute::commands::compute_cancel_job,
            compute::commands::compute_get_artifact_manifest,
            compute::commands::compute_export_cluster_representatives,
            compute::commands::compute_find_similar,
            compute::commands::compute_purge_job,
            menu::sync_native_menu,
            menu::drain_native_menu_commands,
            menu::register_exit_preflight_listener,
            menu::unregister_exit_preflight_listener,
            menu::respond_to_exit_preflight,
            commands::recent_documents::initialize_recent_documents,
            commands::recent_documents::merge_recent_documents,
            commands::recent_documents::prune_recent_documents,
            commands::recent_documents::clear_recent_documents,
            commands::agent_integration::agent_integration_status,
            commands::chemical_editors::default_application_icon_path,
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
            commands::documents::release_save_as_reservation,
            commands::documents::abort_open_document_claim,
            commands::documents::render_xyzrender_sheet_item,
            commands::documents::render_xyzrender_sheet_items,
            commands::grid::grid_fetch_page,
            commands::grid::grid_mark_virtual_edit,
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
        .expect("error while building Burrete Tauri application");

    #[cfg(target_os = "macos")]
    macos::install_termination_handler(app.handle())
        .expect("failed to install the macOS termination handler");

    app.run(|app, event| match event {
        RunEvent::Opened { urls } => {
            let paths: Vec<String> = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| path.exists())
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            show_and_emit_open_documents(app, paths);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                let _ = windows::focus_or_create_workspace_window(
                    app,
                    Some(windows::MAIN_WINDOW_LABEL),
                );
            }
        }
        RunEvent::ExitRequested { code, api, .. } if menu::should_prevent_exit(app) => {
            api.prevent_exit();
            #[cfg(target_os = "macos")]
            let keep_running_without_windows = should_keep_running_after_last_window_closed(
                code,
                !app.webview_windows().is_empty(),
            );
            #[cfg(not(target_os = "macos"))]
            let keep_running_without_windows = false;
            if !keep_running_without_windows {
                menu::request_quit(app);
            }
        }
        _ => {}
    });
}

#[cfg(target_os = "macos")]
fn should_keep_running_after_last_window_closed(code: Option<i32>, has_windows: bool) -> bool {
    code.is_none() && !has_windows
}

fn packaged_compute_service_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("BURRETE_COMPUTE_SERVICE_PATH").map(PathBuf::from) {
        return path.is_file().then_some(path);
    }
    let executable = std::env::current_exe().ok()?;
    let directory = executable.parent()?;
    let packaged = directory
        .parent()?
        .join("Helpers")
        .join("burrete-compute-service");
    if packaged.is_file() {
        return Some(packaged);
    }
    let development = directory.join("burrete-compute-service");
    development.is_file().then_some(development)
}

fn show_and_emit_open_documents<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() || menu::exit_transition_is_active(app) {
        return;
    }
    let preferred_label = windows::focused_window_label(app);
    let Ok(window) = windows::focus_or_create_workspace_window(app, preferred_label.as_deref())
    else {
        return;
    };
    startup::signal_open_documents_for_window(app, window.label(), paths);
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::should_keep_running_after_last_window_closed;

    #[test]
    fn keeps_the_app_alive_after_implicit_last_window_close() {
        assert!(should_keep_running_after_last_window_closed(None, false));
        assert!(!should_keep_running_after_last_window_closed(None, true));
        assert!(!should_keep_running_after_last_window_closed(
            Some(0),
            false
        ));
    }
}
