mod build;
mod events;
mod quit;
mod state;

use tauri::Manager;

pub(crate) use build::configure_menu;
pub(crate) use events::emit_command_to_window;
pub(crate) use events::handle_event;
pub(crate) use quit::{
    authorize_exit, confirm_exit, exit_transition_is_active, request_quit, request_system_quit,
    should_prevent_exit, validate_exit_permit, ExitIntent, ExitTransition, SystemQuitRequest,
};
pub(crate) use state::OpenDocumentRegistry;

#[tauri::command]
pub(crate) fn drain_native_menu_commands<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    pending: tauri::State<'_, events::PendingNativeMenuCommands>,
) -> Result<Vec<events::NativeMenuCommand>, String> {
    pending.drain(window.label())
}

pub(crate) fn window_destroyed<R: tauri::Runtime>(app: &tauri::AppHandle<R>, window_label: &str) {
    quit::window_destroyed(app, window_label);
    events::window_destroyed(app, window_label);
    if let Some(registry) = app.try_state::<OpenDocumentRegistry>() {
        registry.remove_window(window_label);
    }
    let has_other_window = app
        .webview_windows()
        .keys()
        .any(|label| label != window_label);
    if !has_other_window {
        let _ = state::reset_native_menu_for_no_windows(app);
    }
}

#[tauri::command]
pub(crate) fn register_exit_preflight_listener<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) -> Result<String, String> {
    quit::register_exit_preflight_listener(app, window)
}

#[tauri::command]
pub(crate) fn unregister_exit_preflight_listener<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    registration_id: String,
) -> Result<(), String> {
    quit::unregister_exit_preflight_listener(app, window, registration_id)
}

#[tauri::command]
pub(crate) fn respond_to_exit_preflight<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request_id: String,
    close_transition_active: bool,
    dirty: bool,
    revision: u64,
) -> Result<(), String> {
    quit::respond_to_exit_preflight(
        app,
        window,
        request_id,
        close_transition_active,
        dirty,
        revision,
    )
}

#[tauri::command]
pub(crate) fn sync_native_menu<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: state::NativeMenuState,
) -> Result<(), String> {
    state::sync_native_menu(app, window, state)
}
