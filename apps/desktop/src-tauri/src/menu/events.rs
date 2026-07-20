use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime};

use super::quit::{exit_transition_is_active, request_quit};
use super::state::{recent_path, RECENT_MENU_ITEM_PREFIX};

const MENU_COMMAND_EVENT: &str = "menu:command";
const MAX_PENDING_COMMANDS_PER_WINDOW: usize = 64;

const FORWARDED_COMMANDS: &[&str] = &[
    "settings.open",
    "updater.check",
    "file.new-tab",
    "file.open",
    "file.open-clipboard",
    "file.save",
    "file.save-as",
    "file.clear-recent",
    "file.reveal-active",
    "file.copy-active-path",
    "file.show-active-metadata",
    "file.export-smiles",
    "file.export-csv",
    "file.export-preview-png",
    "file.export-preview-svg",
    "file.close-tab",
    "file.close-other-tabs",
    "file.close-all-tabs",
    "file.close-window",
    "edit.undo-grid",
    "edit.redo-grid",
    "edit.find",
    "view.toggle-sidebar",
    "view.toggle-inspector",
    "view.toggle-bottom-panel",
    "view.grid-cards",
    "view.grid-table",
    "view.grid-properties",
    "view.grid-renderer-rdkit",
    "view.grid-renderer-xyzrender",
    "view.command-palette",
    "structure.open-in-molstar",
    "structure.edit-in-ketcher",
    "structure.generate-3d",
    "structure.crest-generate",
    "structure.prism-prune",
    "structure.xtb-optimize",
    "structure.xtb-properties",
    "structure.xtb-frequencies",
    "structure.xtb-vipea",
    "structure.xtb-fukui",
    "collection.copy-selected",
    "collection.select-all",
    "collection.clear-selection",
    "collection.calculate-descriptors",
    "window.previous-tab",
    "window.next-tab",
    "help.open",
    "help.keyboard-shortcuts",
    "help.whats-new",
    "help.report-issue",
    "help.runtime-doctor",
    "help.export-diagnostics",
    "maintenance.clear-preview-cache",
    "maintenance.reset-quick-look",
    "maintenance.open-logs",
];

const WINDOW_REQUIRED_COMMANDS: &[&str] = &[
    "settings.open",
    "updater.check",
    "file.new-tab",
    "file.open",
    "file.open-clipboard",
    "file.clear-recent",
    "view.command-palette",
    "help.open",
    "help.keyboard-shortcuts",
    "help.whats-new",
    "help.report-issue",
    "help.runtime-doctor",
    "help.export-diagnostics",
    "maintenance.clear-preview-cache",
    "maintenance.reset-quick-look",
    "maintenance.open-logs",
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeMenuCommand {
    command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    recent_path: Option<String>,
}

#[derive(Default)]
pub(crate) struct PendingNativeMenuCommands {
    commands_by_window: Mutex<HashMap<String, VecDeque<NativeMenuCommand>>>,
}

impl PendingNativeMenuCommands {
    fn push(&self, window_label: &str, command: NativeMenuCommand) -> Result<(), String> {
        let mut commands_by_window = self
            .commands_by_window
            .lock()
            .map_err(|_| "native menu command queue lock is poisoned".to_string())?;
        let pending = commands_by_window
            .entry(window_label.to_string())
            .or_default();
        if pending.len() == MAX_PENDING_COMMANDS_PER_WINDOW {
            pending.pop_front();
        }
        pending.push_back(command);
        Ok(())
    }

    pub(crate) fn drain(&self, window_label: &str) -> Result<Vec<NativeMenuCommand>, String> {
        let mut commands_by_window = self
            .commands_by_window
            .lock()
            .map_err(|_| "native menu command queue lock is poisoned".to_string())?;
        Ok(commands_by_window
            .remove(window_label)
            .unwrap_or_default()
            .into_iter()
            .collect())
    }

    fn window_destroyed(&self, window_label: &str) {
        if let Ok(mut commands_by_window) = self.commands_by_window.lock() {
            commands_by_window.remove(window_label);
        }
    }
}

pub(crate) fn handle_event<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    if exit_transition_is_active(app) {
        return;
    }

    if id == "app.quit" {
        request_quit(app);
        return;
    }

    if id == "file.new-window" {
        let _ = crate::windows::open_new_workspace_window(app);
        return;
    }

    if is_recent_menu_item_id(id) {
        if let Some(path) = recent_path(app, id) {
            let preferred_label = crate::windows::focused_window_label(app);
            if let Ok(window) =
                crate::windows::focus_or_create_workspace_window(app, preferred_label.as_deref())
            {
                emit_command_to_window(&window, "file.open-recent", Some(path));
            }
        }
        return;
    }

    if FORWARDED_COMMANDS.contains(&id) {
        if WINDOW_REQUIRED_COMMANDS.contains(&id) {
            let preferred_label = crate::windows::focused_window_label(app);
            if let Ok(window) =
                crate::windows::focus_or_create_workspace_window(app, preferred_label.as_deref())
            {
                emit_command_to_window(&window, id, None);
            }
            return;
        }
        emit_command_to_focused_window(app, id, None);
    }
}

fn is_recent_menu_item_id(id: &str) -> bool {
    id.strip_prefix(RECENT_MENU_ITEM_PREFIX)
        .is_some_and(|suffix| {
            !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
        })
}

pub(crate) fn emit_command_to_focused_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    command: &str,
    recent_path: Option<String>,
) {
    if let Some(window) = focused_window(app) {
        emit_command_to_window(&window, command, recent_path);
    }
}

pub(crate) fn emit_command_to_window<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    command: &str,
    recent_path: Option<String>,
) {
    let Some(pending) = window.try_state::<PendingNativeMenuCommands>() else {
        return;
    };
    if pending
        .push(
            window.label(),
            NativeMenuCommand {
                command: command.to_string(),
                recent_path,
            },
        )
        .is_ok()
    {
        let _ = window.emit(MENU_COMMAND_EVENT, ());
    }
}

pub(super) fn window_destroyed<R: Runtime>(app: &tauri::AppHandle<R>, window_label: &str) {
    if let Some(pending) = app.try_state::<PendingNativeMenuCommands>() {
        pending.window_destroyed(window_label);
    }
}

fn focused_window<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::{
        is_recent_menu_item_id, NativeMenuCommand, PendingNativeMenuCommands, FORWARDED_COMMANDS,
        MAX_PENDING_COMMANDS_PER_WINDOW, WINDOW_REQUIRED_COMMANDS,
    };

    #[test]
    fn recent_menu_ids_accept_only_opaque_numeric_items() {
        assert!(is_recent_menu_item_id("file.open-recent.item.7"));
        assert!(!is_recent_menu_item_id("file.open-recent.empty"));
        assert!(!is_recent_menu_item_id("file.open-recent.item.2.extra"));
    }

    #[test]
    fn contextual_and_collection_commands_are_forwarded() {
        for id in [
            "edit.redo-grid",
            "collection.copy-selected",
            "structure.xtb-properties",
            "window.next-tab",
        ] {
            assert!(FORWARDED_COMMANDS.contains(&id), "missing {id}");
        }
    }

    #[test]
    fn document_commands_can_restore_a_closed_workspace() {
        for id in [
            "settings.open",
            "file.new-tab",
            "file.open",
            "file.open-clipboard",
            "view.command-palette",
            "help.open",
            "maintenance.open-logs",
        ] {
            assert!(WINDOW_REQUIRED_COMMANDS.contains(&id), "missing {id}");
        }
        assert!(!WINDOW_REQUIRED_COMMANDS.contains(&"app.quit"));
        assert!(!WINDOW_REQUIRED_COMMANDS.contains(&"structure.generate-3d"));
    }

    #[test]
    fn pending_commands_are_drained_once_in_order() {
        let pending = PendingNativeMenuCommands::default();
        pending
            .push(
                "main",
                NativeMenuCommand {
                    command: "file.open".into(),
                    recent_path: None,
                },
            )
            .unwrap();
        pending
            .push(
                "main",
                NativeMenuCommand {
                    command: "file.open-recent".into(),
                    recent_path: Some("/tmp/example.smi".into()),
                },
            )
            .unwrap();

        assert_eq!(
            pending.drain("main").unwrap(),
            vec![
                NativeMenuCommand {
                    command: "file.open".into(),
                    recent_path: None,
                },
                NativeMenuCommand {
                    command: "file.open-recent".into(),
                    recent_path: Some("/tmp/example.smi".into()),
                },
            ]
        );
        assert!(pending.drain("main").unwrap().is_empty());
    }

    #[test]
    fn pending_commands_are_bounded_per_window() {
        let pending = PendingNativeMenuCommands::default();
        for index in 0..=MAX_PENDING_COMMANDS_PER_WINDOW {
            pending
                .push(
                    "main",
                    NativeMenuCommand {
                        command: format!("command.{index}"),
                        recent_path: None,
                    },
                )
                .unwrap();
        }

        let drained = pending.drain("main").unwrap();
        assert_eq!(drained.len(), MAX_PENDING_COMMANDS_PER_WINDOW);
        assert_eq!(drained.first().unwrap().command, "command.1");
        assert_eq!(
            drained.last().unwrap().command,
            format!("command.{MAX_PENDING_COMMANDS_PER_WINDOW}")
        );
    }
}
