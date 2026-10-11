use std::sync::Mutex;

use tauri::{Emitter, Manager, Runtime};

const ZOOM_LEVELS: [f64; 13] = [
    0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];
const DEFAULT_ZOOM: f64 = 1.0;
const MIN_ZOOM: f64 = ZOOM_LEVELS[0];
const MAX_ZOOM: f64 = ZOOM_LEVELS[ZOOM_LEVELS.len() - 1];
const LEVEL_EPSILON: f64 = 1e-3;
/// Tells every window that keyboard zoom changed the interface scale, so the
/// persisted setting follows it.
const INTERFACE_SCALE_EVENT: &str = "interface-scale-changed";

pub(crate) struct WindowZoom {
    factor: Mutex<f64>,
}

impl Default for WindowZoom {
    fn default() -> Self {
        Self {
            factor: Mutex::new(DEFAULT_ZOOM),
        }
    }
}

/// The next ladder level above `factor`; scales set from Settings can sit
/// between levels.
fn zoomed_in(factor: f64) -> f64 {
    ZOOM_LEVELS
        .iter()
        .copied()
        .find(|level| *level > factor + LEVEL_EPSILON)
        .unwrap_or(MAX_ZOOM)
}

fn zoomed_out(factor: f64) -> f64 {
    ZOOM_LEVELS
        .iter()
        .rev()
        .copied()
        .find(|level| *level < factor - LEVEL_EPSILON)
        .unwrap_or(MIN_ZOOM)
}

fn command_target_factor(command: &str, current: f64) -> Option<f64> {
    match command {
        "view.zoom-actual" => Some(DEFAULT_ZOOM),
        "view.zoom-in" => Some(zoomed_in(current)),
        "view.zoom-out" => Some(zoomed_out(current)),
        _ => None,
    }
}

fn normalized_factor(scale: f64) -> f64 {
    if scale.is_finite() {
        scale.clamp(MIN_ZOOM, MAX_ZOOM)
    } else {
        DEFAULT_ZOOM
    }
}

fn apply_zoom_to_window<R: Runtime>(window: &tauri::WebviewWindow<R>, factor: f64) {
    if let Err(error) = window.set_zoom(factor) {
        eprintln!(
            "failed to apply zoom factor {factor} to window {}: {error}",
            window.label()
        );
    }
    // Native chrome (macOS traffic lights) does not scale with the webview
    // zoom, so the frontend compensates its reserved areas via this variable.
    let script =
        format!("document.documentElement.style.setProperty('--window-zoom', '{factor}');");
    if let Err(error) = window.eval(script) {
        eprintln!(
            "failed to sync the zoom css variable on window {}: {error}",
            window.label()
        );
    }
}

/// Stores `factor` and applies it to every window. Returns `false` when the
/// factor was already current.
fn set_factor<R: Runtime>(app: &tauri::AppHandle<R>, zoom: &WindowZoom, factor: f64) -> bool {
    {
        let mut current = zoom
            .factor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if (*current - factor).abs() < f64::EPSILON {
            return false;
        }
        *current = factor;
    }
    for window in app.webview_windows().values() {
        apply_zoom_to_window(window, factor);
    }
    true
}

/// Handles the View menu zoom commands. Returns `false` for unrelated ids so
/// the menu dispatcher can fall through to the forwarding path.
pub(crate) fn handle_menu_command<R: Runtime>(app: &tauri::AppHandle<R>, command: &str) -> bool {
    let Some(zoom) = app.try_state::<WindowZoom>() else {
        return false;
    };
    let current = *zoom
        .factor
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(target) = command_target_factor(command, current) else {
        return false;
    };
    if set_factor(app, &zoom, target) {
        if let Err(error) = app.emit(INTERFACE_SCALE_EVENT, target) {
            eprintln!("failed to announce the interface scale change: {error}");
        }
    }
    true
}

/// Applies the Settings interface scale; the shell calls it on launch and
/// whenever the preference changes.
#[tauri::command]
pub(crate) fn set_interface_scale<R: Runtime>(app: tauri::AppHandle<R>, scale: f64) {
    if let Some(zoom) = app.try_state::<WindowZoom>() {
        set_factor(&app, &zoom, normalized_factor(scale));
    }
}

/// Re-syncs the shared zoom factor after a page load, so freshly loaded
/// documents pick up both the webview zoom and the css compensation variable.
pub(crate) fn sync_on_page_load<R: Runtime>(webview: &tauri::Webview<R>) {
    let Some(window) = webview.app_handle().get_webview_window(webview.label()) else {
        return;
    };
    apply_current_zoom(&window);
}

/// Brings a newly created window to the shared zoom factor.
pub(crate) fn apply_current_zoom<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let Some(zoom) = window.app_handle().try_state::<WindowZoom>() else {
        return;
    };
    let factor = *zoom
        .factor
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if (factor - DEFAULT_ZOOM).abs() < f64::EPSILON {
        return;
    }
    apply_zoom_to_window(window, factor);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ladder_contains_actual_size_and_is_strictly_increasing() {
        assert!(ZOOM_LEVELS.contains(&DEFAULT_ZOOM));
        for pair in ZOOM_LEVELS.windows(2) {
            assert!(pair[0] < pair[1]);
        }
    }

    #[test]
    fn zoom_in_steps_up_and_clamps_at_top() {
        assert_eq!(zoomed_in(0.5), 0.67);
        assert_eq!(zoomed_in(2.5), 3.0);
        assert_eq!(zoomed_in(3.0), 3.0);
    }

    #[test]
    fn zoom_out_steps_down_and_clamps_at_bottom() {
        assert_eq!(zoomed_out(0.75), 0.67);
        assert_eq!(zoomed_out(0.67), 0.5);
        assert_eq!(zoomed_out(0.5), 0.5);
    }

    #[test]
    fn off_ladder_scales_step_to_the_neighbouring_levels() {
        assert_eq!(zoomed_in(1.2), 1.25);
        assert_eq!(zoomed_out(1.2), 1.1);
    }

    #[test]
    fn actual_size_returns_to_default_from_either_end() {
        assert_eq!(
            command_target_factor("view.zoom-actual", MIN_ZOOM),
            Some(DEFAULT_ZOOM)
        );
        assert_eq!(
            command_target_factor("view.zoom-actual", MAX_ZOOM),
            Some(DEFAULT_ZOOM)
        );
    }

    #[test]
    fn menu_commands_map_to_their_directions() {
        assert_eq!(command_target_factor("view.zoom-in", 1.0), Some(1.1));
        assert_eq!(command_target_factor("view.zoom-out", 1.0), Some(0.9));
    }

    #[test]
    fn round_trip_returns_to_the_starting_level() {
        assert_eq!(zoomed_out(zoomed_in(DEFAULT_ZOOM)), DEFAULT_ZOOM);
    }

    #[test]
    fn settings_scale_is_clamped_to_the_ladder_range() {
        assert_eq!(normalized_factor(0.1), MIN_ZOOM);
        assert_eq!(normalized_factor(9.0), MAX_ZOOM);
        assert_eq!(normalized_factor(f64::NAN), DEFAULT_ZOOM);
    }

    #[test]
    fn unrelated_commands_are_ignored() {
        assert_eq!(command_target_factor("view.toggle-sidebar", 1.0), None);
        assert_eq!(command_target_factor("file.new-window", 1.0), None);
    }
}
