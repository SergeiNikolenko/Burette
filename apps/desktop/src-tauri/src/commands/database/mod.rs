//! The Database menu: structure and text queries against public chemistry
//! services.
//!
//! Everything network-facing lives here, in the backend, on purpose. The webview
//! CSP forbids external requests and the grid iframe has no network at all, so a
//! provider is reachable only through these commands - which means the SSRF guard,
//! the response ceiling and the credential handling in `http.rs` cover every
//! query, and a compromised page cannot reach a service on its own.

pub(crate) mod building_blocks;
pub(crate) mod chembl;
pub(crate) mod chemspace;
pub(crate) mod cod;
pub(crate) mod custom_url;
pub(crate) mod http;
pub(crate) mod patents;
pub(crate) mod secrets;
pub(crate) mod sql;
pub(crate) mod table;
pub(crate) mod wikipedia;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, Runtime};

use crate::preview::grid_store::GridParseOptions;
use crate::preview::runtime::{ViewerDocument, ViewerPreferences};
use crate::preview::runtime_grid::create_grid_runtime_with_options;

/// A search never returns more rows than this, whatever the request asks for: the
/// collection is built in memory and handed to the grid in one piece.
const MAX_RECORDS: usize = 5_000;
const DEFAULT_RECORDS: usize = 500;
const MAX_QUERY_CHARS: usize = 4096;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum StructureSearchMode {
    #[default]
    Substructure,
    Similarity,
    Exact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DatabaseProvider {
    Chembl,
    ChemblActives,
    Cod,
    Wikipedia,
    Url,
    Sql,
    BuildingBlocks,
    Patents,
    Chemspace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DatabaseDelivery {
    /// Open the answer as a new collection.
    Collection,
    /// Hand the answer back as text for `grid_append_records` to fold into the
    /// collection the user is already looking at.
    Records,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseQueryRequest {
    pub(crate) provider: DatabaseProvider,
    #[serde(default)]
    pub(crate) delivery: Option<DatabaseDelivery>,
    #[serde(default)]
    pub(crate) structure: Option<String>,
    #[serde(default)]
    pub(crate) search_mode: Option<StructureSearchMode>,
    #[serde(default)]
    pub(crate) similarity_threshold: Option<f64>,
    #[serde(default)]
    pub(crate) text: Option<String>,
    #[serde(default)]
    pub(crate) field: Option<String>,
    #[serde(default)]
    pub(crate) max_records: Option<usize>,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) sql: Option<sql::SqlQueryRequest>,
    /// A comma-separated catalogue provider list for the building block search.
    #[serde(default)]
    pub(crate) providers: Option<String>,
    #[serde(default)]
    pub(crate) max_price: Option<f64>,
    #[serde(default)]
    pub(crate) min_amount: Option<f64>,
    /// The keychain account holding the ChemSpace key.
    #[serde(default)]
    pub(crate) account: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseRecordsPayload {
    pub(crate) input_extension: String,
    pub(crate) text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseSearchResult {
    pub(crate) provider: String,
    pub(crate) title: String,
    pub(crate) record_count: usize,
    pub(crate) extension: String,
    pub(crate) document: Option<ViewerDocument>,
    pub(crate) records: Option<DatabaseRecordsPayload>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct DatabasePayload {
    pub(crate) extension: &'static str,
    pub(crate) text: String,
    pub(crate) record_count: usize,
    pub(crate) warnings: Vec<String>,
}

/// ChEMBL answers with numbers, strings, booleans and nulls in the same field
/// depending on the record; every one of them has to survive as a cell.
pub(crate) fn scalar_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.trim().to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        _ => String::new(),
    }
}

pub(crate) fn clamp_records(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_RECORDS).clamp(1, MAX_RECORDS)
}

pub(crate) fn clamp_threshold(requested: Option<f64>) -> f64 {
    requested.unwrap_or(80.0).clamp(40.0, 100.0)
}

pub(crate) fn require_query(value: Option<&String>, what: &str) -> Result<String, String> {
    let query = value.map(|value| value.trim()).unwrap_or("");
    if query.is_empty() {
        return Err(format!("{what} is required for this search"));
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(format!(
            "{what} is longer than {MAX_QUERY_CHARS} characters"
        ));
    }
    if query.chars().any(char::is_control) {
        return Err(format!("{what} must not contain control characters"));
    }
    Ok(query.to_string())
}

pub(crate) fn provider_label(provider: DatabaseProvider) -> &'static str {
    match provider {
        DatabaseProvider::Chembl => "ChEMBL",
        DatabaseProvider::ChemblActives => "ChEMBL actives",
        DatabaseProvider::Cod => "Crystallography DB",
        DatabaseProvider::Wikipedia => "Wikipedia molecules",
        DatabaseProvider::Url => "URL",
        DatabaseProvider::Sql => "SQL",
        DatabaseProvider::BuildingBlocks => "Building blocks",
        DatabaseProvider::Patents => "Google Patents",
        DatabaseProvider::Chemspace => "ChemSpace",
    }
}

fn run_provider(request: &DatabaseQueryRequest) -> Result<DatabasePayload, String> {
    let limit = clamp_records(request.max_records);
    match request.provider {
        DatabaseProvider::Chembl => chembl::structure_search(
            &require_query(request.structure.as_ref(), "A query structure")?,
            request
                .search_mode
                .unwrap_or(StructureSearchMode::Substructure),
            clamp_threshold(request.similarity_threshold),
            limit,
        ),
        DatabaseProvider::ChemblActives => chembl::similar_actives(
            &require_query(request.structure.as_ref(), "A query structure")?,
            clamp_threshold(request.similarity_threshold),
            limit,
        ),
        DatabaseProvider::Cod => cod::search(
            &require_query(request.text.as_ref(), "A search term")?,
            cod::CodSearchField::parse(request.field.as_deref()),
            limit,
        ),
        DatabaseProvider::Wikipedia => {
            wikipedia::retrieve(request.text.as_deref().unwrap_or_default(), limit)
        }
        DatabaseProvider::Url => custom_url::retrieve(
            &require_query(request.url.as_ref(), "A document URL")?,
            limit,
        ),
        DatabaseProvider::Sql => sql::query(
            request
                .sql
                .as_ref()
                .ok_or_else(|| "A SQL query needs a connection and a statement".to_string())?,
            limit,
        ),
        DatabaseProvider::BuildingBlocks => building_blocks::search(
            &building_blocks::BuildingBlockQuery {
                smiles: require_query(request.structure.as_ref(), "A query structure")?,
                mode: request
                    .search_mode
                    .unwrap_or(StructureSearchMode::Substructure),
                threshold: clamp_threshold(request.similarity_threshold),
                providers: request.providers.clone().unwrap_or_default(),
                max_price: request.max_price,
                min_amount: request.min_amount,
            },
            limit,
        ),
        DatabaseProvider::Patents => patents::search(
            &require_query(request.text.as_ref(), "A search term")?,
            limit,
        ),
        DatabaseProvider::Chemspace => {
            let structure = require_query(request.structure.as_ref(), "A query structure")?;
            // The key is read from the keychain here rather than travelling in the
            // request, so it never crosses the boundary into the shell.
            let key = request
                .account
                .as_deref()
                .map(secrets::read)
                .transpose()?
                .flatten()
                .unwrap_or_default();
            chemspace::search(
                &structure,
                request
                    .search_mode
                    .unwrap_or(StructureSearchMode::Similarity),
                clamp_threshold(request.similarity_threshold),
                &key,
                limit,
            )
        }
    }
}

/// The address that answers the same query in a browser, for the providers whose
/// interface Burette does not control. Google Patents talks to an endpoint that
/// has never been documented and rate limits without warning, and ChemSpace needs
/// a key the user may not have yet; in both cases the search must still be
/// reachable, so the fallback exists whether or not the request succeeded.
#[tauri::command]
pub(crate) fn database_browser_url(
    request: DatabaseQueryRequest,
) -> Result<Option<String>, String> {
    Ok(match request.provider {
        DatabaseProvider::Patents => Some(patents::browser_url(
            request.text.as_deref().unwrap_or_default().trim(),
        )),
        DatabaseProvider::Chemspace => Some(chemspace::browser_url(
            request.structure.as_deref().unwrap_or_default().trim(),
        )),
        _ => None,
    })
}

fn result_title(provider: DatabaseProvider, request: &DatabaseQueryRequest) -> String {
    let subject = [
        request.text.as_deref(),
        request.structure.as_deref(),
        request.url.as_deref(),
        request.sql.as_ref().map(|sql| sql.statement.as_str()),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .find(|value| !value.is_empty())
    .unwrap_or("");
    let label = provider_label(provider);
    if subject.is_empty() {
        label.to_string()
    } else {
        format!("{label} - {}", clip(subject, 60))
    }
}

fn clip(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let head: String = value.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}

/// Result documents are named after the query, so the file name has to be safe
/// even when the query is a SMILES string full of slashes and brackets.
fn collection_file_name(title: &str, extension: &str) -> String {
    let mut name: String = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | ' ') {
                character
            } else {
                '-'
            }
        })
        .collect();
    name = name.trim().trim_matches('-').trim().to_string();
    if name.is_empty() {
        name = "database-result".to_string();
    }
    format!(
        "{}.{extension}",
        clip(&name, 80).trim_end_matches(['-', ' '])
    )
}

fn open_database_collection<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    title: &str,
    payload: &DatabasePayload,
    preferences: &ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let file_name = collection_file_name(title, payload.extension);
    let label_path: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("viewer")
        .join("database")
        .join(&file_name);
    // Two identical searches must not collide on the same document id: the id is
    // derived from this path, and a repeat would land on the first result's grid
    // runtime instead of opening its own.
    let path = format!(
        "{}#database-{}",
        label_path.to_string_lossy(),
        uuid::Uuid::new_v4()
    );
    let document_id = crate::preview::runtime_utils::stable_id(Path::new(&path));
    let runtime_document_id = crate::windows::runtime_document_id(window_label, &document_id);
    let data = payload.text.as_bytes();
    let runtime_path = create_grid_runtime_with_options(
        app,
        &document_id,
        &runtime_document_id,
        &label_path,
        payload.extension,
        Some(data),
        data.len() as u64,
        preferences,
        &GridParseOptions {
            include_single_sdf: true,
            ..GridParseOptions::default()
        },
    )?
    .ok_or_else(|| "The database answer could not be read as a collection".to_string())?;
    Ok(ViewerDocument::virtual_structure(
        path,
        file_name,
        payload.extension.to_string(),
        "grid2d".to_string(),
        runtime_path.to_string_lossy().to_string(),
        data.len() as u64,
    ))
}

/// Saves a database password in the login keychain. The secret arrives here and
/// goes straight to the keychain: it is never written to the shell's settings,
/// which live in plain text on disk.
#[tauri::command]
pub(crate) fn database_store_secret(account: String, secret: String) -> Result<(), String> {
    secrets::store(&account, &secret)
}

/// Whether a saved connection already has a password, so the dialog can say so
/// without ever reading the secret back into the shell.
#[tauri::command]
pub(crate) fn database_secret_status(account: String) -> Result<bool, String> {
    Ok(secrets::read(&account)?.is_some())
}

#[tauri::command]
pub(crate) fn database_forget_secret(account: String) -> Result<bool, String> {
    secrets::delete(&account)
}

#[tauri::command]
pub(crate) async fn database_search<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: DatabaseQueryRequest,
    preferences: ViewerPreferences,
) -> Result<DatabaseSearchResult, String> {
    let window_label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        database_search_blocking(&app, &window_label, request, &preferences)
    })
    .await
    .map_err(|error| format!("The database search task failed: {error}"))?
}

fn database_search_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    request: DatabaseQueryRequest,
    preferences: &ViewerPreferences,
) -> Result<DatabaseSearchResult, String> {
    let provider = request.provider;
    let payload = run_provider(&request)?;
    let title = result_title(provider, &request);
    if payload.record_count == 0 {
        return Ok(DatabaseSearchResult {
            provider: provider_label(provider).to_string(),
            title,
            record_count: 0,
            extension: payload.extension.to_string(),
            document: None,
            records: None,
            warnings: payload.warnings,
        });
    }
    match request.delivery.unwrap_or(DatabaseDelivery::Collection) {
        DatabaseDelivery::Collection => {
            let document =
                open_database_collection(app, window_label, &title, &payload, preferences)?;
            Ok(DatabaseSearchResult {
                provider: provider_label(provider).to_string(),
                title,
                record_count: payload.record_count,
                extension: payload.extension.to_string(),
                document: Some(document),
                records: None,
                warnings: payload.warnings,
            })
        }
        DatabaseDelivery::Records => Ok(DatabaseSearchResult {
            provider: provider_label(provider).to_string(),
            title,
            record_count: payload.record_count,
            extension: payload.extension.to_string(),
            document: None,
            records: Some(DatabaseRecordsPayload {
                input_extension: payload.extension.to_string(),
                text: payload.text,
            }),
            warnings: payload.warnings,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_counts_and_thresholds_stay_inside_the_supported_range() {
        assert_eq!(clamp_records(None), DEFAULT_RECORDS);
        assert_eq!(clamp_records(Some(0)), 1);
        assert_eq!(clamp_records(Some(10)), 10);
        assert_eq!(clamp_records(Some(usize::MAX)), MAX_RECORDS);
        assert_eq!(clamp_threshold(None), 80.0);
        assert_eq!(clamp_threshold(Some(10.0)), 40.0);
        assert_eq!(clamp_threshold(Some(1000.0)), 100.0);
        assert_eq!(clamp_threshold(Some(95.0)), 95.0);
    }

    #[test]
    fn queries_are_rejected_before_they_reach_a_provider() {
        assert!(require_query(None, "A query structure").is_err());
        assert!(require_query(Some(&"   ".to_string()), "A query structure").is_err());
        assert!(require_query(Some(&"C\nC".to_string()), "A query structure").is_err());
        assert!(require_query(Some(&"C".repeat(MAX_QUERY_CHARS + 1)), "A query").is_err());
        assert_eq!(
            require_query(Some(&" CCO ".to_string()), "A query structure").unwrap(),
            "CCO"
        );
    }

    #[test]
    fn result_files_are_named_after_the_query_without_path_characters() {
        assert_eq!(
            collection_file_name("ChEMBL - CC(=O)Oc1ccccc1C(=O)O", "csv"),
            "ChEMBL - CC--O-Oc1ccccc1C--O-O.csv"
        );
        assert_eq!(
            collection_file_name("../../etc/passwd", "csv"),
            "etc-passwd.csv"
        );
        assert_eq!(collection_file_name("   ", "dwar"), "database-result.dwar");
        let long = collection_file_name(&"x".repeat(400), "csv");
        assert!(!long.contains('/') && !long.contains(std::path::MAIN_SEPARATOR));
    }

    #[test]
    fn titles_carry_the_provider_and_a_clipped_subject() {
        let request = DatabaseQueryRequest {
            provider: DatabaseProvider::Cod,
            delivery: None,
            structure: None,
            search_mode: None,
            similarity_threshold: None,
            text: Some("aspirin".into()),
            field: None,
            max_records: None,
            url: None,
            sql: None,
            providers: None,
            max_price: None,
            min_amount: None,
            account: None,
        };
        assert_eq!(
            result_title(DatabaseProvider::Cod, &request),
            "Crystallography DB - aspirin"
        );
        let long = DatabaseQueryRequest {
            text: Some("a".repeat(200)),
            ..request
        };
        assert!(result_title(DatabaseProvider::Cod, &long).ends_with('…'));
    }

    #[test]
    fn json_scalars_of_every_shape_become_cells() {
        assert_eq!(scalar_text(&Value::Null), "");
        assert_eq!(scalar_text(&serde_json::json!(" text ")), "text");
        assert_eq!(scalar_text(&serde_json::json!(3.5)), "3.5");
        assert_eq!(scalar_text(&serde_json::json!(true)), "true");
        assert_eq!(scalar_text(&serde_json::json!(["a"])), "");
    }
}
