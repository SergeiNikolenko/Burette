//! AppKit asks for a fresh menu on each Dock interaction. Read the existing
//! native menu so recent-document IDs and availability stay in sync with File.
use cocoa::base::{id, nil, NO, YES};
use cocoa::foundation::NSString;
use objc::runtime::{class_addMethod, class_getInstanceMethod, object_getClass, Imp, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::CStr;
use std::sync::OnceLock;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub(crate) fn install(app: &tauri::AppHandle) -> Result<(), String> {
    APP.set(app.clone())
        .map_err(|_| "Dock menu already installed")?;
    // Installed after Tauri creates its delegate, on the main thread. Preserve
    // all existing delegate methods, including termination and file opening.
    unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let delegate: id = msg_send![application, delegate];
        if delegate.is_null() {
            return Err("NSApplication has no delegate".into());
        }
        let class = object_getClass(delegate);
        let methods = [
            (
                sel!(applicationDockMenu:),
                std::mem::transmute::<extern "C" fn(&Object, Sel, id) -> id, Imp>(dock_menu),
                c"@@:@",
            ),
            (
                sel!(buretteDockAction:),
                std::mem::transmute::<extern "C" fn(&Object, Sel, id), Imp>(select),
                c"v@:@",
            ),
        ];
        for (selector, implementation, signature) in methods {
            if !class_getInstanceMethod(class, selector).is_null()
                || class_addMethod(
                    class.cast_mut(),
                    selector,
                    implementation,
                    signature.as_ptr(),
                ) == NO
            {
                return Err(format!("cannot install Dock selector {selector:?}"));
            }
        }
    }
    Ok(())
}

extern "C" fn dock_menu(delegate: &Object, _: Sel, _: id) -> id {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        build_menu(delegate as *const Object as id)
    }))
    .unwrap_or(nil)
}

unsafe fn string(value: &str) -> id {
    let value = NSString::alloc(nil).init_str(value);
    msg_send![value, autorelease]
}

unsafe fn new_menu() -> id {
    let menu: id = msg_send![class!(NSMenu), new];
    let menu: id = msg_send![menu, autorelease];
    let _: () = msg_send![menu, setAutoenablesItems: NO];
    menu
}

unsafe fn append(menu: id, target: id, command: &str, title: &str, enabled: bool) -> id {
    let item: id = msg_send![class!(NSMenuItem), alloc];
    let item: id = msg_send![item, initWithTitle: string(title) action: sel!(buretteDockAction:) keyEquivalent: string("")];
    let item: id = msg_send![item, autorelease];
    let _: () = msg_send![item, setTarget: target];
    let _: () = msg_send![item, setRepresentedObject: string(command)];
    let _: () = msg_send![item, setEnabled: if enabled { YES } else { NO }];
    let _: () = msg_send![menu, addItem: item];
    item
}

// Match the existing text-based clipboard importer; chemical format validation
// remains in that importer and never runs during Dock menu tracking.
unsafe fn clipboard_has_text() -> bool {
    let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];
    let text: id = msg_send![pasteboard, stringForType: string("public.utf8-plain-text")];
    if text.is_null() {
        return false;
    }
    let length: usize = msg_send![text, length];
    length > 0
}

unsafe fn build_menu(target: id) -> id {
    let Some(app) = APP.get() else { return nil };
    let menu = new_menu();
    let available = !super::exit_transition_is_active(app);
    for (command, title) in [
        ("file.new-window", "New Workspace"),
        ("file.open", "Open Structure…"),
    ] {
        append(menu, target, command, title, available);
    }
    if let Ok(source) = super::state::find_app_menu_item(app, "file.open-recent") {
        if let Some(source) = source.as_submenu() {
            let item = append(
                menu,
                target,
                "",
                "Open Recent",
                available && source.is_enabled().unwrap_or(false),
            );
            let recent = new_menu();
            if let Ok(items) = source.items() {
                for entry in items
                    .into_iter()
                    .filter_map(|entry| entry.as_menuitem().cloned())
                    .filter(|entry| entry.id().0 != "file.clear-recent")
                    .take(7)
                {
                    if let Ok(title) = entry.text() {
                        append(
                            recent,
                            target,
                            &entry.id().0,
                            &title,
                            available && entry.is_enabled().unwrap_or(false),
                        );
                    }
                }
            }
            let _: () = msg_send![item, setSubmenu: recent];
        }
    }
    append(
        menu,
        target,
        "file.resume-session",
        "Resume Last Session",
        available,
    );
    append(
        menu,
        target,
        "file.open-clipboard",
        "Open from Clipboard",
        available && clipboard_has_text(),
    );
    let separator: id = msg_send![class!(NSMenuItem), separatorItem];
    let _: () = msg_send![menu, addItem: separator];
    append(menu, target, "settings.open", "Settings…", available);
    menu
}

extern "C" fn select(_: &Object, _: Sel, sender: id) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        let command: id = msg_send![sender, representedObject];
        if command.is_null() {
            return;
        }
        let bytes: *const std::os::raw::c_char = msg_send![command, UTF8String];
        if bytes.is_null() {
            return;
        }
        let Ok(command) = CStr::from_ptr(bytes).to_str() else {
            return;
        };
        if let Some(app) = APP.get() {
            let command = command.to_owned();
            let app = app.clone();
            // Window creation must happen after AppKit finishes tracking the menu.
            crate::macos::after_current_appkit_event(move || super::handle_event(&app, &command));
        }
    }));
}
