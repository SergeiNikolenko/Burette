use tauri::menu::{
    AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Manager, Runtime};

pub(crate) const MENU_OPEN_SETTINGS_EVENT: &str = "menu:open-settings";
pub(crate) const MENU_OPEN_FILES_EVENT: &str = "menu:open-files";
pub(crate) const MENU_OPEN_RECENT_EVENT: &str = "menu:open-recent";
pub(crate) const MENU_REVEAL_ACTIVE_EVENT: &str = "menu:reveal-active";
pub(crate) const MENU_COPY_ACTIVE_PATH_EVENT: &str = "menu:copy-active-path";
pub(crate) const MENU_SHOW_ACTIVE_METADATA_EVENT: &str = "menu:show-active-metadata";
pub(crate) const MENU_EXPORT_PREVIEW_PNG_EVENT: &str = "menu:export-preview-png";
pub(crate) const MENU_EXPORT_PREVIEW_SVG_EVENT: &str = "menu:export-preview-svg";
pub(crate) const MENU_CLEAR_PREVIEW_CACHE_EVENT: &str = "menu:clear-preview-cache";
pub(crate) const MENU_RESET_QUICK_LOOK_EVENT: &str = "menu:reset-quick-look";
pub(crate) const MENU_OPEN_LOGS_EVENT: &str = "menu:open-logs";
pub(crate) const MENU_CHECK_UPDATES_EVENT: &str = "menu:check-updates";

pub(crate) fn configure_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let pkg = app.package_info();
    let settings = MenuItemBuilder::with_id("settings.open", "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let new_window = MenuItemBuilder::with_id("file.new-window", "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let open = MenuItemBuilder::with_id("file.open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_recent = MenuItemBuilder::with_id("file.open-recent", "Open Recent")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let reveal_active = MenuItemBuilder::with_id("file.reveal-active", "Reveal in Finder")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;
    let copy_active_path = MenuItemBuilder::with_id("file.copy-active-path", "Copy Path")
        .accelerator("CmdOrCtrl+Shift+C")
        .build(app)?;
    let show_active_metadata =
        MenuItemBuilder::with_id("file.show-active-metadata", "Show Metadata")
            .accelerator("CmdOrCtrl+I")
            .build(app)?;
    let export_preview_png =
        MenuItemBuilder::with_id("file.export-preview-png", "Export Preview as PNG...")
            .accelerator("CmdOrCtrl+Shift+E")
            .build(app)?;
    let export_preview_svg =
        MenuItemBuilder::with_id("file.export-preview-svg", "Export Preview as SVG...")
            .accelerator("CmdOrCtrl+Alt+E")
            .build(app)?;
    let clear_preview_cache =
        MenuItemBuilder::with_id("maintenance.clear-preview-cache", "Clear Preview Cache")
            .build(app)?;
    let reset_quick_look =
        MenuItemBuilder::with_id("maintenance.reset-quick-look", "Reset Quick Look").build(app)?;
    let open_logs = MenuItemBuilder::with_id("maintenance.open-logs", "Open Logs").build(app)?;
    let updates = MenuItemBuilder::with_id("updater.check", "Check for Updates...")
        .accelerator("CmdOrCtrl+U")
        .build(app)?;
    let about = PredefinedMenuItem::about(
        app,
        None,
        Some(AboutMetadata {
            name: Some("Burrete".into()),
            version: Some(pkg.version.to_string()),
            short_version: Some(pkg.version.to_string()),
            comments: Some("Desktop molecular structure viewer with Quick Look previews.".into()),
            ..Default::default()
        }),
    )?;
    let app_menu = SubmenuBuilder::new(app, "Burrete")
        .items(&[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ])
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .items(&[
            &new_window,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &open_recent,
            &PredefinedMenuItem::separator(app)?,
            &reveal_active,
            &copy_active_path,
            &show_active_metadata,
            &PredefinedMenuItem::separator(app)?,
            &export_preview_png,
            &export_preview_svg,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ])
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .items(&[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ])
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .items(&[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ])
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .items(&[
            &clear_preview_cache,
            &reset_quick_look,
            &open_logs,
            &PredefinedMenuItem::separator(app)?,
            &updates,
        ])
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub(crate) fn emit_to_focused_window<R: Runtime>(app: &tauri::AppHandle<R>, event: &str) {
    let windows = app.webview_windows();
    let target = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next());
    if let Some(window) = target {
        let _ = window.emit(event, ());
    }
}
