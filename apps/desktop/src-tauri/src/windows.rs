use tauri::window::Color;
#[cfg(target_os = "macos")]
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{LogicalSize, Manager, Runtime, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::commands::source_editing::{OpenedSourceRegistry, SourceEditRegistry};
use crate::preview::grid_store::GridRuntimeRegistry;
use crate::window_state::WindowStateRegistry;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const WORKSPACE_WINDOW_PREFIX: &str = "workspace-";

/// How a workspace window first appears.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum WindowEntrance {
    Ordinary,
    /// A fresh install's first window: bare and hidden until its page starts
    /// the first-launch opening (see `crate::intro`).
    Intro,
}

#[derive(Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WindowPresentation {
    #[default]
    Workspace,
    Preview,
}

const DEFAULT_WORKSPACE_WINDOW_WIDTH: f64 = 1180.0;
const DEFAULT_WORKSPACE_WINDOW_HEIGHT: f64 = 760.0;
const MIN_WORKSPACE_WINDOW_WIDTH: f64 = 390.0;
const MIN_WORKSPACE_WINDOW_HEIGHT: f64 = 440.0;
const MIN_REASONABLE_WINDOW_WIDTH: u32 = 320;
const MIN_REASONABLE_WINDOW_HEIGHT: u32 = 320;

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
        return Err("A window cannot be shown while Burette is quitting or restarting.".into());
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
            create_workspace_window(app, MAIN_WINDOW_LABEL.to_string(), WindowEntrance::Ordinary)?,
            true,
        ),
    };
    if crate::menu::exit_transition_is_active(app) {
        if created {
            let _ = window.destroy();
        }
        return Err("A window cannot be shown while Burette is quitting or restarting.".into());
    }
    window.show().map_err(|error| error.to_string())?;
    reposition_traffic_lights(&window);
    window.unminimize().map_err(|error| error.to_string())?;
    normalize_workspace_window(&window);
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

pub(crate) fn open_new_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    presentation: WindowPresentation,
) -> Result<String, String> {
    if crate::menu::exit_transition_is_active(app) {
        return Err(
            "A new window cannot be opened while Burette is quitting or restarting.".into(),
        );
    }
    show_workspace_application(app)?;
    // The popout is a reusable molecule inspector. Reusing its live webview
    // avoids booting another complete application for every picked molecule.
    if presentation == WindowPresentation::Preview {
        if let Some(window) = app
            .webview_windows()
            .values()
            .find(|window| window.label().starts_with("workspace-preview-"))
        {
            let label = window.label().to_string();
            focus_or_create_workspace_window(app, Some(&label))?;
            return Ok(label);
        }
    }
    let label = match presentation {
        WindowPresentation::Workspace => next_workspace_label(app),
        WindowPresentation::Preview => format!("workspace-preview-{}", uuid::Uuid::new_v4()),
    };
    let window = create_workspace_window(app, label.clone(), WindowEntrance::Ordinary)?;
    if crate::menu::exit_transition_is_active(app) {
        let _ = window.destroy();
        return Err(
            "A new window cannot be opened while Burette is quitting or restarting.".into(),
        );
    }
    window.show().map_err(|error| error.to_string())?;
    reposition_traffic_lights(&window);
    window.unminimize().map_err(|error| error.to_string())?;
    normalize_workspace_window(&window);
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(label)
}

pub(crate) fn restore_workspace_windows<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entrance: WindowEntrance,
) -> Result<(), String> {
    show_workspace_application(app)?;
    let registry = app.state::<WindowStateRegistry>();
    let (mut labels, active_label) = registry.restoration_order();
    if labels.is_empty() {
        labels.push(MAIN_WINDOW_LABEL.to_string());
    }
    let mut restored = Vec::new();
    for label in labels {
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let window_entrance = if label == MAIN_WINDOW_LABEL {
            entrance
        } else {
            WindowEntrance::Ordinary
        };
        match create_workspace_window(app, label.clone(), window_entrance) {
            Ok(window) if window_entrance == WindowEntrance::Intro => {
                crate::intro::hold(&window);
                restored.push(window);
            }
            Ok(window) => {
                window.show().map_err(|error| error.to_string())?;
                reposition_traffic_lights(&window);
                normalize_workspace_window(&window);
                registry.apply_window_mode(&window);
                restored.push(window);
            }
            Err(error) if label != MAIN_WINDOW_LABEL => {
                eprintln!("failed to restore workspace window {label}: {error}");
            }
            Err(error) => return Err(error),
        }
    }
    // A held window is shown and focused by its opening.
    if entrance == WindowEntrance::Intro {
        return Ok(());
    }
    let focus_label = active_label
        .filter(|label| app.get_webview_window(label).is_some())
        .or_else(|| restored.first().map(|window| window.label().to_string()))
        .unwrap_or_else(|| MAIN_WINDOW_LABEL.to_string());
    if let Some(window) = app.get_webview_window(&focus_label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

pub(crate) fn hide_workspace_application<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.hide();
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

/// The material behind every workspace window; the opening clears it while it plays.
#[cfg(target_os = "macos")]
pub(crate) fn workspace_effects() -> tauri::utils::config::WindowEffectsConfig {
    EffectsBuilder::new()
        .effect(Effect::HudWindow)
        .state(EffectState::Active)
        .build()
}

fn create_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: String,
    entrance: WindowEntrance,
) -> Result<WebviewWindow<R>, String> {
    let url = WebviewUrl::App(format!("index.html?buretteWindow={label}").into());
    let preview = label.starts_with("workspace-preview-");
    let builder = WebviewWindowBuilder::new(app, &label, url)
        .title("Burette")
        .inner_size(
            if preview {
                540.0
            } else {
                DEFAULT_WORKSPACE_WINDOW_WIDTH
            },
            if preview {
                680.0
            } else {
                DEFAULT_WORKSPACE_WINDOW_HEIGHT
            },
        )
        .min_inner_size(MIN_WORKSPACE_WINDOW_WIDTH, MIN_WORKSPACE_WINDOW_HEIGHT)
        .decorations(!preview)
        .visible(false)
        .focused(false)
        .prevent_overflow();
    let builder = if preview {
        builder.always_on_top(true).visible_on_all_workspaces(true)
    } else {
        builder
    };
    let builder = builder
        .transparent(true)
        .background_color(Color(0, 0, 0, 0));
    let builder = if crate::perf_trace::verbose() {
        builder.initialization_script("window.__BURETTE_PERF_TRACE__ = true;")
    } else {
        builder
    };
    let builder = match entrance {
        WindowEntrance::Ordinary => builder,
        WindowEntrance::Intro => builder.initialization_script(crate::intro::HELD_WINDOW_SCRIPT),
    };
    #[cfg(target_os = "macos")]
    let builder = if preview {
        builder.shadow(true)
    } else {
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(crate::macos::TRAFFIC_LIGHT_INSET);
        match entrance {
            WindowEntrance::Ordinary => builder.effects(workspace_effects()).shadow(true),
            // The opening restores the material and shadow when it settles.
            WindowEntrance::Intro => builder.shadow(false),
        }
    };
    let window = builder.build().map_err(|error| error.to_string())?;
    if crate::menu::exit_transition_is_active(app) {
        let _ = window.destroy();
        return Err("Workspace creation was cancelled during an exit transition.".into());
    }
    let registry = app.state::<WindowStateRegistry>();
    if let Err(error) = registry.ensure_window(&label) {
        eprintln!("failed to persist workspace window {label}: {error}");
    }
    registry.apply_geometry(&window);
    attach_window_cleanup(app, &window);
    #[cfg(target_os = "macos")]
    if !preview {
        crate::macos::keep_traffic_lights_inset(&window);
    }
    crate::zoom::apply_current_zoom(&window);
    Ok(window)
}

pub(crate) fn attach_window_cleanup<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    let app = app.clone();
    let event_window = window.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if let Some(registry) = app.try_state::<WindowStateRegistry>() {
            registry.handle_event(
                &event_window,
                event,
                !crate::menu::should_prevent_exit(&app),
            );
        }
        if matches!(
            event,
            tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Focused(true)
                | tauri::WindowEvent::ThemeChanged(_)
        ) {
            reposition_traffic_lights(&event_window);
        }
        if matches!(event, tauri::WindowEvent::Destroyed) {
            crate::commands::job_host::window_destroyed(&label);
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

fn reposition_traffic_lights<R: Runtime>(window: &WebviewWindow<R>) {
    if window.label().starts_with("workspace-preview-") {
        return;
    }
    #[cfg(target_os = "macos")]
    crate::macos::reposition_traffic_lights(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
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
