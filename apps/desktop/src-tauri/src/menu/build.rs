use tauri::menu::{
    AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{Manager, Runtime};

use super::events::PendingNativeMenuCommands;
use super::quit::ExitPreflightCoordinator;
use super::state::{OpenDocumentRegistry, QuitGuard, RecentMenuSnapshot};

pub(crate) fn configure_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    app.manage(RecentMenuSnapshot::default());
    app.manage(PendingNativeMenuCommands::default());
    app.manage(ExitPreflightCoordinator::default());
    app.manage(QuitGuard::default());
    app.manage(OpenDocumentRegistry::default());

    let pkg = app.package_info();
    let settings = MenuItemBuilder::with_id("settings.open", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let updates = MenuItemBuilder::with_id("updater.check", "Check for Updates…").build(app)?;
    let about = PredefinedMenuItem::about(
        app,
        None,
        Some(AboutMetadata {
            name: Some("Burette".into()),
            version: Some(pkg.version.to_string()),
            short_version: Some(pkg.version.to_string()),
            comments: Some("Native molecular structure viewer and analysis workspace.".into()),
            ..Default::default()
        }),
    )?;
    let quit = MenuItemBuilder::with_id("app.quit", "Quit Burette")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Burette")
        .items(&[
            &about,
            &updates,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ])
        .build()?;

    let new_window = MenuItemBuilder::with_id("file.new-window", "New Window")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_tab = MenuItemBuilder::with_id("file.new-tab", "New Tab")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let open = MenuItemBuilder::with_id("file.open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_clipboard =
        MenuItemBuilder::with_id("file.open-clipboard", "Open from Clipboard").build(app)?;
    let no_recent = MenuItemBuilder::with_id("file.open-recent.empty", "No Recent Documents")
        .enabled(false)
        .build(app)?;
    let open_recent = SubmenuBuilder::with_id(app, "file.open-recent", "Open Recent")
        .enabled(false)
        .item(&no_recent)
        .build()?;
    let save = MenuItemBuilder::with_id("file.save", "Save")
        .enabled(false)
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("file.save-as", "Save As…")
        .enabled(false)
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let reveal_active = MenuItemBuilder::with_id("file.reveal-active", "Reveal in Finder")
        .enabled(false)
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;
    let copy_active_path = MenuItemBuilder::with_id("file.copy-active-path", "Copy Path")
        .enabled(false)
        .accelerator("CmdOrCtrl+Shift+C")
        .build(app)?;
    let show_active_metadata = MenuItemBuilder::with_id("file.show-active-metadata", "Get Info")
        .enabled(false)
        .accelerator("CmdOrCtrl+I")
        .build(app)?;
    let export_smiles = MenuItemBuilder::with_id("file.export-smiles", "SMILES…")
        .enabled(false)
        .build(app)?;
    let export_csv = MenuItemBuilder::with_id("file.export-csv", "CSV…")
        .enabled(false)
        .build(app)?;
    let export_preview_png = MenuItemBuilder::with_id("file.export-preview-png", "Preview as PNG…")
        .enabled(false)
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let export_preview_svg = MenuItemBuilder::with_id("file.export-preview-svg", "Preview as SVG…")
        .enabled(false)
        .accelerator("CmdOrCtrl+Alt+E")
        .build(app)?;
    let export_menu = SubmenuBuilder::with_id(app, "file.export", "Export")
        .enabled(false)
        .items(&[
            &export_smiles,
            &export_csv,
            &PredefinedMenuItem::separator(app)?,
            &export_preview_png,
            &export_preview_svg,
        ])
        .build()?;
    let close_tab = MenuItemBuilder::with_id("file.close-tab", "Close Tab")
        .enabled(false)
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let close_other_tabs = MenuItemBuilder::with_id("file.close-other-tabs", "Close Other Tabs")
        .enabled(false)
        .build(app)?;
    let close_all_tabs = MenuItemBuilder::with_id("file.close-all-tabs", "Close All Tabs")
        .enabled(false)
        .build(app)?;
    let close_window = MenuItemBuilder::with_id("file.close-window", "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .items(&[
            &new_window,
            &new_tab,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &open_clipboard,
            &open_recent,
            &PredefinedMenuItem::separator(app)?,
            &save,
            &save_as,
            &PredefinedMenuItem::separator(app)?,
            &reveal_active,
            &copy_active_path,
            &show_active_metadata,
            &PredefinedMenuItem::separator(app)?,
            &export_menu,
            &PredefinedMenuItem::separator(app)?,
            &close_tab,
            &close_other_tabs,
            &close_all_tabs,
            &close_window,
        ])
        .build()?;

    let find = MenuItemBuilder::with_id("edit.find", "Find")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let edit_menu = SubmenuBuilder::with_id(app, "edit.menu", "Edit")
        .items(&[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &find,
        ])
        .build()?;

    let show_sidebar = CheckMenuItemBuilder::with_id("view.toggle-sidebar", "Sidebar")
        .checked(true)
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let show_inspector = CheckMenuItemBuilder::with_id("view.toggle-inspector", "Inspector")
        .checked(true)
        .accelerator("CmdOrCtrl+Alt+B")
        .build(app)?;
    let show_bottom_panel =
        CheckMenuItemBuilder::with_id("view.toggle-bottom-panel", "Bottom Panel")
            .checked(false)
            .accelerator("CmdOrCtrl+J")
            .build(app)?;
    let cards = CheckMenuItemBuilder::with_id("view.grid-cards", "Cards")
        .enabled(false)
        .checked(false)
        .build(app)?;
    let table = CheckMenuItemBuilder::with_id("view.grid-table", "Table")
        .enabled(false)
        .checked(false)
        .build(app)?;
    let properties = CheckMenuItemBuilder::with_id("view.grid-properties", "Properties")
        .enabled(false)
        .checked(false)
        .build(app)?;
    let rdkit = CheckMenuItemBuilder::with_id("view.grid-renderer-rdkit", "RDKit")
        .enabled(false)
        .checked(false)
        .build(app)?;
    let xyzrender = CheckMenuItemBuilder::with_id("view.grid-renderer-xyzrender", "xyzrender")
        .enabled(false)
        .checked(false)
        .build(app)?;
    let molecule_renderer = SubmenuBuilder::with_id(app, "view.grid-renderer", "Molecule Renderer")
        .enabled(false)
        .items(&[&rdkit, &xyzrender])
        .build()?;
    let command_palette = MenuItemBuilder::with_id("view.command-palette", "Command Palette…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .items(&[
            &show_sidebar,
            &show_inspector,
            &show_bottom_panel,
            &PredefinedMenuItem::separator(app)?,
            &cards,
            &table,
            &properties,
            &molecule_renderer,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &command_palette,
        ])
        .build()?;

    let open_in_molstar =
        MenuItemBuilder::with_id("structure.open-in-molstar", "Open Molecule in Mol*")
            .enabled(false)
            .build(app)?;
    let edit_in_ketcher = MenuItemBuilder::with_id("structure.edit-in-ketcher", "Edit in Ketcher")
        .enabled(false)
        .build(app)?;
    let generate_3d = MenuItemBuilder::with_id("structure.generate-3d", "Generate 3D Conformer")
        .enabled(false)
        .build(app)?;
    let crest_generate =
        MenuItemBuilder::with_id("structure.crest-generate", "Generate Ensemble with CREST")
            .enabled(false)
            .build(app)?;
    let prism_prune =
        MenuItemBuilder::with_id("structure.prism-prune", "Prune Conformers with PRISM")
            .enabled(false)
            .build(app)?;
    let conformers = SubmenuBuilder::with_id(app, "structure.conformers", "Conformers")
        .items(&[&generate_3d, &crest_generate, &prism_prune])
        .build()?;
    let xtb_optimize = MenuItemBuilder::with_id("structure.xtb-optimize", "Optimize Geometry")
        .enabled(false)
        .build(app)?;
    let xtb_properties =
        MenuItemBuilder::with_id("structure.xtb-properties", "Calculate Properties")
            .enabled(false)
            .build(app)?;
    let xtb_frequencies = MenuItemBuilder::with_id(
        "structure.xtb-frequencies",
        "Optimize & Calculate Frequencies",
    )
    .enabled(false)
    .build(app)?;
    let xtb_vipea =
        MenuItemBuilder::with_id("structure.xtb-vipea", "Calculate Vertical IP/EA (IPEA-xTB)")
            .enabled(false)
            .build(app)?;
    let xtb_fukui = MenuItemBuilder::with_id("structure.xtb-fukui", "Calculate Fukui Indices")
        .enabled(false)
        .build(app)?;
    let xtb = SubmenuBuilder::with_id(app, "structure.xtb", "xTB")
        .items(&[
            &xtb_optimize,
            &xtb_properties,
            &xtb_frequencies,
            &xtb_vipea,
            &xtb_fukui,
        ])
        .build()?;
    let structure_menu = SubmenuBuilder::with_id(app, "structure.menu", "Structure")
        .items(&[
            &open_in_molstar,
            &edit_in_ketcher,
            &PredefinedMenuItem::separator(app)?,
            &conformers,
            &xtb,
        ])
        .build()?;

    let copy_selected = MenuItemBuilder::with_id("collection.copy-selected", "Copy Selected")
        .enabled(false)
        .build(app)?;
    let select_all = MenuItemBuilder::with_id("collection.select-all", "Select Visible Molecules")
        .enabled(false)
        .build(app)?;
    let clear_selection = MenuItemBuilder::with_id("collection.clear-selection", "Clear Selection")
        .enabled(false)
        .build(app)?;
    let calculate_descriptors = MenuItemBuilder::with_id(
        "collection.calculate-descriptors",
        "Calculate Descriptors for All Molecules",
    )
    .enabled(false)
    .build(app)?;
    let collection_menu = SubmenuBuilder::with_id(app, "collection.menu", "Collection")
        .items(&[
            &copy_selected,
            &select_all,
            &clear_selection,
            &PredefinedMenuItem::separator(app)?,
            &calculate_descriptors,
        ])
        .build()?;

    let previous_tab = MenuItemBuilder::with_id("window.previous-tab", "Previous Tab")
        .enabled(false)
        .accelerator("Ctrl+Shift+Tab")
        .build(app)?;
    let next_tab = MenuItemBuilder::with_id("window.next-tab", "Next Tab")
        .enabled(false)
        .accelerator("Ctrl+Tab")
        .build(app)?;
    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .items(&[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &previous_tab,
            &next_tab,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ])
        .build()?;

    let github = MenuItemBuilder::with_id("help.open", "Burette Help").build(app)?;
    let shortcuts =
        MenuItemBuilder::with_id("help.keyboard-shortcuts", "Keyboard Shortcuts").build(app)?;
    let whats_new = MenuItemBuilder::with_id("help.whats-new", "What’s New").build(app)?;
    let report_issue =
        MenuItemBuilder::with_id("help.report-issue", "Report an Issue…").build(app)?;
    let runtime_doctor =
        MenuItemBuilder::with_id("help.runtime-doctor", "Run Runtime Doctor").build(app)?;
    let clear_preview_cache =
        MenuItemBuilder::with_id("maintenance.clear-preview-cache", "Clear Preview Cache")
            .build(app)?;
    let reset_quick_look =
        MenuItemBuilder::with_id("maintenance.reset-quick-look", "Reset Quick Look").build(app)?;
    let open_logs = MenuItemBuilder::with_id("maintenance.open-logs", "Open Logs").build(app)?;
    let export_diagnostics =
        MenuItemBuilder::with_id("help.export-diagnostics", "Export Diagnostics…").build(app)?;
    let troubleshooting = SubmenuBuilder::with_id(app, "help.troubleshooting", "Troubleshooting")
        .items(&[
            &runtime_doctor,
            &PredefinedMenuItem::separator(app)?,
            &clear_preview_cache,
            &reset_quick_look,
            &PredefinedMenuItem::separator(app)?,
            &open_logs,
            &export_diagnostics,
        ])
        .build()?;
    let help_menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help")
        .items(&[
            &github,
            &shortcuts,
            &whats_new,
            &report_issue,
            &PredefinedMenuItem::separator(app)?,
            &troubleshooting,
        ])
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &structure_menu,
            &collection_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}
