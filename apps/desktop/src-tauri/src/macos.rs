use cocoa::appkit::{NSApplicationTerminateReply, NSView, NSWindow, NSWindowButton};
use cocoa::base::{id, NO, YES};
use cocoa::foundation::NSRect;
use dispatch2::DispatchQueue;
use objc::runtime::{class_addMethod, class_getInstanceMethod, object_getClass, Imp, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::LogicalPosition;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static TERMINATION_PENDING: AtomicBool = AtomicBool::new(false);

/// Logical inset of the close/minimize/zoom buttons inside the overlay title bar.
/// Shared by the window builder and the manual re-layout below so both agree.
pub(crate) const TRAFFIC_LIGHT_INSET: LogicalPosition<f64> = LogicalPosition { x: 20.0, y: 29.0 };

/// Re-applies the traffic light inset tao computes inside its `drawRect:`.
///
/// tao only lays the buttons out when its content view redraws, so a window
/// that is shown without a subsequent resize keeps the macOS default button
/// positions until something else triggers a redraw. Calling this after
/// `show()` and on resize/focus/theme events keeps the buttons aligned with the
/// toolbar. The layout mirrors `inset_traffic_lights` in tao 0.35.3.
pub(crate) fn reposition_traffic_lights<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ns_window) = target.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        unsafe { inset_traffic_lights(ns_window as id, TRAFFIC_LIGHT_INSET) };
    });
}

unsafe fn inset_traffic_lights(window: id, position: LogicalPosition<f64>) {
    let close = window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
    let miniaturize = window.standardWindowButton_(NSWindowButton::NSWindowMiniaturizeButton);
    let zoom = window.standardWindowButton_(NSWindowButton::NSWindowZoomButton);
    if close.is_null() || miniaturize.is_null() || zoom.is_null() {
        return;
    }
    let button_row = NSView::superview(close);
    if button_row.is_null() {
        return;
    }
    let title_bar_container = NSView::superview(button_row);
    if title_bar_container.is_null() {
        return;
    }

    let close_frame = NSView::frame(close);
    let title_bar_height = close_frame.size.height + position.y;
    let mut title_bar_frame: NSRect = NSView::frame(title_bar_container);
    title_bar_frame.size.height = title_bar_height;
    title_bar_frame.origin.y = NSWindow::frame(window).size.height - title_bar_height;
    let _: () = msg_send![title_bar_container, setFrame: title_bar_frame];

    let spacing = NSView::frame(miniaturize).origin.x - close_frame.origin.x;
    for (index, button) in [close, miniaturize, zoom].into_iter().enumerate() {
        let mut frame = NSView::frame(button);
        frame.origin.x = position.x + index as f64 * spacing;
        NSView::setFrameOrigin(button, frame.origin);
    }
}

pub(crate) fn after_current_appkit_event<F>(work: F)
where
    F: FnOnce() + Send + 'static,
{
    DispatchQueue::main().exec_async(work);
}

pub(crate) fn install_termination_handler(app: &tauri::AppHandle) -> Result<(), String> {
    APP_HANDLE
        .set(app.clone())
        .map_err(|_| "the macOS termination handler is already installed".to_string())?;

    unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let delegate: id = msg_send![application, delegate];
        if delegate.is_null() {
            return Err("NSApplication has no delegate".into());
        }
        let delegate_class = object_getClass(delegate);
        if delegate_class.is_null() {
            return Err("NSApplication delegate has no Objective-C class".into());
        }
        let selector = sel!(applicationShouldTerminate:);
        if !class_getInstanceMethod(delegate_class, selector).is_null() {
            return Err(
                "NSApplication delegate already handles applicationShouldTerminate:".into(),
            );
        }
        let implementation: Imp = std::mem::transmute(
            application_should_terminate
                as extern "C" fn(&Object, Sel, id) -> NSApplicationTerminateReply,
        );
        if class_addMethod(
            delegate_class.cast_mut(),
            selector,
            implementation,
            c"Q@:@".as_ptr(),
        ) == NO
        {
            return Err("failed to install applicationShouldTerminate:".into());
        }
    }
    Ok(())
}

extern "C" fn application_should_terminate(
    _delegate: &Object,
    _selector: Sel,
    _application: id,
) -> NSApplicationTerminateReply {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(termination_reply)).unwrap_or_else(|_| {
        TERMINATION_PENDING.store(false, Ordering::Release);
        NSApplicationTerminateReply::NSTerminateCancel
    })
}

fn termination_reply() -> NSApplicationTerminateReply {
    use crate::menu::SystemQuitRequest;

    let Some(app) = APP_HANDLE.get() else {
        return NSApplicationTerminateReply::NSTerminateNow;
    };
    if TERMINATION_PENDING.load(Ordering::Acquire) {
        return NSApplicationTerminateReply::NSTerminateLater;
    }
    if TERMINATION_PENDING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return NSApplicationTerminateReply::NSTerminateLater;
    }
    match crate::menu::request_system_quit(app) {
        SystemQuitRequest::Pending => NSApplicationTerminateReply::NSTerminateLater,
        SystemQuitRequest::Authorized => {
            TERMINATION_PENDING.store(false, Ordering::Release);
            NSApplicationTerminateReply::NSTerminateNow
        }
        SystemQuitRequest::Busy => {
            TERMINATION_PENDING.store(false, Ordering::Release);
            NSApplicationTerminateReply::NSTerminateCancel
        }
    }
}

pub(crate) fn reply_to_pending_termination<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    should_terminate: bool,
) -> Result<bool, String> {
    if !TERMINATION_PENDING.swap(false, Ordering::AcqRel) {
        return Ok(false);
    }
    let scheduled = app.run_on_main_thread(move || unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let response = if should_terminate { YES } else { NO };
        let _: () = msg_send![application, replyToApplicationShouldTerminate: response];
    });
    if scheduled.is_err() {
        TERMINATION_PENDING.store(true, Ordering::Release);
        return Err("failed to reply to the pending macOS termination request".into());
    }
    Ok(true)
}

pub(crate) struct PendingTerminationReply<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    resolved: bool,
}

impl<R: tauri::Runtime> PendingTerminationReply<R> {
    pub(crate) fn new(app: &tauri::AppHandle<R>) -> Self {
        Self {
            app: app.clone(),
            resolved: false,
        }
    }

    pub(crate) fn allow(&mut self) -> Result<bool, String> {
        let replied = reply_to_pending_termination(&self.app, true)?;
        self.resolved = replied;
        Ok(replied)
    }
}

impl<R: tauri::Runtime> Drop for PendingTerminationReply<R> {
    fn drop(&mut self) {
        if !self.resolved {
            let _ = reply_to_pending_termination(&self.app, false);
        }
    }
}
