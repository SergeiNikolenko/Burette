use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use tauri::menu::MenuItem;

pub const MENU_OPEN_PREFERENCES_EVENT: &str = "menu:open-preferences";
pub const MENU_CHECK_UPDATES_EVENT: &str = "menu:check-updates";

#[cfg(target_os = "macos")]
const CLI_MENU_INSTALL_LABEL: &str = "Install 'burrete' Command Line Tool...";
#[cfg(target_os = "macos")]
const CLI_MENU_UNINSTALL_LABEL: &str = "Uninstall 'burrete' Command Line Tool...";

#[cfg(target_os = "macos")]
struct CliMenuItem(MenuItem<tauri::Wry>);

pub fn configure_menu(app: &tauri::App) -> tauri::Result<()> {
    let check_updates =
        MenuItemBuilder::with_id("updates.check", "Check for Updates...").build(app)?;
    let preferences = MenuItemBuilder::with_id("preferences.open", "Preferences...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    #[cfg(target_os = "macos")]
    let cli_item = MenuItemBuilder::with_id("cli.toggle", CLI_MENU_INSTALL_LABEL).build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Burrete")
        .items(&[
            &PredefinedMenuItem::about(app, Some("About Burrete"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &preferences,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(target_os = "macos")]
            &cli_item,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
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
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ])
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    #[cfg(target_os = "macos")]
    {
        app.manage(CliMenuItem(cli_item));
        refresh_cli_menu(app.handle());
    }
    Ok(())
}

pub fn install_menu_event_handler(app: &tauri::App) {
    app.on_menu_event(|app, event| match event.id().0.as_str() {
        "preferences.open" | "settings.open" => {
            emit_to_focused_window(app, MENU_OPEN_PREFERENCES_EVENT)
        }
        "updates.check" => emit_to_focused_window(app, MENU_CHECK_UPDATES_EVENT),
        #[cfg(target_os = "macos")]
        "cli.toggle" => run_cli_toggle(app.clone()),
        _ => {}
    });
}

fn emit_to_focused_window(app: &tauri::AppHandle, event: &str) {
    let windows = app.webview_windows();
    let target = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main").filter(|window| window.is_visible().unwrap_or(false)))
        .or_else(|| windows.values().find(|window| window.is_visible().unwrap_or(false)));
    if let Some(window) = target {
        let _ = app.emit_to(window.label(), event, ());
    }
}

#[cfg(target_os = "macos")]
fn refresh_cli_menu(app: &tauri::AppHandle) {
    let installed = crate::commands::shell_install::cli_status(app.clone()).installed;
    let label = if installed {
        CLI_MENU_UNINSTALL_LABEL
    } else {
        CLI_MENU_INSTALL_LABEL
    };
    if let Some(item) = app.try_state::<CliMenuItem>() {
        let _ = item.0.set_text(label);
    }
}

#[cfg(target_os = "macos")]
fn run_cli_toggle(app: tauri::AppHandle) {
    if crate::commands::shell_install::cli_status(app.clone()).installed {
        run_cli_uninstall(app);
    } else {
        run_cli_install(app);
    }
}

#[cfg(target_os = "macos")]
fn run_cli_install(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    tauri::async_runtime::spawn_blocking(move || {
        match crate::commands::shell_install::install_cli(app.clone()) {
            Ok(status) => {
                refresh_cli_menu(&app);
                app.dialog()
                    .message(format!(
                        "The `burrete` command is now installed at {}.\n\nRun `burrete .` from any terminal to open the current folder.",
                        status.target
                    ))
                    .kind(MessageDialogKind::Info)
                    .title("Burrete CLI Installed")
                    .show(|_| {});
            }
            Err(err) => {
                app.dialog()
                    .message(format!("Could not install the burrete command.\n\n{err}"))
                    .kind(MessageDialogKind::Error)
                    .title("Burrete CLI")
                    .show(|_| {});
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn run_cli_uninstall(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    tauri::async_runtime::spawn_blocking(move || {
        match crate::commands::shell_install::uninstall_cli(app.clone()) {
            Ok(status) => {
                refresh_cli_menu(&app);
                app.dialog()
                    .message(format!(
                        "The `burrete` command has been removed from {}.",
                        status.target
                    ))
                    .kind(MessageDialogKind::Info)
                    .title("Burrete CLI Removed")
                    .show(|_| {});
            }
            Err(err) => {
                app.dialog()
                    .message(format!("Could not remove the burrete command.\n\n{err}"))
                    .kind(MessageDialogKind::Error)
                    .title("Burrete CLI")
                    .show(|_| {});
            }
        }
    });
}
