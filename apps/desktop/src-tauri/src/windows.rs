use tauri::window::Color;
#[cfg(target_os = "macos")]
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{
    LogicalPosition, LogicalSize, Manager, Runtime, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::commands::source_editing::{OpenedSourceRegistry, SourceEditRegistry};
use crate::preview::grid_store::GridRuntimeRegistry;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const WORKSPACE_WINDOW_PREFIX: &str = "workspace-";

const DEFAULT_WORKSPACE_WINDOW_WIDTH: f64 = 1180.0;
const DEFAULT_WORKSPACE_WINDOW_HEIGHT: f64 = 760.0;
const MIN_WORKSPACE_WINDOW_WIDTH: f64 = 820.0;
const MIN_WORKSPACE_WINDOW_HEIGHT: f64 = 520.0;
const MIN_REASONABLE_WINDOW_WIDTH: u32 = 640;
const MIN_REASONABLE_WINDOW_HEIGHT: u32 = 420;

pub(crate) fn runtime_document_id(window_label: &str, document_id: &str) -> String {
    format!("{window_label}:{document_id}")
}

pub(crate) fn runtime_document_prefix(window_label: &str) -> String {
    format!("{window_label}:")
}

pub(crate) fn focused_window_label<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .map(|window| window.label().to_string())
        .or_else(|| {
            windows
                .contains_key(MAIN_WINDOW_LABEL)
                .then(|| MAIN_WINDOW_LABEL.to_string())
        })
        .or_else(|| windows.keys().next().cloned())
}

pub(crate) fn focus_or_create_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    preferred_label: Option<&str>,
) -> Result<WebviewWindow<R>, String> {
    if crate::menu::exit_transition_is_active(app) {
        return Err("A window cannot be shown while Burrete is quitting or restarting.".into());
    }
    show_workspace_application(app)?;
    let windows = app.webview_windows();
    let existing_window = preferred_label
        .and_then(|label| windows.get(label).cloned())
        .or_else(|| {
            windows
                .values()
                .find(|window| window.is_focused().unwrap_or(false))
                .cloned()
        })
        .or_else(|| windows.get(MAIN_WINDOW_LABEL).cloned())
        .or_else(|| windows.values().next().cloned());
    let (window, created) = match existing_window {
        Some(window) => (window, false),
        None => (
            create_workspace_window(app, MAIN_WINDOW_LABEL.to_string())?,
            true,
        ),
    };
    if crate::menu::exit_transition_is_active(app) {
        if created {
            let _ = window.destroy();
        }
        return Err("A window cannot be shown while Burrete is quitting or restarting.".into());
    }
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    normalize_workspace_window(&window);
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

pub(crate) fn open_new_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<String, String> {
    if crate::menu::exit_transition_is_active(app) {
        return Err(
            "A new window cannot be opened while Burrete is quitting or restarting.".into(),
        );
    }
    show_workspace_application(app)?;
    let label = next_workspace_label(app);
    let window = create_workspace_window(app, label.clone())?;
    if crate::menu::exit_transition_is_active(app) {
        let _ = window.destroy();
        return Err(
            "A new window cannot be opened while Burrete is quitting or restarting.".into(),
        );
    }
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    normalize_workspace_window(&window);
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(label)
}

fn show_workspace_application<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Regular)
            .map_err(|error| error.to_string())?;
        app.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn create_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: String,
) -> Result<WebviewWindow<R>, String> {
    let url = WebviewUrl::App(format!("index.html?burreteWindow={label}").into());
    let builder = WebviewWindowBuilder::new(app, &label, url)
        .title("Burrete")
        .inner_size(
            DEFAULT_WORKSPACE_WINDOW_WIDTH,
            DEFAULT_WORKSPACE_WINDOW_HEIGHT,
        )
        .min_inner_size(MIN_WORKSPACE_WINDOW_WIDTH, MIN_WORKSPACE_WINDOW_HEIGHT)
        .decorations(true)
        .visible(false)
        .focused(false)
        .prevent_overflow();
    let builder = builder
        .transparent(true)
        .background_color(Color(0, 0, 0, 0));
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(20.0, 29.0))
        .effects(
            EffectsBuilder::new()
                .effect(Effect::HudWindow)
                .state(EffectState::Active)
                .build(),
        )
        .shadow(true);
    let window = builder.build().map_err(|error| error.to_string())?;
    if crate::menu::exit_transition_is_active(app) {
        let _ = window.destroy();
        return Err("Workspace creation was cancelled during an exit transition.".into());
    }
    attach_window_cleanup(app, &window);
    Ok(window)
}

pub(crate) fn attach_window_cleanup<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app
                .state::<GridRuntimeRegistry>()
                .unregister_prefix(&runtime_document_prefix(&label));
            let _ = app
                .state::<OpenedSourceRegistry>()
                .unregister_window(&label);
            let _ = app.state::<SourceEditRegistry>().unregister_window(&label);
            crate::menu::window_destroyed(&app, &label);
        }
    });
}

pub(crate) fn normalize_workspace_window<R: Runtime>(window: &WebviewWindow<R>) {
    let needs_reset = window
        .inner_size()
        .map(|size| {
            size.width < MIN_REASONABLE_WINDOW_WIDTH || size.height < MIN_REASONABLE_WINDOW_HEIGHT
        })
        .unwrap_or(false);
    if !needs_reset {
        return;
    }

    let _ = window.set_size(Size::Logical(LogicalSize::new(
        DEFAULT_WORKSPACE_WINDOW_WIDTH,
        DEFAULT_WORKSPACE_WINDOW_HEIGHT,
    )));
    let _ = window.center();
}

fn next_workspace_label<R: Runtime>(app: &tauri::AppHandle<R>) -> String {
    loop {
        let label = format!("{WORKSPACE_WINDOW_PREFIX}{}", uuid::Uuid::new_v4());
        if app.get_webview_window(&label).is_none() {
            return label;
        }
    }
}
