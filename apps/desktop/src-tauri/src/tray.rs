use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, Runtime};

use crate::menu;

pub(crate) fn configure_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray.show", "Show Burrete").build(app)?;
    let open = MenuItemBuilder::with_id("tray.open", "Open...").build(app)?;
    let settings = MenuItemBuilder::with_id("tray.settings", "Settings...").build(app)?;
    let quit = MenuItemBuilder::with_id("tray.quit", "Quit Burrete").build(app)?;
    let tray_menu = MenuBuilder::new(app)
        .items(&[
            &show,
            &open,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("burrete-status")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .title("B")
        .tooltip("Burrete")
        .on_menu_event(|app, event| match event.id().0.as_str() {
            "tray.show" => show_main_window(app),
            "tray.open" => {
                show_main_window(app);
                menu::emit_to_focused_window(app, menu::MENU_OPEN_FILES_EVENT);
            }
            "tray.settings" => {
                show_main_window(app);
                menu::emit_to_focused_window(app, menu::MENU_OPEN_SETTINGS_EVENT);
            }
            "tray.quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).icon_as_template(true);
    }

    builder.build(app)?;
    Ok(())
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
