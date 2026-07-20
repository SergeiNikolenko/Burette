use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{MenuItemBuilder, MenuItemKind, PredefinedMenuItem};
use tauri::{Manager, Runtime};

const MAX_RECENT_DOCUMENTS: usize = 10;
const MAX_MENU_TITLE_CHARS: usize = 80;
const MAX_INPUT_LABEL_CHARS: usize = 256;
const MAX_RECENT_TITLE_CHARS: usize = 512;
const MAX_RECENT_PATH_CHARS: usize = 4096;
const MAX_TAB_COUNT: usize = 10_000;
const MAX_SELECTED_MOLECULE_COUNT: usize = 10_000_000;
const MAX_NATIVE_MOLSTAR_SELECTION: usize = 100;
const MAX_NATIVE_KETCHER_SELECTION: usize = 25;
const MAX_NATIVE_GENERATE_3D_SELECTION: usize = 20;
pub(super) const RECENT_MENU_ITEM_PREFIX: &str = "file.open-recent.item.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeMenuState {
    document_registry_revision: u64,
    has_active_tab: bool,
    active_tab_closable: bool,
    tab_count: usize,
    closable_tab_count: usize,
    has_active_file: bool,
    has_active_document: bool,
    can_export_external_preview: bool,
    document_dirty: bool,
    is_grid: bool,
    sidebar_open: bool,
    right_dock_open: bool,
    bottom_dock_open: bool,
    can_save: bool,
    can_save_as: bool,
    can_undo: bool,
    can_redo: bool,
    undo_label: Option<String>,
    redo_label: Option<String>,
    grid_editing_text: bool,
    grid_view_mode: Option<String>,
    grid_properties_shown: bool,
    grid_card_renderer: Option<String>,
    selected_molecule_count: usize,
    selected_grid_row_count: usize,
    grid_has_molecules: bool,
    grid_dirty: bool,
    grid_export_enabled: bool,
    grid_selection_enabled: bool,
    grid_supports_xyzrender: bool,
    grid_generating_3d: bool,
    can_open_in_molstar: bool,
    can_edit_in_ketcher: bool,
    can_generate_3d: bool,
    can_run_crest: bool,
    can_run_prism: bool,
    can_run_xtb: bool,
    open_document_paths: Vec<String>,
    recent_documents: Option<Vec<RecentMenuDocument>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecentMenuDocument {
    path: String,
    title: String,
}

#[derive(Default)]
pub(super) struct RecentMenuSnapshot {
    state: Mutex<RecentMenuSnapshotState>,
}

#[derive(Default)]
pub(crate) struct OpenDocumentRegistry {
    state: Mutex<OpenDocumentRegistryState>,
}

#[derive(Default)]
struct OpenDocumentRegistryState {
    paths_by_window: HashMap<String, OpenDocumentSnapshot>,
    provisional_open_claims: HashMap<String, ProvisionalOpenClaim>,
    save_as_reservations: HashMap<PathBuf, SaveAsReservation>,
}

struct OpenDocumentSnapshot {
    revision: u64,
    paths: HashSet<PathBuf>,
}

struct ProvisionalOpenClaim {
    window_label: String,
    path: PathBuf,
    baseline_revision: u64,
}

struct SaveAsReservation {
    window_label: String,
    source_path: PathBuf,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum WritePermitMode {
    Plain,
    SaveAs,
}

impl OpenDocumentRegistry {
    fn replace(&self, window_label: &str, revision: u64, paths: &[String]) -> Result<(), String> {
        let normalized: HashSet<PathBuf> = paths
            .iter()
            .map(|path| normalized_document_path(Path::new(path)))
            .collect();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "open document registry lock is poisoned".to_string())?;
        if let Some(current) = state.paths_by_window.get(window_label) {
            match revision.cmp(&current.revision) {
                std::cmp::Ordering::Less => return Ok(()),
                std::cmp::Ordering::Equal if current.paths == normalized => return Ok(()),
                std::cmp::Ordering::Equal => {
                    return Err("Document registry revision was reused for different paths.".into())
                }
                std::cmp::Ordering::Greater => {}
            }
        }
        state.provisional_open_claims.retain(|_, claim| {
            claim.window_label != window_label
                || revision <= claim.baseline_revision
                || !normalized.contains(&claim.path)
        });
        state.save_as_reservations.retain(|path, reservation| {
            reservation.window_label != window_label || !normalized.contains(path)
        });
        state.paths_by_window.insert(
            window_label.to_string(),
            OpenDocumentSnapshot {
                revision,
                paths: normalized,
            },
        );
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.paths_by_window.remove(window_label);
            state
                .provisional_open_claims
                .retain(|_, claim| claim.window_label != window_label);
            state
                .save_as_reservations
                .retain(|_, reservation| reservation.window_label != window_label);
        }
    }

    pub(crate) fn begin_provisional_open(
        &self,
        window_label: &str,
        path: &Path,
        baseline_revision: u64,
    ) -> Result<Option<String>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "open document registry lock is poisoned".to_string())?;
        let already_open = state
            .paths_by_window
            .get(window_label)
            .is_some_and(|snapshot| snapshot.paths.contains(&normalized_document_path(path)));
        if already_open {
            return Ok(None);
        }
        let path = normalized_document_path(path);
        let claim_id = uuid::Uuid::new_v4().to_string();
        state.provisional_open_claims.insert(
            claim_id.clone(),
            ProvisionalOpenClaim {
                window_label: window_label.to_string(),
                path,
                baseline_revision,
            },
        );
        Ok(Some(claim_id))
    }

    pub(crate) fn abort_open_claim(
        &self,
        window_label: &str,
        claim_id: &str,
    ) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "open document registry lock is poisoned".to_string())?;
        let Some(claim) = state.provisional_open_claims.get(claim_id) else {
            return Ok(false);
        };
        if claim.window_label != window_label {
            return Err("The open document claim belongs to another window.".into());
        }
        state.provisional_open_claims.remove(claim_id);
        Ok(true)
    }

    pub(crate) fn with_write_permit<T>(
        &self,
        window_label: &str,
        output_path: &Path,
        source_path: Option<&Path>,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.write_with_permit(
            window_label,
            output_path,
            source_path,
            None,
            WritePermitMode::Plain,
            write,
        )
    }

    pub(crate) fn with_claimed_write_permit<T>(
        &self,
        window_label: &str,
        output_path: &Path,
        source_path: Option<&Path>,
        owned_claim_id: Option<&str>,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.write_with_permit(
            window_label,
            output_path,
            source_path,
            owned_claim_id,
            WritePermitMode::Plain,
            write,
        )
    }

    pub(crate) fn with_save_as_permit<T>(
        &self,
        window_label: &str,
        output_path: &Path,
        source_path: &Path,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.write_with_permit(
            window_label,
            output_path,
            Some(source_path),
            None,
            WritePermitMode::SaveAs,
            write,
        )
    }

    fn write_with_permit<T>(
        &self,
        window_label: &str,
        output_path: &Path,
        source_path: Option<&Path>,
        owned_claim_id: Option<&str>,
        mode: WritePermitMode,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let output_path = normalized_document_path(output_path);
        let source_path = source_path.map(normalized_document_path);
        let mut state = self
            .state
            .lock()
            .map_err(|_| "open document registry lock is poisoned".to_string())?;
        if let Some(claim_id) = owned_claim_id {
            let claim = state
                .provisional_open_claims
                .get(claim_id)
                .ok_or_else(|| "The open document claim is no longer active.".to_string())?;
            if claim.window_label != window_label || claim.path != output_path {
                return Err("The open document claim does not match this write.".into());
            }
        }
        let materialized_open_here = state
            .paths_by_window
            .get(window_label)
            .is_some_and(|snapshot| snapshot.paths.contains(&output_path));
        let other_provisional_open_here =
            state
                .provisional_open_claims
                .iter()
                .any(|(claim_id, claim)| {
                    claim.window_label == window_label
                        && claim.path == output_path
                        && Some(claim_id.as_str()) != owned_claim_id
                });
        let open_elsewhere = state.paths_by_window.iter().any(|(label, snapshot)| {
            label != window_label && snapshot.paths.contains(&output_path)
        }) || state
            .provisional_open_claims
            .values()
            .any(|claim| claim.window_label != window_label && claim.path == output_path);
        let overwrites_own_source =
            materialized_open_here && source_path.as_ref() == Some(&output_path);
        if open_elsewhere
            || other_provisional_open_here
            || (materialized_open_here && !overwrites_own_source)
        {
            return Err("Close the destination document before replacing it.".into());
        }

        let owns_existing_reservation =
            state
                .save_as_reservations
                .get(&output_path)
                .is_some_and(|reservation| {
                    reservation.window_label == window_label
                        && (source_path.as_ref() == Some(&reservation.source_path)
                            || source_path.as_ref() == Some(&output_path))
                });
        if state.save_as_reservations.contains_key(&output_path) && !owns_existing_reservation {
            return Err("Close the destination document before replacing it.".into());
        }

        let should_reserve = mode == WritePermitMode::SaveAs
            && source_path.is_some()
            && source_path.as_ref() != Some(&output_path);
        let inserted_reservation = should_reserve && !owns_existing_reservation;
        if inserted_reservation {
            state.save_as_reservations.insert(
                output_path.clone(),
                SaveAsReservation {
                    window_label: window_label.to_string(),
                    source_path: source_path.clone().expect("Save As source path"),
                },
            );
        }

        match write() {
            Ok(result) => Ok(result),
            Err(error) => {
                if inserted_reservation {
                    state.save_as_reservations.remove(&output_path);
                }
                Err(error)
            }
        }
    }

    pub(crate) fn release_save_as_reservation(
        &self,
        window_label: &str,
        output_path: &Path,
        source_path: &Path,
    ) -> Result<bool, String> {
        let output_path = normalized_document_path(output_path);
        let source_path = normalized_document_path(source_path);
        let mut state = self
            .state
            .lock()
            .map_err(|_| "open document registry lock is poisoned".to_string())?;
        match state.save_as_reservations.get(&output_path) {
            Some(reservation)
                if reservation.window_label == window_label
                    && reservation.source_path == source_path =>
            {
                state.save_as_reservations.remove(&output_path);
                Ok(true)
            }
            Some(_) => Err("The Save As destination is reserved by another document.".into()),
            None => Ok(false),
        }
    }
}

fn normalized_document_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        path.parent()
            .and_then(|parent| parent.canonicalize().ok())
            .and_then(|parent| path.file_name().map(|name| parent.join(name)))
            .unwrap_or_else(|| path.to_path_buf())
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum QuitRequestStart {
    Authorized,
    Busy,
    InProgress,
    Started,
}

#[derive(Default)]
struct QuitGuardState {
    exit_authorized: bool,
    prompt_open: bool,
    transition_active: bool,
}

#[derive(Default)]
pub(super) struct QuitGuard {
    state: Mutex<QuitGuardState>,
}

impl QuitGuard {
    pub(super) fn authorize_exit(&self) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "quit guard lock is poisoned".to_string())?;
        state.exit_authorized = true;
        Ok(())
    }

    pub(super) fn revoke_exit_authorization(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.exit_authorized = false;
        }
    }

    pub(super) fn exit_is_authorized(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.exit_authorized)
            .unwrap_or(false)
    }

    pub(super) fn begin_quit_request(&self) -> QuitRequestStart {
        let Ok(mut state) = self.state.lock() else {
            return QuitRequestStart::Busy;
        };
        if state.exit_authorized {
            QuitRequestStart::Authorized
        } else if state.transition_active {
            QuitRequestStart::Busy
        } else if state.prompt_open {
            QuitRequestStart::InProgress
        } else {
            state.prompt_open = true;
            QuitRequestStart::Started
        }
    }

    pub(super) fn finish_prompt(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.prompt_open = false;
        }
    }

    pub(super) fn begin_transition(&self, quit_prompt_owner: bool) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.transition_active
            || (quit_prompt_owner && !state.prompt_open)
            || (!quit_prompt_owner && state.prompt_open)
        {
            return false;
        }
        state.transition_active = true;
        true
    }

    pub(super) fn finish_transition(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.transition_active = false;
        }
    }

    pub(super) fn transition_is_active(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.transition_active)
            .unwrap_or(true)
    }
}

#[derive(Default)]
struct RecentMenuSnapshotState {
    next_id: u64,
    paths_by_id: HashMap<String, String>,
}

impl RecentMenuSnapshot {
    fn replace(&self, paths: Vec<String>) -> Result<Vec<String>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "recent menu snapshot lock is poisoned".to_string())?;
        let mut item_ids = Vec::with_capacity(paths.len());
        let mut paths_by_id = HashMap::with_capacity(paths.len());
        for path in paths {
            let item_id = state
                .paths_by_id
                .iter()
                .find_map(|(item_id, existing_path)| {
                    (existing_path == &path).then(|| item_id.clone())
                })
                .unwrap_or_else(|| {
                    let item_id = format!("{RECENT_MENU_ITEM_PREFIX}{}", state.next_id);
                    state.next_id = state.next_id.wrapping_add(1);
                    item_id
                });
            paths_by_id.insert(item_id.clone(), path);
            item_ids.push(item_id);
        }
        state.paths_by_id = paths_by_id;
        Ok(item_ids)
    }

    fn path(&self, item_id: &str) -> Option<String> {
        self.state.lock().ok()?.paths_by_id.get(item_id).cloned()
    }
}

pub(super) fn recent_path<R: Runtime>(app: &tauri::AppHandle<R>, item_id: &str) -> Option<String> {
    app.try_state::<RecentMenuSnapshot>()?.path(item_id)
}

pub(super) fn sync_native_menu<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: NativeMenuState,
) -> Result<(), String> {
    state.validate()?;
    app.try_state::<OpenDocumentRegistry>()
        .ok_or_else(|| "open document registry is not configured".to_string())?
        .replace(
            window.label(),
            state.document_registry_revision,
            &state.open_document_paths,
        )?;
    sync_document_edited(&window, state.document_dirty)?;

    if !window.is_focused().map_err(|error| error.to_string())? {
        return Ok(());
    }

    if let Some(documents) = &state.recent_documents {
        sync_recent_documents(&app, documents)?;
    }

    set_enabled(&app, "file.save", state.can_save)?;
    set_enabled(&app, "file.save-as", state.can_save_as)?;
    set_enabled(&app, "file.reveal-active", state.has_active_file)?;
    set_enabled(&app, "file.copy-active-path", state.has_active_file)?;
    set_enabled(
        &app,
        "file.show-active-metadata",
        state.has_active_file || state.has_active_document,
    )?;
    set_enabled(
        &app,
        "file.export",
        (state.is_grid && state.grid_has_molecules && state.grid_export_enabled)
            || state.can_export_external_preview,
    )?;
    set_enabled(
        &app,
        "file.export-smiles",
        state.is_grid && state.grid_has_molecules && state.grid_export_enabled,
    )?;
    set_enabled(
        &app,
        "file.export-csv",
        state.is_grid && state.grid_has_molecules && state.grid_export_enabled,
    )?;
    set_enabled(
        &app,
        "file.export-preview-png",
        state.can_export_external_preview,
    )?;
    set_enabled(
        &app,
        "file.export-preview-svg",
        state.can_export_external_preview,
    )?;
    set_enabled(&app, "file.close-tab", state.active_tab_closable)?;
    set_enabled(
        &app,
        "file.close-other-tabs",
        state.has_active_tab && state.tab_count > 1,
    )?;
    set_enabled(&app, "file.close-all-tabs", state.closable_tab_count > 0)?;
    set_enabled(&app, "file.close-window", true)?;

    sync_edit_history(&app, &state)?;
    set_enabled(&app, "edit.find", true)?;

    set_enabled(&app, "view.toggle-sidebar", true)?;
    set_enabled(&app, "view.toggle-inspector", true)?;
    set_enabled(&app, "view.toggle-bottom-panel", true)?;
    set_checked(&app, "view.toggle-sidebar", state.sidebar_open)?;
    set_checked(&app, "view.toggle-inspector", state.right_dock_open)?;
    set_checked(&app, "view.toggle-bottom-panel", state.bottom_dock_open)?;
    set_enabled(&app, "view.grid-cards", state.is_grid)?;
    set_enabled(&app, "view.grid-table", state.is_grid)?;
    set_enabled(
        &app,
        "view.grid-properties",
        state.is_grid && state.grid_view_mode.as_deref() == Some("cards"),
    )?;
    set_enabled(&app, "view.grid-renderer", state.is_grid)?;
    set_enabled(&app, "view.grid-renderer-rdkit", state.is_grid)?;
    set_enabled(
        &app,
        "view.grid-renderer-xyzrender",
        state.is_grid && state.grid_supports_xyzrender,
    )?;
    set_checked(
        &app,
        "view.grid-cards",
        state.is_grid && state.grid_view_mode.as_deref() == Some("cards"),
    )?;
    set_checked(
        &app,
        "view.grid-table",
        state.is_grid && state.grid_view_mode.as_deref() == Some("table"),
    )?;
    set_checked(
        &app,
        "view.grid-properties",
        state.is_grid && state.grid_properties_shown,
    )?;
    set_checked(
        &app,
        "view.grid-renderer-rdkit",
        state.is_grid && state.grid_card_renderer.as_deref() == Some("rdkit"),
    )?;
    set_checked(
        &app,
        "view.grid-renderer-xyzrender",
        state.is_grid && state.grid_card_renderer.as_deref() == Some("xyzrender"),
    )?;
    set_enabled(&app, "view.command-palette", true)?;

    set_enabled(&app, "structure.menu", true)?;
    set_text(
        &app,
        "structure.open-in-molstar",
        if state.is_grid && state.selected_molecule_count > MAX_NATIVE_MOLSTAR_SELECTION {
            format!("Open Selection in Mol* (max {MAX_NATIVE_MOLSTAR_SELECTION})")
        } else if state.is_grid && state.selected_molecule_count >= 2 {
            format!(
                "Open {} Selected Molecules in Mol*",
                state.selected_molecule_count
            )
        } else if state.is_grid && state.selected_molecule_count == 0 {
            "Open Selection in Mol*".into()
        } else if state.is_grid {
            "Open Selected Molecule in Mol*".into()
        } else {
            "Open Molecule in Mol*".into()
        },
    )?;
    set_text(
        &app,
        "structure.edit-in-ketcher",
        if state.is_grid && state.selected_molecule_count > MAX_NATIVE_KETCHER_SELECTION {
            format!("Open Selection in Ketcher (max {MAX_NATIVE_KETCHER_SELECTION})")
        } else if state.is_grid && state.selected_molecule_count >= 2 {
            format!(
                "Open {} Selected Molecules in Ketcher",
                state.selected_molecule_count
            )
        } else if state.is_grid && state.selected_molecule_count == 0 {
            "Edit Selection in Ketcher".into()
        } else if state.is_grid {
            "Edit Selected Molecule in Ketcher".into()
        } else {
            "Edit in Ketcher".into()
        },
    )?;
    set_text(
        &app,
        "structure.generate-3d",
        if state.is_grid && state.selected_molecule_count > MAX_NATIVE_GENERATE_3D_SELECTION {
            format!("Generate 3D for Selection (max {MAX_NATIVE_GENERATE_3D_SELECTION})")
        } else if state.is_grid && state.selected_molecule_count == 0 {
            "Generate 3D for Selection".into()
        } else if state.is_grid {
            format!(
                "Generate 3D for {} Selected Molecule{}",
                state.selected_molecule_count,
                if state.selected_molecule_count == 1 {
                    ""
                } else {
                    "s"
                }
            )
        } else {
            "Generate 3D Conformer".into()
        },
    )?;
    set_enabled(&app, "structure.open-in-molstar", state.can_open_in_molstar)?;
    set_enabled(&app, "structure.edit-in-ketcher", state.can_edit_in_ketcher)?;
    set_enabled(
        &app,
        "structure.generate-3d",
        state.can_generate_3d && !state.grid_generating_3d,
    )?;
    set_enabled(&app, "structure.crest-generate", state.can_run_crest)?;
    set_enabled(&app, "structure.prism-prune", state.can_run_prism)?;
    set_enabled(&app, "structure.xtb-optimize", state.can_run_xtb)?;
    set_enabled(&app, "structure.xtb-properties", state.can_run_xtb)?;
    set_enabled(&app, "structure.xtb-frequencies", state.can_run_xtb)?;
    set_enabled(&app, "structure.xtb-vipea", state.can_run_xtb)?;
    set_enabled(&app, "structure.xtb-fukui", state.can_run_xtb)?;

    let has_grid_selection =
        state.is_grid && state.grid_selection_enabled && state.selected_grid_row_count > 0;
    set_enabled(&app, "collection.menu", true)?;
    set_enabled(&app, "collection.copy-selected", has_grid_selection)?;
    set_enabled(
        &app,
        "collection.select-all",
        state.is_grid && state.grid_has_molecules && state.grid_selection_enabled,
    )?;
    set_enabled(&app, "collection.clear-selection", has_grid_selection)?;
    set_enabled(
        &app,
        "collection.calculate-descriptors",
        state.is_grid && state.grid_has_molecules && !state.grid_dirty,
    )?;

    let can_cycle_tabs = state.tab_count > 1;
    set_enabled(&app, "window.previous-tab", can_cycle_tabs)?;
    set_enabled(&app, "window.next-tab", can_cycle_tabs)?;
    Ok(())
}

pub(super) fn reset_native_menu_for_no_windows<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    for id in [
        "file.save",
        "file.save-as",
        "file.reveal-active",
        "file.copy-active-path",
        "file.show-active-metadata",
        "file.export",
        "file.export-smiles",
        "file.export-csv",
        "file.export-preview-png",
        "file.export-preview-svg",
        "file.close-tab",
        "file.close-other-tabs",
        "file.close-all-tabs",
        "file.close-window",
        "edit.find",
        "view.toggle-sidebar",
        "view.toggle-inspector",
        "view.toggle-bottom-panel",
        "view.grid-cards",
        "view.grid-table",
        "view.grid-properties",
        "view.grid-renderer",
        "view.grid-renderer-rdkit",
        "view.grid-renderer-xyzrender",
        "structure.menu",
        "collection.menu",
        "window.previous-tab",
        "window.next-tab",
    ] {
        set_enabled(app, id, false)?;
    }
    for id in [
        "view.toggle-sidebar",
        "view.toggle-inspector",
        "view.toggle-bottom-panel",
        "view.grid-cards",
        "view.grid-table",
        "view.grid-properties",
        "view.grid-renderer-rdkit",
        "view.grid-renderer-xyzrender",
    ] {
        set_checked(app, id, false)?;
    }
    set_text(app, "structure.open-in-molstar", "Open Molecule in Mol*")?;
    set_text(app, "structure.edit-in-ketcher", "Edit in Ketcher")?;
    set_text(app, "structure.generate-3d", "Generate 3D Conformer")?;
    ensure_standard_edit_history(app)
}

impl NativeMenuState {
    fn validate(&self) -> Result<(), String> {
        if self.tab_count > MAX_TAB_COUNT {
            return Err(format!("tabCount must not exceed {MAX_TAB_COUNT}"));
        }
        if self.closable_tab_count > self.tab_count {
            return Err("closableTabCount must not exceed tabCount".into());
        }
        if self.active_tab_closable && !self.has_active_tab {
            return Err("activeTabClosable requires hasActiveTab".into());
        }
        if self.selected_molecule_count > MAX_SELECTED_MOLECULE_COUNT {
            return Err(format!(
                "selectedMoleculeCount must not exceed {MAX_SELECTED_MOLECULE_COUNT}"
            ));
        }
        if self.selected_grid_row_count > MAX_SELECTED_MOLECULE_COUNT {
            return Err(format!(
                "selectedGridRowCount must not exceed {MAX_SELECTED_MOLECULE_COUNT}"
            ));
        }
        if self.selected_molecule_count > self.selected_grid_row_count {
            return Err("selectedMoleculeCount must not exceed selectedGridRowCount".into());
        }
        validate_optional_string(
            "undoLabel",
            self.undo_label.as_deref(),
            MAX_INPUT_LABEL_CHARS,
        )?;
        validate_optional_string(
            "redoLabel",
            self.redo_label.as_deref(),
            MAX_INPUT_LABEL_CHARS,
        )?;
        validate_choice(
            "gridViewMode",
            self.grid_view_mode.as_deref(),
            &["cards", "table"],
        )?;
        validate_choice(
            "gridCardRenderer",
            self.grid_card_renderer.as_deref(),
            &["rdkit", "xyzrender"],
        )?;
        if let Some(documents) = &self.recent_documents {
            validate_recent_documents(documents)?;
        }
        validate_open_document_paths(&self.open_document_paths)?;
        Ok(())
    }
}

fn validate_optional_string(
    field: &str,
    value: Option<&str>,
    max_chars: usize,
) -> Result<(), String> {
    if value.is_some_and(|value| value.chars().count() > max_chars) {
        return Err(format!("{field} must not exceed {max_chars} characters"));
    }
    Ok(())
}

fn validate_choice(field: &str, value: Option<&str>, choices: &[&str]) -> Result<(), String> {
    if value.is_some_and(|value| !choices.contains(&value)) {
        return Err(format!("{field} has an unsupported value"));
    }
    Ok(())
}

fn validate_recent_documents(documents: &[RecentMenuDocument]) -> Result<(), String> {
    if documents.len() > MAX_RECENT_DOCUMENTS {
        return Err(format!(
            "recentDocuments must not contain more than {MAX_RECENT_DOCUMENTS} entries"
        ));
    }
    let mut paths = HashSet::with_capacity(documents.len());
    for document in documents {
        if document.path.trim().is_empty() {
            return Err("recentDocuments paths must not be empty".into());
        }
        if !Path::new(&document.path).is_absolute() {
            return Err("recentDocuments paths must be absolute".into());
        }
        if document.path.chars().count() > MAX_RECENT_PATH_CHARS {
            return Err(format!(
                "recentDocuments paths must not exceed {MAX_RECENT_PATH_CHARS} characters"
            ));
        }
        if document.title.chars().count() > MAX_RECENT_TITLE_CHARS {
            return Err(format!(
                "recentDocuments titles must not exceed {MAX_RECENT_TITLE_CHARS} characters"
            ));
        }
        if !paths.insert(document.path.as_str()) {
            return Err("recentDocuments paths must be unique".into());
        }
    }
    Ok(())
}

fn validate_open_document_paths(paths: &[String]) -> Result<(), String> {
    if paths.len() > MAX_TAB_COUNT {
        return Err(format!(
            "openDocumentPaths must not contain more than {MAX_TAB_COUNT} entries"
        ));
    }
    let mut unique_paths = HashSet::with_capacity(paths.len());
    for path in paths {
        if !Path::new(path).is_absolute() {
            return Err("openDocumentPaths must be absolute".into());
        }
        if path.chars().count() > MAX_RECENT_PATH_CHARS {
            return Err(format!(
                "openDocumentPaths must not exceed {MAX_RECENT_PATH_CHARS} characters"
            ));
        }
        if !unique_paths.insert(path) {
            return Err("openDocumentPaths must be unique".into());
        }
    }
    Ok(())
}

fn sync_edit_history<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &NativeMenuState,
) -> Result<(), String> {
    let item = find_app_menu_item(app, "edit.menu")?;
    let submenu = item
        .as_submenu()
        .ok_or_else(|| "edit.menu is not a submenu".to_string())?;
    let items = submenu.items().map_err(|error| error.to_string())?;
    let use_grid_history = state.is_grid && !state.grid_editing_text;

    if use_grid_history {
        let has_grid_pair = items
            .first()
            .is_some_and(|item| item.id().0 == "edit.undo-grid")
            && items
                .get(1)
                .is_some_and(|item| item.id().0 == "edit.redo-grid");
        if !has_grid_pair {
            replace_edit_history_items(submenu, app, true)?;
        }
        set_text(
            app,
            "edit.undo-grid",
            contextual_history_title("Undo", state.undo_label.as_deref()),
        )?;
        set_text(
            app,
            "edit.redo-grid",
            contextual_history_title("Redo", state.redo_label.as_deref()),
        )?;
        set_enabled(app, "edit.undo-grid", state.can_undo)?;
        set_enabled(app, "edit.redo-grid", state.can_redo)?;
    } else {
        ensure_standard_edit_history(app)?;
    }
    Ok(())
}

fn ensure_standard_edit_history<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let item = find_app_menu_item(app, "edit.menu")?;
    let submenu = item
        .as_submenu()
        .ok_or_else(|| "edit.menu is not a submenu".to_string())?;
    let items = submenu.items().map_err(|error| error.to_string())?;
    let has_standard_pair = matches!(items.first(), Some(MenuItemKind::Predefined(_)))
        && matches!(items.get(1), Some(MenuItemKind::Predefined(_)));
    if !has_standard_pair {
        replace_edit_history_items(submenu, app, false)?;
    }
    Ok(())
}

fn replace_edit_history_items<R: Runtime>(
    submenu: &tauri::menu::Submenu<R>,
    app: &tauri::AppHandle<R>,
    grid: bool,
) -> Result<(), String> {
    if submenu
        .remove_at(0)
        .map_err(|error| error.to_string())?
        .is_none()
        || submenu
            .remove_at(0)
            .map_err(|error| error.to_string())?
            .is_none()
    {
        return Err("edit.menu is missing its history items".into());
    }

    if grid {
        let undo = MenuItemBuilder::with_id("edit.undo-grid", "Undo")
            .enabled(false)
            .accelerator("CmdOrCtrl+Z")
            .build(app)
            .map_err(|error| error.to_string())?;
        let redo = MenuItemBuilder::with_id("edit.redo-grid", "Redo")
            .enabled(false)
            .accelerator("CmdOrCtrl+Shift+Z")
            .build(app)
            .map_err(|error| error.to_string())?;
        submenu
            .insert_items(&[&undo, &redo], 0)
            .map_err(|error| error.to_string())?;
    } else {
        let undo = PredefinedMenuItem::undo(app, None).map_err(|error| error.to_string())?;
        let redo = PredefinedMenuItem::redo(app, None).map_err(|error| error.to_string())?;
        submenu
            .insert_items(&[&undo, &redo], 0)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn contextual_history_title(prefix: &str, label: Option<&str>) -> String {
    let operation = label.map(normalize_whitespace).unwrap_or_default();
    if operation.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix} {operation}")
            .chars()
            .take(MAX_MENU_TITLE_CHARS)
            .collect()
    }
}

fn sync_recent_documents<R: Runtime>(
    app: &tauri::AppHandle<R>,
    documents: &[RecentMenuDocument],
) -> Result<(), String> {
    let snapshot = app
        .try_state::<RecentMenuSnapshot>()
        .ok_or_else(|| "recent menu snapshot is not configured".to_string())?;
    let item_ids = snapshot.replace(
        documents
            .iter()
            .map(|document| document.path.clone())
            .collect(),
    )?;
    let item = find_app_menu_item(app, "file.open-recent")?;
    let submenu = item
        .as_submenu()
        .ok_or_else(|| "file.open-recent is not a submenu".to_string())?;
    for item in submenu.items().map_err(|error| error.to_string())? {
        submenu.remove(&item).map_err(|error| error.to_string())?;
    }

    if documents.is_empty() {
        let empty = MenuItemBuilder::with_id("file.open-recent.empty", "No Recent Documents")
            .enabled(false)
            .build(app)
            .map_err(|error| error.to_string())?;
        submenu.append(&empty).map_err(|error| error.to_string())?;
        submenu
            .set_enabled(false)
            .map_err(|error| error.to_string())?;
    } else {
        for (index, (item_id, title)) in item_ids
            .into_iter()
            .zip(recent_menu_titles(documents))
            .enumerate()
        {
            let mut builder = MenuItemBuilder::with_id(item_id, title);
            if index == 0 {
                builder = builder.accelerator("CmdOrCtrl+Shift+O");
            }
            let item = builder.build(app).map_err(|error| error.to_string())?;
            submenu.append(&item).map_err(|error| error.to_string())?;
        }
        let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
        let clear = MenuItemBuilder::with_id("file.clear-recent", "Clear Menu")
            .build(app)
            .map_err(|error| error.to_string())?;
        submenu
            .append(&separator)
            .map_err(|error| error.to_string())?;
        submenu.append(&clear).map_err(|error| error.to_string())?;
        submenu
            .set_enabled(true)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn recent_menu_titles(documents: &[RecentMenuDocument]) -> Vec<String> {
    let normalized = documents
        .iter()
        .map(|document| recent_menu_title(&document.title))
        .collect::<Vec<_>>();
    let counts = normalized.iter().fold(HashMap::new(), |mut counts, title| {
        *counts.entry(title.to_lowercase()).or_insert(0usize) += 1;
        counts
    });

    documents
        .iter()
        .zip(normalized)
        .map(|(document, title)| {
            if counts.get(&title.to_lowercase()).copied().unwrap_or(0) < 2 {
                title
            } else {
                recent_menu_title_with_parent(&title, &document.path)
            }
        })
        .collect()
}

fn recent_menu_title(title: &str) -> String {
    let normalized = normalize_whitespace(title);
    let title = if normalized.is_empty() {
        "Untitled Structure".to_string()
    } else {
        normalized
    };
    title.chars().take(MAX_MENU_TITLE_CHARS).collect()
}

fn recent_menu_title_with_parent(title: &str, path: &str) -> String {
    let parent = Path::new(path)
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .map(normalize_whitespace)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Folder".into());
    let parent = parent.chars().take(30).collect::<String>();
    let suffix = format!(" — {parent}");
    let title_room = MAX_MENU_TITLE_CHARS.saturating_sub(suffix.chars().count());
    format!(
        "{}{suffix}",
        title.chars().take(title_room).collect::<String>()
    )
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn set_enabled<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    match find_app_menu_item(app, id)? {
        MenuItemKind::MenuItem(item) => item.set_enabled(enabled),
        MenuItemKind::Submenu(item) => item.set_enabled(enabled),
        MenuItemKind::Check(item) => item.set_enabled(enabled),
        MenuItemKind::Icon(item) => item.set_enabled(enabled),
        MenuItemKind::Predefined(_) => return Err(format!("{id} cannot be enabled dynamically")),
    }
    .map_err(|error| error.to_string())
}

fn set_text<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    text: impl AsRef<str>,
) -> Result<(), String> {
    let text = text.as_ref();
    match find_app_menu_item(app, id)? {
        MenuItemKind::MenuItem(item) => item.set_text(text),
        MenuItemKind::Submenu(item) => item.set_text(text),
        MenuItemKind::Check(item) => item.set_text(text),
        MenuItemKind::Icon(item) => item.set_text(text),
        MenuItemKind::Predefined(item) => item.set_text(text),
    }
    .map_err(|error| error.to_string())
}

fn set_checked<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    checked: bool,
) -> Result<(), String> {
    let item = find_app_menu_item(app, id)?;
    item.as_check_menuitem()
        .ok_or_else(|| format!("{id} is not a check menu item"))?
        .set_checked(checked)
        .map_err(|error| error.to_string())
}

fn find_app_menu_item<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<MenuItemKind<R>, String> {
    let menu = app
        .menu()
        .ok_or_else(|| "application menu is not configured".to_string())?;
    find_menu_item(menu.items().map_err(|error| error.to_string())?, id)?
        .ok_or_else(|| format!("native menu item {id} is missing"))
}

fn find_menu_item<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
) -> Result<Option<MenuItemKind<R>>, String> {
    for item in items {
        if item.id().0 == id {
            return Ok(Some(item));
        }
        if let Some(submenu) = item.as_submenu() {
            let children = submenu.items().map_err(|error| error.to_string())?;
            if let Some(found) = find_menu_item(children, id)? {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn sync_document_edited<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    document_dirty: bool,
) -> Result<(), String> {
    use cocoa::base::{id, NO, YES};
    use objc::{msg_send, sel, sel_impl};

    window
        .with_webview(move |webview| unsafe {
            let ns_window = webview.ns_window() as id;
            let edited = if document_dirty { YES } else { NO };
            let _: () = msg_send![ns_window, setDocumentEdited: edited];
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn sync_document_edited<R: Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _document_dirty: bool,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        contextual_history_title, recent_menu_titles, validate_recent_documents, NativeMenuState,
        OpenDocumentRegistry, RecentMenuDocument, RecentMenuSnapshot, MAX_MENU_TITLE_CHARS,
    };
    use serde_json::json;
    use std::path::Path;

    fn valid_native_menu_state_payload() -> serde_json::Value {
        json!({
            "documentRegistryRevision": 1,
            "hasActiveTab": true,
            "activeTabClosable": true,
            "tabCount": 2,
            "closableTabCount": 1,
            "hasActiveFile": true,
            "hasActiveDocument": true,
            "canExportExternalPreview": false,
            "documentDirty": false,
            "isGrid": true,
            "sidebarOpen": true,
            "rightDockOpen": false,
            "bottomDockOpen": false,
            "canSave": false,
            "canSaveAs": true,
            "canUndo": false,
            "canRedo": false,
            "undoLabel": null,
            "redoLabel": null,
            "gridEditingText": false,
            "gridViewMode": "cards",
            "gridPropertiesShown": true,
            "gridCardRenderer": "rdkit",
            "selectedMoleculeCount": 1,
            "selectedGridRowCount": 1,
            "gridHasMolecules": true,
            "gridDirty": false,
            "gridExportEnabled": true,
            "gridSelectionEnabled": true,
            "gridSupportsXyzrender": false,
            "gridGenerating3d": false,
            "canOpenInMolstar": true,
            "canEditInKetcher": true,
            "canGenerate3d": true,
            "canRunCrest": false,
            "canRunPrism": false,
            "canRunXtb": false,
            "openDocumentPaths": ["/tmp/molecules.sdf"],
            "recentDocuments": null
        })
    }

    #[test]
    fn current_native_menu_payload_deserializes_and_validates() {
        let state: NativeMenuState = serde_json::from_value(valid_native_menu_state_payload())
            .expect("current native menu payload");

        state.validate().expect("valid native menu state");
    }

    #[test]
    fn native_menu_payload_rejects_unknown_fields() {
        let mut payload = valid_native_menu_state_payload();
        payload["removedCapability"] = json!(true);

        assert!(serde_json::from_value::<NativeMenuState>(payload).is_err());
    }

    #[test]
    fn open_document_registry_blocks_cross_window_overwrites() {
        let registry = OpenDocumentRegistry::default();
        registry
            .replace("main", 1, &["/tmp/shared.sdf".to_string()])
            .expect("register main document");
        registry
            .replace("workspace", 1, &["/tmp/other.sdf".to_string()])
            .expect("register workspace document");

        let blocked = registry.with_write_permit(
            "workspace",
            Path::new("/tmp/shared.sdf"),
            Some(Path::new("/tmp/other.sdf")),
            || Ok(()),
        );
        assert!(blocked
            .expect_err("cross-window overwrite must fail")
            .contains("Close the destination"));

        registry
            .with_write_permit(
                "main",
                Path::new("/tmp/shared.sdf"),
                Some(Path::new("/tmp/shared.sdf")),
                || Ok(()),
            )
            .expect("a window may save its own source document");
    }

    #[test]
    fn provisional_open_claim_survives_unrelated_and_stale_snapshots() {
        let registry = OpenDocumentRegistry::default();
        registry
            .replace("main", 10, &["/tmp/already-open.sdf".to_string()])
            .expect("register the request-time snapshot");
        registry
            .replace("workspace", 1, &["/tmp/workspace-source.sdf".to_string()])
            .expect("register workspace source");
        let claim_id = registry
            .begin_provisional_open("main", Path::new("/tmp/opening.sdf"), 10)
            .expect("begin provisional open")
            .expect("new path should need a claim");

        registry
            .replace("main", 11, &["/tmp/already-open.sdf".to_string()])
            .expect("an unrelated newer snapshot may omit the opening path");
        let blocked = registry.with_write_permit(
            "workspace",
            Path::new("/tmp/opening.sdf"),
            Some(Path::new("/tmp/workspace-source.sdf")),
            || Ok(()),
        );
        assert!(blocked
            .expect_err("an unrelated snapshot must not expose the opening path")
            .contains("Close the destination"));

        registry
            .replace(
                "main",
                12,
                &[
                    "/tmp/already-open.sdf".to_string(),
                    "/tmp/opening.sdf".to_string(),
                ],
            )
            .expect("the materializing snapshot should commit the open path");
        registry
            .replace("main", 11, &["/tmp/already-open.sdf".to_string()])
            .expect("a late stale snapshot should be ignored");
        assert!(registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/opening.sdf"),
                Some(Path::new("/tmp/workspace-source.sdf")),
                || Ok(()),
            )
            .is_err());

        registry
            .replace("main", 13, &["/tmp/already-open.sdf".to_string()])
            .expect("closing the document should release the committed path");
        registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/opening.sdf"),
                Some(Path::new("/tmp/workspace-source.sdf")),
                || Ok(()),
            )
            .expect("the closed destination may be reused");
        assert!(!registry
            .abort_open_claim("main", &claim_id)
            .expect("a committed claim is already gone"));
    }

    #[test]
    fn provisional_open_claim_abort_is_owner_scoped() {
        let registry = OpenDocumentRegistry::default();
        registry.replace("main", 1, &[]).expect("register main");
        registry
            .replace("workspace", 1, &[])
            .expect("register workspace");
        let claim_id = registry
            .begin_provisional_open("main", Path::new("/tmp/aborted-open.sdf"), 1)
            .expect("begin provisional open")
            .expect("claim ID");

        assert!(registry
            .abort_open_claim("workspace", &claim_id)
            .expect_err("a foreign window must not abort the claim")
            .contains("another window"));
        assert!(registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/aborted-open.sdf"),
                None,
                || Ok(()),
            )
            .is_err());
        assert!(registry
            .abort_open_claim("main", &claim_id)
            .expect("the owner may abort the claim"));
        registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/aborted-open.sdf"),
                None,
                || Ok(()),
            )
            .expect("an aborted path may be reused");

        assert!(registry
            .replace("main", 1, &["/tmp/different.sdf".to_string()])
            .expect_err("one revision cannot describe two path sets")
            .contains("reused"));
    }

    #[test]
    fn claimed_write_rejects_another_same_window_open() {
        let registry = OpenDocumentRegistry::default();
        registry.replace("main", 1, &[]).expect("register main");
        let path = Path::new("/tmp/concurrent-collection-write.sdf");
        let first_claim = registry
            .begin_provisional_open("main", path, 1)
            .expect("begin first open")
            .expect("first claim ID");
        let write_claim = registry
            .begin_provisional_open("main", path, 1)
            .expect("begin collection write")
            .expect("write claim ID");

        assert!(registry
            .with_claimed_write_permit("main", path, Some(path), Some(&write_claim), || Ok(()),)
            .expect_err("a concurrent open must block the collection write")
            .contains("Close the destination"));

        registry
            .abort_open_claim("main", &first_claim)
            .expect("release first claim");
        registry
            .with_claimed_write_permit("main", path, Some(path), Some(&write_claim), || Ok(()))
            .expect("the write may proceed after the other open finishes");
        registry
            .abort_open_claim("main", &write_claim)
            .expect("release write claim");
    }

    #[test]
    fn save_as_claims_destination_before_frontend_resync() {
        let registry = OpenDocumentRegistry::default();
        registry
            .replace("main", 1, &["/tmp/main-source.sdf".to_string()])
            .expect("register main source");
        registry
            .replace("workspace", 1, &["/tmp/workspace-source.sdf".to_string()])
            .expect("register workspace source");

        registry
            .with_save_as_permit(
                "main",
                Path::new("/tmp/shared-save-as.sdf"),
                Path::new("/tmp/main-source.sdf"),
                || Ok(()),
            )
            .expect("first Save As should claim the destination");

        let blocked = registry.with_write_permit(
            "workspace",
            Path::new("/tmp/shared-save-as.sdf"),
            Some(Path::new("/tmp/workspace-source.sdf")),
            || Ok(()),
        );
        assert!(blocked
            .expect_err("a second Save As must not overwrite the claimed destination")
            .contains("Close the destination"));
    }

    #[test]
    fn failed_save_as_and_exports_do_not_claim_destinations() {
        let registry = OpenDocumentRegistry::default();
        registry
            .replace("main", 1, &["/tmp/main-source.sdf".to_string()])
            .expect("register main source");
        registry
            .replace("workspace", 1, &["/tmp/workspace-source.sdf".to_string()])
            .expect("register workspace source");

        let failed = registry.with_save_as_permit(
            "main",
            Path::new("/tmp/failed-save-as.sdf"),
            Path::new("/tmp/main-source.sdf"),
            || Err::<(), _>("write failed".to_string()),
        );
        assert_eq!(failed.expect_err("the write should fail"), "write failed");
        registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/failed-save-as.sdf"),
                Some(Path::new("/tmp/workspace-source.sdf")),
                || Ok(()),
            )
            .expect("a failed Save As must not leave a claim");

        registry
            .with_write_permit("main", Path::new("/tmp/export-only.sdf"), None, || Ok(()))
            .expect("export should succeed");
        registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/export-only.sdf"),
                Some(Path::new("/tmp/workspace-source.sdf")),
                || Ok(()),
            )
            .expect("an export must not claim its destination as an open document");
    }

    #[test]
    fn stale_frontend_resync_does_not_release_a_save_as_reservation() {
        let registry = OpenDocumentRegistry::default();
        registry
            .replace("main", 1, &["/tmp/main-source.sdf".to_string()])
            .expect("register main source");
        registry
            .replace("workspace", 1, &["/tmp/workspace-source.sdf".to_string()])
            .expect("register workspace source");
        registry
            .with_save_as_permit(
                "main",
                Path::new("/tmp/abandoned-save-as.sdf"),
                Path::new("/tmp/main-source.sdf"),
                || Ok(()),
            )
            .expect("Save As should claim the destination");

        registry
            .replace("main", 1, &["/tmp/main-source.sdf".to_string()])
            .expect("stale frontend snapshot should be accepted");
        let still_blocked = registry.with_write_permit(
            "workspace",
            Path::new("/tmp/abandoned-save-as.sdf"),
            Some(Path::new("/tmp/workspace-source.sdf")),
            || Ok(()),
        );
        assert!(still_blocked
            .expect_err("stale sync must not erase an in-flight Save As reservation")
            .contains("Close the destination"));

        assert!(registry
            .release_save_as_reservation(
                "main",
                Path::new("/tmp/abandoned-save-as.sdf"),
                Path::new("/tmp/main-source.sdf"),
            )
            .expect("release abandoned reservation"));
        registry
            .with_write_permit(
                "workspace",
                Path::new("/tmp/abandoned-save-as.sdf"),
                Some(Path::new("/tmp/workspace-source.sdf")),
                || Ok(()),
            )
            .expect("an explicitly released destination may be reused");
    }

    #[test]
    fn contextual_history_titles_are_normalized_and_bounded() {
        let title =
            contextual_history_title("Undo", Some(&format!("  Delete\n{}  ", "x".repeat(100))));

        assert!(title.starts_with("Undo Delete "));
        assert!(!title.contains('\n'));
        assert_eq!(title.chars().count(), MAX_MENU_TITLE_CHARS);
        assert_eq!(contextual_history_title("Redo", Some(" \n ")), "Redo");
    }

    #[test]
    fn recent_documents_are_limited_to_ten() {
        let documents = (0..11)
            .map(|index| RecentMenuDocument {
                path: format!("/tmp/{index}.sdf"),
                title: format!("{index}.sdf"),
            })
            .collect::<Vec<_>>();

        assert!(validate_recent_documents(&documents).is_err());
    }

    #[test]
    fn duplicate_recent_titles_include_the_parent_folder() {
        let documents = vec![
            RecentMenuDocument {
                path: "/data/alpha/ligand.sdf".into(),
                title: "ligand.sdf".into(),
            },
            RecentMenuDocument {
                path: "/data/beta/ligand.sdf".into(),
                title: "ligand.sdf".into(),
            },
        ];

        assert_eq!(
            recent_menu_titles(&documents),
            vec!["ligand.sdf — alpha", "ligand.sdf — beta"]
        );
    }

    #[test]
    fn recent_snapshot_ids_stay_with_paths_across_reordering() {
        let snapshot = RecentMenuSnapshot::default();
        let first = snapshot
            .replace(vec!["/data/alpha.sdf".into(), "/data/beta.sdf".into()])
            .expect("first snapshot");
        let reordered = snapshot
            .replace(vec!["/data/beta.sdf".into(), "/data/alpha.sdf".into()])
            .expect("reordered snapshot");

        assert_eq!(first[0], reordered[1]);
        assert_eq!(first[1], reordered[0]);
        assert_eq!(snapshot.path(&first[0]).as_deref(), Some("/data/alpha.sdf"));

        snapshot
            .replace(vec!["/data/beta.sdf".into()])
            .expect("pruned snapshot");
        assert_eq!(snapshot.path(&first[0]), None);
    }
}
