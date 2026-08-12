use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io, path::PathBuf, sync::Mutex};
use tauri::{
    Manager, Monitor, PhysicalPosition, PhysicalSize, Position, Runtime, Size, WebviewWindow,
    WindowEvent,
};

const MANIFEST_VERSION: u32 = 1;
const MANIFEST_FILE_NAME: &str = "workspace-windows.json";
const MAX_RESTORED_WINDOWS: usize = 12;
const MIN_VISIBLE_WIDTH: i32 = 120;
const MIN_VISIBLE_HEIGHT: i32 = 48;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
    fullscreen: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedWorkspaceWindow {
    label: String,
    geometry: Option<WindowGeometry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowManifest {
    version: u32,
    windows: Vec<SavedWorkspaceWindow>,
    active_label: Option<String>,
}

impl Default for WindowManifest {
    fn default() -> Self {
        Self {
            version: MANIFEST_VERSION,
            windows: Vec::new(),
            active_label: None,
        }
    }
}

pub(crate) struct WindowStateRegistry {
    path: Option<PathBuf>,
    manifest: Mutex<WindowManifest>,
}

impl WindowStateRegistry {
    pub(crate) fn load<R: Runtime>(app: &tauri::AppHandle<R>) -> io::Result<Self> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| io::Error::other(error.to_string()))?;
        fs::create_dir_all(&directory)?;
        let path = directory.join(MANIFEST_FILE_NAME);
        let manifest = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<WindowManifest>(&bytes).ok())
            .filter(|manifest| manifest.version == MANIFEST_VERSION)
            .map(normalize_manifest)
            .unwrap_or_default();
        Ok(Self {
            path: Some(path),
            manifest: Mutex::new(manifest),
        })
    }

    pub(crate) fn unavailable() -> Self {
        Self {
            path: None,
            manifest: Mutex::new(WindowManifest::default()),
        }
    }

    pub(crate) fn restoration_order(&self) -> (Vec<String>, Option<String>) {
        let Ok(manifest) = self.manifest.lock() else {
            return (Vec::new(), None);
        };
        (
            manifest
                .windows
                .iter()
                .map(|window| window.label.clone())
                .collect(),
            manifest.active_label.clone(),
        )
    }

    pub(crate) fn ensure_window(&self, label: &str) -> io::Result<()> {
        let snapshot = {
            let mut manifest = self
                .manifest
                .lock()
                .map_err(|_| io::Error::other("window state lock is poisoned"))?;
            if manifest.windows.iter().any(|window| window.label == label) {
                return Ok(());
            }
            manifest.windows.push(SavedWorkspaceWindow {
                label: label.to_string(),
                geometry: None,
            });
            manifest.clone()
        };
        self.write(&snapshot)
    }

    pub(crate) fn apply_geometry<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let saved = self.manifest.lock().ok().and_then(|manifest| {
            manifest
                .windows
                .iter()
                .find(|saved| saved.label == window.label())
                .and_then(|saved| saved.geometry)
        });
        let Some(saved) = saved else {
            return;
        };
        let monitors = window.available_monitors().unwrap_or_default();
        let geometry = visible_geometry(saved, &monitors);
        let _ = window.set_size(Size::Physical(PhysicalSize::new(
            geometry.width,
            geometry.height,
        )));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(
            geometry.x, geometry.y,
        )));
    }

    pub(crate) fn apply_window_mode<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let saved = self.manifest.lock().ok().and_then(|manifest| {
            manifest
                .windows
                .iter()
                .find(|saved| saved.label == window.label())
                .and_then(|saved| saved.geometry)
        });
        let Some(saved) = saved else {
            return;
        };
        if saved.fullscreen {
            let _ = window.set_fullscreen(true);
        } else if saved.maximized {
            let _ = window.maximize();
        }
    }

    pub(crate) fn handle_event<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        event: &WindowEvent,
        preserve_destroyed: bool,
    ) {
        match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                self.capture(window, false);
            }
            WindowEvent::Focused(focused) => {
                self.capture(window, true);
                if *focused {
                    self.set_active(window.label());
                }
            }
            WindowEvent::Destroyed if preserve_destroyed => {
                let _ = self.flush();
            }
            WindowEvent::Destroyed => {
                self.remove(window.label());
            }
            _ => {}
        }
    }

    pub(crate) fn capture_open_windows<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> io::Result<()> {
        let windows = app.webview_windows();
        let live_labels = windows.keys().cloned().collect::<HashSet<_>>();
        let focused = windows
            .values()
            .find(|window| window.is_focused().unwrap_or(false))
            .map(|window| window.label().to_string());
        let geometries = windows
            .values()
            .filter_map(|window| {
                current_geometry(window).map(|geometry| (window.label().to_string(), geometry))
            })
            .collect::<Vec<_>>();
        let snapshot = {
            let mut manifest = self
                .manifest
                .lock()
                .map_err(|_| io::Error::other("window state lock is poisoned"))?;
            manifest
                .windows
                .retain(|window| live_labels.contains(&window.label));
            for (label, geometry) in geometries {
                if let Some(saved) = manifest
                    .windows
                    .iter_mut()
                    .find(|saved| saved.label == label)
                {
                    saved.geometry = Some(merge_geometry(saved.geometry, geometry));
                } else {
                    manifest.windows.push(SavedWorkspaceWindow {
                        label,
                        geometry: Some(geometry),
                    });
                }
            }
            if focused.is_some() {
                manifest.active_label = focused;
            }
            manifest.clone()
        };
        self.write(&snapshot)
    }

    fn capture<R: Runtime>(&self, window: &WebviewWindow<R>, persist: bool) {
        let Some(geometry) = current_geometry(window) else {
            return;
        };
        let snapshot = {
            let Ok(mut manifest) = self.manifest.lock() else {
                return;
            };
            if let Some(saved) = manifest
                .windows
                .iter_mut()
                .find(|saved| saved.label == window.label())
            {
                saved.geometry = Some(merge_geometry(saved.geometry, geometry));
            } else {
                manifest.windows.push(SavedWorkspaceWindow {
                    label: window.label().to_string(),
                    geometry: Some(geometry),
                });
            }
            persist.then(|| manifest.clone())
        };
        if let Some(snapshot) = snapshot {
            let _ = self.write(&snapshot);
        }
    }

    fn set_active(&self, label: &str) {
        let snapshot = {
            let Ok(mut manifest) = self.manifest.lock() else {
                return;
            };
            manifest.active_label = Some(label.to_string());
            manifest.clone()
        };
        let _ = self.write(&snapshot);
    }

    fn remove(&self, label: &str) {
        let snapshot = {
            let Ok(mut manifest) = self.manifest.lock() else {
                return;
            };
            manifest.windows.retain(|window| window.label != label);
            if manifest.active_label.as_deref() == Some(label) {
                manifest.active_label = None;
            }
            manifest.clone()
        };
        let _ = self.write(&snapshot);
    }

    fn flush(&self) -> io::Result<()> {
        let manifest = self
            .manifest
            .lock()
            .map_err(|_| io::Error::other("window state lock is poisoned"))?
            .clone();
        self.write(&manifest)
    }

    fn write(&self, manifest: &WindowManifest) -> io::Result<()> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        let bytes = serde_json::to_vec_pretty(manifest)?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, bytes)?;
        fs::rename(temporary, path)
    }
}

fn normalize_manifest(mut manifest: WindowManifest) -> WindowManifest {
    let mut labels = HashSet::new();
    manifest.windows.retain(|window| {
        valid_workspace_label(&window.label) && labels.insert(window.label.clone())
    });
    manifest.windows.truncate(MAX_RESTORED_WINDOWS);
    labels = manifest
        .windows
        .iter()
        .map(|window| window.label.clone())
        .collect();
    if manifest
        .active_label
        .as_ref()
        .is_some_and(|label| !labels.contains(label))
    {
        manifest.active_label = None;
    }
    manifest
}

fn valid_workspace_label(label: &str) -> bool {
    label == crate::windows::MAIN_WINDOW_LABEL
        || label
            .strip_prefix(crate::windows::WORKSPACE_WINDOW_PREFIX)
            .is_some_and(|value| uuid::Uuid::parse_str(value).is_ok())
}

fn merge_geometry(previous: Option<WindowGeometry>, current: WindowGeometry) -> WindowGeometry {
    if !current.maximized && !current.fullscreen {
        return current;
    }
    let Some(previous) = previous else {
        return current;
    };
    WindowGeometry {
        maximized: current.maximized,
        fullscreen: current.fullscreen,
        ..previous
    }
}

fn current_geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowGeometry> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
        fullscreen: window.is_fullscreen().unwrap_or(false),
    })
}

fn visible_geometry(saved: WindowGeometry, monitors: &[Monitor]) -> WindowGeometry {
    let Some(work_area) = monitors
        .iter()
        .map(|monitor| monitor.work_area())
        .max_by_key(|area| {
            let (width, height) = intersection_size(
                saved,
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            );
            i64::from(width) * i64::from(height)
        })
    else {
        return saved;
    };
    let (visible_width, visible_height) = intersection_size(
        saved,
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
    );
    let width = saved.width.min(work_area.size.width);
    let height = saved.height.min(work_area.size.height);
    if visible_width >= MIN_VISIBLE_WIDTH && visible_height >= MIN_VISIBLE_HEIGHT {
        return WindowGeometry {
            width,
            height,
            ..saved
        };
    }
    WindowGeometry {
        x: work_area.position.x + (work_area.size.width.saturating_sub(width) / 2) as i32,
        y: work_area.position.y + (work_area.size.height.saturating_sub(height) / 2) as i32,
        width,
        height,
        ..saved
    }
}

#[cfg(test)]
fn intersection_area(
    geometry: WindowGeometry,
    area_x: i32,
    area_y: i32,
    area_width: u32,
    area_height: u32,
) -> i64 {
    let (width, height) = intersection_size(geometry, area_x, area_y, area_width, area_height);
    i64::from(width) * i64::from(height)
}

fn intersection_size(
    geometry: WindowGeometry,
    area_x: i32,
    area_y: i32,
    area_width: u32,
    area_height: u32,
) -> (i32, i32) {
    let left = i64::from(geometry.x).max(i64::from(area_x));
    let top = i64::from(geometry.y).max(i64::from(area_y));
    let right = (i64::from(geometry.x) + i64::from(geometry.width))
        .min(i64::from(area_x) + i64::from(area_width));
    let bottom = (i64::from(geometry.y) + i64::from(geometry.height))
        .min(i64::from(area_y) + i64::from(area_height));
    ((right - left).max(0) as i32, (bottom - top).max(0) as i32)
}

#[cfg(test)]
mod tests {
    use super::{intersection_area, intersection_size, merge_geometry, WindowGeometry};

    fn geometry(x: i32, y: i32, width: u32, height: u32) -> WindowGeometry {
        WindowGeometry {
            x,
            y,
            width,
            height,
            maximized: false,
            fullscreen: false,
        }
    }

    #[test]
    fn computes_visible_intersection_for_negative_monitor_coordinates() {
        assert_eq!(
            intersection_area(geometry(-500, 100, 600, 400), -1440, 0, 1440, 900),
            200_000
        );
    }

    #[test]
    fn offscreen_geometry_has_no_visible_area() {
        assert_eq!(
            intersection_area(geometry(3000, 2000, 600, 400), 0, 0, 1920, 1080),
            0
        );
    }

    #[test]
    fn thin_visible_strip_does_not_meet_both_visibility_thresholds() {
        assert_eq!(
            intersection_size(geometry(1912, 100, 600, 760), 0, 0, 1920, 1080),
            (8, 760)
        );
    }

    #[test]
    fn maximized_capture_preserves_the_regular_window_frame() {
        let previous = geometry(120, 80, 1180, 760);
        let mut maximized = geometry(0, 0, 1920, 1050);
        maximized.maximized = true;
        assert_eq!(
            merge_geometry(Some(previous), maximized),
            WindowGeometry {
                maximized: true,
                ..previous
            }
        );
    }
}
