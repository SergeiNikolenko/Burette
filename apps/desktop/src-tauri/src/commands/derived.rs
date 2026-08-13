use serde::{Deserialize, Serialize};
use tauri::{Runtime, State};

use crate::preview::grid_store::{
    descriptor_source_row_batch, open_descriptor_source, store_derived_values_in_database,
    DerivedValueInput, GridRuntimeRegistry,
};

const DERIVED_SOURCE_BATCH_LIMIT: usize = 500;
const DERIVED_STORE_BATCH_LIMIT: usize = 2_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DerivedSourceRowsRequest {
    document_id: String,
    after_source_index: i64,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DerivedSourceRowsResult {
    rows: Vec<DerivedSourceRowPayload>,
    total_rows: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DerivedSourceRowPayload {
    row_id: i64,
    name: String,
    smiles: Option<String>,
    molblock: Option<String>,
    source_index: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DerivedStoreRequest {
    document_id: String,
    column_id: String,
    label: String,
    kind: String,
    params_json: Option<String>,
    values: Vec<DerivedStoreValue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DerivedStoreValue {
    row_id: i64,
    value_real: Option<f64>,
    value_text: Option<String>,
    error_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DerivedStoreResult {
    stored: usize,
}

// Matches is_descriptor_identifier in grid_store: derived column ids share the
// descriptor id namespace, so they must satisfy the same shape the sort and
// filter paths validate against.
fn validate_column_id(column_id: &str) -> Result<(), String> {
    let valid = !column_id.is_empty()
        && column_id.len() <= 80
        && column_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid derived column id: {column_id:?}"))
    }
}

#[tauri::command]
pub(crate) fn derived_source_rows<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: DerivedSourceRowsRequest,
) -> Result<DerivedSourceRowsResult, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let total_rows = registry.descriptor_source_row_count(&document_id)?;
    let database_path = registry.descriptor_database_path(&document_id)?;
    let connection = open_descriptor_source(&database_path)?;
    let limit = request
        .limit
        .unwrap_or(DERIVED_SOURCE_BATCH_LIMIT)
        .clamp(1, DERIVED_SOURCE_BATCH_LIMIT);
    let rows = descriptor_source_row_batch(&connection, request.after_source_index, limit)?;
    Ok(DerivedSourceRowsResult {
        rows: rows
            .into_iter()
            .map(|row| DerivedSourceRowPayload {
                row_id: row.row_id,
                name: row.name,
                smiles: row.smiles,
                molblock: row.molblock,
                source_index: row.source_index,
            })
            .collect(),
        total_rows,
    })
}

#[tauri::command]
pub(crate) fn derived_store_values<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: DerivedStoreRequest,
) -> Result<DerivedStoreResult, String> {
    validate_column_id(&request.column_id)?;
    let label = request.label.trim();
    if label.is_empty() || label.len() > 120 {
        return Err("Derived column label must be 1-120 characters".into());
    }
    if request.values.len() > DERIVED_STORE_BATCH_LIMIT {
        return Err(format!(
            "Derived store batch is too large: {} values, limit is {DERIVED_STORE_BATCH_LIMIT}",
            request.values.len()
        ));
    }
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let database_path = registry.descriptor_database_path(&document_id)?;
    let mut connection = open_descriptor_source(&database_path)?;
    let values = request
        .values
        .into_iter()
        .map(|value| DerivedValueInput {
            row_id: value.row_id,
            value_real: value.value_real,
            value_text: value.value_text,
            error_text: value.error_text,
        })
        .collect::<Vec<_>>();
    let stored = store_derived_values_in_database(
        &mut connection,
        &request.column_id,
        label,
        &request.kind,
        request.params_json.as_deref(),
        &values,
    )?;
    Ok(DerivedStoreResult { stored })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_column_ids() {
        assert!(validate_column_id("Formula").is_ok());
        assert!(validate_column_id("InChIKey").is_ok());
        assert!(validate_column_id("a-b_C1").is_ok());
        assert!(validate_column_id("").is_err());
        assert!(validate_column_id("has space").is_err());
        assert!(validate_column_id(&"x".repeat(81)).is_err());
    }
}
