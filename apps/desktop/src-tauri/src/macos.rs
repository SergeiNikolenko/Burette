use cocoa::appkit::{NSApplicationTerminateReply, NSView, NSWindow, NSWindowButton};
use cocoa::base::{id, NO, YES};
use cocoa::foundation::NSRect;
use dispatch2::{
    _dispatch_source_type_memorypressure, dispatch_source_memorypressure_flags_t, DispatchObject,
    DispatchQoS, DispatchQueue, DispatchRetained, DispatchSource, GlobalQueueIdentifier,
};
use objc::declare::ClassDecl;
use objc::runtime::{
    class_addMethod, class_getInstanceMethod, object_getClass, Class, Imp, Object, Sel,
};
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::c_void;
use std::ptr::addr_of;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;
use tauri::{Emitter, LogicalPosition};

#[link(name = "AppKit", kind = "framework")]
extern "C" {
    static NSViewFrameDidChangeNotification: id;
}

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static TERMINATION_PENDING: AtomicBool = AtomicBool::new(false);
static MEMORY_PRESSURE_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static MEMORY_PRESSURE_SOURCE: OnceLock<RetainedDispatchSource> = OnceLock::new();
static LAST_MEMORY_PRESSURE: AtomicU8 = AtomicU8::new(MemoryPressureLevel::Normal as u8);

pub(crate) const MEMORY_PRESSURE_EVENT: &str = "memory-pressure";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub(crate) enum MemoryPressureLevel {
    Normal = 0,
    Warn = 1,
    Critical = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryPressureEvent {
    pub(crate) level: MemoryPressureLevel,
}

struct RetainedDispatchSource(DispatchRetained<DispatchSource>);

// Dispatch sources are thread-safe kernel event handles retained for the life of the app.
unsafe impl Send for RetainedDispatchSource {}
unsafe impl Sync for RetainedDispatchSource {}

fn memory_pressure_level_from_flags(flags: usize) -> Option<MemoryPressureLevel> {
    let critical =
        dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_CRITICAL.0 as usize;
    let warn = dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_WARN.0 as usize;
    let normal = dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_NORMAL.0 as usize;
    if flags & critical != 0 {
        Some(MemoryPressureLevel::Critical)
    } else if flags & warn != 0 {
        Some(MemoryPressureLevel::Warn)
    } else if flags & normal != 0 {
        Some(MemoryPressureLevel::Normal)
    } else {
        None
    }
}

/// Subscribes to macOS kernel memory-pressure notifications and forwards level
/// transitions to the frontend so idle background WebGL scenes can be evicted.
pub(crate) fn install_memory_pressure_monitor(app: &tauri::AppHandle) -> Result<(), String> {
    MEMORY_PRESSURE_APP
        .set(app.clone())
        .map_err(|_| "the macOS memory-pressure monitor is already installed".to_string())?;

    let queue = DispatchQueue::global_queue(GlobalQueueIdentifier::QualityOfService(
        DispatchQoS::Utility,
    ));
    let mask = (dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_NORMAL.0
        | dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_WARN.0
        | dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_CRITICAL.0)
        as usize;
    let source = unsafe {
        DispatchSource::new(
            addr_of!(_dispatch_source_type_memorypressure).cast_mut(),
            0,
            mask,
            Some(&queue),
        )
    };
    source.set_event_handler_f(memory_pressure_event_handler);
    MEMORY_PRESSURE_SOURCE
        .set(RetainedDispatchSource(source))
        .map_err(|_| "the macOS memory-pressure source is already installed".to_string())?;
    if let Some(retained) = MEMORY_PRESSURE_SOURCE.get() {
        retained.0.activate();
    }
    Ok(())
}

extern "C" fn memory_pressure_event_handler(_context: *mut c_void) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Some(retained) = MEMORY_PRESSURE_SOURCE.get() else {
            return;
        };
        let Some(level) = memory_pressure_level_from_flags(retained.0.data()) else {
            return;
        };
        let encoded = level as u8;
        if LAST_MEMORY_PRESSURE.swap(encoded, Ordering::AcqRel) == encoded {
            return;
        }
        if let Some(app) = MEMORY_PRESSURE_APP.get() {
            let _ = app.emit(MEMORY_PRESSURE_EVENT, MemoryPressureEvent { level });
        }
    }));
}

/// Logical inset of the close/minimize/zoom buttons inside the overlay title bar.
/// Shared by the window builder and the manual re-layout below so both agree.
pub(crate) const TRAFFIC_LIGHT_INSET: LogicalPosition<f64> = LogicalPosition { x: 20.0, y: 24.0 };

pub(crate) fn disable_automatic_window_tabbing() {
    // Burette owns its document tabs and split panes. AppKit's automatic tabs
    // would introduce a second, independent tab strip around those windows.
    let disable = || unsafe {
        NSWindow::setAllowsAutomaticWindowTabbing_(class!(NSWindow) as *const Class as id, NO);
    };
    let on_main_thread: cocoa::base::BOOL = unsafe { msg_send![class!(NSThread), isMainThread] };
    if on_main_thread == YES {
        disable();
    } else {
        DispatchQueue::main().exec_sync(disable);
    }
}

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

/// Keeps the traffic lights inset whenever AppKit lays the title bar out again.
///
/// AppKit resets the buttons to their default positions on its own schedule,
/// for example after an accessibility client such as Computer Use releases the
/// window, and no Tauri window event marks that moment. Watching the frames of
/// the close button and its title bar container catches every such reset.
pub(crate) fn keep_traffic_lights_inset<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ns_window) = target.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        unsafe { observe_title_bar_frames(ns_window as id) };
    });
}

struct TitleBarViews {
    container: id,
    buttons: [id; 3],
}

unsafe fn title_bar_views(window: id) -> Option<TitleBarViews> {
    let buttons = [
        NSWindowButton::NSWindowCloseButton,
        NSWindowButton::NSWindowMiniaturizeButton,
        NSWindowButton::NSWindowZoomButton,
    ]
    .map(|kind| window.standardWindowButton_(kind));
    if buttons.iter().any(|button| button.is_null()) {
        return None;
    }
    let button_row = NSView::superview(buttons[0]);
    if button_row.is_null() {
        return None;
    }
    let container = NSView::superview(button_row);
    if container.is_null() {
        return None;
    }
    Some(TitleBarViews { container, buttons })
}

// Only frames that differ are written, so the frame change notifications this
// raises end in a pass that changes nothing.
unsafe fn inset_traffic_lights(window: id, position: LogicalPosition<f64>) {
    let Some(TitleBarViews { container, buttons }) = title_bar_views(window) else {
        return;
    };

    let close_frame = NSView::frame(buttons[0]);
    let title_bar_height = close_frame.size.height + position.y;
    let mut title_bar_frame: NSRect = NSView::frame(container);
    let current = title_bar_frame;
    title_bar_frame.size.height = title_bar_height;
    title_bar_frame.origin.y = NSWindow::frame(window).size.height - title_bar_height;
    if title_bar_frame.size.height != current.size.height
        || title_bar_frame.origin.y != current.origin.y
    {
        let _: () = msg_send![container, setFrame: title_bar_frame];
    }

    let spacing = NSView::frame(buttons[1]).origin.x - close_frame.origin.x;
    for (index, button) in buttons.into_iter().enumerate() {
        let mut origin = NSView::frame(button).origin;
        let x = position.x + index as f64 * spacing;
        if origin.x != x {
            origin.x = x;
            NSView::setFrameOrigin(button, origin);
        }
    }
}

unsafe fn observe_title_bar_frames(window: id) {
    let Some(TitleBarViews { container, buttons }) = title_bar_views(window) else {
        return;
    };
    let center: id = msg_send![class!(NSNotificationCenter), defaultCenter];
    let observer = title_bar_observer();
    for view in [buttons[0], container] {
        let _: () = msg_send![view, setPostsFrameChangedNotifications: YES];
        let _: () = msg_send![center, addObserver: observer
            selector: sel!(titleBarFrameChanged:)
            name: NSViewFrameDidChangeNotification
            object: view];
    }
}

/// One app-lifetime observer serves every window; each notification names the
/// view that moved, and the view leads back to its window.
fn title_bar_observer() -> id {
    static OBSERVER: OnceLock<usize> = OnceLock::new();
    *OBSERVER.get_or_init(|| unsafe {
        let observer: id = msg_send![title_bar_observer_class(), new];
        observer as usize
    }) as id
}

fn title_bar_observer_class() -> &'static Class {
    static CLASS: OnceLock<&'static Class> = OnceLock::new();
    CLASS.get_or_init(|| {
        let mut class = ClassDecl::new("BuretteTitleBarObserver", class!(NSObject))
            .expect("unique title bar observer class");
        unsafe {
            class.add_method(
                sel!(titleBarFrameChanged:),
                title_bar_frame_changed as extern "C" fn(&Object, Sel, id),
            );
        }
        class.register()
    })
}

// AppKit moves the buttons in the middle of its own layout pass, so the inset
// is restored once that pass has finished.
extern "C" fn title_bar_frame_changed(_: &Object, _: Sel, notification: id) {
    let window = unsafe {
        let view: id = msg_send![notification, object];
        let window: id = msg_send![view, window];
        if window.is_null() {
            return;
        }
        let owned = title_bar_views(window)
            .is_some_and(|views| view == views.container || view == views.buttons[0]);
        if !owned {
            return;
        }
        let window: id = msg_send![window, retain];
        window as usize
    };
    after_current_appkit_event(move || unsafe {
        let window = window as id;
        inset_traffic_lights(window, TRAFFIC_LIGHT_INSET);
        let _: () = msg_send![window, release];
    });
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
    eprintln!("[exit] AppKit termination handler installed");
    Ok(())
}

extern "C" fn application_should_terminate(
    _delegate: &Object,
    _selector: Sel,
    _application: id,
) -> NSApplicationTerminateReply {
    eprintln!("[exit] AppKit termination callback received");
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(termination_reply)).unwrap_or_else(|_| {
        eprintln!("[exit] AppKit termination cancelled after callback panic");
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
        eprintln!("[exit] AppKit termination remains pending");
        return NSApplicationTerminateReply::NSTerminateLater;
    }
    if TERMINATION_PENDING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return NSApplicationTerminateReply::NSTerminateLater;
    }
    match crate::menu::request_system_quit(app) {
        SystemQuitRequest::Pending => {
            eprintln!("[exit] AppKit termination deferred for preflight");
            NSApplicationTerminateReply::NSTerminateLater
        }
        SystemQuitRequest::Authorized => {
            eprintln!("[exit] AppKit termination already authorized");
            TERMINATION_PENDING.store(false, Ordering::Release);
            NSApplicationTerminateReply::NSTerminateNow
        }
        SystemQuitRequest::Busy => {
            eprintln!("[exit] AppKit termination cancelled: exit guard busy");
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
        eprintln!("[exit] AppKit termination reply skipped: no pending request");
        return Ok(false);
    }
    let scheduled = app.run_on_main_thread(move || unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let response = if should_terminate { YES } else { NO };
        eprintln!("[exit] AppKit termination reply allow={should_terminate}");
        let _: () = msg_send![application, replyToApplicationShouldTerminate: response];
    });
    if scheduled.is_err() {
        eprintln!("[exit] AppKit termination reply dispatch failed");
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

#[cfg(test)]
mod tests {
    use super::{memory_pressure_level_from_flags, MemoryPressureLevel};
    use dispatch2::dispatch_source_memorypressure_flags_t;

    #[test]
    fn maps_macos_memory_pressure_flags_with_highest_severity_priority() {
        let normal =
            dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_NORMAL.0 as usize;
        let warn = dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_WARN.0 as usize;
        let critical =
            dispatch_source_memorypressure_flags_t::DISPATCH_MEMORYPRESSURE_CRITICAL.0 as usize;

        assert_eq!(memory_pressure_level_from_flags(0), None);
        assert_eq!(
            memory_pressure_level_from_flags(normal),
            Some(MemoryPressureLevel::Normal)
        );
        assert_eq!(
            memory_pressure_level_from_flags(warn),
            Some(MemoryPressureLevel::Warn)
        );
        assert_eq!(
            memory_pressure_level_from_flags(critical),
            Some(MemoryPressureLevel::Critical)
        );
        assert_eq!(
            memory_pressure_level_from_flags(normal | warn),
            Some(MemoryPressureLevel::Warn)
        );
        assert_eq!(
            memory_pressure_level_from_flags(normal | warn | critical),
            Some(MemoryPressureLevel::Critical)
        );
    }
}
