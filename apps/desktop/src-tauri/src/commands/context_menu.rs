use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum MenuEntry {
    Separator,
    Item {
        id: String,
        text: String,
        enabled: bool,
        symbol: Option<String>,
        image: Option<String>,
        accelerator: Option<String>,
        checked: Option<bool>,
    },
    Submenu {
        id: String,
        text: String,
        enabled: bool,
        symbol: Option<String>,
        image: Option<String>,
        items: Vec<MenuEntry>,
    },
}

#[derive(Deserialize)]
pub(crate) struct MenuPosition {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum PopupResult {
    #[cfg(target_os = "macos")]
    Shown { selection: Option<String> },
    #[cfg(not(target_os = "macos"))]
    Unsupported,
}

// PNG only, at icon resolution: do not pass arbitrary image formats or large
// decoded bitmaps into AppKit from a menu payload.
fn decode_image(encoded: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    if encoded.len() > 16384 {
        return Err("Menu icon exceeds 16 KB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid menu icon encoding")?;
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("Menu icons must be PNG images".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if !(1..=64).contains(&width) || !(1..=64).contains(&height) {
        return Err("Menu icon dimensions exceed 64 px".into());
    }
    Ok(bytes)
}

fn validate(items: &[MenuEntry], at: Option<&MenuPosition>) -> Result<(), String> {
    fn entries(
        items: &[MenuEntry],
        depth: usize,
        ids: &mut std::collections::HashSet<String>,
        count: &mut usize,
    ) -> Result<(), String> {
        if depth > 3 {
            return Err("Context menu nesting exceeds three levels".into());
        }
        for entry in items {
            *count += 1;
            if *count > 128 {
                return Err("Context menu exceeds 128 entries".into());
            }
            let (id, text, symbol, image) = match entry {
                MenuEntry::Separator => continue,
                MenuEntry::Item {
                    id,
                    text,
                    symbol,
                    image,
                    accelerator,
                    ..
                } => {
                    if accelerator.as_ref().is_some_and(|value| value.len() > 64) {
                        return Err("Context menu accelerator is too long".into());
                    }
                    (id, text, symbol, image)
                }
                MenuEntry::Submenu {
                    id,
                    text,
                    symbol,
                    image,
                    items,
                    ..
                } => {
                    entries(items, depth + 1, ids, count)?;
                    (id, text, symbol, image)
                }
            };
            if id.is_empty()
                || id.len() > 160
                || !ids.insert(id.clone())
                || text.len() > 1024
                || text.contains('\0')
            {
                return Err("Invalid context menu item".into());
            }
            if let Some(image) = image {
                decode_image(image)?;
            }
            if symbol.as_ref().is_some_and(|value| {
                value.len() > 100
                    || !value
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'.')
            }) {
                return Err("Invalid system symbol name".into());
            }
        }
        Ok(())
    }
    if at.is_some_and(|point| !point.x.is_finite() || !point.y.is_finite()) {
        return Err("Invalid context menu position".into());
    }
    entries(items, 0, &mut Default::default(), &mut 0)
}

/// AppKit owns the menu, its material, template icons, highlighting and submenus.
/// Only a selected command ID crosses back to the existing frontend callbacks.
#[tauri::command]
pub(crate) async fn popup_macos_context_menu(
    window: tauri::WebviewWindow,
    items: Vec<MenuEntry>,
    at: Option<MenuPosition>,
) -> Result<PopupResult, String> {
    validate(&items, at.as_ref())?;
    #[cfg(target_os = "macos")]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let result = macos::popup(&owner, &items, at.as_ref());
                let _ = sender.try_send(result);
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .await
            .ok_or("Context menu closed without a result")?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(PopupResult::Unsupported)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use cocoa::base::{id, nil, BOOL, NO, YES};
    use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize, NSString};
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::OnceLock;

    // One target per popup keeps nested menus and simultaneous app windows
    // independent. NSMenu's modal tracking ends before this target is released.
    extern "C" fn select(this: &mut Object, _: Sel, sender: id) {
        unsafe {
            let tag: isize = msg_send![sender, tag];
            this.set_ivar("selectedTag", tag);
        }
    }

    fn target_class() -> &'static Class {
        static CLASS: OnceLock<&'static Class> = OnceLock::new();
        CLASS.get_or_init(|| {
            let mut class = ClassDecl::new("BuretteContextMenuTarget", class!(NSObject))
                .expect("unique context menu target class");
            class.add_ivar::<isize>("selectedTag");
            unsafe {
                class.add_method(
                    sel!(chooseItem:),
                    select as extern "C" fn(&mut Object, Sel, id),
                );
            }
            class.register()
        })
    }

    unsafe fn string(value: &str) -> id {
        let value = NSString::alloc(nil).init_str(value);
        msg_send![value, autorelease]
    }

    fn accelerator(value: &str) -> (String, usize) {
        let mut mask = 0;
        let mut key = String::new();
        for part in value.split('+') {
            match part.to_ascii_lowercase().as_str() {
                "cmd" | "command" | "cmdorctrl" | "super" | "meta" => mask |= 1 << 20,
                "shift" => mask |= 1 << 17,
                "ctrl" | "control" => mask |= 1 << 18,
                "alt" | "option" => mask |= 1 << 19,
                "backspace" => key = "\u{8}".into(),
                "delete" => key = "\u{f728}".into(),
                "enter" | "return" => key = "\r".into(),
                "escape" | "esc" => key = "\u{1b}".into(),
                "space" => key = " ".into(),
                _ => key = part.to_lowercase(),
            }
        }
        (key, mask)
    }

    unsafe fn apply_image(item: id, encoded: &str) {
        let Ok(bytes) = decode_image(encoded) else {
            return;
        };
        let data: id = msg_send![class!(NSData), dataWithBytes: bytes.as_ptr() length: bytes.len()];
        let image: id = msg_send![class!(NSImage), alloc];
        let image: id = msg_send![image, initWithData: data];
        if image.is_null() {
            return;
        }
        let image: id = msg_send![image, autorelease];
        let _: () = msg_send![image, setTemplate: YES];
        let _: () = msg_send![image, setSize: NSSize::new(16.0, 16.0)];
        let _: () = msg_send![item, setImage: image];
    }

    unsafe fn apply_symbol(item: id, name: &Option<String>) {
        let Some(name) = name else {
            return;
        };
        let image: id = msg_send![class!(NSImage), imageWithSystemSymbolName: string(name) accessibilityDescription: nil];
        if image.is_null() {
            return;
        }
        let configuration: id = msg_send![class!(NSImageSymbolConfiguration), configurationWithPointSize: 14.0f64 weight: 0.0f64 scale: 2isize];
        let image: id = msg_send![image, imageWithSymbolConfiguration: configuration];
        if image.is_null() {
            return;
        }
        let _: () = msg_send![image, setTemplate: YES];
        let _: () = msg_send![image, setSize: NSSize::new(16.0, 16.0)];
        let _: () = msg_send![item, setImage: image];
    }

    unsafe fn make_menu(entries: &[MenuEntry], target: id, ids: &mut Vec<String>) -> id {
        let menu: id = msg_send![class!(NSMenu), new];
        let menu: id = msg_send![menu, autorelease];
        let _: () = msg_send![menu, setAutoenablesItems: NO];
        for entry in entries {
            let (text, enabled, symbol, image) = match entry {
                MenuEntry::Separator => {
                    let separator: id = msg_send![class!(NSMenuItem), separatorItem];
                    let _: () = msg_send![menu, addItem: separator];
                    continue;
                }
                MenuEntry::Item {
                    text,
                    enabled,
                    symbol,
                    image,
                    ..
                }
                | MenuEntry::Submenu {
                    text,
                    enabled,
                    symbol,
                    image,
                    ..
                } => (text, enabled, symbol, image),
            };
            let item: id = msg_send![class!(NSMenuItem), alloc];
            let item: id = msg_send![item, initWithTitle: string(text) action: sel!(chooseItem:) keyEquivalent: string("")];
            let item: id = msg_send![item, autorelease];
            let _: () = msg_send![item, setEnabled: if *enabled { YES } else { NO }];
            if let Some(encoded) = image {
                apply_image(item, encoded);
            } else {
                apply_symbol(item, symbol);
            }
            match entry {
                MenuEntry::Item {
                    id,
                    accelerator: shortcut,
                    checked,
                    ..
                } => {
                    ids.push(id.clone());
                    let _: () = msg_send![item, setTag: ids.len() as isize];
                    let _: () = msg_send![item, setTarget: target];
                    if let Some(value) = checked {
                        let _: () = msg_send![item, setState: isize::from(*value)];
                    }
                    if let Some(shortcut) = shortcut {
                        let (key, mask) = accelerator(shortcut);
                        let _: () = msg_send![item, setKeyEquivalent: string(&key)];
                        let _: () = msg_send![item, setKeyEquivalentModifierMask: mask];
                    }
                }
                MenuEntry::Submenu { items, .. } => {
                    let child = make_menu(items, target, ids);
                    let _: () = msg_send![item, setSubmenu: child];
                }
                MenuEntry::Separator => unreachable!(),
            }
            let _: () = msg_send![menu, addItem: item];
        }
        menu
    }

    pub(super) fn popup(
        window: &tauri::WebviewWindow,
        items: &[MenuEntry],
        at: Option<&MenuPosition>,
    ) -> Result<PopupResult, String> {
        let native_window = window.ns_window().map_err(|error| error.to_string())? as id;
        unsafe {
            let pool = NSAutoreleasePool::new(nil);
            let target: id = msg_send![target_class(), new];
            (*target).set_ivar("selectedTag", 0isize);
            let mut ids = Vec::new();
            let menu = make_menu(items, target, &mut ids);
            let view: id = msg_send![native_window, contentView];
            let (point, view) = if let Some(at) = at {
                let bounds: NSRect = msg_send![view, bounds];
                let flipped: BOOL = msg_send![view, isFlipped];
                (
                    NSPoint::new(
                        at.x,
                        if flipped == YES {
                            at.y
                        } else {
                            bounds.size.height - at.y
                        },
                    ),
                    view,
                )
            } else {
                (msg_send![class!(NSEvent), mouseLocation], nil)
            };
            let _: BOOL =
                msg_send![menu, popUpMenuPositioningItem: nil atLocation: point inView: view];
            let tag = *(*target).get_ivar::<isize>("selectedTag");
            let selection = tag
                .checked_sub(1)
                .and_then(|index| ids.get(index as usize))
                .cloned();
            let _: () = msg_send![target, release];
            let _: () = msg_send![pool, drain];
            Ok(PopupResult::Shown { selection })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn menu_images_accept_png_and_reject_unbounded_bitmaps() {
        use base64::Engine;
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBqkAAAAASUVORK5CYII=";
        let mut bytes = decode_image(png).unwrap();
        bytes[16..20].copy_from_slice(&4096_u32.to_be_bytes());
        assert!(decode_image(&base64::engine::general_purpose::STANDARD.encode(bytes)).is_err());
        assert!(decode_image("PHN2Zy8+").is_err());
        assert!(decode_image(&"A".repeat(16385)).is_err());
    }

    fn item(id: &str) -> MenuEntry {
        MenuEntry::Item {
            id: id.into(),
            text: "Rename".into(),
            enabled: true,
            symbol: Some("pencil".into()),
            image: None,
            accelerator: None,
            checked: None,
        }
    }
    #[test]
    fn validates_nested_menus_and_bounds() {
        let submenu = |items| MenuEntry::Submenu {
            id: "group".into(),
            text: "Open As".into(),
            enabled: true,
            symbol: None,
            image: None,
            items,
        };
        assert!(validate(&[item("rename"), submenu(vec![item("text")])], None).is_ok());
        assert!(validate(&[item("rename"), submenu(vec![item("rename")])], None).is_err());
        assert!(validate(
            &(0..129).map(|i| item(&i.to_string())).collect::<Vec<_>>(),
            None
        )
        .is_err());
        assert!(validate(
            &[],
            Some(&MenuPosition {
                x: f64::NAN,
                y: 0.0
            })
        )
        .is_err());
    }
}
