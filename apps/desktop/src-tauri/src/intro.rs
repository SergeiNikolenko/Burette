//! Burette's first-launch opening.
//!
//! On a fresh install the first window is held back: hidden, without material,
//! shadow or traffic lights, until its page starts the atom opening. While the
//! atom plays the window is a bare transparent surface above a desktop dimmed
//! on every display. The page sends each stage through `present_intro` as its
//! timeline reaches it, and the window ends as an ordinary workspace window.
//! Resetting onboarding replays the opening in the window it is chosen from.

use serde::Deserialize;
use tauri::{Runtime, WebviewWindow};

/// Tells the page of a held window that the shell waits for the opening.
pub(crate) const HELD_WINDOW_SCRIPT: &str = "window.__BURETTE_INTRO__ = true;";

/// A stage of the opening, sent by the page when its timeline reaches it.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum IntroCue {
    /// Strips the window chrome, dims every display and brings the window forward.
    Begin,
    /// Fades the traffic lights in.
    Chrome,
    /// Lifts the dim over `seconds`.
    Undim { seconds: f64 },
    /// Makes the window an ordinary window again from whatever stage it reached.
    Settle,
}

#[tauri::command]
pub(crate) fn present_intro(window: tauri::WebviewWindow, cue: IntroCue) -> Result<(), String> {
    platform::present(&window, cue)
}

/// Keeps a fresh install's first window hidden for the opening. If its page
/// never answers, the window appears as an ordinary window a few seconds later.
pub(crate) fn hold<R: Runtime>(window: &WebviewWindow<R>) {
    platform::hold(window);
}

#[cfg(target_os = "macos")]
mod platform {
    use super::IntroCue;
    use cocoa::appkit::{NSWindow, NSWindowButton};
    use cocoa::base::{id, nil, BOOL, NO, YES};
    use cocoa::foundation::{NSPoint, NSRect, NSSize, NSString};
    use dispatch2::{DispatchQueue, DispatchTime};
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::{Runtime, WebviewWindow};

    /// Like Arc, the desktop sinks to near black behind the opening.
    const DIM_LEVEL: f64 = 0.9;
    const DIM_IN_SECONDS: f64 = 1.0;
    const SETTLE_UNDIM_SECONDS: f64 = 0.3;
    const CHROME_FADE_SECONDS: f64 = 0.35;
    /// The opening runs 7.5 s; past this the desktop is never left dimmed.
    const SAFETY: Duration = Duration::from_secs(16);
    /// A held window appears as an ordinary window if its page never answers.
    const HOLD_TIMEOUT: Duration = Duration::from_secs(6);

    const NS_WINDOW_BELOW: i64 = -1;
    const NS_FLOATING_WINDOW_LEVEL: i64 = 3;
    const NS_BORDERLESS_WINDOW_MASK: u64 = 0;
    const NS_BACKING_STORE_BUFFERED: u64 = 2;
    const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
    const STATIONARY: u64 = 1 << 4;
    const IGNORES_CYCLE: u64 = 1 << 6;
    const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
    const FULL_SCREEN_NONE: u64 = 1 << 9;

    /// Retained dim windows; only the main thread creates, animates or closes them.
    static DIMS: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    /// Bumped whenever the dims are shown again, so a stale fade never removes them.
    static DIM_GENERATION: AtomicU64 = AtomicU64::new(0);
    /// Bumped on every begin and settle, so a stale safety timer does nothing.
    static PRESENTATION: AtomicU64 = AtomicU64::new(0);
    static HELD: AtomicBool = AtomicBool::new(false);

    #[derive(Clone, Copy)]
    enum Lights {
        Hidden,
        /// Fades in buttons that are hidden and leaves visible ones as they are.
        FadeIn,
    }

    #[derive(Clone, Copy)]
    enum Placement {
        /// A child kept directly below the window, covering its display under the menu bar.
        BelowWindow,
        /// Another display, or the band behind the menu bar, which ordinary windows never cover.
        Floating,
    }

    pub(super) fn present<R: Runtime>(
        window: &WebviewWindow<R>,
        cue: IntroCue,
    ) -> Result<(), String> {
        match cue {
            IntroCue::Begin => begin(window),
            IntroCue::Chrome => on_main(window, |ns_window| unsafe {
                set_traffic_lights(ns_window, Lights::FadeIn)
            }),
            IntroCue::Undim { seconds } => {
                lift_dims(seconds.clamp(0.0, 5.0));
                Ok(())
            }
            IntroCue::Settle => settle(window),
        }
    }

    pub(super) fn hold<R: Runtime>(window: &WebviewWindow<R>) {
        HELD.store(true, Ordering::SeqCst);
        let _ = window.center();
        let _ = on_main(window, |ns_window| unsafe {
            set_traffic_lights(ns_window, Lights::Hidden)
        });
        let window = window.clone();
        after(HOLD_TIMEOUT, move || {
            if HELD.load(Ordering::SeqCst) {
                eprintln!("[intro] the page did not answer; showing the window");
                let _ = settle(&window);
            }
        });
    }

    fn begin<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
        HELD.store(false, Ordering::SeqCst);
        let presentation = PRESENTATION.fetch_add(1, Ordering::SeqCst) + 1;
        window
            .set_effects(None::<WindowEffectsConfig>)
            .map_err(|error| error.to_string())?;
        window
            .set_shadow(false)
            .map_err(|error| error.to_string())?;
        on_main(window, |ns_window| unsafe {
            set_traffic_lights(ns_window, Lights::Hidden)
        })?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        on_main(window, |ns_window| unsafe { show_dims(ns_window) })?;
        let window = window.clone();
        after(SAFETY, move || {
            if PRESENTATION.load(Ordering::SeqCst) == presentation {
                eprintln!("[intro] the opening did not settle; restoring the window");
                let _ = settle(&window);
            }
        });
        Ok(())
    }

    fn settle<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
        HELD.store(false, Ordering::SeqCst);
        PRESENTATION.fetch_add(1, Ordering::SeqCst);
        window
            .set_effects(crate::windows::workspace_effects())
            .map_err(|error| error.to_string())?;
        window.set_shadow(true).map_err(|error| error.to_string())?;
        lift_dims(SETTLE_UNDIM_SECONDS);
        if !window.is_visible().unwrap_or(true) {
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
        }
        on_main(window, |ns_window| unsafe {
            set_traffic_lights(ns_window, Lights::FadeIn);
            let _: () = msg_send![ns_window, invalidateShadow];
        })?;
        crate::macos::reposition_traffic_lights(window);
        Ok(())
    }

    fn on_main<R: Runtime>(
        window: &WebviewWindow<R>,
        work: impl FnOnce(id) + Send + 'static,
    ) -> Result<(), String> {
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let Ok(ns_window) = target.ns_window() else {
                    return;
                };
                if !ns_window.is_null() {
                    work(ns_window as id);
                }
            })
            .map_err(|error| error.to_string())
    }

    fn after(delay: Duration, work: impl FnOnce() + Send + 'static) {
        let when = DispatchTime::try_from(delay).unwrap_or(DispatchTime::NOW);
        let _ = DispatchQueue::main().after(when, work);
    }

    unsafe fn animate(seconds: f64, change: impl FnOnce()) {
        let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
        let context: id = msg_send![class!(NSAnimationContext), currentContext];
        let _: () = msg_send![context, setDuration: seconds];
        let name = NSString::alloc(nil).init_str("easeInEaseOut");
        let timing: id = msg_send![class!(CAMediaTimingFunction), functionWithName: name];
        let _: () = msg_send![name, release];
        let _: () = msg_send![context, setTimingFunction: timing];
        change();
        let _: () = msg_send![class!(NSAnimationContext), endGrouping];
    }

    /// Animates the alpha of a window or view inside an `animate` group.
    unsafe fn fade_to(target: id, alpha: f64) {
        let animator: id = msg_send![target, animator];
        let _: () = msg_send![animator, setAlphaValue: alpha];
    }

    unsafe fn set_traffic_lights(window: id, lights: Lights) {
        for kind in [
            NSWindowButton::NSWindowCloseButton,
            NSWindowButton::NSWindowMiniaturizeButton,
            NSWindowButton::NSWindowZoomButton,
        ] {
            let button = window.standardWindowButton_(kind);
            if button == nil {
                continue;
            }
            match lights {
                Lights::Hidden => {
                    let _: () = msg_send![button, setHidden: YES];
                }
                Lights::FadeIn => {
                    let hidden: BOOL = msg_send![button, isHidden];
                    if hidden == NO {
                        continue;
                    }
                    let _: () = msg_send![button, setAlphaValue: 0.0f64];
                    let _: () = msg_send![button, setHidden: NO];
                    animate(CHROME_FADE_SECONDS, || fade_to(button, 1.0));
                }
            }
        }
    }

    unsafe fn show_dims(window: id) {
        DIM_GENERATION.fetch_add(1, Ordering::SeqCst);
        let Ok(mut dims) = DIMS.lock() else {
            return;
        };
        if dims.is_empty() {
            *dims = place_dims(window);
        }
        let shown = dims.clone();
        drop(dims);
        animate(DIM_IN_SECONDS, || {
            for dim in shown {
                fade_to(dim as id, DIM_LEVEL);
            }
        });
    }

    fn lift_dims(seconds: f64) {
        DispatchQueue::main().exec_async(move || {
            let generation = DIM_GENERATION.load(Ordering::SeqCst);
            let dims = DIMS.lock().map(|dims| dims.clone()).unwrap_or_default();
            if dims.is_empty() {
                return;
            }
            unsafe {
                animate(seconds, || {
                    for dim in dims {
                        fade_to(dim as id, 0.0);
                    }
                });
            }
            after(Duration::from_secs_f64(seconds + 0.05), move || {
                if DIM_GENERATION.load(Ordering::SeqCst) == generation {
                    unsafe { remove_dims() };
                }
            });
        });
    }

    unsafe fn remove_dims() {
        let dims = DIMS
            .lock()
            .map(|mut dims| std::mem::take(&mut *dims))
            .unwrap_or_default();
        for dim in dims {
            let dim = dim as id;
            let parent: id = msg_send![dim, parentWindow];
            if parent != nil {
                let _: () = msg_send![parent, removeChildWindow: dim];
            }
            let _: () = msg_send![dim, orderOut: nil];
            let _: () = msg_send![dim, release];
        }
    }

    /// One dim per display. The window's display is covered by a child dim kept
    /// directly below the window plus a floating band behind the menu bar.
    unsafe fn place_dims(window: id) -> Vec<usize> {
        let frame = NSWindow::frame(window);
        let center = NSPoint::new(
            frame.origin.x + frame.size.width / 2.0,
            frame.origin.y + frame.size.height / 2.0,
        );
        let list: id = msg_send![class!(NSScreen), screens];
        let count: u64 = msg_send![list, count];
        let mut screens = Vec::new();
        for index in 0..count {
            let screen: id = msg_send![list, objectAtIndex: index];
            screens.push(screen);
        }
        let home = screens
            .iter()
            .copied()
            .find(|&screen| {
                let bounds: NSRect = msg_send![screen, frame];
                contains(bounds, center)
            })
            .or_else(|| screens.first().copied());

        let mut dims = Vec::new();
        for screen in screens {
            let bounds: NSRect = msg_send![screen, frame];
            if Some(screen) != home {
                dims.push(make_dim(bounds, Placement::Floating) as usize);
                continue;
            }
            let visible: NSRect = msg_send![screen, visibleFrame];
            let menu_top = visible.origin.y + visible.size.height;
            let below = NSRect::new(
                bounds.origin,
                NSSize::new(bounds.size.width, menu_top - bounds.origin.y),
            );
            let attached = make_dim(below, Placement::BelowWindow);
            let _: () = msg_send![window, addChildWindow: attached ordered: NS_WINDOW_BELOW];
            dims.push(attached as usize);
            let top = bounds.origin.y + bounds.size.height;
            if top > menu_top {
                let band = NSRect::new(
                    NSPoint::new(bounds.origin.x, menu_top),
                    NSSize::new(bounds.size.width, top - menu_top),
                );
                dims.push(make_dim(band, Placement::Floating) as usize);
            }
        }
        dims
    }

    fn contains(rect: NSRect, point: NSPoint) -> bool {
        point.x >= rect.origin.x
            && point.x < rect.origin.x + rect.size.width
            && point.y >= rect.origin.y
            && point.y < rect.origin.y + rect.size.height
    }

    unsafe fn make_dim(frame: NSRect, placement: Placement) -> id {
        let dim: id = msg_send![dim_window_class(), alloc];
        let dim: id = msg_send![dim,
            initWithContentRect: frame
            styleMask: NS_BORDERLESS_WINDOW_MASK
            backing: NS_BACKING_STORE_BUFFERED
            defer: NO];
        let _: () = msg_send![dim, setFrame: frame display: NO];
        let black: id = msg_send![class!(NSColor), blackColor];
        let _: () = msg_send![dim, setBackgroundColor: black];
        let _: () = msg_send![dim, setOpaque: NO];
        let _: () = msg_send![dim, setAlphaValue: 0.0f64];
        let _: () = msg_send![dim, setHasShadow: NO];
        let _: () = msg_send![dim, setReleasedWhenClosed: NO];
        // Like Arc, the dimmed desktop swallows clicks until the welcome window is ready.
        let _: () = msg_send![dim, setIgnoresMouseEvents: NO];
        match placement {
            Placement::BelowWindow => {
                let _: () = msg_send![dim, setCollectionBehavior: IGNORES_CYCLE | FULL_SCREEN_NONE];
            }
            Placement::Floating => {
                let _: () = msg_send![dim, setLevel: NS_FLOATING_WINDOW_LEVEL];
                let _: () = msg_send![dim, setCollectionBehavior: CAN_JOIN_ALL_SPACES
                    | STATIONARY
                    | IGNORES_CYCLE
                    | FULL_SCREEN_AUXILIARY];
                let _: () = msg_send![dim, orderFrontRegardless];
            }
        }
        dim
    }

    /// A dim keeps exactly the frame it is given, including the band behind the menu bar.
    fn dim_window_class() -> &'static Class {
        static CLASS: OnceLock<&'static Class> = OnceLock::new();
        CLASS.get_or_init(|| {
            let mut class = ClassDecl::new("BuretteIntroDimWindow", class!(NSWindow))
                .expect("unique intro dim window class");
            unsafe {
                class.add_method(
                    sel!(constrainFrameRect:toScreen:),
                    keep_frame as extern "C" fn(&Object, Sel, NSRect, id) -> NSRect,
                );
            }
            class.register()
        })
    }

    extern "C" fn keep_frame(_: &Object, _: Sel, frame: NSRect, _: id) -> NSRect {
        frame
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::IntroCue;
    use tauri::{Runtime, WebviewWindow};

    pub(super) fn present<R: Runtime>(
        window: &WebviewWindow<R>,
        cue: IntroCue,
    ) -> Result<(), String> {
        match cue {
            IntroCue::Begin | IntroCue::Settle => {
                window.show().map_err(|error| error.to_string())?;
                window.set_focus().map_err(|error| error.to_string())
            }
            IntroCue::Chrome | IntroCue::Undim { .. } => Ok(()),
        }
    }

    pub(super) fn hold<R: Runtime>(window: &WebviewWindow<R>) {
        let _ = window.show();
    }
}

#[cfg(test)]
mod tests {
    use super::IntroCue;

    #[test]
    fn cues_read_the_page_wire_format() {
        let cues: Vec<IntroCue> = serde_json::from_str(
            r#"[{"kind":"begin"},{"kind":"chrome"},{"kind":"undim","seconds":1},{"kind":"settle"}]"#,
        )
        .expect("cues parse");
        assert_eq!(
            cues,
            [
                IntroCue::Begin,
                IntroCue::Chrome,
                IntroCue::Undim { seconds: 1.0 },
                IntroCue::Settle
            ]
        );
    }
}
