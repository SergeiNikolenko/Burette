//! External energy models for geometry optimization on the desktop: xTB
//! (GFN2-xTB, GFN1-xTB, GFN-FF) and the energy models installed Avogadro
//! packages declare. A session belongs to the window that opened it, keeps its
//! model process or scratch folder until it is closed, and dies with the
//! window or the app. Each evaluation returns the energy in kcal/mol and its
//! gradient in kcal/(mol·Å).
//!
//! The webview names a model by id; the executable, identifier, protocol and
//! input format come from the resolved xTB runtime or the installed package's
//! own manifest, never from the request.

mod manifest;
mod script;
mod xtb;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Runtime;

use manifest::DeclaredModel;
use script::ScriptSession;
use xtb::{XtbMethod, XtbSession};

pub(crate) const CANCELLED: &str = "Cancelled";
pub(crate) const KJ_PER_KCAL: f64 = 4.184;
/// The optimizer's Cartesian bound (`OPTIMIZATION_LIMITS.graphAtoms`).
const MAX_ATOMS: usize = 256;
/// Each session may hold a running process.
const MAX_SESSIONS: usize = 8;
const MAX_BOOTSTRAP_BYTES: usize = 4 * 1024 * 1024;
/// A batch covers the central differences of the 64 atoms the optimizer
/// differentiates numerically (6 · 64 sets) with room to spare.
const MAX_BATCH_SETS: usize = 1024;
const MAX_BATCH_BYTES: usize = 4 * 1024 * 1024;
const XTB_PREFIX: &str = "xtb:";
const AVOGADRO_PREFIX: &str = "avogadro:";

#[derive(Debug, PartialEq, Serialize)]
pub(crate) struct Evaluation {
    /// Non-finite values reach the webview as `null`; the optimizer rejects them.
    pub(crate) energy: f64,
    pub(crate) gradient: Option<Vec<f64>>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalModel {
    /// `xtb:<method>` or `avogadro:<package>/<identifier>`.
    id: String,
    name: String,
    description: String,
    /// `xtb`, or the Avogadro package that declares the model.
    source: String,
    /// The molecule format the model reads at start-up; none for xTB.
    input_format: Option<String>,
    gradients: bool,
    ions: bool,
    radicals: bool,
    unit_cell: bool,
    /// Energies of many coordinate sets in one request.
    batch: bool,
    /// Supported atomic numbers.
    elements: Vec<u8>,
    /// Why the model cannot run yet.
    unavailable: Option<String>,
}

fn xtb_model(method: XtbMethod) -> ExternalModel {
    ExternalModel {
        id: format!("{XTB_PREFIX}{}", method.id()),
        name: method.name().into(),
        description: format!("{} through the xTB program", method.name()),
        source: "xtb".into(),
        input_format: None,
        gradients: true,
        ions: true,
        // GFN-FF has no open-shell treatment.
        radicals: method != XtbMethod::Gfnff,
        unit_cell: false,
        batch: false,
        elements: (1..=86).collect(),
        unavailable: None,
    }
}

fn plugin_model(
    package: &str,
    model: &DeclaredModel,
    unavailable: Option<String>,
) -> ExternalModel {
    ExternalModel {
        id: format!("{AVOGADRO_PREFIX}{package}/{}", model.identifier),
        name: model.name.clone(),
        description: model.description.clone(),
        source: package.into(),
        input_format: Some(model.input_format.clone()),
        gradients: model.gradients,
        ions: model.ions,
        radicals: model.radicals,
        unit_cell: model.unit_cell,
        batch: model.batch,
        elements: model.elements.clone(),
        unavailable,
    }
}

/// The declared models of every installed package; packages without a pixi
/// environment are listed with the reason they cannot run.
fn plugin_models(root: &std::path::Path) -> Vec<ExternalModel> {
    let mut models = Vec::new();
    for plugin in crate::commands::avogadro_plugins::installed(root) {
        let package = &plugin.receipt.name;
        let manifest = manifest::read(&plugin.pyproject, package);
        let unavailable = if manifest.script.is_none() {
            Some(format!("{package} declares no avogadro-* command"))
        } else if !plugin.prepared {
            Some(format!("Set up {package} in Settings › Extensions first"))
        } else {
            None
        };
        models.extend(
            manifest
                .models
                .iter()
                .map(|model| plugin_model(package, model, unavailable.clone())),
        );
    }
    models
}

#[tauri::command(async)]
pub(crate) fn energy_models_list<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ExternalModel>, String> {
    let mut models = Vec::new();
    if crate::commands::xtb_runtime::resolve(&app).is_ok() {
        models.extend(XtbMethod::ALL.map(xtb_model));
    }
    models.extend(plugin_models(
        &crate::commands::avogadro_plugins::plugins_root(&app)?,
    ));
    Ok(models)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    model: String,
    /// Element symbols in the order coordinates follow.
    elements: Vec<String>,
    charge: i32,
    multiplicity: u32,
    /// Avogadro models: the start-up JSON line with the molecule in the
    /// model's input format.
    bootstrap: Option<String>,
}

enum Backend {
    Xtb(XtbSession),
    Script(ScriptSession),
}

struct Session {
    owner: String,
    atoms: usize,
    /// The model answers binary-v1 batch requests.
    batch: bool,
    cancel: AtomicBool,
    backend: Mutex<Backend>,
}

static SESSIONS: Mutex<Option<HashMap<String, Arc<Session>>>> = Mutex::new(None);

fn valid_element(symbol: &str) -> bool {
    let mut chars = symbol.chars();
    chars.next().is_some_and(|c| c.is_ascii_uppercase())
        && symbol.len() <= 3
        && chars.all(|c| c.is_ascii_lowercase())
}

fn validate(request: &OpenRequest) -> Result<(), String> {
    if request.elements.is_empty() || request.elements.len() > MAX_ATOMS {
        return Err(format!(
            "External energy models support 1–{MAX_ATOMS} atoms"
        ));
    }
    if !request
        .elements
        .iter()
        .all(|element| valid_element(element))
    {
        return Err("Invalid element symbol".into());
    }
    if request.charge.abs() > 64 || !(1..=32).contains(&request.multiplicity) {
        return Err("Invalid charge or spin multiplicity".into());
    }
    Ok(())
}

/// Starts the model `request` names, resolving everything it runs natively;
/// also whether it answers batch requests.
fn open_backend(
    request: OpenRequest,
    xtb: impl FnOnce() -> Result<std::path::PathBuf, String>,
    plugins: &std::path::Path,
) -> Result<(Backend, bool), String> {
    validate(&request)?;
    if let Some(method) = request.model.strip_prefix(XTB_PREFIX) {
        let method = XtbMethod::ALL
            .into_iter()
            .find(|candidate| candidate.id() == method)
            .ok_or("Unknown xTB method")?;
        return XtbSession::new(
            xtb()?,
            method,
            request.elements,
            request.charge,
            request.multiplicity,
        )
        .map(|session| (Backend::Xtb(session), false));
    }
    let (package, identifier) = request
        .model
        .strip_prefix(AVOGADRO_PREFIX)
        .and_then(|rest| rest.split_once('/'))
        .ok_or("Unknown energy model")?;
    let plugin = crate::commands::avogadro_plugins::installed(plugins)
        .into_iter()
        .find(|plugin| plugin.receipt.name == package)
        .ok_or("This plugin is not installed")?;
    let declared = manifest::read(&plugin.pyproject, package);
    let model = declared
        .models
        .iter()
        .find(|model| model.identifier == identifier)
        .ok_or("The plugin does not declare this energy model")?;
    let script = declared
        .script
        .ok_or("The plugin declares no avogadro-* command")?;
    let bootstrap = request
        .bootstrap
        .ok_or("The energy model needs the molecule")?;
    if bootstrap.len() > MAX_BOOTSTRAP_BYTES
        || bootstrap.contains('\n')
        || serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&bootstrap).is_err()
    {
        return Err("Invalid energy model input".into());
    }
    let command = crate::commands::avogadro_plugins::package_command(plugins, package, &script)?;
    ScriptSession::start(
        command,
        &model.identifier,
        model.protocol,
        model.gradients,
        &bootstrap,
        request.elements.len(),
    )
    .map(|session| (Backend::Script(session), model.batch))
}

fn register(
    owner: &str,
    atoms: usize,
    (backend, batch): (Backend, bool),
) -> Result<String, String> {
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| "The energy model registry is unavailable".to_string())?;
    let sessions = sessions.get_or_insert_with(HashMap::new);
    if sessions.len() >= MAX_SESSIONS {
        return Err("Too many energy model sessions are open".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    sessions.insert(
        id.clone(),
        Arc::new(Session {
            owner: owner.into(),
            atoms,
            batch,
            cancel: AtomicBool::new(false),
            backend: Mutex::new(backend),
        }),
    );
    Ok(id)
}

fn session(owner: &str, id: &str) -> Result<Arc<Session>, String> {
    SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.as_ref()?.get(id).cloned())
        .filter(|session| session.owner == owner)
        .ok_or_else(|| "This energy model session is closed".to_string())
}

fn evaluate(owner: &str, id: &str, coordinates: &[f64]) -> Result<Evaluation, String> {
    let session = session(owner, id)?;
    if coordinates.len() != 3 * session.atoms || !coordinates.iter().all(|v| v.is_finite()) {
        return Err("Energy coordinates must be finite and match the structure".into());
    }
    let mut backend = session
        .backend
        .lock()
        .map_err(|_| "This energy model session failed".to_string())?;
    match &mut *backend {
        Backend::Xtb(xtb) => xtb.evaluate(coordinates, &session.cancel),
        Backend::Script(script) => script.evaluate(coordinates, &session.cancel),
    }
}

/// Energies of `coordinates.len() / (3 · atoms)` coordinate sets in one request,
/// for models that declare batch support.
fn evaluate_batch(owner: &str, id: &str, coordinates: &[f64]) -> Result<Vec<f64>, String> {
    let session = session(owner, id)?;
    if !session.batch {
        return Err("This energy model does not evaluate batches".into());
    }
    let size = 3 * session.atoms;
    let sets = coordinates.len() / size;
    if coordinates.is_empty()
        || coordinates.len() % size != 0
        || sets > MAX_BATCH_SETS
        || 8 * coordinates.len() > MAX_BATCH_BYTES
        || !coordinates.iter().all(|v| v.is_finite())
    {
        return Err(
            "Batch coordinates must be finite, match the structure and fit one request".into(),
        );
    }
    let mut backend = session
        .backend
        .lock()
        .map_err(|_| "This energy model session failed".to_string())?;
    match &mut *backend {
        Backend::Script(script) => script.evaluate_energies(coordinates, sets, &session.cancel),
        Backend::Xtb(_) => Err("This energy model does not evaluate batches".into()),
    }
}

/// Removes the matching sessions and cancels their evaluations; each model
/// process stops once its last evaluation returns.
fn close_where(keep: impl Fn(&str, &Session) -> bool) {
    let removed: Vec<_> = SESSIONS
        .lock()
        .map(|mut sessions| {
            let Some(sessions) = sessions.as_mut() else {
                return Vec::new();
            };
            let ids: Vec<_> = sessions
                .iter()
                .filter(|(id, session)| !keep(id, session))
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        })
        .unwrap_or_default();
    for session in &removed {
        session.cancel.store(true, Ordering::Relaxed);
    }
}

#[tauri::command(async)]
pub(crate) fn energy_model_open<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: OpenRequest,
) -> Result<String, String> {
    let atoms = request.elements.len();
    let plugins = crate::commands::avogadro_plugins::plugins_root(&app)?;
    let backend = open_backend(
        request,
        || crate::commands::xtb_runtime::resolve(&app).map(|xtb| xtb.executable_path),
        &plugins,
    )?;
    register(window.label(), atoms, backend)
}

#[tauri::command(async)]
pub(crate) fn energy_model_evaluate<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    session: String,
    coordinates: Vec<f64>,
) -> Result<Evaluation, String> {
    evaluate(window.label(), &session, &coordinates)
}

/// `coordinates` holds the sets one after another, x y z per atom in Å; each
/// energy is kcal/mol, or `null` when it is not finite.
#[tauri::command(async)]
pub(crate) fn energy_model_evaluate_batch<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    session: String,
    coordinates: Vec<f64>,
) -> Result<Vec<Option<f64>>, String> {
    evaluate_batch(window.label(), &session, &coordinates).map(|energies| {
        energies
            .into_iter()
            .map(|e| e.is_finite().then_some(e))
            .collect()
    })
}

#[tauri::command]
pub(crate) fn energy_model_close<R: Runtime>(window: tauri::WebviewWindow<R>, session: String) {
    let owner = window.label().to_string();
    close_where(|id, candidate| id != session || candidate.owner != owner);
}

pub(crate) fn window_destroyed(label: &str) {
    close_where(|_, session| session.owner != label);
}

pub(crate) fn close_all() {
    close_where(|_, _| false);
}

#[cfg(test)]
mod tests;
