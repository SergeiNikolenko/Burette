//! Voluntary usage statistics. Consent and the queue are owned by the native
//! process, shared by all windows. Nothing reads or uploads the local logs.
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime};
use uuid::Uuid;

#[cfg(test)]
mod tests;
mod transport;

const CONSENT_VERSION: &str = "2026-10-20";
const MAX_PENDING: usize = 64;
const MAX_ATTEMPTS: u8 = 3;
const CHANGED: &str = "statistics-consent-changed";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub(crate) enum StatisticsEvent {
    Active(Activity),
    Feature(Feature),
    Error(ErrorCategory),
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Activity {
    Day,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Feature {
    Structure,
    Table,
    Editor,
    Trajectory,
    Docking,
    Compute,
    Files,
    Export,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ErrorCategory {
    Network,
    Parse,
    Render,
    Timeout,
    Permission,
    Unsupported,
    Unknown,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct Consent {
    decided: bool,
    enabled: bool,
    version: String,
    installation_id: Option<Uuid>,
    pending_erasure: bool,
    destination: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatisticsStatus {
    available: bool,
    decided: bool,
    enabled: bool,
    pending_erasure: bool,
    notice_url: Option<String>,
}

struct Batch {
    id: Uuid,
    events: Vec<StatisticsEvent>,
    attempts: u8,
}

struct State {
    path: PathBuf,
    endpoint: Option<String>,
    notice_url: Option<String>,
    consent: Consent,
    pending: Vec<StatisticsEvent>,
    batch: Option<Batch>,
}

pub(crate) struct Telemetry(Mutex<State>);

fn https_url(value: Option<&str>) -> Option<String> {
    let url = url::Url::parse(value?).ok()?;
    (url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none())
    .then(|| url.as_str().trim_end_matches('/').to_string())
}

impl State {
    fn load(path: PathBuf, endpoint: Option<String>, notice_url: Option<String>) -> Self {
        // Missing/corrupt preferences never imply permission.
        let mut consent: Consent = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        if consent.version != CONSENT_VERSION
            || (consent.installation_id.is_some() && consent.destination != endpoint)
        {
            consent.enabled = false;
            consent.decided = false;
            consent.pending_erasure = consent.installation_id.is_some();
        }
        if !consent.decided || consent.installation_id.is_none() || consent.pending_erasure {
            consent.enabled = false;
        }
        Self {
            path,
            endpoint,
            notice_url,
            consent,
            pending: Vec::new(),
            batch: None,
        }
    }

    fn status(&self) -> StatisticsStatus {
        let available = self.endpoint.is_some() && self.notice_url.is_some();
        StatisticsStatus {
            available,
            decided: self.consent.decided,
            enabled: available && self.consent.enabled,
            pending_erasure: self.consent.pending_erasure,
            notice_url: self.notice_url.clone(),
        }
    }

    fn persist(&self, consent: &Consent) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Statistics storage is unavailable.")?;
        fs::create_dir_all(parent).map_err(|_| "Could not save statistics preference.")?;
        let temporary = self.path.with_extension("tmp");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        use std::io::Write;
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Could not save statistics preference.")?;
        file.write_all(
            &serde_json::to_vec(consent).map_err(|_| "Could not save statistics preference.")?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not save statistics preference.")?;
        fs::rename(temporary, &self.path)
            .map_err(|_| "Could not save statistics preference.".to_string())
    }

    fn choose(&mut self, enabled: bool) -> Result<(), String> {
        if enabled && (!self.status().available || self.consent.pending_erasure) {
            return Err("Statistics are unavailable while setup or deletion is pending.".into());
        }
        let mut next = self.consent.clone();
        next.decided = true;
        next.enabled = enabled;
        next.version = CONSENT_VERSION.into();
        if enabled {
            next.installation_id.get_or_insert_with(Uuid::new_v4);
            next.destination = self.endpoint.clone();
        } else {
            next.pending_erasure = next.installation_id.is_some();
        }
        // Stop in-memory collection even if writing the withdrawal fails.
        if !enabled {
            self.pending.clear();
            self.batch = None;
            self.consent = next.clone();
        }
        self.persist(&next)?;
        self.consent = next;
        Ok(())
    }

    fn record(&mut self, event: StatisticsEvent) {
        if !self.status().enabled || self.pending.len() >= MAX_PENDING {
            return;
        }
        if matches!(event, StatisticsEvent::Active(_)) && self.pending.contains(&event) {
            return;
        }
        self.pending.push(event);
    }

    fn flush(
        &mut self,
        version: &str,
        send: impl Fn(&str, &serde_json::Value) -> Result<String, String>,
    ) -> Result<(), String> {
        let destination = if self.consent.pending_erasure {
            https_url(self.consent.destination.as_deref())
        } else {
            self.endpoint.clone()
        };
        let Some(endpoint) = destination else {
            return Ok(());
        };
        let Some(id) = self.consent.installation_id else {
            return Ok(());
        };
        if self.consent.pending_erasure {
            // Make withdrawal durable before acknowledging deletion or forgetting
            // the credential. A failed preference write remains retryable.
            self.persist(&self.consent)?;
            send(
                &format!("{endpoint}/erase"),
                &json!({ "installationId": id }),
            )?;
            let next = Consent {
                installation_id: None,
                pending_erasure: false,
                ..self.consent.clone()
            };
            self.persist(&next)?;
            self.consent = next;
            return Ok(());
        }
        if !self.status().enabled {
            return Ok(());
        }
        if self.batch.is_none() && !self.pending.is_empty() {
            self.batch = Some(Batch {
                id: Uuid::new_v4(),
                events: std::mem::take(&mut self.pending),
                attempts: 0,
            });
        }
        let Some(batch) = &mut self.batch else {
            return Ok(());
        };
        batch.attempts += 1;
        let result = send(
            &format!("{endpoint}/events"),
            &json!({
                "installationId": id,
                "consentVersion": CONSENT_VERSION,
                "batchId": batch.id,
                "appVersion": version,
                "architecture": if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" },
                "events": batch.events,
            }),
        );
        if result.is_ok() || batch.attempts >= MAX_ATTEMPTS {
            self.batch = None;
        }
        result.map(|_| ())
    }
}

pub(crate) fn initialize<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let directory = app.path().app_data_dir().ok();
    let endpoint = directory
        .as_ref()
        .and_then(|_| https_url(option_env!("BURETTE_TELEMETRY_URL")));
    let path = directory
        .map(|path| path.join("statistics-consent.json"))
        .unwrap_or_default();
    app.manage(Telemetry(Mutex::new(State::load(
        path,
        endpoint,
        https_url(option_env!("BURETTE_TELEMETRY_NOTICE_URL")),
    ))));
    Ok(())
}

// Blocking network I/O runs outside Tauri's event loop. The shared lock orders
// sending and withdrawal: after withdrawal returns, no older upload can start.
async fn with_state<R, T, F>(app: tauri::AppHandle<R>, operation: F) -> Result<T, String>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(&mut State) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let telemetry = app.state::<Telemetry>();
        let mut state = telemetry
            .0
            .lock()
            .map_err(|_| "Statistics are unavailable.")?;
        operation(&mut state)
    })
    .await
    .map_err(|_| "Statistics are unavailable.")?
}

#[tauri::command]
pub(crate) async fn statistics_status<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<StatisticsStatus, String> {
    with_state(app, |state| Ok(state.status())).await
}

#[tauri::command]
pub(crate) async fn statistics_consent<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<StatisticsStatus, String> {
    let result = with_state(app.clone(), move |state| {
        state.choose(enabled)?;
        Ok(state.status())
    })
    .await;
    let _ = app.emit(CHANGED, ());
    result
}

#[tauri::command]
pub(crate) async fn statistics_record<R: Runtime>(
    app: tauri::AppHandle<R>,
    event: StatisticsEvent,
) -> Result<(), String> {
    with_state(app, move |state| {
        state.record(event);
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn statistics_flush<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let version = app.package_info().version.to_string();
    let result = with_state(app.clone(), move |state| {
        state.flush(&version, transport::send)
    })
    .await;
    let _ = app.emit(CHANGED, ());
    result
}

#[tauri::command]
pub(crate) async fn statistics_export<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    with_state(app, |state| {
        let id = state
            .consent
            .installation_id
            .ok_or("No shared statistics.")?;
        let endpoint =
            https_url(state.consent.destination.as_deref()).ok_or("Statistics are unavailable.")?;
        transport::send(
            &format!("{endpoint}/export"),
            &json!({ "installationId": id }),
        )
    })
    .await
}
