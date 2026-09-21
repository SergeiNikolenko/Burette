use std::sync::Mutex;

use tauri::{Manager, Runtime};

const ZOOM_LEVELS: [f64; 13] = [
    0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];
const DEFAULT_ZOOM_INDEX: usize = 5;

pub(crate) struct WindowZoom {
    level_index: Mutex<usize>,
}

impl Default for WindowZoom {
    fn default() -> Self {
        Self {
            level_index: Mutex::new(DEFAULT_ZOOM_INDEX),
        }
    }
}

fn zoomed_in(index: usize) -> usize {
    index.saturating_add(1).min(ZOOM_LEVELS.len() - 1)
}

fn zoomed_out(index: usize) -> usize {
    index.saturating_sub(1)
}

fn command_target_index(command: &str, current: usize) -> Option<usize> {
    match command {
        "view.zoom-actual" => Some(DEFAULT_ZOOM_INDEX),
        "view.zoom-in" => Some(zoomed_in(current)),
        "view.zoom-out" => Some(zoomed_out(current)),
        _ => None,
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

/// Handles the View menu zoom commands. Returns `false` for unrelated ids so
/// the menu dispatcher can fall through to the forwarding path.
pub(crate) fn handle_menu_command<R: Runtime>(app: &tauri::AppHandle<R>, command: &str) -> bool {
    let Some(zoom) = app.try_state::<WindowZoom>() else {
        return false;
    };
    let factor = {
        let mut index = zoom
            .level_index
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(target) = command_target_index(command, *index) else {
            return false;
        };
        *index = target;
        ZOOM_LEVELS[target]
    };
    for window in app.webview_windows().values() {
        apply_zoom_to_window(window, factor);
    }
    true
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
    let index = *zoom
        .level_index
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if index == DEFAULT_ZOOM_INDEX {
        return;
    }
    apply_zoom_to_window(window, ZOOM_LEVELS[index]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_level_is_actual_size() {
        assert_eq!(ZOOM_LEVELS[DEFAULT_ZOOM_INDEX], 1.0);
    }

    #[test]
    fn ladder_is_strictly_increasing() {
        for pair in ZOOM_LEVELS.windows(2) {
            assert!(pair[0] < pair[1]);
        }
    }

    #[test]
    fn zoom_in_steps_up_and_clamps_at_top() {
        let top = ZOOM_LEVELS.len() - 1;
        assert_eq!(zoomed_in(0), 1);
        assert_eq!(zoomed_in(top - 1), top);
        assert_eq!(zoomed_in(top), top);
    }

    #[test]
    fn zoom_out_steps_down_and_clamps_at_bottom() {
        assert_eq!(zoomed_out(2), 1);
        assert_eq!(zoomed_out(1), 0);
        assert_eq!(zoomed_out(0), 0);
    }

    #[test]
    fn actual_size_returns_to_default_from_either_end() {
        assert_eq!(
            command_target_index("view.zoom-actual", 0),
            Some(DEFAULT_ZOOM_INDEX)
        );
        assert_eq!(
            command_target_index("view.zoom-actual", ZOOM_LEVELS.len() - 1),
            Some(DEFAULT_ZOOM_INDEX)
        );
    }

    #[test]
    fn menu_commands_map_to_their_directions() {
        assert_eq!(command_target_index("view.zoom-in", 5), Some(6));
        assert_eq!(command_target_index("view.zoom-out", 5), Some(4));
    }

    #[test]
    fn round_trip_returns_to_the_starting_level() {
        let stepped = zoomed_out(zoomed_in(DEFAULT_ZOOM_INDEX));
        assert_eq!(stepped, DEFAULT_ZOOM_INDEX);
    }

    #[test]
    fn unrelated_commands_are_ignored() {
        assert_eq!(command_target_index("view.toggle-sidebar", 3), None);
        assert_eq!(command_target_index("file.new-window", 0), None);
    }
}
