use tauri::window::Color;
#[cfg(target_os = "macos")]
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{
    LogicalPosition, LogicalSize, Manager, Runtime, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

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

pub(crate) fn show_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> tauri::Result<Option<WebviewWindow<R>>> {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let window = if let Some(window) = app.get_webview_window(label) {
        window
    } else if label == MAIN_WINDOW_LABEL {
        return Ok(None);
    } else {
        create_workspace_window(app, label.to_string())?
    };
    let _ = window.show();
    let _ = window.unminimize();
    normalize_workspace_window(&window);
    let _ = window.set_focus();
    Ok(Some(window))
}

pub(crate) fn open_new_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<String> {
    let label = next_workspace_label(app);
    let window = create_workspace_window(app, label.clone())?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(label)
}

fn create_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: String,
) -> tauri::Result<WebviewWindow<R>> {
    let url = WebviewUrl::App(format!("index.html?burreteWindow={label}").into());
    let builder = WebviewWindowBuilder::new(app, &label, url)
        .title("Burrete")
        .inner_size(
            DEFAULT_WORKSPACE_WINDOW_WIDTH,
            DEFAULT_WORKSPACE_WINDOW_HEIGHT,
        )
        .min_inner_size(MIN_WORKSPACE_WINDOW_WIDTH, MIN_WORKSPACE_WINDOW_HEIGHT)
        .decorations(true)
        .visible(true)
        .focused(true)
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
    let window = builder.build()?;
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
