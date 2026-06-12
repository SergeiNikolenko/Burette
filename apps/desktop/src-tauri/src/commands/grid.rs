use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tauri::{Runtime, State};

use crate::preview::formats::{structure_path_extension, supported_structure_extensions};
use crate::preview::grid_store::{
    delimited_smiles_column_choices, GridDelimitedColumnChoice, GridPageResult, GridParseOptions,
    GridQuery, GridRuntimeRegistry,
};

const GRID_APPEND_MAX_SOURCE_SIZE: u64 = 25 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridPageRequest {
    document_id: String,
    query: Option<String>,
    sort: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAppendRequest {
    document_id: String,
    paths: Vec<String>,
    records: Vec<GridAppendRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAppendRecord {
    input_extension: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridDelimitedColumnsRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAppendDelimitedRequest {
    document_id: String,
    path: String,
    smiles_column: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAppendResult {
    records_appended: usize,
    total_rows: usize,
    errors: Vec<String>,
}

#[tauri::command]
pub(crate) fn grid_fetch_page<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: GridPageRequest,
) -> Result<GridPageResult, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    registry.fetch_page(
        &document_id,
        &GridQuery {
            query: request.query.unwrap_or_default(),
            sort: request.sort.unwrap_or_else(|| "index".to_string()),
            offset: request.offset.unwrap_or(0),
            limit: request.limit.unwrap_or(48),
        },
    )
}

#[tauri::command]
pub(crate) fn grid_append_records<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: GridAppendRequest,
) -> Result<GridAppendResult, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let supported = supported_structure_extensions()?;
    let mut records_appended = 0usize;
    let mut total_rows = 0usize;
    let mut errors = Vec::new();

    for path in request.paths {
        match read_grid_append_path(&path, &supported)
            .and_then(|(extension, text)| registry.append_text(&document_id, &extension, &text))
        {
            Ok(summary) => {
                records_appended += summary.records_appended;
                total_rows = summary.total_rows;
            }
            Err(error) => errors.push(format!("{path}: {error}")),
        }
    }

    for record in request.records {
        let extension = record
            .input_extension
            .trim()
            .trim_start_matches('.')
            .to_lowercase();
        if !supported.contains(&extension) {
            errors.push(format!("Unsupported structure extension: {extension}"));
            continue;
        }
        match registry.append_text(&document_id, &extension, &record.text) {
            Ok(summary) => {
                records_appended += summary.records_appended;
                total_rows = summary.total_rows;
            }
            Err(error) => errors.push(error),
        }
    }

    if records_appended == 0 && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(GridAppendResult {
        records_appended,
        total_rows,
        errors,
    })
}

#[tauri::command]
pub(crate) fn grid_delimited_columns(
    request: GridDelimitedColumnsRequest,
) -> Result<Vec<GridDelimitedColumnChoice>, String> {
    let supported = supported_structure_extensions()?;
    let (extension, text) = read_grid_append_path(&request.path, &supported)?;
    delimited_smiles_column_choices(&extension, &text)
}

#[tauri::command]
pub(crate) fn grid_append_delimited_records<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: GridAppendDelimitedRequest,
) -> Result<GridAppendResult, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let supported = supported_structure_extensions()?;
    let (extension, text) = read_grid_append_path(&request.path, &supported)?;
    let summary = registry.append_text_with_options(
        &document_id,
        &extension,
        &text,
        &GridParseOptions {
            smiles_column: Some(request.smiles_column),
            ..GridParseOptions::default()
        },
    )?;
    Ok(GridAppendResult {
        records_appended: summary.records_appended,
        total_rows: summary.total_rows,
        errors: Vec::new(),
    })
}

fn read_grid_append_path(
    path: &str,
    supported: &std::collections::BTreeSet<String>,
) -> Result<(String, String), String> {
    let input_path = PathBuf::from(path);
    let extension = structure_path_extension(&input_path);
    if !supported.contains(&extension) {
        return Err(format!("Unsupported structure extension: {extension}"));
    }
    let metadata =
        fs::metadata(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", input_path.display()));
    }
    if metadata.len() > GRID_APPEND_MAX_SOURCE_SIZE {
        return Err(format!(
            "{} is too large for grid append",
            input_path.display()
        ));
    }
    fs::read_to_string(&input_path)
        .map(|text| (extension, text))
        .map_err(|err| format!("{}: {err}", input_path.display()))
}

#[tauri::command]
pub(crate) fn grid_close_runtime<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    document_id: String,
) -> Result<(), String> {
    registry.unregister(&crate::windows::runtime_document_id(
        window.label(),
        &document_id,
    ))
}

#[cfg(test)]
mod tests {
    use super::read_grid_append_path;
    use std::collections::BTreeSet;
    use std::fs;

    fn supported_extensions() -> BTreeSet<String> {
        ["pdb", "sdf", "xyz"]
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "burrete-grid-command-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn read_grid_append_path_rejects_unsupported_extension_before_io() {
        let path = temp_path("unsupported.txt");
        let error = read_grid_append_path(&path.to_string_lossy(), &supported_extensions())
            .expect_err("unsupported extensions should be rejected");

        assert_eq!(error, "Unsupported structure extension: txt");
    }

    #[test]
    fn read_grid_append_path_rejects_missing_supported_file() {
        let path = temp_path("missing.pdb");
        let error = read_grid_append_path(&path.to_string_lossy(), &supported_extensions())
            .expect_err("missing supported files should surface an IO error");

        assert!(error.contains(&path.display().to_string()));
        assert!(error.contains("No such file") || error.contains("os error 2"));
    }

    #[test]
    fn read_grid_append_path_rejects_directories() {
        let path = temp_path("directory.sdf");
        fs::create_dir_all(&path).expect("temp directory should be created");

        let error = read_grid_append_path(&path.to_string_lossy(), &supported_extensions())
            .expect_err("directories should not be append sources");

        assert_eq!(error, format!("{} is not a file", path.display()));
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn read_grid_append_path_reads_supported_text() {
        let path = temp_path("ligand.xyz");
        fs::write(&path, "1\nwater\nO 0 0 0\n").expect("temp xyz should be writable");

        let (extension, text) =
            read_grid_append_path(&path.to_string_lossy(), &supported_extensions())
                .expect("supported files should read");

        assert_eq!(extension, "xyz");
        assert_eq!(text, "1\nwater\nO 0 0 0\n");
        let _ = fs::remove_file(path);
    }
}
