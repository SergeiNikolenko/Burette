use cocoa::appkit::NSApplicationTerminateReply;
use cocoa::base::{id, NO, YES};
use dispatch2::DispatchQueue;
use objc::runtime::{class_addMethod, class_getInstanceMethod, object_getClass, Imp, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static TERMINATION_PENDING: AtomicBool = AtomicBool::new(false);

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
