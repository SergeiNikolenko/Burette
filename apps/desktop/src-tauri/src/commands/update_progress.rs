#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::{LazyLock, Mutex};

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct NativeUpdateProgressWindow {
    window: usize,
    message_label: usize,
    progress_indicator: usize,
}

#[cfg(target_os = "macos")]
static PROGRESS_WINDOW: LazyLock<Mutex<Option<NativeUpdateProgressWindow>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "macos")]
static PROGRESS_WINDOW_ACTIVE: AtomicBool = AtomicBool::new(false);

pub(crate) fn show(app: &tauri::AppHandle, message: impl Into<String>, progress: Option<f64>) {
    show_platform(app, message.into(), progress);
}

pub(crate) fn close(app: &tauri::AppHandle) {
    close_platform(app);
}

#[cfg(not(target_os = "macos"))]
fn show_platform(_app: &tauri::AppHandle, _message: String, _progress: Option<f64>) {}

#[cfg(not(target_os = "macos"))]
fn close_platform(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
fn show_platform(app: &tauri::AppHandle, message: String, progress: Option<f64>) {
    PROGRESS_WINDOW_ACTIVE.store(true, Ordering::SeqCst);
    let _ = app.run_on_main_thread(move || unsafe {
        if !PROGRESS_WINDOW_ACTIVE.load(Ordering::SeqCst) {
            return;
        }
        let window = ensure_progress_window();
        update_progress_window(window, &message, progress);
    });
}

#[cfg(target_os = "macos")]
fn close_platform(app: &tauri::AppHandle) {
    PROGRESS_WINDOW_ACTIVE.store(false, Ordering::SeqCst);
    let _ = app.run_on_main_thread(move || unsafe {
        use objc::{msg_send, sel, sel_impl};

        if let Ok(mut state) = PROGRESS_WINDOW.lock() {
            if let Some(window) = state.take() {
                let ns_window = window.window as cocoa::base::id;
                let _: () = msg_send![ns_window, close];
                let _: () = msg_send![ns_window, release];
            }
        }
    });
}

#[cfg(target_os = "macos")]
unsafe fn ensure_progress_window() -> NativeUpdateProgressWindow {
    if let Ok(state) = PROGRESS_WINDOW.lock() {
        if let Some(window) = *state {
            return window;
        }
    }

    let window = create_progress_window();
    if let Ok(mut state) = PROGRESS_WINDOW.lock() {
        *state = Some(window);
    }
    window
}

#[cfg(target_os = "macos")]
unsafe fn create_progress_window() -> NativeUpdateProgressWindow {
    use cocoa::appkit::{NSApp, NSBackingStoreType, NSWindow, NSWindowStyleMask};
    use cocoa::base::{id, nil, NO, YES};
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{class, msg_send, sel, sel_impl};
    use std::os::raw::c_void;

    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(620.0, 214.0));
    let window: id = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
        frame,
        NSWindowStyleMask::NSTitledWindowMask,
        NSBackingStoreType::NSBackingStoreBuffered,
        NO,
    );
    window.setTitle_(nsstring("Updating Burrete"));
    let _: () = msg_send![window, setReleasedWhenClosed: NO];
    let _: () = msg_send![window, setMovableByWindowBackground: YES];
    let _: () = msg_send![window, setTitleVisibility: 0u64];
    let _: () = msg_send![window, setTitlebarAppearsTransparent: NO];
    hide_standard_button(window, 0);
    hide_standard_button(window, 1);
    hide_standard_button(window, 2);

    let content: id = msg_send![class!(NSView), alloc];
    let content: id = msg_send![content, initWithFrame: frame];
    let _: () = msg_send![window, setContentView: content];
    let _: () = msg_send![content, release];

    let icon: id = msg_send![NSApp(), applicationIconImage];
    let icon_view: id = msg_send![class!(NSImageView), imageViewWithImage: icon];
    let _: () = msg_send![icon_view, setFrame: rect(34.0, 78.0, 78.0, 78.0)];
    let _: () = msg_send![content, addSubview: icon_view];

    let message_label: id = msg_send![
        class!(NSTextField),
        labelWithString: nsstring("Preparing update...")
    ];
    let _: () = msg_send![message_label, setFrame: rect(134.0, 130.0, 430.0, 30.0)];
    let font: id = msg_send![class!(NSFont), boldSystemFontOfSize: 17.0f64];
    let _: () = msg_send![message_label, setFont: font];
    let _: () = msg_send![message_label, setLineBreakMode: 4u64];
    let _: () = msg_send![content, addSubview: message_label];

    let progress_indicator: id = msg_send![class!(NSProgressIndicator), alloc];
    let progress_indicator: id =
        msg_send![progress_indicator, initWithFrame: rect(134.0, 90.0, 430.0, 14.0)];
    let _: () = msg_send![progress_indicator, setStyle: 0u64];
    let _: () = msg_send![progress_indicator, setMinValue: 0.0f64];
    let _: () = msg_send![progress_indicator, setMaxValue: 100.0f64];
    let _: () = msg_send![progress_indicator, setUsesThreadedAnimation: YES];
    let _: () = msg_send![content, addSubview: progress_indicator];
    let _: () = msg_send![progress_indicator, release];

    let cancel_button: id = msg_send![
        class!(NSButton),
        buttonWithTitle: nsstring("Cancel")
        target: nil
        action: std::ptr::null::<c_void>()
    ];
    let _: () = msg_send![cancel_button, setFrame: rect(450.0, 28.0, 114.0, 32.0)];
    let _: () = msg_send![cancel_button, setEnabled: NO];
    let _: () = msg_send![content, addSubview: cancel_button];

    let _: () = msg_send![window, center];
    let _: () = msg_send![window, makeKeyAndOrderFront: nil];
    let _: () = msg_send![NSApp(), activateIgnoringOtherApps: YES];

    NativeUpdateProgressWindow {
        window: window as usize,
        message_label: message_label as usize,
        progress_indicator: progress_indicator as usize,
    }
}

#[cfg(target_os = "macos")]
unsafe fn update_progress_window(
    window: NativeUpdateProgressWindow,
    message: &str,
    progress: Option<f64>,
) {
    use cocoa::base::{id, nil, NO, YES};
    use objc::{msg_send, sel, sel_impl};

    let message_label = window.message_label as id;
    let progress_indicator = window.progress_indicator as id;
    let ns_window = window.window as id;
    let _: () = msg_send![message_label, setStringValue: nsstring(message)];
    if let Some(progress) = progress {
        let value = progress.clamp(0.0, 1.0) * 100.0;
        let _: () = msg_send![progress_indicator, setIndeterminate: NO];
        let _: () = msg_send![progress_indicator, stopAnimation: nil];
        let _: () = msg_send![progress_indicator, setDoubleValue: value];
    } else {
        let _: () = msg_send![progress_indicator, setIndeterminate: YES];
        let _: () = msg_send![progress_indicator, startAnimation: nil];
    }
    let _: () = msg_send![ns_window, orderFrontRegardless];
}

#[cfg(target_os = "macos")]
unsafe fn hide_standard_button(window: cocoa::base::id, button: u64) {
    use cocoa::base::{id, YES};
    use objc::{msg_send, sel, sel_impl};

    let standard_button: id = msg_send![window, standardWindowButton: button];
    if !standard_button.is_null() {
        let _: () = msg_send![standard_button, setHidden: YES];
    }
}

#[cfg(target_os = "macos")]
fn rect(x: f64, y: f64, width: f64, height: f64) -> cocoa::foundation::NSRect {
    use cocoa::foundation::{NSPoint, NSRect, NSSize};

    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

#[cfg(target_os = "macos")]
unsafe fn nsstring(value: &str) -> cocoa::base::id {
    use cocoa::base::nil;
    use cocoa::foundation::NSString;
    use objc::{msg_send, sel, sel_impl};

    let string = NSString::alloc(nil).init_str(value);
    msg_send![string, autorelease]
}
