//! Host-side helpers for long-running jobs: keeping the Mac awake while any
//! window runs a job, and posting a notification when one finishes.

use std::collections::BTreeSet;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Runtime, WebviewWindow};

struct SleepPrevention {
    active_windows: BTreeSet<String>,
    caffeinate: Option<Child>,
}

static SLEEP_PREVENTION: Mutex<SleepPrevention> = Mutex::new(SleepPrevention {
    active_windows: BTreeSet::new(),
    caffeinate: None,
});

/// Records whether the calling window has running jobs that should keep the
/// system awake. A `caffeinate -i -w <pid>` child holds the idle-sleep
/// assertion while any window asks for it, and exits with the app.
#[tauri::command]
pub(crate) fn set_sleep_prevention<R: Runtime>(
    window: WebviewWindow<R>,
    active: bool,
) -> Result<(), String> {
    SLEEP_PREVENTION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .set_window_active(window.label(), active)
}

pub(crate) fn window_destroyed(label: &str) {
    let _ = SLEEP_PREVENTION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .set_window_active(label, false);
}

impl SleepPrevention {
    fn set_window_active(&mut self, label: &str, active: bool) -> Result<(), String> {
        if active {
            self.active_windows.insert(label.to_string());
        } else {
            self.active_windows.remove(label);
        }
        if self.active_windows.is_empty() {
            if let Some(mut child) = self.caffeinate.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            return Ok(());
        }
        let running = self
            .caffeinate
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
        if !running {
            self.caffeinate = Some(spawn_caffeinate()?);
        }
        Ok(())
    }
}

fn spawn_caffeinate() -> Result<Child, String> {
    Command::new("/usr/bin/caffeinate")
        .args(["-i", "-w", &std::process::id().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Cannot keep the Mac awake: {error}"))
}

#[tauri::command]
pub(crate) fn notify_job_finished(title: String, body: String) -> Result<(), String> {
    let title = bounded(&title, 120);
    let body = bounded(&body, 400);
    #[cfg(target_os = "macos")]
    {
        // SAFETY: Objective-C calls on classes from linked system frameworks;
        // every object created here is released before returning.
        if unsafe { macos::post_user_notification(&title, &body) } {
            return Ok(());
        }
    }
    post_with_osascript(&title, &body)
}

fn bounded(value: &str, limit: usize) -> String {
    value.trim().chars().take(limit).collect()
}

/// Fallback for unbundled development builds, where the notification center
/// has no application identity to post under.
fn post_with_osascript(title: &str, body: &str) -> Result<(), String> {
    Command::new("/usr/bin/osascript")
        .args([
            "-e",
            "on run argv",
            "-e",
            "display notification (item 2 of argv) with title (item 1 of argv)",
            "-e",
            "end run",
            title,
            body,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Cannot post a notification: {error}"))
}

#[cfg(target_os = "macos")]
mod macos {
    use block::ConcreteBlock;
    use cocoa::base::{id, nil, BOOL, NO};
    use cocoa::foundation::NSString;
    use objc::runtime::Class;
    use objc::{class, msg_send, sel, sel_impl};

    #[link(name = "UserNotifications", kind = "framework")]
    extern "C" {}

    const AUTHORIZATION_SOUND: usize = 1 << 1;
    const AUTHORIZATION_ALERT: usize = 1 << 2;

    /// Posts through UNUserNotificationCenter. Returns `false` when the process
    /// is not a bundled app, since the center raises without a bundle identity.
    pub(super) unsafe fn post_user_notification(title: &str, body: &str) -> bool {
        let bundle: id = msg_send![class!(NSBundle), mainBundle];
        let identifier: id = msg_send![bundle, bundleIdentifier];
        if identifier == nil {
            return false;
        }
        let bundle_path: id = msg_send![bundle, bundlePath];
        let suffix = NSString::alloc(nil).init_str(".app");
        let bundled: BOOL = msg_send![bundle_path, hasSuffix: suffix];
        let _: () = msg_send![suffix, release];
        if bundled == NO {
            return false;
        }
        let (Some(center_class), Some(content_class), Some(request_class)) = (
            Class::get("UNUserNotificationCenter"),
            Class::get("UNMutableNotificationContent"),
            Class::get("UNNotificationRequest"),
        ) else {
            return false;
        };
        let center: id = msg_send![center_class, currentNotificationCenter];
        if center == nil {
            return false;
        }
        let authorization = ConcreteBlock::new(|_granted: BOOL, _error: id| {}).copy();
        let _: () = msg_send![
            center,
            requestAuthorizationWithOptions: AUTHORIZATION_ALERT | AUTHORIZATION_SOUND
            completionHandler: &*authorization
        ];

        let content: id = msg_send![content_class, new];
        let title = NSString::alloc(nil).init_str(title);
        let body = NSString::alloc(nil).init_str(body);
        let request_id = NSString::alloc(nil).init_str(&uuid::Uuid::new_v4().to_string());
        let _: () = msg_send![content, setTitle: title];
        let _: () = msg_send![content, setBody: body];
        let request: id = msg_send![
            request_class,
            requestWithIdentifier: request_id
            content: content
            trigger: nil
        ];
        let posted = request != nil;
        if posted {
            let _: () =
                msg_send![center, addNotificationRequest: request withCompletionHandler: nil];
        }
        for object in [content, title, body, request_id] {
            let _: () = msg_send![object, release];
        }
        posted
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn closing_windows_releases_sleep_assertion_after_last_requester() {
        let mut state = SleepPrevention {
            active_windows: BTreeSet::new(),
            caffeinate: None,
        };
        state.set_window_active("first", true).unwrap();
        state.set_window_active("second", true).unwrap();
        let pid = state.caffeinate.as_ref().unwrap().id();
        state.set_window_active("first", false).unwrap();
        assert_eq!(state.active_windows, BTreeSet::from(["second".to_string()]));
        assert_eq!(state.caffeinate.as_ref().unwrap().id(), pid);
        assert!(state
            .caffeinate
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        state.set_window_active("second", false).unwrap();
        assert!(state.active_windows.is_empty());
        assert!(state.caffeinate.is_none());
        state.set_window_active("second", false).unwrap();
        assert!(state.caffeinate.is_none());
    }
}
