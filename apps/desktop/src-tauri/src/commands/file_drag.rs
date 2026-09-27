//! Sidebar rows drag real files, so Finder and other apps can take a copy.
//! An HTML drag from the webview reaches them only as text.

use std::path::Path;

use serde::Serialize;

const MAX_DRAG_ITEMS: usize = 500;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDragOutcome {
    /// A destination (Finder, another app, or the webview itself) took the files.
    accepted: bool,
    /// Where the button was released over this window when nothing took the
    /// files, in webview points from the top-left. AppKit does not always hand
    /// such a drop to the webview, so the page completes it at this point.
    in_app_drop: Option<FileDragPoint>,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub(crate) struct FileDragPoint {
    x: f64,
    y: f64,
}

/// Starts an AppKit file drag at the pointer and resolves when it ends.
#[tauri::command]
pub(crate) async fn start_file_drag(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<FileDragOutcome, String> {
    if paths.is_empty() || paths.len() > MAX_DRAG_ITEMS {
        return Err(format!("Drag between 1 and {MAX_DRAG_ITEMS} items."));
    }
    for path in &paths {
        let path = Path::new(path);
        if !path.is_absolute() || std::fs::symlink_metadata(path).is_err() {
            return Err(format!("{} is not an existing item.", path.display()));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        window
            .with_webview(move |webview| unsafe {
                macos::begin(webview.inner() as cocoa::base::id, &paths, sender);
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "File drag ended without a result".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Err("Dragging files to other apps is supported by the macOS app.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{FileDragOutcome, FileDragPoint};
    use cocoa::base::{id, nil, YES};
    use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize};
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Protocol, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::{c_void, CString};
    use std::sync::OnceLock;

    type Sender = tauri::async_runtime::Sender<FileDragOutcome>;

    const NOT_STARTED: FileDragOutcome = FileDragOutcome {
        accepted: false,
        in_app_drop: None,
    };

    const DRAG_OPERATION_COPY: usize = 1;
    const LEFT_MOUSE_UP: usize = 2;
    const LEFT_MOUSE_DRAGGED: usize = 6;
    const ICON_SIZE: f64 = 32.0;

    struct Drag {
        sender: Sender,
        view: id,
    }

    // Finder and other apps copy; an in-app drop is handled by the page itself.
    extern "C" fn operation_mask(_: &Object, _: Sel, _session: id, _context: isize) -> usize {
        DRAG_OPERATION_COPY
    }

    extern "C" fn ended(this: &mut Object, _: Sel, _session: id, point: NSPoint, operation: usize) {
        unsafe {
            let drag = *this.get_ivar::<*mut c_void>("drag");
            if drag.is_null() {
                return;
            }
            this.set_ivar("drag", std::ptr::null_mut::<c_void>());
            let drag = Box::from_raw(drag as *mut Drag);
            let accepted = operation != 0;
            let in_app_drop = if accepted {
                None
            } else {
                released_over_view(drag.view, point)
            };
            release_mouse(drag.view);
            let _ = drag.sender.try_send(FileDragOutcome {
                accepted,
                in_app_drop,
            });
            // Balances `new` in `begin`; the session no longer calls its source.
            let _: id = msg_send![this, autorelease];
        }
    }

    fn source_class() -> &'static Class {
        static CLASS: OnceLock<&'static Class> = OnceLock::new();
        CLASS.get_or_init(|| {
            let mut class = ClassDecl::new("BuretteFileDragSource", class!(NSObject))
                .expect("unique file drag source class");
            class.add_ivar::<*mut c_void>("drag");
            if let Some(protocol) = Protocol::get("NSDraggingSource") {
                class.add_protocol(protocol);
            }
            unsafe {
                class.add_method(
                    sel!(draggingSession:sourceOperationMaskForDraggingContext:),
                    operation_mask as extern "C" fn(&Object, Sel, id, isize) -> usize,
                );
                class.add_method(
                    sel!(draggingSession:endedAtPoint:operation:),
                    ended as extern "C" fn(&mut Object, Sel, id, NSPoint, usize),
                );
            }
            class.register()
        })
    }

    unsafe fn mouse_event(view: id, kind: usize) -> id {
        let window: id = msg_send![view, window];
        if window == nil {
            return nil;
        }
        let location: NSPoint = msg_send![window, mouseLocationOutsideOfEventStream];
        let number: isize = msg_send![window, windowNumber];
        let info: id = msg_send![class!(NSProcessInfo), processInfo];
        let uptime: f64 = msg_send![info, systemUptime];
        msg_send![class!(NSEvent), mouseEventWithType: kind location: location modifierFlags: 0usize timestamp: uptime windowNumber: number context: nil eventNumber: 0isize clickCount: 1isize pressure: 1.0f32]
    }

    // Escape ends the drag with the button still held; a drop releases it over
    // the topmost window, which must be this one.
    unsafe fn released_over_view(view: id, screen_point: NSPoint) -> Option<FileDragPoint> {
        let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
        let window: id = msg_send![view, window];
        if buttons & 1 == 1 || window == nil {
            return None;
        }
        let number: isize = msg_send![window, windowNumber];
        let topmost: isize = msg_send![class!(NSWindow), windowNumberAtPoint: screen_point belowWindowWithWindowNumber: 0isize];
        if topmost != number {
            return None;
        }
        let location: NSPoint = msg_send![window, convertPointFromScreen: screen_point];
        let frame: NSRect = msg_send![view, frame];
        // Same convention as wry's drop positions: the webview fills the window.
        let point = FileDragPoint {
            x: location.x,
            y: frame.size.height - location.y,
        };
        let inside = (0.0..=frame.size.width).contains(&point.x)
            && (0.0..=frame.size.height).contains(&point.y);
        inside.then_some(point)
    }

    // AppKit's drag loop consumed the mouse-up WebKit is still waiting for.
    unsafe fn release_mouse(view: id) {
        let event = mouse_event(view, LEFT_MOUSE_UP);
        if event != nil {
            let _: () = msg_send![view, mouseUp: event];
        }
    }

    pub(super) unsafe fn begin(view: id, paths: &[String], sender: Sender) {
        let pool = NSAutoreleasePool::new(nil);
        // The page asks asynchronously, so start only while the button is still down.
        let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
        let event = if buttons & 1 == 1 {
            mouse_event(view, LEFT_MOUSE_DRAGGED)
        } else {
            nil
        };
        if event == nil {
            let _ = sender.try_send(NOT_STARTED);
            let _: () = msg_send![pool, drain];
            return;
        }
        let location: NSPoint = msg_send![event, locationInWindow];
        let point: NSPoint = msg_send![view, convertPoint: location fromView: nil];
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let items: id = msg_send![class!(NSMutableArray), array];
        for (index, path) in paths.iter().enumerate() {
            let Ok(path) = CString::new(path.as_str()) else {
                continue;
            };
            let path: id = msg_send![class!(NSString), stringWithUTF8String: path.as_ptr()];
            let url: id = msg_send![class!(NSURL), fileURLWithPath: path];
            let item: id = msg_send![class!(NSDraggingItem), alloc];
            let item: id = msg_send![item, initWithPasteboardWriter: url];
            let item: id = msg_send![item, autorelease];
            let icon: id = msg_send![workspace, iconForFile: path];
            // Finder-style stack: the first icons fan out slightly under the pointer.
            let offset = index.min(4) as f64 * 3.0;
            let frame = NSRect::new(
                NSPoint::new(
                    point.x - ICON_SIZE / 2.0 + offset,
                    point.y - ICON_SIZE / 2.0 + offset,
                ),
                NSSize::new(ICON_SIZE, ICON_SIZE),
            );
            let _: () = msg_send![item, setDraggingFrame: frame contents: icon];
            let _: () = msg_send![items, addObject: item];
        }
        let source: id = msg_send![source_class(), new];
        let drag = Box::into_raw(Box::new(Drag { sender, view }));
        (*source).set_ivar("drag", drag as *mut c_void);
        let session: id =
            msg_send![view, beginDraggingSessionWithItems: items event: event source: source];
        if session == nil {
            let drag = Box::from_raw(drag);
            let _ = drag.sender.try_send(NOT_STARTED);
            let _: () = msg_send![source, release];
        } else {
            let _: () = msg_send![session, setAnimatesToStartingPositionsOnCancelOrFail: YES];
        }
        let _: () = msg_send![pool, drain];
    }
}
