//! Tab transfers carry an identity, never an exported document or file URL.

use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
// Only the AppKit drag session reports drops; other platforms always cancel.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) enum TabDragOutcome {
    Cancelled,
    Window {
        #[serde(rename = "windowLabel")]
        window_label: String,
        position: TabDragPoint,
        #[serde(rename = "viewportWidth")]
        viewport_width: f64,
    },
    Outside {
        position: TabDragPoint,
    },
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct TabDragPoint {
    x: f64,
    y: f64,
}

#[tauri::command]
pub(crate) async fn start_tab_drag(
    window: tauri::WebviewWindow,
    tab_id: String,
    title: Option<String>,
) -> Result<TabDragOutcome, String> {
    if tab_id.is_empty() || tab_id.len() > 256 || tab_id.contains('\0') {
        return Err("Invalid tab identity.".into());
    }
    let title: String = title
        .unwrap_or_else(|| "Burette".into())
        .chars()
        .take(120)
        .collect();
    #[cfg(target_os = "macos")]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        let app = window.app_handle().clone();
        window
            .with_webview(move |webview| unsafe {
                macos::begin(
                    webview.inner() as cocoa::base::id,
                    app,
                    &tab_id,
                    &title,
                    sender,
                );
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "Tab drag ended without a result.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, title);
        Ok(TabDragOutcome::Cancelled)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{TabDragOutcome, TabDragPoint};
    use cocoa::base::{id, nil, NO};
    use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize};
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Protocol, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::{c_void, CString};
    use std::sync::OnceLock;
    use tauri::Manager;

    type Sender = tauri::async_runtime::Sender<TabDragOutcome>;
    struct Drag {
        sender: Sender,
        view: id,
        app: tauri::AppHandle,
    }

    unsafe fn string(value: &str) -> id {
        let clean = value.replace('\0', "");
        let value = CString::new(clean).expect("NUL removed");
        msg_send![class!(NSString), stringWithUTF8String: value.as_ptr()]
    }

    extern "C" fn operation_mask(_: &Object, _: Sel, _: id, _: isize) -> usize {
        16
    }

    extern "C" fn ended(this: &mut Object, _: Sel, _: id, point: NSPoint, _: usize) {
        unsafe {
            let ptr = *this.get_ivar::<*mut c_void>("drag");
            if ptr.is_null() {
                return;
            }
            this.set_ivar("drag", std::ptr::null_mut::<c_void>());
            let drag = Box::from_raw(ptr as *mut Drag);
            let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
            let cancelled = buttons & 1 != 0;
            let event = mouse_event(drag.view, 2);
            if event != nil {
                let _: () = msg_send![drag.view, mouseUp: event];
            }
            let _: () = msg_send![drag.view, release];
            let Drag { sender, app, .. } = *drag;
            // AppKit removes its drag-image window after the source callback.
            // Hit-test on the next turn so that image cannot hide the receiver.
            crate::macos::after_current_appkit_event(move || {
                let outcome = if cancelled {
                    TabDragOutcome::Cancelled
                } else {
                    destination(&app, point)
                };
                let _ = sender.try_send(outcome);
            });
            let _: id = msg_send![this, autorelease];
        }
    }

    unsafe fn destination(app: &tauri::AppHandle, point: NSPoint) -> TabDragOutcome {
        let topmost: isize = msg_send![class!(NSWindow), windowNumberAtPoint: point belowWindowWithWindowNumber: 0isize];
        for window in app.webview_windows().values() {
            if !crate::windows::is_workspace_window_label(window.label()) {
                continue;
            }
            let Ok(native) = window.ns_window() else {
                continue;
            };
            let native = native as id;
            let number: isize = msg_send![native, windowNumber];
            if number != topmost {
                continue;
            }
            let location: NSPoint = msg_send![native, convertPointFromScreen: point];
            let view: id = msg_send![native, contentView];
            let bounds: NSRect = msg_send![view, bounds];
            let location: NSPoint = msg_send![view, convertPoint: location fromView: nil];
            let flipped: cocoa::base::BOOL = msg_send![view, isFlipped];
            let x = location.x - bounds.origin.x;
            let y = if flipped != NO {
                location.y - bounds.origin.y
            } else {
                bounds.origin.y + bounds.size.height - location.y
            };
            if !(0.0..=bounds.size.width).contains(&x) || !(0.0..=bounds.size.height).contains(&y) {
                return TabDragOutcome::Cancelled;
            }
            return TabDragOutcome::Window {
                window_label: window.label().to_string(),
                viewport_width: bounds.size.width,
                position: TabDragPoint { x, y },
            };
        }
        TabDragOutcome::Outside {
            position: TabDragPoint {
                x: point.x,
                y: point.y,
            },
        }
    }

    fn source_class() -> &'static Class {
        static CLASS: OnceLock<&'static Class> = OnceLock::new();
        CLASS.get_or_init(|| {
            let mut class = ClassDecl::new("BuretteTabDragSource", class!(NSObject))
                .expect("unique tab drag source");
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
        let point: NSPoint = msg_send![window, mouseLocationOutsideOfEventStream];
        let number: isize = msg_send![window, windowNumber];
        let info: id = msg_send![class!(NSProcessInfo), processInfo];
        let uptime: f64 = msg_send![info, systemUptime];
        msg_send![class!(NSEvent), mouseEventWithType: kind location: point modifierFlags: 0usize timestamp: uptime windowNumber: number context: nil eventNumber: 0isize clickCount: 1isize pressure: 1.0f32]
    }

    pub(super) unsafe fn begin(
        view: id,
        app: tauri::AppHandle,
        tab_id: &str,
        title: &str,
        sender: Sender,
    ) {
        let pool = NSAutoreleasePool::new(nil);
        let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
        let event = if buttons & 1 != 0 {
            mouse_event(view, 6)
        } else {
            nil
        };
        if event == nil {
            let _ = sender.try_send(TabDragOutcome::Cancelled);
            let _: () = msg_send![pool, drain];
            return;
        }
        let writer: id = msg_send![class!(NSPasteboardItem), new];
        let _: bool = msg_send![writer, setString: string(tab_id) forType: string("com.burette.workspace-tab")];
        let item: id = msg_send![class!(NSDraggingItem), alloc];
        let item: id = msg_send![item, initWithPasteboardWriter: writer];
        let _: () = msg_send![writer, release];
        let image: id = msg_send![class!(NSImage), alloc];
        let image: id = msg_send![image, initWithSize: NSSize::new(240.0, 40.0)];
        let _: () = msg_send![image, lockFocus];
        let color: id = msg_send![class!(NSColor), windowBackgroundColor];
        let _: () = msg_send![color, setFill];
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(240.0, 40.0));
        let path: id = msg_send![class!(NSBezierPath), bezierPathWithRoundedRect: rect xRadius: 8.0f64 yRadius: 8.0f64];
        let _: () = msg_send![path, fill];
        let attributes: id = msg_send![class!(NSMutableDictionary), dictionary];
        let font: id = msg_send![class!(NSFont), systemFontOfSize: 13.0f64];
        let text_color: id = msg_send![class!(NSColor), labelColor];
        let _: () = msg_send![attributes, setObject: font forKey: string("NSFont")];
        let _: () = msg_send![attributes, setObject: text_color forKey: string("NSColor")];
        let _: () = msg_send![string(title), drawInRect: NSRect::new(NSPoint::new(12.0, 11.0), NSSize::new(216.0, 20.0)) withAttributes: attributes];
        let _: () = msg_send![image, unlockFocus];
        let location: NSPoint = msg_send![event, locationInWindow];
        let point: NSPoint = msg_send![view, convertPoint: location fromView: nil];
        let frame = NSRect::new(
            NSPoint::new(point.x - 120.0, point.y - 20.0),
            NSSize::new(240.0, 40.0),
        );
        let _: () = msg_send![item, setDraggingFrame: frame contents: image];
        let _: () = msg_send![image, release];
        let items: id = msg_send![class!(NSArray), arrayWithObject: item];
        let source: id = msg_send![source_class(), new];
        let _: id = msg_send![view, retain];
        let ptr = Box::into_raw(Box::new(Drag { sender, view, app }));
        (*source).set_ivar("drag", ptr as *mut c_void);
        let session: id =
            msg_send![view, beginDraggingSessionWithItems: items event: event source: source];
        let _: () = msg_send![item, release];
        if session == nil {
            let drag = Box::from_raw(ptr);
            let _ = drag.sender.try_send(TabDragOutcome::Cancelled);
            let _: () = msg_send![view, release];
            let _: () = msg_send![source, release];
        } else {
            let _: () = msg_send![session, setAnimatesToStartingPositionsOnCancelOrFail: NO];
        }
        let _: () = msg_send![pool, drain];
    }
}
