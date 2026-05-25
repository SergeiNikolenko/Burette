use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, Runtime};

pub(crate) const MENU_OPEN_SETTINGS_EVENT: &str = "menu:open-settings";
pub(crate) const MENU_OPEN_FILES_EVENT: &str = "menu:open-files";
pub(crate) const MENU_CHECK_UPDATES_EVENT: &str = "menu:check-updates";

pub(crate) fn configure_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let pkg = app.package_info();
    let settings = MenuItemBuilder::with_id("settings.open", "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let open = MenuItemBuilder::with_id("file.open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
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
            &open,
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
