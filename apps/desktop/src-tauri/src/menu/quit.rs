use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

use super::state::{QuitGuard, QuitRequestStart};

pub(crate) const EXIT_PREFLIGHT_EVENT: &str = "app:exit-preflight";
const EXIT_TRANSITION_RESUMED_EVENT: &str = "app:exit-transition-resumed";
const EXIT_PREFLIGHT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);
#[derive(Debug, PartialEq, Eq)]
enum ExitPreflightOutcome {
    Ready(Vec<String>),
    CloseTransitionActive,
}

type ExitPreflightResult = Result<ExitPreflightOutcome, String>;
type ExitPreflightReceiver = Receiver<ExitPreflightResult>;

#[derive(Clone, Copy)]
pub(crate) enum ExitIntent {
    Quit,
    RestartForUpdate,
}

impl ExitIntent {
    fn message(self) -> &'static str {
        match self {
            Self::Quit => {
                "One or more molecule collections have unsaved or in-progress changes. Review them before quitting, or quit without saving."
            }
            Self::RestartForUpdate => {
                "One or more molecule collections have unsaved or in-progress changes. Review them before restarting, or restart without saving."
            }
        }
    }

    fn discard_label(self) -> &'static str {
        match self {
            Self::Quit => "Quit Without Saving",
            Self::RestartForUpdate => "Restart Without Saving",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitPreflightRequest {
    request_id: String,
}

pub(crate) struct ExitPermit {
    request_id: String,
}

pub(crate) struct ValidatedExitPermit {
    live_windows: HashSet<String>,
}

pub(crate) struct ExitTransition<R: Runtime> {
    app: tauri::AppHandle<R>,
    resume_on_drop: bool,
    paused_window_labels: HashSet<String>,
}

impl<R: Runtime> ExitTransition<R> {
    pub(crate) fn acquire(app: &tauri::AppHandle<R>) -> Result<Self, String> {
        Self::acquire_with_owner(app, false)
    }

    fn acquire_for_quit(app: &tauri::AppHandle<R>) -> Result<Self, String> {
        Self::acquire_with_owner(app, true)
    }

    fn acquire_with_owner(
        app: &tauri::AppHandle<R>,
        quit_prompt_owner: bool,
    ) -> Result<Self, String> {
        let guard = app
            .try_state::<QuitGuard>()
            .ok_or_else(|| "quit guard is not configured".to_string())?;
        if !guard.begin_transition(quit_prompt_owner) {
            return Err("Another quit or restart transition is already in progress.".into());
        }
        Ok(Self {
            app: app.clone(),
            resume_on_drop: true,
            paused_window_labels: HashSet::new(),
        })
    }

    fn pause_window_interaction(&mut self) -> Result<(), String> {
        self.paused_window_labels = pause_window_interaction(&self.app)?;
        Ok(())
    }

    fn resume_window_interaction(&mut self) -> Result<(), String> {
        restore_window_interaction(&self.app, &self.paused_window_labels)?;
        self.paused_window_labels.clear();
        Ok(())
    }

    pub(crate) fn keep_paused(mut self) {
        self.resume_on_drop = false;
    }
}

impl<R: Runtime> Drop for ExitTransition<R> {
    fn drop(&mut self) {
        if !self.resume_on_drop {
            return;
        }
        let _ = self.resume_window_interaction();
        if let Some(guard) = self.app.try_state::<QuitGuard>() {
            guard.finish_transition();
        }
        let _ = self.app.emit(EXIT_TRANSITION_RESUMED_EVENT, ());
    }
}

#[derive(Default)]
pub(super) struct ExitPreflightCoordinator {
    state: Mutex<ExitPreflightState>,
}

#[derive(Default)]
struct ExitPreflightState {
    registered_windows: HashMap<String, HashSet<String>>,
    pending: Option<PendingExitPreflight>,
}

struct PendingExitPreflight {
    request_id: String,
    expected_windows: HashSet<String>,
    responded_windows: HashSet<String>,
    close_transition_windows: HashSet<String>,
    dirty_windows: HashSet<String>,
    response_revisions: HashMap<String, u64>,
    approved_dirty_windows: Option<HashSet<String>>,
    approved_revisions: Option<HashMap<String, u64>>,
    result_sender: Option<SyncSender<ExitPreflightResult>>,
}

impl ExitPreflightCoordinator {
    fn register(&self, window_label: &str) -> Result<String, String> {
        let registration_id = uuid::Uuid::new_v4().to_string();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
        state
            .registered_windows
            .entry(window_label.to_string())
            .or_default()
            .insert(registration_id.clone());
        Ok(registration_id)
    }

    fn unregister(&self, window_label: &str, registration_id: &str) -> Result<(), String> {
        let aborted = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            let remove_window =
                state
                    .registered_windows
                    .get_mut(window_label)
                    .is_some_and(|registrations| {
                        registrations.remove(registration_id);
                        registrations.is_empty()
                    });
            if remove_window {
                state.registered_windows.remove(window_label);
            }
            if remove_window
                && state.pending.as_ref().is_some_and(|pending| {
                    pending.result_sender.is_some()
                        && pending.expected_windows.contains(window_label)
                })
            {
                state.pending.take()
            } else {
                None
            }
        };
        if let Some(mut pending) = aborted {
            if let Some(sender) = pending.result_sender.take() {
                let _ = sender.send(Err(format!(
                    "Window {window_label} stopped listening during exit preflight."
                )));
            }
        }
        Ok(())
    }

    fn begin<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<(String, ExitPreflightReceiver), String> {
        let windows = app.webview_windows();
        let live_windows = windows.keys().cloned().collect::<HashSet<_>>();
        let request_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = sync_channel(1);

        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            if state.pending.is_some() {
                return Err("Another exit confirmation is already in progress.".into());
            }
            state
                .registered_windows
                .retain(|label, _| live_windows.contains(label));
            let mut missing = live_windows
                .iter()
                .filter(|label| !state.registered_windows.contains_key(*label))
                .cloned()
                .collect::<Vec<_>>();
            missing.sort();
            if !missing.is_empty() {
                return Err(format!(
                    "Exit protection is not ready in window(s): {}.",
                    missing.join(", ")
                ));
            }
            state.pending = Some(PendingExitPreflight {
                request_id: request_id.clone(),
                expected_windows: live_windows,
                responded_windows: HashSet::new(),
                close_transition_windows: HashSet::new(),
                dirty_windows: HashSet::new(),
                response_revisions: HashMap::new(),
                approved_dirty_windows: None,
                approved_revisions: None,
                result_sender: Some(sender),
            });
        }

        if windows.is_empty() {
            self.complete_if_ready(&request_id)?;
            return Ok((request_id, receiver));
        }

        for (label, window) in windows {
            if let Err(error) = window.emit(
                EXIT_PREFLIGHT_EVENT,
                ExitPreflightRequest {
                    request_id: request_id.clone(),
                },
            ) {
                if app.get_webview_window(&label).is_none() {
                    self.window_destroyed(&label)?;
                    continue;
                }
                self.abort(
                    &request_id,
                    format!("Could not query window {label} before exit: {error}"),
                )?;
                break;
            }
        }

        Ok((request_id, receiver))
    }

    fn begin_validation<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        request_id: &str,
    ) -> Result<ExitPreflightReceiver, String> {
        let windows = app.webview_windows();
        let live_windows = windows.keys().cloned().collect::<HashSet<_>>();
        let (sender, receiver) = sync_channel(1);
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            let Some(pending) = state.pending.as_ref() else {
                return Err("Exit permit is no longer valid.".into());
            };
            if pending.request_id != request_id || pending.result_sender.is_some() {
                return Err("Exit permit is no longer valid.".into());
            }
            if pending.expected_windows != live_windows {
                state.pending = None;
                return Err("The app window set changed during exit confirmation.".into());
            }
            let pending = state
                .pending
                .as_mut()
                .expect("pending preflight checked above");
            pending.approved_dirty_windows = Some(pending.dirty_windows.clone());
            pending.approved_revisions = Some(pending.response_revisions.clone());
            pending.responded_windows.clear();
            pending.close_transition_windows.clear();
            pending.dirty_windows.clear();
            pending.response_revisions.clear();
            pending.result_sender = Some(sender);
        }

        if windows.is_empty() {
            self.complete_if_ready(request_id)?;
            return Ok(receiver);
        }
        for (label, window) in windows {
            if let Err(error) = window.emit(
                EXIT_PREFLIGHT_EVENT,
                ExitPreflightRequest {
                    request_id: request_id.to_string(),
                },
            ) {
                if app.get_webview_window(&label).is_none() {
                    self.window_destroyed(&label)?;
                    continue;
                }
                self.abort(
                    request_id,
                    format!("Could not revalidate window {label} before exit: {error}"),
                )?;
                break;
            }
        }
        Ok(receiver)
    }

    fn respond(
        &self,
        request_id: &str,
        window_label: &str,
        close_transition_active: bool,
        dirty: bool,
        revision: u64,
    ) -> Result<(), String> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            let Some(pending) = state.pending.as_mut() else {
                return Ok(());
            };
            if pending.request_id != request_id
                || !pending.expected_windows.contains(window_label)
                || !pending.responded_windows.insert(window_label.to_string())
            {
                return Ok(());
            }
            if dirty {
                pending.dirty_windows.insert(window_label.to_string());
            }
            if close_transition_active {
                pending
                    .close_transition_windows
                    .insert(window_label.to_string());
            }
            pending
                .response_revisions
                .insert(window_label.to_string(), revision);
        }
        self.complete_if_ready(request_id)
    }

    fn window_destroyed(&self, window_label: &str) -> Result<(), String> {
        let request_id = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            state.registered_windows.remove(window_label);
            let Some(pending) = state.pending.as_mut() else {
                return Ok(());
            };
            pending.expected_windows.remove(window_label);
            pending.responded_windows.remove(window_label);
            pending.close_transition_windows.remove(window_label);
            pending.dirty_windows.remove(window_label);
            pending.response_revisions.remove(window_label);
            if let Some(approved) = pending.approved_dirty_windows.as_mut() {
                approved.remove(window_label);
            }
            if let Some(approved) = pending.approved_revisions.as_mut() {
                approved.remove(window_label);
            }
            pending.request_id.clone()
        };
        self.complete_if_ready(&request_id)
    }

    fn complete_if_ready(&self, request_id: &str) -> Result<(), String> {
        let completion = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            let Some(pending) = state.pending.as_mut() else {
                return Ok(());
            };
            if pending.request_id != request_id
                || pending.result_sender.is_none()
                || pending.responded_windows.len() != pending.expected_windows.len()
            {
                return Ok(());
            }
            let mut close_transition_windows = pending
                .close_transition_windows
                .iter()
                .cloned()
                .collect::<Vec<_>>();
            close_transition_windows.sort();
            let result = if close_transition_windows.is_empty() {
                let mut dirty_windows = pending.dirty_windows.iter().cloned().collect::<Vec<_>>();
                dirty_windows.sort();
                Ok(ExitPreflightOutcome::Ready(dirty_windows))
            } else {
                Ok(ExitPreflightOutcome::CloseTransitionActive)
            };
            pending.result_sender.take().map(|sender| (sender, result))
        };
        if let Some((sender, result)) = completion {
            let _ = sender.send(result);
        }
        Ok(())
    }

    fn abort(&self, request_id: &str, error: String) -> Result<(), String> {
        let aborted = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
            if state
                .pending
                .as_ref()
                .is_some_and(|pending| pending.request_id == request_id)
            {
                state.pending.take()
            } else {
                None
            }
        };
        if let Some(mut pending) = aborted {
            if let Some(sender) = pending.result_sender.take() {
                let _ = sender.send(Err(error));
            }
        }
        Ok(())
    }

    fn finish(&self, request_id: &str) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.request_id == request_id)
        {
            state.pending = None;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn finish_validation(
        &self,
        request_id: &str,
        live_windows: &HashSet<String>,
    ) -> Result<HashSet<String>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "exit preflight state lock is poisoned".to_string())?;
        let Some(pending) = state.pending.as_ref() else {
            return Err("Exit permit is no longer valid.".into());
        };
        if pending.request_id != request_id || pending.result_sender.is_some() {
            return Err("Exit permit is no longer valid.".into());
        }
        if &pending.expected_windows != live_windows {
            state.pending = None;
            return Err("The app window set changed during exit confirmation.".into());
        }
        let approved_dirty_windows = pending.approved_dirty_windows.as_ref().ok_or_else(|| {
            "Exit validation did not preserve the approved window state.".to_string()
        })?;
        let approved_revisions = pending.approved_revisions.as_ref().ok_or_else(|| {
            "Exit validation did not preserve the approved window revisions.".to_string()
        })?;
        let clean_window_changed = pending.expected_windows.iter().any(|label| {
            !approved_dirty_windows.contains(label)
                && (pending.dirty_windows.contains(label)
                    || approved_revisions.get(label) != pending.response_revisions.get(label))
        });
        if clean_window_changed {
            state.pending = None;
            return Err("Window contents changed during exit confirmation.".into());
        }
        let validated_windows = pending.expected_windows.clone();
        state.pending = None;
        Ok(validated_windows)
    }
}

fn pause_window_interaction<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<HashSet<String>, String> {
    let windows = app.webview_windows();
    let mut paused_window_labels = HashSet::new();
    for window in windows.values() {
        let enabled = match window.is_enabled() {
            Ok(enabled) => enabled,
            Err(error) => {
                let _ = restore_window_interaction(app, &paused_window_labels);
                return Err(format!(
                    "Could not inspect app interaction before exit for {}: {error}",
                    window.label()
                ));
            }
        };
        if !enabled {
            continue;
        }
        if let Err(error) = window.set_enabled(false) {
            let _ = restore_window_interaction(app, &paused_window_labels);
            return Err(format!(
                "Could not pause app interaction for exit for {}: {error}",
                window.label()
            ));
        }
        paused_window_labels.insert(window.label().to_string());
    }
    Ok(paused_window_labels)
}

fn restore_window_interaction<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paused_window_labels: &HashSet<String>,
) -> Result<(), String> {
    let errors = paused_window_labels
        .iter()
        .filter_map(|label| {
            app.get_webview_window(label).and_then(|window| {
                window
                    .set_enabled(true)
                    .err()
                    .map(|error| format!("{label}: {error}"))
            })
        })
        .collect::<Vec<_>>();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Could not restore app interaction after exit was cancelled: {}",
            errors.join(", ")
        ))
    }
}

pub(crate) async fn confirm_exit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    intent: ExitIntent,
    transition: &mut ExitTransition<R>,
) -> Result<Option<ExitPermit>, String> {
    let coordinator = app
        .try_state::<ExitPreflightCoordinator>()
        .ok_or_else(|| "exit preflight coordinator is not configured".to_string())?;
    let (request_id, receiver) = coordinator.begin(app)?;
    let dirty_result = match tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(EXIT_PREFLIGHT_RESPONSE_TIMEOUT)
    })
    .await
    {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(RecvTimeoutError::Timeout)) => {
            Err("Timed out while checking windows for unsaved changes.".to_string())
        }
        Ok(Err(RecvTimeoutError::Disconnected)) => {
            Err("Exit preflight ended before every window responded.".to_string())
        }
        Err(error) => {
            let _ = coordinator.finish(&request_id);
            return Err(error.to_string());
        }
    };
    let dirty_windows = match dirty_result {
        Ok(result) => match result {
            Ok(ExitPreflightOutcome::Ready(dirty_windows)) => dirty_windows,
            Ok(ExitPreflightOutcome::CloseTransitionActive) => {
                let _ = coordinator.finish(&request_id);
                return Ok(None);
            }
            Err(error) => {
                let _ = coordinator.finish(&request_id);
                return Err(error);
            }
        },
        Err(error) => {
            let _ = coordinator.finish(&request_id);
            return Err(error);
        }
    };
    if dirty_windows.is_empty() {
        if let Err(error) = transition.pause_window_interaction() {
            let _ = coordinator.finish(&request_id);
            return Err(error);
        }
        return Ok(Some(ExitPermit { request_id }));
    }

    let decision = match show_unsaved_changes_dialog(app, intent, &dirty_windows).await {
        Ok(decision) => decision,
        Err(error) => {
            let _ = coordinator.finish(&request_id);
            return Err(error);
        }
    };
    if decision == UnsavedChangesDecision::Proceed {
        if let Err(error) = transition.pause_window_interaction() {
            let _ = coordinator.finish(&request_id);
            return Err(error);
        }
        return Ok(Some(ExitPermit { request_id }));
    }

    coordinator.finish(&request_id)?;
    if decision == UnsavedChangesDecision::Review {
        focus_dirty_window(app, &dirty_windows);
    }
    Ok(None)
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum UnsavedChangesDecision {
    Proceed,
    Review,
    Cancel,
}

async fn show_unsaved_changes_dialog<R: Runtime>(
    app: &tauri::AppHandle<R>,
    intent: ExitIntent,
    dirty_windows: &[String],
) -> Result<UnsavedChangesDecision, String> {
    const REVIEW_LABEL: &str = "Review Unsaved Changes…";
    let discard_label = intent.discard_label().to_string();
    let (sender, receiver) = sync_channel(1);
    let mut dialog = app
        .dialog()
        .message(intent.message())
        .title("Unsaved Changes")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            REVIEW_LABEL.into(),
            discard_label.clone(),
            "Cancel".into(),
        ));
    if let Some(window) = dirty_windows
        .iter()
        .find_map(|label| app.get_webview_window(label))
    {
        dialog = dialog.parent(&window);
    }
    dialog.show_with_result(move |result| {
        let _ = sender.send(result);
    });
    let result = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|_| "Unsaved changes dialog closed without a decision.".to_string())?;
    let review = result == MessageDialogResult::Yes
        || matches!(&result, MessageDialogResult::Custom(label) if label == REVIEW_LABEL);
    if review {
        return Ok(UnsavedChangesDecision::Review);
    }

    if result == MessageDialogResult::No
        || matches!(&result, MessageDialogResult::Custom(label) if label == &discard_label)
    {
        Ok(UnsavedChangesDecision::Proceed)
    } else {
        Ok(UnsavedChangesDecision::Cancel)
    }
}

fn focus_dirty_window<R: Runtime>(app: &tauri::AppHandle<R>, dirty_windows: &[String]) {
    if let Some(window) = dirty_windows
        .iter()
        .find_map(|label| app.get_webview_window(label))
    {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub(crate) fn authorize_exit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    permit: ValidatedExitPermit,
) -> Result<(), String> {
    let live_windows = app
        .webview_windows()
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    if permit.live_windows != live_windows {
        return Err("The app window set changed after exit validation.".into());
    }
    let guard = app
        .try_state::<QuitGuard>()
        .ok_or_else(|| "quit guard is not configured".to_string())?;
    guard.authorize_exit()
}

pub(crate) async fn validate_exit_permit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    permit: ExitPermit,
) -> Result<Option<ValidatedExitPermit>, String> {
    let coordinator = app
        .try_state::<ExitPreflightCoordinator>()
        .ok_or_else(|| "exit preflight coordinator is not configured".to_string())?;
    let receiver = match coordinator.begin_validation(app, &permit.request_id) {
        Ok(receiver) => receiver,
        Err(error) => {
            let _ = coordinator.finish(&permit.request_id);
            return Err(error);
        }
    };
    let validation = match tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(EXIT_PREFLIGHT_RESPONSE_TIMEOUT)
    })
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(RecvTimeoutError::Timeout)) => {
            let _ = coordinator.finish(&permit.request_id);
            return Err("Timed out while rechecking windows before exit.".into());
        }
        Ok(Err(RecvTimeoutError::Disconnected)) => {
            let _ = coordinator.finish(&permit.request_id);
            return Err("Exit validation ended before every window responded.".into());
        }
        Err(error) => {
            let _ = coordinator.finish(&permit.request_id);
            return Err(error.to_string());
        }
    };
    match validation {
        Ok(ExitPreflightOutcome::Ready(_)) => {}
        Ok(ExitPreflightOutcome::CloseTransitionActive) => {
            let _ = coordinator.finish(&permit.request_id);
            return Ok(None);
        }
        Err(error) => {
            let _ = coordinator.finish(&permit.request_id);
            return Err(error);
        }
    }
    let live_windows = app
        .webview_windows()
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    coordinator
        .finish_validation(&permit.request_id, &live_windows)
        .map(|live_windows| Some(ValidatedExitPermit { live_windows }))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SystemQuitRequest {
    Authorized,
    Busy,
    Pending,
}

#[derive(Clone, Copy)]
enum QuitOrigin {
    Menu,
    AppKit,
}

pub(crate) fn request_system_quit<R: Runtime>(app: &tauri::AppHandle<R>) -> SystemQuitRequest {
    match begin_quit_request(app) {
        Some(QuitRequestStart::Authorized) => SystemQuitRequest::Authorized,
        Some(QuitRequestStart::Busy) | None => SystemQuitRequest::Busy,
        Some(QuitRequestStart::InProgress) => SystemQuitRequest::Busy,
        Some(QuitRequestStart::Started) => {
            spawn_quit_flow(app, QuitOrigin::AppKit);
            SystemQuitRequest::Pending
        }
    }
}

pub(crate) fn request_quit<R: Runtime>(app: &tauri::AppHandle<R>) {
    match begin_quit_request(app) {
        Some(QuitRequestStart::Authorized) => {
            #[cfg(target_os = "macos")]
            match crate::macos::reply_to_pending_termination(app, true) {
                Ok(true) => return,
                Ok(false) => {}
                Err(error) => {
                    revoke_exit_authorization(app);
                    show_exit_error(app, error);
                    return;
                }
            }
            app.exit(0);
        }
        Some(QuitRequestStart::Started) => spawn_quit_flow(app, QuitOrigin::Menu),
        Some(QuitRequestStart::Busy | QuitRequestStart::InProgress) | None => {}
    }
}

fn begin_quit_request<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<QuitRequestStart> {
    app.try_state::<QuitGuard>()
        .map(|guard| guard.begin_quit_request())
}

fn spawn_quit_flow<R: Runtime>(app: &tauri::AppHandle<R>, origin: QuitOrigin) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        #[cfg(not(target_os = "macos"))]
        let _ = origin;
        #[cfg(target_os = "macos")]
        let mut pending_termination_reply = match origin {
            QuitOrigin::Menu => None,
            QuitOrigin::AppKit => Some(crate::macos::PendingTerminationReply::new(&app_handle)),
        };
        let mut transition = match ExitTransition::acquire_for_quit(&app_handle) {
            Ok(transition) => transition,
            Err(error) => {
                if let Some(guard) = app_handle.try_state::<QuitGuard>() {
                    guard.finish_prompt();
                }
                show_exit_error(&app_handle, error);
                return;
            }
        };
        let decision = confirm_exit(&app_handle, ExitIntent::Quit, &mut transition).await;
        if let Some(guard) = app_handle.try_state::<QuitGuard>() {
            guard.finish_prompt();
        }
        let exit_authorized = match decision {
            Ok(Some(permit)) => match validate_exit_permit(&app_handle, permit).await {
                Ok(Some(validated)) => match authorize_exit(&app_handle, validated) {
                    Ok(()) => true,
                    Err(error) => {
                        show_exit_error(&app_handle, error);
                        false
                    }
                },
                Ok(None) => false,
                Err(error) => {
                    show_exit_error(&app_handle, error);
                    false
                }
            },
            Ok(None) => false,
            Err(error) => {
                show_exit_error(&app_handle, error);
                false
            }
        };
        if exit_authorized {
            #[cfg(target_os = "macos")]
            if matches!(origin, QuitOrigin::AppKit) {
                let Some(pending_termination_reply) = pending_termination_reply.as_mut() else {
                    revoke_exit_authorization(&app_handle);
                    show_exit_error(
                        &app_handle,
                        "The pending macOS termination request was lost.".into(),
                    );
                    return;
                };
                match pending_termination_reply.allow() {
                    Ok(true) => {
                        transition.keep_paused();
                        return;
                    }
                    Ok(false) => {
                        revoke_exit_authorization(&app_handle);
                        show_exit_error(
                            &app_handle,
                            "The pending macOS termination request was lost.".into(),
                        );
                        return;
                    }
                    Err(error) => {
                        revoke_exit_authorization(&app_handle);
                        show_exit_error(&app_handle, error);
                        return;
                    }
                }
            }
            transition.keep_paused();
            app_handle.exit(0);
        }
    });
}

fn revoke_exit_authorization<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(guard) = app.try_state::<QuitGuard>() {
        guard.revoke_exit_authorization();
    }
}

pub(crate) fn should_prevent_exit<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.try_state::<QuitGuard>()
        .is_none_or(|guard| !guard.exit_is_authorized())
}

pub(crate) fn exit_transition_is_active<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.try_state::<QuitGuard>()
        .is_some_and(|guard| guard.transition_is_active())
}

fn show_exit_error<R: Runtime>(app: &tauri::AppHandle<R>, error: String) {
    app.dialog()
        .message(format!(
            "Burette could not verify unsaved changes.\n\n{error}"
        ))
        .title("Quit Cancelled")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

pub(crate) fn register_exit_preflight_listener<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) -> Result<String, String> {
    app.try_state::<ExitPreflightCoordinator>()
        .ok_or_else(|| "exit preflight coordinator is not configured".to_string())?
        .register(window.label())
}

pub(crate) fn unregister_exit_preflight_listener<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    registration_id: String,
) -> Result<(), String> {
    app.try_state::<ExitPreflightCoordinator>()
        .ok_or_else(|| "exit preflight coordinator is not configured".to_string())?
        .unregister(window.label(), &registration_id)
}

pub(crate) fn respond_to_exit_preflight<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request_id: String,
    close_transition_active: bool,
    dirty: bool,
    revision: u64,
) -> Result<(), String> {
    app.try_state::<ExitPreflightCoordinator>()
        .ok_or_else(|| "exit preflight coordinator is not configured".to_string())?
        .respond(
            &request_id,
            window.label(),
            close_transition_active,
            dirty,
            revision,
        )
}

pub(crate) fn window_destroyed<R: Runtime>(app: &tauri::AppHandle<R>, window_label: &str) {
    if let Some(coordinator) = app.try_state::<ExitPreflightCoordinator>() {
        let _ = coordinator.window_destroyed(window_label);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ExitPreflightCoordinator, ExitPreflightOutcome, ExitPreflightReceiver, PendingExitPreflight,
    };
    use crate::menu::state::{QuitGuard, QuitRequestStart};
    use std::collections::{HashMap, HashSet};
    use std::sync::mpsc::sync_channel;

    #[test]
    fn quit_prompt_claim_blocks_a_competing_update_transition() {
        let guard = QuitGuard::default();
        assert_eq!(guard.begin_quit_request(), QuitRequestStart::Started);
        assert_eq!(guard.begin_quit_request(), QuitRequestStart::InProgress);
        assert!(!guard.begin_transition(false));
        assert!(guard.begin_transition(true));
        assert_eq!(guard.begin_quit_request(), QuitRequestStart::Busy);
        guard.finish_prompt();
        guard.finish_transition();
        assert_eq!(guard.begin_quit_request(), QuitRequestStart::Started);
    }

    #[test]
    fn revoked_exit_authorization_requires_a_fresh_quit_request() {
        let guard = QuitGuard::default();
        guard.authorize_exit().expect("authorize exit");
        assert_eq!(guard.begin_quit_request(), QuitRequestStart::Authorized);

        guard.revoke_exit_authorization();

        assert_eq!(guard.begin_quit_request(), QuitRequestStart::Started);
    }

    fn pending(
        coordinator: &ExitPreflightCoordinator,
        request_id: &str,
        labels: &[&str],
    ) -> ExitPreflightReceiver {
        let (sender, receiver) = sync_channel(1);
        coordinator.state.lock().expect("state").pending = Some(PendingExitPreflight {
            request_id: request_id.into(),
            expected_windows: labels.iter().map(|label| (*label).to_string()).collect(),
            responded_windows: HashSet::new(),
            close_transition_windows: HashSet::new(),
            dirty_windows: HashSet::new(),
            response_revisions: HashMap::new(),
            approved_dirty_windows: None,
            approved_revisions: None,
            result_sender: Some(sender),
        });
        receiver
    }

    fn validation(coordinator: &ExitPreflightCoordinator) -> ExitPreflightReceiver {
        let (sender, receiver) = sync_channel(1);
        let mut state = coordinator.state.lock().expect("state");
        let pending = state.pending.as_mut().expect("pending preflight");
        pending.approved_dirty_windows = Some(pending.dirty_windows.clone());
        pending.approved_revisions = Some(pending.response_revisions.clone());
        pending.responded_windows.clear();
        pending.close_transition_windows.clear();
        pending.dirty_windows.clear();
        pending.response_revisions.clear();
        pending.result_sender = Some(sender);
        receiver
    }

    fn ready(receiver: ExitPreflightReceiver, context: &'static str) -> Vec<String> {
        match receiver.recv().expect(context).expect("success") {
            ExitPreflightOutcome::Ready(windows) => windows,
            ExitPreflightOutcome::CloseTransitionActive => {
                panic!("unexpected active close transition")
            }
        }
    }

    #[test]
    fn waits_for_every_window_and_aggregates_dirty_responses() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main", "workspace"]);

        coordinator
            .respond("request", "main", false, false, 1)
            .expect("first response");
        assert!(receiver.try_recv().is_err());
        coordinator
            .respond("request", "workspace", false, true, 4)
            .expect("second response");

        assert_eq!(ready(receiver, "completion"), vec!["workspace"]);
    }

    #[test]
    fn treats_an_active_window_close_confirmation_as_a_benign_cancellation() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main"]);

        coordinator
            .respond("request", "main", true, true, 1)
            .expect("close transition response");

        assert_eq!(
            receiver.recv().expect("completion").expect("success"),
            ExitPreflightOutcome::CloseTransitionActive
        );
    }

    #[test]
    fn ignores_stale_and_duplicate_responses() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "current", &["main", "workspace"]);

        coordinator
            .respond("stale", "main", false, true, 1)
            .expect("stale response");
        coordinator
            .respond("current", "main", false, false, 2)
            .expect("current response");
        coordinator
            .respond("current", "main", false, true, 3)
            .expect("duplicate response");
        assert!(receiver.try_recv().is_err());
        coordinator
            .respond("current", "workspace", false, false, 4)
            .expect("final response");

        assert!(ready(receiver, "completion").is_empty());
    }

    #[test]
    fn destroyed_window_no_longer_blocks_completion() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main", "workspace"]);

        coordinator
            .respond("request", "main", false, true, 1)
            .expect("main response");
        coordinator
            .window_destroyed("workspace")
            .expect("destroy window");

        assert_eq!(ready(receiver, "completion"), vec!["main"]);
    }

    #[test]
    fn abandoned_preflight_can_be_finished_before_retry() {
        let coordinator = ExitPreflightCoordinator::default();
        let abandoned = pending(&coordinator, "abandoned", &["main"]);

        assert!(coordinator.finish("abandoned").expect("finish abandoned"));
        assert!(abandoned.recv().is_err());

        let retry = pending(&coordinator, "retry", &["main"]);
        coordinator
            .respond("retry", "main", false, false, 1)
            .expect("retry response");
        assert!(ready(retry, "retry completion").is_empty());
    }

    #[test]
    fn validation_rejects_a_window_created_after_preflight() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main"]);
        coordinator
            .respond("request", "main", false, false, 1)
            .expect("preflight response");
        assert!(ready(receiver, "completion").is_empty());

        let validation = validation(&coordinator);
        coordinator
            .respond("request", "main", false, false, 1)
            .expect("validation response");
        assert!(ready(validation, "validation completion").is_empty());
        let live_windows = HashSet::from(["main".to_string(), "workspace-new".to_string()]);
        assert!(coordinator
            .finish_validation("request", &live_windows)
            .expect_err("changed window set must fail")
            .contains("window set changed"));
        assert!(!coordinator.finish("request").expect("permit removed"));
    }

    #[test]
    fn validation_rejects_dirty_revision_changed_after_clean_preflight() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main"]);
        coordinator
            .respond("request", "main", false, false, 7)
            .expect("preflight response");
        assert!(ready(receiver, "completion").is_empty());

        let validation = validation(&coordinator);
        coordinator
            .respond("request", "main", false, true, 8)
            .expect("validation response");
        assert_eq!(ready(validation, "validation completion"), vec!["main"]);
        let live_windows = HashSet::from(["main".to_string()]);
        assert!(coordinator
            .finish_validation("request", &live_windows)
            .expect_err("changed contents must fail")
            .contains("contents changed"));
    }

    #[test]
    fn validation_accepts_stable_window_revisions() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main"]);
        coordinator
            .respond("request", "main", false, true, 9)
            .expect("preflight response");
        assert_eq!(ready(receiver, "completion"), vec!["main"]);

        let validation = validation(&coordinator);
        coordinator
            .respond("request", "main", false, true, 9)
            .expect("validation response");
        assert_eq!(ready(validation, "validation completion"), vec!["main"]);
        let live_windows = HashSet::from(["main".to_string()]);
        assert_eq!(
            coordinator
                .finish_validation("request", &live_windows)
                .expect("stable validation"),
            live_windows
        );
    }

    #[test]
    fn validation_accepts_new_changes_after_discard_was_approved() {
        let coordinator = ExitPreflightCoordinator::default();
        let receiver = pending(&coordinator, "request", &["main"]);
        coordinator
            .respond("request", "main", false, true, 10)
            .expect("preflight response");
        assert_eq!(ready(receiver, "completion"), vec!["main"]);

        let validation = validation(&coordinator);
        coordinator
            .respond("request", "main", false, true, 11)
            .expect("validation response");
        assert_eq!(ready(validation, "validation completion"), vec!["main"]);
        let live_windows = HashSet::from(["main".to_string()]);
        assert_eq!(
            coordinator
                .finish_validation("request", &live_windows)
                .expect("approved dirty window may continue changing"),
            live_windows
        );
    }

    #[test]
    fn unregister_removes_only_its_listener_generation() {
        let coordinator = ExitPreflightCoordinator::default();
        let first = coordinator.register("main").expect("first registration");
        let second = coordinator.register("main").expect("second registration");

        coordinator
            .unregister("main", &first)
            .expect("unregister first");
        assert!(coordinator
            .state
            .lock()
            .expect("state")
            .registered_windows
            .contains_key("main"));

        coordinator
            .unregister("main", &second)
            .expect("unregister second");
        assert!(!coordinator
            .state
            .lock()
            .expect("state")
            .registered_windows
            .contains_key("main"));
    }
}
