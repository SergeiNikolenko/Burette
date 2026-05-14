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

    let builder = TrayIconBuilder::with_id("burrete-status")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .icon(status_image())
        .icon_as_template(true)
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

    builder.build(app)?;
    Ok(())
}

fn status_image() -> tauri::image::Image<'static> {
    const SIZE: u32 = 18;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];

    fill_ellipse(&mut rgba, 9.0, 9.0, 1.6, 1.6);
    stroke_ellipse(&mut rgba, 9.0, 9.0, 6.1, 2.8, 0.0, 1.35);
    stroke_ellipse(&mut rgba, 9.0, 9.0, 6.1, 2.8, 60.0, 1.35);
    stroke_ellipse(&mut rgba, 9.0, 9.0, 6.1, 2.8, -60.0, 1.35);
    stroke_line(&mut rgba, 12.4, 3.6, 14.4, 2.1, 1.1);

    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

fn fill_ellipse(rgba: &mut [u8], cx: f32, cy: f32, rx: f32, ry: f32) {
    for y in 0..18 {
        for x in 0..18 {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let value = ((px - cx) / rx).powi(2) + ((py - cy) / ry).powi(2);
            if value <= 1.0 {
                put_pixel(rgba, x, y, 255);
            }
        }
    }
}

fn stroke_ellipse(rgba: &mut [u8], cx: f32, cy: f32, rx: f32, ry: f32, degrees: f32, width: f32) {
    let radians = degrees.to_radians();
    let (sin, cos) = radians.sin_cos();
    let threshold = width / rx.min(ry);

    for y in 0..18 {
        for x in 0..18 {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let px = dx * cos + dy * sin;
            let py = -dx * sin + dy * cos;
            let value = (px / rx).powi(2) + (py / ry).powi(2);
            if (value.sqrt() - 1.0).abs() <= threshold {
                put_pixel(rgba, x, y, 255);
            }
        }
    }
}

fn stroke_line(rgba: &mut [u8], x1: f32, y1: f32, x2: f32, y2: f32, width: f32) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let length_squared = dx * dx + dy * dy;

    for y in 0..18 {
        for x in 0..18 {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let t = (((px - x1) * dx + (py - y1) * dy) / length_squared).clamp(0.0, 1.0);
            let nearest_x = x1 + t * dx;
            let nearest_y = y1 + t * dy;
            let distance = ((px - nearest_x).powi(2) + (py - nearest_y).powi(2)).sqrt();
            if distance <= width / 2.0 {
                put_pixel(rgba, x, y, 255);
            }
        }
    }
}

fn put_pixel(rgba: &mut [u8], x: u32, y: u32, alpha: u8) {
    let index = ((y * 18 + x) * 4) as usize;
    rgba[index] = 0;
    rgba[index + 1] = 0;
    rgba[index + 2] = 0;
    rgba[index + 3] = alpha;
}

pub(crate) fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
