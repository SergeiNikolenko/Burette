use super::numpy_artifact::{read_numpy_arrays, NumpyArraySummary};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const FOLDING_SCAN_DEPTH_LIMIT: usize = 6;
const FOLDING_SCAN_FILE_LIMIT: usize = 5000;
const FOLDING_NUMPY_VALUE_LIMIT: usize = 1_000_000;
const FOLDING_MATRIX_PREVIEW_LIMIT: usize = 72;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FoldingResultBundle {
    root_path: String,
    title: String,
    source: String,
    models: Vec<FoldingModel>,
    artifacts: Vec<FoldingArtifact>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldingModel {
    id: String,
    title: String,
    backend: String,
    seed: Option<usize>,
    model_index: Option<usize>,
    structure_path: String,
    structure_title: String,
    metrics: Vec<FoldingMetric>,
    plddt_profile: Option<FoldingProfile>,
    matrix_preview: Option<FoldingMatrixPreview>,
    artifacts: Vec<FoldingArtifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldingMetric {
    key: String,
    label: String,
    value: f64,
    formatted: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldingProfile {
    label: String,
    path: String,
    values: Vec<f64>,
    min: f64,
    max: f64,
    mean: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldingMatrixPreview {
    kind: String,
    label: String,
    path: String,
    shape: Vec<usize>,
    values: Vec<Vec<Option<f64>>>,
    x_labels: Vec<String>,
    y_labels: Vec<String>,
    min: Option<f64>,
    max: Option<f64>,
    mean: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldingArtifact {
    path: String,
    title: String,
    extension: String,
    kind: String,
    byte_count: u64,
}

#[derive(Debug, Clone)]
struct FileEntry {
    path: PathBuf,
    title: String,
    extension: String,
    byte_count: u64,
}

#[tauri::command]
pub(crate) fn read_folding_result_bundle(path: String) -> Result<FoldingResultBundle, String> {
    read_folding_result_bundle_impl(PathBuf::from(path))
}

fn read_folding_result_bundle_impl(path: PathBuf) -> Result<FoldingResultBundle, String> {
    let input = fs::canonicalize(&path).map_err(|err| format!("{}: {err}", path.display()))?;
    let roots = candidate_roots(&input)?;
    for root in roots.iter() {
        let bundle = scan_folding_root(root, &input)?;
        if !folding_bundle_has_content(&bundle) {
            continue;
        }
        if folding_bundle_references_input(&bundle, &input) {
            return Ok(bundle);
        }
    }
    Ok(empty_bundle(&input, &input, Vec::new()))
}

fn scan_folding_root(root: &Path, input: &Path) -> Result<FoldingResultBundle, String> {
    let mut files = Vec::new();
    collect_files(root, 0, &mut files);
    let folding_artifacts: Vec<FileEntry> = files
        .iter()
        .filter(|entry| folding_artifact_kind(entry).is_some())
        .cloned()
        .collect();
    if folding_artifacts.is_empty() {
        return Ok(empty_bundle(root, input, Vec::new()));
    }
    let structures: Vec<FileEntry> = files
        .iter()
        .filter(|entry| is_structure_extension(&entry.extension))
        .cloned()
        .collect();
    let mut warnings = Vec::new();
    let mut models = Vec::new();
    for (index, structure) in structures.iter().enumerate() {
        let model_index = model_index_for_path(&structure.path);
        let seed = seed_for_path(&structure.path);
        let artifacts = matching_artifacts(structure, model_index, &structures, &folding_artifacts);
        if artifacts.is_empty() {
            continue;
        }
        let (metrics, plddt_profile, matrix_preview, model_warnings) =
            model_outputs_for_artifacts(&artifacts);
        warnings.extend(model_warnings);
        let backend = backend_for_model(structure, &artifacts, root);
        let title = model_title(&backend, index, model_index, seed);
        models.push(FoldingModel {
            id: format!("folding:{}:{index}", structure.path.display()),
            title,
            backend,
            seed,
            model_index,
            structure_path: structure.path.to_string_lossy().to_string(),
            structure_title: structure.title.clone(),
            metrics,
            plddt_profile,
            matrix_preview,
            artifacts: artifacts.iter().map(folding_artifact).collect(),
        });
    }
    let artifacts = folding_artifacts
        .iter()
        .map(folding_artifact)
        .collect::<Vec<_>>();
    let source = source_for_root(root, &models, &artifacts);
    Ok(FoldingResultBundle {
        root_path: root.to_string_lossy().to_string(),
        title: root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Folding result")
            .to_string(),
        source,
        models,
        artifacts,
        warnings,
    })
}

fn model_outputs_for_artifacts(
    artifacts: &[FileEntry],
) -> (
    Vec<FoldingMetric>,
    Option<FoldingProfile>,
    Option<FoldingMatrixPreview>,
    Vec<String>,
) {
    let mut metrics = Vec::new();
    let mut metric_keys = HashSet::new();
    let mut plddt_profile = None;
    let mut matrix_preview = None;
    let mut warnings = Vec::new();
    for artifact in artifacts {
        if artifact.extension == "json" {
            match fs::read_to_string(&artifact.path)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            {
                Some(value) => {
                    collect_json_metrics(&value, "", &mut metrics, &mut metric_keys);
                    if plddt_profile.is_none() {
                        plddt_profile = plddt_profile_for_json(&value, artifact);
                    }
                    if matrix_preview.is_none() {
                        if let Some(preview) = matrix_preview_for_json(&value, artifact) {
                            add_matrix_metric(&preview, &mut metrics, &mut metric_keys);
                            matrix_preview = Some(preview);
                        }
                    }
                }
                None => warnings.push(format!("Could not parse {}", artifact.title)),
            }
            continue;
        }
        if matches!(artifact.extension.as_str(), "html" | "htm") {
            if matrix_preview.is_none() {
                if let Some(preview) = matrix_preview_for_abcfold_html(artifact) {
                    add_matrix_metric(&preview, &mut metrics, &mut metric_keys);
                    matrix_preview = Some(preview);
                }
            }
            continue;
        }
        if artifact.extension != "npz" && artifact.extension != "npy" {
            continue;
        }
        match read_numpy_arrays(&artifact.path, FOLDING_NUMPY_VALUE_LIMIT) {
            Ok(arrays) => {
                for array in arrays {
                    add_array_metrics(&array, artifact, &mut metrics, &mut metric_keys);
                    if plddt_profile.is_none() {
                        plddt_profile = plddt_profile_for_array(&array, artifact);
                    }
                    if matrix_preview.is_none() {
                        matrix_preview = matrix_preview_for_array(&array, artifact);
                    }
                }
            }
            Err(error) => warnings.push(error),
        }
    }
    (metrics, plddt_profile, matrix_preview, warnings)
}

fn add_matrix_metric(
    preview: &FoldingMatrixPreview,
    metrics: &mut Vec<FoldingMetric>,
    keys: &mut HashSet<String>,
) {
    let Some(mean) = preview.mean else {
        return;
    };
    let (key, label) = match preview.kind.as_str() {
        "pae" => ("pae_mean", "Mean PAE"),
        "pde" => ("pde_mean", "Mean PDE"),
        _ => return,
    };
    add_metric(metrics, keys, key.to_string(), label.to_string(), mean);
}

fn collect_json_metrics(
    value: &Value,
    prefix: &str,
    metrics: &mut Vec<FoldingMetric>,
    keys: &mut HashSet<String>,
) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let next = if prefix.is_empty() {
                    key.to_string()
                } else {
                    format!("{prefix}.{key}")
                };
                collect_json_metrics(child, &next, metrics, keys);
            }
        }
        Value::Number(number) => {
            if let Some(value) = number.as_f64() {
                let key = normalize_metric_key(prefix);
                if is_confidence_metric(&key) {
                    add_metric(metrics, keys, key.clone(), metric_label(&key), value);
                }
            }
        }
        _ => {}
    }
}

fn add_array_metrics(
    array: &NumpyArraySummary,
    artifact: &FileEntry,
    metrics: &mut Vec<FoldingMetric>,
    keys: &mut HashSet<String>,
) {
    let name = normalize_metric_key(&array.name);
    let path = normalize_metric_key(&artifact.title);
    let kind = if name.contains("plddt") || path.contains("plddt") {
        Some(("plddt_mean", "Mean pLDDT", true))
    } else if name.contains("pae") || path.contains("pae") {
        Some(("pae_mean", "Mean PAE", false))
    } else if name.contains("pde") || path.contains("pde") {
        Some(("pde_mean", "Mean PDE", false))
    } else {
        None
    };
    let Some((key, label, scale_confidence)) = kind else {
        return;
    };
    if let Some(mean) = array.mean {
        let value = if scale_confidence && mean <= 1.5 {
            mean * 100.0
        } else {
            mean
        };
        add_metric(metrics, keys, key.to_string(), label.to_string(), value);
    }
}

fn plddt_profile_for_array(
    array: &NumpyArraySummary,
    artifact: &FileEntry,
) -> Option<FoldingProfile> {
    let name = normalize_metric_key(&array.name);
    let path = normalize_metric_key(&artifact.title);
    if !(name.contains("plddt") || path.contains("plddt")) || array.shape.len() != 1 {
        return None;
    }
    let scale = array.max.unwrap_or(0.0) <= 1.5;
    let values = array
        .values
        .iter()
        .filter_map(|value| value.map(|number| if scale { number * 100.0 } else { number }))
        .collect::<Vec<_>>();
    if values.is_empty() {
        return None;
    }
    let (min, max, mean) = finite_stats(&values)?;
    Some(FoldingProfile {
        label: "pLDDT".to_string(),
        path: artifact.path.to_string_lossy().to_string(),
        values,
        min,
        max,
        mean,
    })
}

fn plddt_profile_for_json(value: &Value, artifact: &FileEntry) -> Option<FoldingProfile> {
    let payload = json_object_payload(value)?;
    let values = numeric_vector(
        payload
            .get("plddt")
            .or_else(|| payload.get("plddts"))
            .or_else(|| payload.get("predicted_lddt"))?,
    )?;
    let scale = values.iter().copied().fold(0.0f64, f64::max) <= 1.5;
    let values = values
        .into_iter()
        .map(|value| if scale { value * 100.0 } else { value })
        .collect::<Vec<_>>();
    let (min, max, mean) = finite_stats(&values)?;
    Some(FoldingProfile {
        label: "pLDDT".to_string(),
        path: artifact.path.to_string_lossy().to_string(),
        values,
        min,
        max,
        mean,
    })
}

fn matrix_preview_for_array(
    array: &NumpyArraySummary,
    artifact: &FileEntry,
) -> Option<FoldingMatrixPreview> {
    if array.shape.len() != 2 {
        return None;
    }
    let name = normalize_metric_key(&array.name);
    let path = normalize_metric_key(&artifact.title);
    let (kind, label) = if name.contains("pae") || path.contains("pae") {
        ("pae", "PAE")
    } else if name.contains("pde") || path.contains("pde") {
        ("pde", "PDE")
    } else {
        return None;
    };
    let rows = array.shape[0];
    let cols = array.shape[1];
    if rows == 0 || cols == 0 || rows.saturating_mul(cols) > array.values.len() {
        return None;
    }
    let row_count = rows.min(FOLDING_MATRIX_PREVIEW_LIMIT);
    let col_count = cols.min(FOLDING_MATRIX_PREVIEW_LIMIT);
    let mut values = Vec::with_capacity(row_count);
    for row in 0..row_count {
        let source_row = row * rows / row_count;
        let mut preview_row = Vec::with_capacity(col_count);
        for col in 0..col_count {
            let source_col = col * cols / col_count;
            preview_row.push(array.values[source_row * cols + source_col]);
        }
        values.push(preview_row);
    }
    Some(FoldingMatrixPreview {
        kind: kind.to_string(),
        label: label.to_string(),
        path: artifact.path.to_string_lossy().to_string(),
        shape: array.shape.clone(),
        values,
        x_labels: Vec::new(),
        y_labels: Vec::new(),
        min: array.min,
        max: array.max,
        mean: array.mean,
    })
}

fn matrix_preview_for_json(value: &Value, artifact: &FileEntry) -> Option<FoldingMatrixPreview> {
    let payload = json_object_payload(value);
    let matrix_value = payload
        .and_then(|object| {
            object
                .get("pae")
                .or_else(|| object.get("predicted_aligned_error"))
        })
        .or_else(|| {
            let path = normalize_metric_key(&artifact.title);
            (path.contains("pae") || path.contains("predicted_aligned_error")).then_some(value)
        })?;
    let matrix = numeric_matrix(matrix_value)?;
    let labels = payload.and_then(|object| token_labels_for_json(object, matrix.len()));
    matrix_preview_from_matrix(
        "pae",
        "PAE",
        artifact.path.to_string_lossy().to_string(),
        matrix,
        labels,
    )
}

fn matrix_preview_for_abcfold_html(artifact: &FileEntry) -> Option<FoldingMatrixPreview> {
    let lower = artifact.title.to_ascii_lowercase();
    if !lower.contains("pae") {
        return None;
    }
    let text = fs::read_to_string(&artifact.path).ok()?;
    let session_text = html_json_script_content(&text, "session-data")?;
    let session = serde_json::from_str::<Value>(session_text).ok()?;
    if let Some(scores_content) = session
        .get("scoresFile")
        .and_then(|value| value.get("content"))
        .and_then(Value::as_str)
    {
        let scores = serde_json::from_str::<Value>(scores_content).ok()?;
        return matrix_preview_for_json(&scores, artifact);
    }
    matrix_preview_for_json(&session, artifact)
}

fn matrix_preview_from_matrix(
    kind: &str,
    label: &str,
    path: String,
    matrix: Vec<Vec<Option<f64>>>,
    labels: Option<Vec<String>>,
) -> Option<FoldingMatrixPreview> {
    let rows = matrix.len();
    let cols = matrix.first()?.len();
    if rows == 0 || cols == 0 {
        return None;
    }
    let row_count = rows.min(FOLDING_MATRIX_PREVIEW_LIMIT);
    let col_count = cols.min(FOLDING_MATRIX_PREVIEW_LIMIT);
    let mut values = Vec::with_capacity(row_count);
    let mut x_labels = Vec::with_capacity(col_count);
    let mut y_labels = Vec::with_capacity(row_count);
    for col in 0..col_count {
        let source_col = col * cols / col_count;
        x_labels.push(matrix_axis_label(labels.as_ref(), source_col));
    }
    for row in 0..row_count {
        let source_row = row * rows / row_count;
        y_labels.push(matrix_axis_label(labels.as_ref(), source_row));
        let mut preview_row = Vec::with_capacity(col_count);
        for col in 0..col_count {
            let source_col = col * cols / col_count;
            preview_row.push(matrix[source_row][source_col]);
        }
        values.push(preview_row);
    }
    let stats_values = matrix
        .iter()
        .flat_map(|row| row.iter().filter_map(|value| *value))
        .collect::<Vec<_>>();
    let (min, max, mean) = finite_stats(&stats_values)?;
    Some(FoldingMatrixPreview {
        kind: kind.to_string(),
        label: label.to_string(),
        path,
        shape: vec![rows, cols],
        values,
        x_labels,
        y_labels,
        min: Some(min),
        max: Some(max),
        mean: Some(mean),
    })
}

fn json_object_payload(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    match value {
        Value::Object(object) => Some(object),
        Value::Array(items) => items.iter().find_map(|item| match item {
            Value::Object(object) => Some(object),
            _ => None,
        }),
        _ => None,
    }
}

fn numeric_vector(value: &Value) -> Option<Vec<f64>> {
    let values = value.as_array()?;
    let mut output = Vec::with_capacity(values.len());
    for value in values {
        let number = value.as_f64()?;
        if !number.is_finite() {
            return None;
        }
        output.push(number);
    }
    (!output.is_empty()).then_some(output)
}

fn numeric_matrix(value: &Value) -> Option<Vec<Vec<Option<f64>>>> {
    let rows = value.as_array()?;
    let first = rows.first()?.as_array()?;
    if first.is_empty() {
        return None;
    }
    let col_count = first.len();
    let mut matrix = Vec::with_capacity(rows.len());
    for row in rows {
        let row = row.as_array()?;
        if row.len() != col_count {
            return None;
        }
        let mut output_row = Vec::with_capacity(row.len());
        for value in row {
            if value.is_null() {
                output_row.push(None);
                continue;
            }
            let number = value.as_f64()?;
            if !number.is_finite() || number < 0.0 {
                return None;
            }
            output_row.push(Some(number));
        }
        matrix.push(output_row);
    }
    (!matrix.is_empty()).then_some(matrix)
}

fn token_labels_for_json(
    object: &serde_json::Map<String, Value>,
    expected_len: usize,
) -> Option<Vec<String>> {
    let residue_labels = json_label_array(
        object
            .get("token_res_ids")
            .or_else(|| object.get("residue_ids"))
            .or_else(|| object.get("residue_index"))?,
    )?;
    if residue_labels.len() != expected_len {
        return None;
    }
    let chain_labels = object
        .get("token_chain_ids")
        .or_else(|| object.get("chain_ids"))
        .and_then(json_label_array);
    Some(match chain_labels {
        Some(chains) if chains.len() == expected_len => chains
            .into_iter()
            .zip(residue_labels)
            .map(|(chain, residue)| format!("{chain}:{residue}"))
            .collect(),
        _ => residue_labels,
    })
}

fn json_label_array(value: &Value) -> Option<Vec<String>> {
    let values = value.as_array()?;
    let mut labels = Vec::with_capacity(values.len());
    for value in values {
        labels.push(json_label(value)?);
    }
    (!labels.is_empty()).then_some(labels)
}

fn json_label(value: &Value) -> Option<String> {
    match value {
        Value::String(label) => Some(label.clone()),
        Value::Number(number) => number
            .as_i64()
            .map(|value| value.to_string())
            .or_else(|| number.as_u64().map(|value| value.to_string()))
            .or_else(|| number.as_f64().map(|value| value.to_string())),
        _ => None,
    }
}

fn matrix_axis_label(labels: Option<&Vec<String>>, source_index: usize) -> String {
    labels
        .and_then(|labels| labels.get(source_index))
        .cloned()
        .unwrap_or_else(|| (source_index + 1).to_string())
}

fn html_json_script_content<'a>(html: &'a str, script_id: &str) -> Option<&'a str> {
    let id_attribute = format!("id=\"{script_id}\"");
    let id_position = html.find(&id_attribute)?;
    let script_start = html[..id_position].rfind("<script")?;
    let content_start = html[script_start..].find('>')? + script_start + 1;
    let content_end = html[content_start..].find("</script>")? + content_start;
    Some(html[content_start..content_end].trim())
}

fn matching_artifacts(
    structure: &FileEntry,
    model_index: Option<usize>,
    structures: &[FileEntry],
    artifacts: &[FileEntry],
) -> Vec<FileEntry> {
    let structure_stem = structure
        .path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut matches = Vec::new();
    for artifact in artifacts {
        let lower_path = artifact.path.to_string_lossy().to_ascii_lowercase();
        let model_match = model_index
            .map(|index| filename_mentions_model(&lower_path, index))
            .unwrap_or(false);
        let stem_match = !structure_stem.is_empty() && lower_path.contains(&structure_stem);
        if structures.len() == 1 || model_match || stem_match {
            matches.push(artifact.clone());
        }
    }
    matches
}

fn folding_bundle_has_content(bundle: &FoldingResultBundle) -> bool {
    !bundle.models.is_empty() || !bundle.artifacts.is_empty()
}

fn folding_bundle_references_input(bundle: &FoldingResultBundle, input: &Path) -> bool {
    let input_string = input.to_string_lossy();
    bundle
        .models
        .iter()
        .any(|model| model.structure_path == input_string)
        || bundle
            .artifacts
            .iter()
            .any(|artifact| artifact.path == input_string)
        || bundle.models.iter().any(|model| {
            model
                .artifacts
                .iter()
                .any(|artifact| artifact.path == input_string)
        })
}

fn source_for_root(root: &Path, models: &[FoldingModel], artifacts: &[FoldingArtifact]) -> String {
    let root_lower = root.to_string_lossy().to_ascii_lowercase();
    if root_lower.contains("abcfold") {
        return "ABCFold result bundle".to_string();
    }
    let mut backends = models
        .iter()
        .map(|model| model.backend.as_str())
        .collect::<Vec<_>>();
    backends.sort_unstable();
    backends.dedup();
    if !backends.is_empty() && backends[0] != "Folding" {
        return format!("{} folding output", backends.join(" + "));
    }
    if artifacts.iter().any(|artifact| artifact.kind == "affinity") {
        return "Boltz-style folding output".to_string();
    }
    "Folding result bundle".to_string()
}

fn backend_for_model(structure: &FileEntry, artifacts: &[FileEntry], root: &Path) -> String {
    let combined = std::iter::once(structure.path.to_string_lossy().to_string())
        .chain(
            artifacts
                .iter()
                .map(|artifact| artifact.path.to_string_lossy().to_string()),
        )
        .chain(std::iter::once(root.to_string_lossy().to_string()))
        .collect::<Vec<_>>()
        .join("\n")
        .to_ascii_lowercase();
    if combined.contains("boltz") || combined.contains("affinity_") {
        return "Boltz".to_string();
    }
    if combined.contains("chai") || combined.contains("model_idx") {
        return "Chai-1".to_string();
    }
    if combined.contains("protenix") {
        return "Protenix".to_string();
    }
    if combined.contains("openfold") {
        return "OpenFold".to_string();
    }
    if combined.contains("alphafold")
        || combined.contains("seed-")
        || combined.contains("summary_confidences")
    {
        return "AlphaFold3".to_string();
    }
    "Folding".to_string()
}

fn model_title(
    backend: &str,
    ordinal: usize,
    model_index: Option<usize>,
    seed: Option<usize>,
) -> String {
    let mut parts = vec![backend.to_string()];
    if let Some(index) = model_index {
        parts.push(format!("model {index}"));
    } else {
        parts.push(format!("model {}", ordinal + 1));
    }
    if let Some(seed) = seed {
        parts.push(format!("seed {seed}"));
    }
    parts.join(" / ")
}

fn folding_artifact(entry: &FileEntry) -> FoldingArtifact {
    FoldingArtifact {
        path: entry.path.to_string_lossy().to_string(),
        title: entry.title.clone(),
        extension: entry.extension.clone(),
        kind: folding_artifact_kind(entry)
            .unwrap_or("artifact")
            .to_string(),
        byte_count: entry.byte_count,
    }
}

fn folding_artifact_kind(entry: &FileEntry) -> Option<&'static str> {
    let lower = entry.title.to_ascii_lowercase();
    match entry.extension.as_str() {
        "json" if lower.contains("confidence") || lower.contains("score") => Some("confidence"),
        "json" if lower.contains("affinity") => Some("affinity"),
        "json" => Some("metadata"),
        "npz" | "npy" if lower.contains("plddt") => Some("plddt"),
        "npz" | "npy" if lower.contains("pae") => Some("pae"),
        "npz" | "npy" if lower.contains("pde") => Some("pde"),
        "npz" | "npy" => Some("array"),
        "pkl" | "pickle" => Some("pickle"),
        "pml" | "pse" => Some("pymol"),
        "html" | "htm" => Some("report"),
        _ => None,
    }
}

fn is_structure_extension(extension: &str) -> bool {
    matches!(extension, "pdb" | "cif" | "mmcif" | "mcif" | "bcif")
}

fn collect_files(root: &Path, depth: usize, files: &mut Vec<FileEntry>) {
    if depth > FOLDING_SCAN_DEPTH_LIMIT || files.len() >= FOLDING_SCAN_FILE_LIMIT {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if files.len() >= FOLDING_SCAN_FILE_LIMIT {
            return;
        }
        // Hidden entries are tooling side-cars, never folding output. A trajectory
        // leaves `.<name>.xtc_offsets.npz` index caches beside its frames, and those
        // counted as folding arrays, which showed a plain MD folder as a result bundle.
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_files(&path, depth + 1, files);
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        files.push(FileEntry {
            title: file_title(&path),
            extension: file_extension(&path),
            byte_count: metadata.len(),
            path,
        });
    }
}

fn candidate_roots(input: &Path) -> Result<Vec<PathBuf>, String> {
    let metadata = fs::metadata(input).map_err(|err| format!("{}: {err}", input.display()))?;
    let mut root = if metadata.is_dir() {
        input.to_path_buf()
    } else {
        input
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", input.display()))?
            .to_path_buf()
    };
    let mut roots = Vec::new();
    for _ in 0..=FOLDING_SCAN_DEPTH_LIMIT {
        roots.push(root.clone());
        let Some(parent) = root.parent() else {
            break;
        };
        root = parent.to_path_buf();
    }
    Ok(roots)
}

fn model_index_for_path(path: &Path) -> Option<usize> {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    digits_after_any(
        &lower,
        &[
            "model_idx_",
            "model_idx-",
            "model_",
            "model-",
            "sample_",
            "sample-",
        ],
    )
}

fn seed_for_path(path: &Path) -> Option<usize> {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    digits_after_any(&lower, &["seed_", "seed-"])
}

fn filename_mentions_model(lower_path: &str, index: usize) -> bool {
    [
        format!("model_idx_{index}"),
        format!("model_idx-{index}"),
        format!("model_{index}"),
        format!("model-{index}"),
        format!("sample_{index}"),
        format!("sample-{index}"),
    ]
    .iter()
    .any(|needle| lower_path.contains(needle))
}

fn digits_after_any(value: &str, needles: &[&str]) -> Option<usize> {
    needles.iter().find_map(|needle| {
        let start = value.find(needle)? + needle.len();
        let digits = value[start..]
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>();
        (!digits.is_empty())
            .then(|| digits.parse::<usize>().ok())
            .flatten()
    })
}

fn add_metric(
    metrics: &mut Vec<FoldingMetric>,
    keys: &mut HashSet<String>,
    key: String,
    label: String,
    value: f64,
) {
    if !value.is_finite() || !keys.insert(key.clone()) {
        return;
    }
    metrics.push(FoldingMetric {
        formatted: format_metric_value(&key, value),
        key,
        label,
        value,
    });
}

fn is_confidence_metric(key: &str) -> bool {
    matches!(
        key,
        "ptm"
            | "iptm"
            | "ranking_score"
            | "ranking_confidence"
            | "confidence_score"
            | "fraction_disordered"
            | "has_clash"
            | "complex_plddt"
            | "complex_iplddt"
            | "complex_pde"
            | "complex_ipde"
            | "affinity_pred_value"
            | "affinity_probability_binary"
            | "affinity_pred_probability"
    ) || key.contains("plddt")
        || key.contains("iptm")
        || key.contains("ptm")
        || key.contains("affinity")
}

fn metric_label(key: &str) -> String {
    match key {
        "ptm" => "pTM".to_string(),
        "iptm" => "ipTM".to_string(),
        "ranking_score" => "Ranking".to_string(),
        "ranking_confidence" => "Ranking confidence".to_string(),
        "confidence_score" => "Confidence".to_string(),
        "fraction_disordered" => "Disordered fraction".to_string(),
        "complex_plddt" => "Complex pLDDT".to_string(),
        "complex_iplddt" => "Complex ipLDDT".to_string(),
        "complex_pde" => "Complex PDE".to_string(),
        "complex_ipde" => "Complex ipDE".to_string(),
        "affinity_pred_value" => "Affinity".to_string(),
        "affinity_probability_binary" | "affinity_pred_probability" => {
            "Affinity probability".to_string()
        }
        _ => key
            .split('_')
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                chars
                    .next()
                    .map(|first| format!("{}{}", first.to_ascii_uppercase(), chars.as_str()))
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn format_metric_value(key: &str, value: f64) -> String {
    if (key.contains("probability") || key.contains("confidence") || key.contains("fraction"))
        && (0.0..=1.0).contains(&value)
    {
        return format!("{:.1}%", value * 100.0);
    }
    if key.contains("plddt") {
        return format!("{value:.1}");
    }
    if value.abs() >= 1000.0 || (value != 0.0 && value.abs() < 0.001) {
        format!("{value:.3e}")
    } else {
        format!("{value:.3}")
    }
}

fn finite_stats(values: &[f64]) -> Option<(f64, f64, f64)> {
    let mut min: Option<f64> = None;
    let mut max: Option<f64> = None;
    let mut sum = 0.0f64;
    let mut count = 0usize;
    for value in values {
        if !value.is_finite() {
            continue;
        }
        min = Some(min.map_or(*value, |current| current.min(*value)));
        max = Some(max.map_or(*value, |current| current.max(*value)));
        sum += value;
        count += 1;
    }
    Some((min?, max?, sum / count as f64))
}

fn normalize_metric_key(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let without_extension = lower
        .strip_suffix(".npy")
        .or_else(|| lower.strip_suffix(".npz"))
        .or_else(|| lower.strip_suffix(".json"))
        .unwrap_or(&lower);
    without_extension
        .rsplit('.')
        .next()
        .unwrap_or(without_extension)
        .replace(['-', ' ', '/'], "_")
}

fn empty_bundle(root: &Path, input: &Path, warnings: Vec<String>) -> FoldingResultBundle {
    FoldingResultBundle {
        root_path: root.to_string_lossy().to_string(),
        title: input
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Folding result")
            .to_string(),
        source: "Folding result bundle".to_string(),
        models: Vec::new(),
        artifacts: Vec::new(),
        warnings,
    }
}

fn file_title(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Artifact")
        .to_string()
}

fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::read_folding_result_bundle_impl;
    use crate::commands::numpy_artifact::read_numpy_arrays;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "burette-folding-result-test-{}-{name}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("fixture dir should create");
        path
    }

    fn npy_f32(shape: &[usize], values: &[f32]) -> Vec<u8> {
        let shape_text = if shape.len() == 1 {
            format!("{},", shape[0])
        } else {
            shape
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mut header =
            format!("{{'descr': '<f4', 'fortran_order': False, 'shape': ({shape_text}), }}");
        let padding = (16 - ((10 + header.len() + 1) % 16)) % 16;
        header.push_str(&" ".repeat(padding));
        header.push('\n');
        let mut bytes = b"\x93NUMPY\x01\x00".to_vec();
        bytes.extend_from_slice(&(header.len() as u16).to_le_bytes());
        bytes.extend_from_slice(header.as_bytes());
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn recognizes_boltz_style_sidecars() {
        let dir = temp_dir("boltz");
        let pdb = dir.join("Boltz.pdb");
        fs::write(&pdb, "ATOM      1  N   GLY A   1       0.0 0.0 0.0\n")
            .expect("pdb should write");
        fs::write(
            dir.join("affinity_reflig.json"),
            r#"{"affinity_pred_value": -7.2, "affinity_probability_binary": 0.81}"#,
        )
        .expect("json should write");
        let plddt_path = dir.join("plddt_reflig_model_0.npy");
        fs::write(&plddt_path, npy_f32(&[3], &[0.8, 0.9, 0.95])).expect("plddt should write");
        fs::write(
            dir.join("pae_reflig_model_0.npy"),
            npy_f32(&[2, 2], &[0.25, 1.0, 1.1, 0.3]),
        )
        .expect("pae should write");
        let bundle = read_folding_result_bundle_impl(pdb.clone()).expect("bundle should read");
        let arrays = read_numpy_arrays(&plddt_path, 16).expect("plddt array should read");
        assert_eq!(arrays[0].shape, vec![3]);
        assert!(arrays[0].mean.expect("mean") > 0.88);
        assert_eq!(bundle.models.len(), 1);
        assert_eq!(bundle.models[0].backend, "Boltz");
        assert!(bundle.models[0].plddt_profile.is_some());
        assert!(bundle.models[0].matrix_preview.is_some());
        assert!(bundle.models[0]
            .metrics
            .iter()
            .any(|metric| metric.key == "affinity_pred_value"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn prefers_nearest_result_root_over_broad_ancestor() {
        let root = temp_dir("ancestor");
        let dir = root.join("test");
        let unrelated = root.join("other");
        fs::create_dir_all(&dir).expect("test dir should create");
        fs::create_dir_all(&unrelated).expect("other dir should create");
        let pdb = dir.join("Boltz.pdb");
        fs::write(&pdb, "ATOM      1  N   GLY A   1       0.0 0.0 0.0\n")
            .expect("pdb should write");
        fs::write(
            dir.join("affinity_reflig.json"),
            r#"{"affinity_pred_value": -7.2}"#,
        )
        .expect("json should write");
        fs::write(
            unrelated.join("unrelated.pdb"),
            "ATOM      1  N   GLY A   1\n",
        )
        .expect("unrelated pdb should write");
        fs::write(
            unrelated.join("summary_confidences.json"),
            r#"{"ranking_score": 0.5}"#,
        )
        .expect("unrelated json should write");
        let bundle = read_folding_result_bundle_impl(pdb.clone()).expect("bundle should read");
        let canonical_dir = fs::canonicalize(&dir).expect("dir should canonicalize");
        assert_eq!(bundle.root_path, canonical_dir.to_string_lossy());
        assert_eq!(bundle.models.len(), 1);
        let canonical_pdb = fs::canonicalize(&pdb).expect("pdb should canonicalize");
        assert_eq!(
            bundle.models[0].structure_path,
            canonical_pdb.to_string_lossy()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_unrelated_sidecars_in_same_directory() {
        let dir = temp_dir("unrelated-sidecars");
        let pdb = dir.join("ordinary.pdb");
        fs::write(&pdb, "ATOM      1  N   GLY A   1       0.0 0.0 0.0\n")
            .expect("ordinary pdb should write");
        fs::write(
            dir.join("folded_model.pdb"),
            "ATOM      1  N   GLY A   1       0.0 0.0 0.0\n",
        )
        .expect("folded model should write");
        fs::write(
            dir.join("summary_confidences.json"),
            r#"{"ranking_score": 0.5}"#,
        )
        .expect("confidence json should write");
        let bundle = read_folding_result_bundle_impl(pdb).expect("bundle should read");
        assert_eq!(bundle.models.len(), 0);
        assert_eq!(bundle.artifacts.len(), 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn extracts_pae_matrix_from_confidence_json() {
        let dir = temp_dir("pae-json");
        let cif = dir.join("model_0.cif");
        fs::write(&cif, "data_model\n#\n").expect("cif should write");
        fs::write(
            dir.join("model_0_confidences.json"),
            r#"{
              "ptm": 0.64,
              "pae": [[0.0, 3.5], [4.5, 0.2]],
              "token_chain_ids": ["A", "B"],
              "token_res_ids": [10, 22]
            }"#,
        )
        .expect("confidence json should write");
        let bundle = read_folding_result_bundle_impl(cif).expect("bundle should read");
        let preview = bundle.models[0]
            .matrix_preview
            .as_ref()
            .expect("pae preview should be present");
        assert_eq!(preview.kind, "pae");
        assert_eq!(preview.shape, vec![2, 2]);
        assert_eq!(
            preview.x_labels,
            vec!["A:10".to_string(), "B:22".to_string()]
        );
        assert!(bundle.models[0]
            .metrics
            .iter()
            .any(|metric| metric.key == "pae_mean"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn extracts_pae_matrix_from_abcfold_html_session_data() {
        let dir = temp_dir("pae-html");
        let cif = dir.join("model_0.cif");
        fs::write(&cif, "data_model\n#\n").expect("cif should write");
        let scores = serde_json::json!({
            "pae": [[0.0, 1.0], [2.0, 0.0]],
            "token_chain_ids": ["A", "A"],
            "token_res_ids": [1, 2]
        })
        .to_string();
        let session = serde_json::json!({
            "scoresFile": {
                "name": "scores.json",
                "content": scores
            }
        });
        fs::write(
            dir.join("model_0_af3_pae_plot.html"),
            format!(
                r#"<html><head><script type="application/json" id="session-data">{session}</script></head></html>"#
            ),
        )
        .expect("pae html should write");
        let bundle = read_folding_result_bundle_impl(cif).expect("bundle should read");
        let preview = bundle.models[0]
            .matrix_preview
            .as_ref()
            .expect("pae preview should be present");
        assert_eq!(preview.kind, "pae");
        assert_eq!(preview.values[0][1], Some(1.0));
        assert_eq!(preview.y_labels, vec!["A:1".to_string(), "A:2".to_string()]);
        let _ = fs::remove_dir_all(dir);
    }
}
