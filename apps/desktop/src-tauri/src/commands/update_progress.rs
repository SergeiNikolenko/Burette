#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::{LazyLock, Mutex};

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct NativeUpdateProgressWindow {
    window: usize,
    title_label: usize,
    detail_label: usize,
    progress_indicator: usize,
}

/// Panel geometry. Every vertical position is derived from these heights so the
/// content block stays centered instead of relying on hand-placed coordinates.
#[cfg(target_os = "macos")]
mod layout {
    pub(super) const WINDOW_WIDTH: f64 = 400.0;
    pub(super) const WINDOW_HEIGHT: f64 = 104.0;
    pub(super) const CORNER_RADIUS: f64 = 12.0;
    pub(super) const HORIZONTAL_PADDING: f64 = 20.0;
    pub(super) const ICON_SIZE: f64 = 36.0;
    pub(super) const ICON_TEXT_GAP: f64 = 12.0;
    pub(super) const TITLE_HEIGHT: f64 = 17.0;
    pub(super) const TITLE_BAR_GAP: f64 = 8.0;
    /// Thickness the progress bar occupies in the layout.
    pub(super) const BAR_HEIGHT: f64 = 6.0;
    /// `NSProgressIndicator` draws a thin bar centered in a taller intrinsic
    /// frame, so the view is centered on the layout slot rather than matching it.
    pub(super) const BAR_VIEW_HEIGHT: f64 = 20.0;
    pub(super) const BAR_DETAIL_GAP: f64 = 7.0;
    pub(super) const DETAIL_HEIGHT: f64 = 14.0;

    pub(super) const CONTENT_HEIGHT: f64 =
        TITLE_HEIGHT + TITLE_BAR_GAP + BAR_HEIGHT + BAR_DETAIL_GAP + DETAIL_HEIGHT;
    pub(super) const CONTENT_BOTTOM: f64 = (WINDOW_HEIGHT - CONTENT_HEIGHT) / 2.0;

    pub(super) const DETAIL_Y: f64 = CONTENT_BOTTOM;
    pub(super) const BAR_Y: f64 = DETAIL_Y + DETAIL_HEIGHT + BAR_DETAIL_GAP;
    pub(super) const BAR_VIEW_Y: f64 = BAR_Y + (BAR_HEIGHT - BAR_VIEW_HEIGHT) / 2.0;
    pub(super) const TITLE_Y: f64 = BAR_Y + BAR_HEIGHT + TITLE_BAR_GAP;
    pub(super) const ICON_Y: f64 = CONTENT_BOTTOM + (CONTENT_HEIGHT - ICON_SIZE) / 2.0;

    pub(super) const TEXT_X: f64 = HORIZONTAL_PADDING + ICON_SIZE + ICON_TEXT_GAP;
    pub(super) const TEXT_WIDTH: f64 = WINDOW_WIDTH - TEXT_X - HORIZONTAL_PADDING;
}

#[cfg(target_os = "macos")]
static PROGRESS_WINDOW: LazyLock<Mutex<Option<NativeUpdateProgressWindow>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "macos")]
static PROGRESS_WINDOW_ACTIVE: AtomicBool = AtomicBool::new(false);

pub(crate) fn show(app: &tauri::AppHandle, message: impl Into<String>, progress: Option<f64>) {
    show_with_detail(app, message, String::new(), progress);
}

pub(crate) fn show_with_detail(
    app: &tauri::AppHandle,
    message: impl Into<String>,
    detail: impl Into<String>,
    progress: Option<f64>,
) {
    show_platform(app, message.into(), detail.into(), progress);
}

pub(crate) fn close(app: &tauri::AppHandle) {
    close_platform(app);
}

#[cfg(not(target_os = "macos"))]
fn show_platform(
    _app: &tauri::AppHandle,
    _message: String,
    _detail: String,
    _progress: Option<f64>,
) {
}

#[cfg(not(target_os = "macos"))]
fn close_platform(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
fn show_platform(app: &tauri::AppHandle, message: String, detail: String, progress: Option<f64>) {
    PROGRESS_WINDOW_ACTIVE.store(true, Ordering::SeqCst);
    let _ = app.run_on_main_thread(move || unsafe {
        if !PROGRESS_WINDOW_ACTIVE.load(Ordering::SeqCst) {
            return;
        }
        let window = ensure_progress_window();
        update_progress_window(window, &message, &detail, progress);
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

    use layout::*;

    // Borderless keeps the panel free of an empty titlebar strip, and a
    // borderless window cannot become key, so it can never steal focus.
    let frame = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(WINDOW_WIDTH, WINDOW_HEIGHT),
    );
    let window: id = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
        frame,
        NSWindowStyleMask::NSBorderlessWindowMask,
        NSBackingStoreType::NSBackingStoreBuffered,
        NO,
    );
    window.setTitle_(nsstring("Updating Burette"));
    let _: () = msg_send![window, setReleasedWhenClosed: NO];
    let _: () = msg_send![window, setMovableByWindowBackground: YES];
    let _: () = msg_send![window, setOpaque: NO];
    let clear_color: id = msg_send![class!(NSColor), clearColor];
    let _: () = msg_send![window, setBackgroundColor: clear_color];
    let _: () = msg_send![window, setHasShadow: YES];
    // NSFloatingWindowLevel: above the app window, without activating the app.
    let _: () = msg_send![window, setLevel: 3i64];
    let _: () = msg_send![window, setHidesOnDeactivate: NO];

    let content: id = msg_send![class!(NSVisualEffectView), alloc];
    let content: id = msg_send![content, initWithFrame: frame];
    // NSVisualEffectMaterialPopover / BehindWindow / StateActive.
    let _: () = msg_send![content, setMaterial: 6i64];
    let _: () = msg_send![content, setBlendingMode: 0i64];
    let _: () = msg_send![content, setState: 1i64];
    let _: () = msg_send![content, setWantsLayer: YES];
    let layer: id = msg_send![content, layer];
    let _: () = msg_send![layer, setCornerRadius: CORNER_RADIUS];
    let _: () = msg_send![layer, setMasksToBounds: YES];
    let _: () = msg_send![window, setContentView: content];

    let icon: id = msg_send![NSApp(), applicationIconImage];
    let icon_view: id = msg_send![class!(NSImageView), imageViewWithImage: icon];
    let _: () =
        msg_send![icon_view, setFrame: rect(HORIZONTAL_PADDING, ICON_Y, ICON_SIZE, ICON_SIZE)];
    let _: () = msg_send![content, addSubview: icon_view];

    let title_label: id = msg_send![
        class!(NSTextField),
        labelWithString: nsstring("Preparing update...")
    ];
    let _: () = msg_send![title_label, setFrame: rect(TEXT_X, TITLE_Y, TEXT_WIDTH, TITLE_HEIGHT)];
    // NSFontWeightSemibold.
    let title_font: id = msg_send![class!(NSFont), systemFontOfSize: 13.0f64 weight: 0.3f64];
    let _: () = msg_send![title_label, setFont: title_font];
    let _: () = msg_send![title_label, setLineBreakMode: 4u64];
    let _: () = msg_send![content, addSubview: title_label];

    let progress_indicator: id = msg_send![class!(NSProgressIndicator), alloc];
    let progress_indicator: id = msg_send![
        progress_indicator,
        initWithFrame: rect(TEXT_X, BAR_VIEW_Y, TEXT_WIDTH, BAR_VIEW_HEIGHT)
    ];
    let _: () = msg_send![progress_indicator, setStyle: 0u64];
    let _: () = msg_send![progress_indicator, setMinValue: 0.0f64];
    let _: () = msg_send![progress_indicator, setMaxValue: 100.0f64];
    let _: () = msg_send![progress_indicator, setUsesThreadedAnimation: YES];
    let _: () = msg_send![content, addSubview: progress_indicator];
    let _: () = msg_send![progress_indicator, release];

    let detail_label: id = msg_send![class!(NSTextField), labelWithString: nsstring("")];
    let _: () =
        msg_send![detail_label, setFrame: rect(TEXT_X, DETAIL_Y, TEXT_WIDTH, DETAIL_HEIGHT)];
    let detail_font: id = msg_send![class!(NSFont), systemFontOfSize: 11.0f64];
    let _: () = msg_send![detail_label, setFont: detail_font];
    let detail_color: id = msg_send![class!(NSColor), secondaryLabelColor];
    let _: () = msg_send![detail_label, setTextColor: detail_color];
    let _: () = msg_send![detail_label, setLineBreakMode: 4u64];
    let _: () = msg_send![content, addSubview: detail_label];

    let _: () = msg_send![content, release];

    position_progress_window(window);
    let _: () = msg_send![window, orderFrontRegardless];

    NativeUpdateProgressWindow {
        window: window as usize,
        title_label: title_label as usize,
        detail_label: detail_label as usize,
        progress_indicator: progress_indicator as usize,
    }
}

/// Centers the panel over the app's main window, nudged above the midpoint the
/// way system dialogs sit. Falls back to the screen center when no main window
/// is available.
#[cfg(target_os = "macos")]
unsafe fn position_progress_window(window: cocoa::base::id) {
    use cocoa::appkit::{NSApp, NSWindow};
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSPoint;
    use objc::{msg_send, sel, sel_impl};

    let host: id = msg_send![NSApp(), mainWindow];
    if host == nil {
        let _: () = msg_send![window, center];
        return;
    }

    let host_frame = NSWindow::frame(host);
    let panel_frame = NSWindow::frame(window);
    let x = host_frame.origin.x + (host_frame.size.width - panel_frame.size.width) / 2.0;
    let centered_y = host_frame.origin.y + (host_frame.size.height - panel_frame.size.height) / 2.0;
    let y = centered_y + host_frame.size.height * 0.10;
    let origin = NSPoint::new(x.round(), y.round());
    let _: () = msg_send![window, setFrameOrigin: origin];
}

#[cfg(target_os = "macos")]
unsafe fn update_progress_window(
    window: NativeUpdateProgressWindow,
    message: &str,
    detail: &str,
    progress: Option<f64>,
) {
    use cocoa::base::{id, nil, NO, YES};
    use objc::{msg_send, sel, sel_impl};

    let title_label = window.title_label as id;
    let detail_label = window.detail_label as id;
    let progress_indicator = window.progress_indicator as id;
    let _: () = msg_send![title_label, setStringValue: nsstring(message)];
    let _: () = msg_send![detail_label, setStringValue: nsstring(detail)];
    if let Some(progress) = progress {
        let value = progress.clamp(0.0, 1.0) * 100.0;
        let _: () = msg_send![progress_indicator, setIndeterminate: NO];
        let _: () = msg_send![progress_indicator, stopAnimation: nil];
        let _: () = msg_send![progress_indicator, setDoubleValue: value];
    } else {
        let _: () = msg_send![progress_indicator, setIndeterminate: YES];
        let _: () = msg_send![progress_indicator, startAnimation: nil];
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
