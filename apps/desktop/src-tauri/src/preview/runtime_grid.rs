use base64::Engine;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

use super::formats::normalize_renderer_mode;
use super::grid_store::{build_grid_store_with_options, GridParseOptions};
use super::runtime::ViewerPreferences;
use super::runtime_utils::{asset_url, escape_html, prune_runtime_dirs};
use super::runtime_viewer::{copy_web_assets, AssetProfile};
use super::trace::{runtime_manifest, write_bytes_atomic, write_json_atomic};

const GRID_RUNTIME_CSP: &str = "default-src 'self' file: asset: data: blob:; connect-src 'self' file: asset:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' file: asset:; style-src 'self' 'unsafe-inline' file: asset:; img-src 'self' file: asset: data: blob:; worker-src 'self' blob:;";

#[cfg(test)]
use super::runtime_utils::{clipped, normalized_lines};
#[cfg(test)]
use std::collections::BTreeMap;

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
struct GridCollection {
    format: &'static str,
    records: Vec<GridRecord>,
    records_total: usize,
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
struct GridRecord {
    index: usize,
    name: String,
    smiles: Option<String>,
    molblock: Option<String>,
    props: BTreeMap<String, String>,
}

pub(crate) fn create_grid_runtime_with_options<R: Runtime>(
    app: &tauri::AppHandle<R>,
    document_id: &str,
    registry_document_id: &str,
    file_path: &Path,
    extension: &str,
    data: &[u8],
    preferences: &ViewerPreferences,
    options: &GridParseOptions,
) -> Result<Option<PathBuf>, String> {
    if !grid_can_preview(extension) {
        return Ok(None);
    }

    let base = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer");
    let assets = base.join("assets");
    let runtime = base.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&assets).map_err(|err| err.to_string())?;
    fs::create_dir_all(&runtime).map_err(|err| err.to_string())?;
    copy_web_assets(app, &assets, AssetProfile::Grid)?;
    prune_runtime_dirs(&base);
    let grid_options = GridParseOptions {
        smiles_column: options.smiles_column.clone(),
        include_single_sdf: options.include_single_sdf
            || normalize_renderer_mode(&preferences.renderer_mode) == "grid2d",
    };
    let Some(grid_store) = build_grid_store_with_options(&runtime, extension, data, &grid_options)?
    else {
        return Ok(None);
    };
    let collection = grid_store.summary;
    app.state::<super::grid_store::GridRuntimeRegistry>()
        .register(
            registry_document_id,
            grid_store.database_path,
            collection.format,
            grid_store.cancel_token,
            grid_store.ingest_worker,
        )?;
    let rdkit_wasm = runtime.join("RDKit_minimal.wasm");
    fs::copy(assets.join("rdkit").join("RDKit_minimal.wasm"), &rdkit_wasm)
        .map_err(|err| err.to_string())?;
    let rdkit_wasm_base64 = base64::engine::general_purpose::STANDARD
        .encode(fs::read(&rdkit_wasm).map_err(|err| err.to_string())?);
    write_bytes_atomic(
        &runtime.join("preview-rdkit-wasm.js"),
        format!("window.BurreteRDKitWasmBase64 = \"{rdkit_wasm_base64}\";\n").as_bytes(),
    )?;
    let rdkit_wasm_path = asset_url(&rdkit_wasm);
    let config = json!({
        "mode": "grid2d",
        "format": collection.format,
        "renderer": "grid2d",
        "documentId": document_id,
        "sourcePath": file_path.to_string_lossy(),
        "label": file_path.file_name().and_then(|value| value.to_str()).unwrap_or("molecule collection"),
        "byteCount": data.len(),
        "host": "app",
        "quickLookBuild": "burrete-tauri-grid2d",
        "debug": false,
        "appViewer": true,
        "pubChemSearch": true,
        "tauriViewer": true,
        "gridDataMode": "bridge",
        "theme": preferences.theme_for_runtime(),
        "themeTokens": preferences.theme_tokens(),
        "canvasBackground": preferences.canvas_background_for_runtime(),
        "overlayOpacity": 0.90,
        "transparentBackground": preferences.resolved_transparent_background(),
        "recordsTotal": collection.records_total,
        "recordsIndexed": collection.records_indexed,
        "indexing": !collection.index_ready,
        "indexReady": collection.index_ready,
        "recordsIncluded": 0,
        "recordsTruncated": false,
        "pageSize": 720,
        "rdkitWasmPath": rdkit_wasm_path,
        "capabilities": {
            "selection": true,
            "export": true,
            "substructureSearch": true,
            "rendererSwitch": matches!(extension, "sdf" | "sd")
        }
    });
    let config_text = serde_json::to_string(&config).map_err(|err| err.to_string())?;
    write_bytes_atomic(
        &runtime.join("index.html"),
        grid_html(file_path, extension, &runtime, &assets, preferences).as_bytes(),
    )?;
    write_bytes_atomic(
        &runtime.join("preview-config.js"),
        format!("window.BurreteConfig = {config_text};\n").as_bytes(),
    )?;
    write_json_atomic(
        &runtime.join("manifest.json"),
        &runtime_manifest(
            "grid2d",
            extension,
            document_id,
            data.len(),
            0,
            AssetProfile::Grid.name(),
        ),
    )?;
    Ok(Some(runtime.join("index.html")))
}

fn grid_html(
    file_path: &Path,
    extension: &str,
    runtime: &Path,
    assets: &Path,
    preferences: &ViewerPreferences,
) -> String {
    let title = escape_html(
        file_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("molecule collection"),
    );
    let background_class = if preferences.resolved_transparent_background() {
        "burette-transparent-background"
    } else {
        "burette-opaque-background"
    };
    let grid_css = versioned_asset_url(&assets.join("grid.css"));
    let config_js = asset_url(&runtime.join("preview-config.js"));
    let rdkit_wasm_js = asset_url(&runtime.join("preview-rdkit-wasm.js"));
    let rdkit_js = versioned_asset_url(&assets.join("rdkit").join("RDKit_minimal.js"));
    let openchemlib_js = versioned_asset_url(&assets.join("openchemlib").join("openchemlib.js"));
    let openchemlib_script = if extension == "dwar" {
        format!(r#"<script src="{openchemlib_js}"></script>"#)
    } else {
        String::new()
    };
    let grid_ui_js = versioned_asset_url(&assets.join("grid-ui.js"));
    let grid_js = versioned_asset_url(&assets.join("grid-viewer.js"));
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Burrete Grid - {title}</title>
  <meta http-equiv="Content-Security-Policy" content="{GRID_RUNTIME_CSP}" />
  <link rel="stylesheet" href="{grid_css}" />
  <script>
    window.__mqlPost = function (type, message, payload) {{
      try {{
        window.parent && window.parent.postMessage({{ source: 'burrete-grid', body: {{ type: type, message: String(message || ''), ...(payload || {{}}) }} }}, '*');
      }} catch (_) {{}}
    }};
    window.BurreteInlineMode = true;
    window.BurreteGridMode = true;
    window.BurreteDebug = false;
  </script>
</head>
<body class="{background_class}">
  <div id="app"></div>
  <div id="status">Loading molecule grid...</div>
  <script src="{config_js}"></script>
  <script src="{rdkit_wasm_js}"></script>
  {openchemlib_script}
  <script src="{rdkit_js}"></script>
  <script src="{grid_ui_js}"></script>
  <script src="{grid_js}"></script>
</body>
</html>"#
    )
}

fn versioned_asset_url(path: &Path) -> String {
    format!("{}?v=grid-ui-v12", asset_url(path))
}

fn grid_can_preview(extension: &str) -> bool {
    matches!(
        extension,
        "csv" | "dwar" | "sd" | "sdf" | "smi" | "smiles" | "tsv"
    )
}

pub(crate) fn grid_requires_preview(extension: &str) -> bool {
    matches!(extension, "csv" | "dwar" | "smi" | "smiles" | "tsv")
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_smiles_grid(text: &str, max_records: usize) -> GridCollection {
    let mut records = Vec::new();
    let mut records_total = 0;
    for line in normalized_lines(text) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(smiles) = parts.next() else { continue };
        if !looks_like_smiles(smiles) {
            continue;
        }
        if records.len() < max_records {
            let name = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| clipped(value, 160))
                .unwrap_or_else(|| format!("Molecule {}", records_total + 1));
            records.push(GridRecord {
                index: records_total,
                name,
                smiles: Some(clipped(smiles, 2048)),
                molblock: None,
                props: BTreeMap::new(),
            });
        }
        records_total += 1;
    }
    GridCollection {
        format: "smiles",
        records,
        records_total,
    }
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_sdf_grid(text: &str, max_records: usize) -> GridCollection {
    let mut records = Vec::new();
    let mut records_total = 0;
    let mut current = Vec::new();
    let mut current_has_content = false;

    fn finish_record(
        current: &mut Vec<String>,
        current_has_content: &mut bool,
        records: &mut Vec<GridRecord>,
        records_total: &mut usize,
        max_records: usize,
    ) {
        let lines = std::mem::take(current);
        let has_content = *current_has_content;
        *current_has_content = false;
        if !has_content {
            return;
        }
        if records.len() < max_records {
            let props = parse_sdf_properties(&lines);
            let fallback_name = format!("Molecule {}", *records_total + 1);
            let title = lines
                .first()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty());
            let name = [props.get("Name"), props.get("NAME"), props.get("ID")]
                .into_iter()
                .flatten()
                .map(String::as_str)
                .chain(title)
                .find(|value| !value.trim().is_empty())
                .map(|value| clipped(value, 160))
                .unwrap_or(fallback_name);
            let smiles = [
                props.get("SMILES"),
                props.get("Smiles"),
                props.get("smiles"),
            ]
            .into_iter()
            .flatten()
            .next()
            .map(|value| clipped(value, 2048));
            records.push(GridRecord {
                index: *records_total,
                name,
                smiles,
                molblock: Some(clipped(&extract_molblock(&lines), 250_000)),
                props,
            });
        }
        *records_total += 1;
    }

    for line in normalized_lines(text) {
        if line.trim() == "$$$$" {
            finish_record(
                &mut current,
                &mut current_has_content,
                &mut records,
                &mut records_total,
                max_records,
            );
        } else {
            if !line.trim().is_empty() {
                current_has_content = true;
            }
            if records.len() < max_records {
                current.push(line.to_string());
            }
        }
    }
    finish_record(
        &mut current,
        &mut current_has_content,
        &mut records,
        &mut records_total,
        max_records,
    );
    GridCollection {
        format: "sdf",
        records,
        records_total,
    }
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_delimited_table_with_fallback(
    text: &str,
    separator: char,
    format: &'static str,
    max_records: usize,
) -> Result<GridCollection, String> {
    parse_delimited_table(text, separator, format, max_records).or_else(|_| {
        Ok(parse_delimited_rows_as_smiles(
            text,
            separator,
            format,
            max_records,
        ))
    })
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_delimited_table(
    text: &str,
    separator: char,
    format: &'static str,
    max_records: usize,
) -> Result<GridCollection, String> {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let Some(header_line) = rows.first() else {
        return Ok(GridCollection {
            format,
            records: Vec::new(),
            records_total: 0,
        });
    };
    let headers: Vec<_> = parse_delimited_line(header_line, separator)
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect();
    let normalized_headers: Vec<_> = headers
        .iter()
        .map(|value| value.to_lowercase().replace(' ', "_"))
        .collect();
    let Some(smiles_index) = normalized_headers
        .iter()
        .position(|value| is_smiles_column(value))
    else {
        return Err(format!(
            "{} table needs a SMILES column",
            format.to_uppercase()
        ));
    };
    let name_index = normalized_headers
        .iter()
        .enumerate()
        .position(|(index, value)| {
            index != smiles_index
                && matches!(
                    value.as_str(),
                    "compound_id" | "id" | "name" | "title" | "compound"
                )
        });
    let mut records = Vec::new();
    let mut records_total = 0;
    for line in rows.into_iter().skip(1) {
        let cells = parse_delimited_line(&line, separator);
        let Some(smiles) = cells
            .get(smiles_index)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if records.len() < max_records {
            let raw_name = name_index
                .and_then(|index| cells.get(index))
                .map(|value| value.trim())
                .unwrap_or("");
            let name = if raw_name.is_empty() {
                format!("Molecule {}", records_total + 1)
            } else {
                clipped(raw_name, 160)
            };
            let mut props = BTreeMap::new();
            for (index, header) in headers.iter().enumerate() {
                if index == smiles_index || Some(index) == name_index {
                    continue;
                }
                if let Some(value) = cells
                    .get(index)
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                {
                    if !header.is_empty() && props.len() < 64 {
                        props.insert(clipped(header, 80), clipped(value, 500));
                    }
                }
            }
            records.push(GridRecord {
                index: records_total,
                name,
                smiles: Some(clipped(smiles, 2048)),
                molblock: None,
                props,
            });
        }
        records_total += 1;
    }
    Ok(GridCollection {
        format,
        records,
        records_total,
    })
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_delimited_rows_as_smiles(
    text: &str,
    separator: char,
    format: &'static str,
    max_records: usize,
) -> GridCollection {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let start_index = rows
        .first()
        .map(|row| is_likely_delimited_header(&parse_delimited_line(row, separator)))
        .unwrap_or(false) as usize;
    let mut records = Vec::new();
    let mut records_total = 0;
    for row in rows.into_iter().skip(start_index) {
        let cells: Vec<_> = parse_delimited_line(&row, separator)
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let Some(smiles) = cells.first().filter(|value| looks_like_smiles(value)) else {
            continue;
        };
        if records.len() < max_records {
            let name = cells
                .get(1)
                .filter(|value| !value.is_empty())
                .map(|value| clipped(value, 160))
                .unwrap_or_else(|| format!("Molecule {}", records_total + 1));
            let mut props = BTreeMap::new();
            for (offset, value) in cells.iter().skip(2).enumerate() {
                if props.len() < 64 {
                    props.insert(format!("Column {}", offset + 3), clipped(value, 500));
                }
            }
            records.push(GridRecord {
                index: records_total,
                name,
                smiles: Some(clipped(smiles, 2048)),
                molblock: None,
                props,
            });
        }
        records_total += 1;
    }
    GridCollection {
        format,
        records,
        records_total,
    }
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_delimited_line(line: &str, separator: char) -> Vec<String> {
    let chars: Vec<_> = line.chars().collect();
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut index = 0;
    let mut in_quotes = false;
    while index < chars.len() {
        let ch = chars[index];
        if ch == '"' {
            if in_quotes && index + 1 < chars.len() && chars[index + 1] == '"' {
                field.push(ch);
                index += 1;
            } else {
                in_quotes = !in_quotes;
            }
        } else if ch == separator && !in_quotes {
            fields.push(field);
            field = String::new();
        } else {
            field.push(ch);
        }
        index += 1;
    }
    fields.push(field);
    fields
}

#[cfg(test)]
#[allow(dead_code)]
fn is_smiles_column(value: &str) -> bool {
    matches!(
        value,
        "smiles" | "smile" | "canonical_smiles" | "isomeric_smiles" | "cxsmiles" | "smiles_string"
    )
}

#[cfg(test)]
#[allow(dead_code)]
fn is_likely_delimited_header(cells: &[String]) -> bool {
    cells
        .iter()
        .map(|value| value.to_lowercase().replace(' ', "_"))
        .any(|value| {
            is_smiles_column(&value)
                || matches!(
                    value.as_str(),
                    "id" | "name" | "title" | "compound" | "molecule" | "structure" | "inchi"
                )
        })
}

#[cfg(test)]
#[allow(dead_code)]
fn looks_like_smiles(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.contains(char::is_whitespace) {
        return false;
    }
    let lowered = trimmed.to_lowercase();
    if matches!(
        lowered.as_str(),
        "smiles"
            | "smile"
            | "id"
            | "name"
            | "title"
            | "compound"
            | "molecule"
            | "structure"
            | "inchi"
    ) {
        return false;
    }
    let mut chars = trimmed.chars().peekable();
    let mut has_atom = false;
    let mut has_aromatic_atom = false;
    let mut has_structural_marker = false;
    while let Some(ch) = chars.next() {
        if ch.is_ascii_digit() || "[]=#@+-/\\().,:".contains(ch) {
            has_structural_marker = true;
        } else if matches!((ch, chars.peek()), ('B', Some(&'r')) | ('C', Some(&'l'))) {
            has_atom = true;
            chars.next();
        } else if "BCNOFPSIKH".contains(ch) {
            has_atom = true;
        } else if "bcnops".contains(ch) {
            has_atom = true;
            has_aromatic_atom = true;
        } else {
            return false;
        }
    }
    has_atom && (!has_aromatic_atom || has_structural_marker)
}

#[cfg(test)]
#[allow(dead_code)]
fn parse_sdf_properties(lines: &[String]) -> BTreeMap<String, String> {
    let mut props = BTreeMap::new();
    let mut index = 0;
    while index < lines.len() {
        let line = &lines[index];
        if !line.starts_with('>') {
            index += 1;
            continue;
        }
        let name = property_name(line);
        index += 1;
        let mut values = Vec::new();
        while index < lines.len() {
            let value_line = &lines[index];
            if value_line.starts_with('>') {
                break;
            }
            if value_line.trim().is_empty() {
                index += 1;
                break;
            }
            values.push(value_line.as_str());
            index += 1;
        }
        if let Some(name) = name.filter(|value| !value.is_empty()) {
            let value = values.join("\n").trim().to_string();
            if !value.is_empty() && props.len() < 64 {
                props.insert(clipped(&name, 80), clipped(&value, 500));
            }
        }
    }
    props
}

#[cfg(test)]
#[allow(dead_code)]
fn property_name(line: &str) -> Option<String> {
    let open = line.find('<')?;
    let close = line[open + 1..].find('>')? + open + 1;
    (open < close).then(|| line[open + 1..close].trim().to_string())
}

#[cfg(test)]
#[allow(dead_code)]
fn extract_molblock(lines: &[String]) -> String {
    let mut molblock_lines =
        if let Some(end) = lines.iter().position(|line| line.trim() == "M  END") {
            lines[..=end].to_vec()
        } else {
            lines.to_vec()
        };
    normalize_molblock_header(&mut molblock_lines);
    molblock_lines.join("\n")
}

#[cfg(test)]
fn normalize_molblock_header(lines: &mut Vec<String>) {
    let Some(mut counts_index) = lines.iter().position(|line| is_molfile_counts_line(line)) else {
        return;
    };
    while counts_index < 3 {
        lines.insert(counts_index, String::new());
        counts_index += 1;
    }
}

#[cfg(test)]
fn is_molfile_counts_line(line: &str) -> bool {
    let fields: Vec<&str> = line.split_whitespace().collect();
    fields.len() >= 10
        && matches!(fields.last(), Some(&"V2000" | &"V3000"))
        && fields[0].parse::<usize>().is_ok()
        && fields[1].parse::<usize>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_multi_record_sdf_separator() {
        let collection = parse_sdf_grid(
            r#"Mol A
  Burrete

  0  0  0  0  0  0            999 V2000
M  END
>  <ID>
A1

$$$$
Mol B
  Burrete

  0  0  0  0  0  0            999 V2000
M  END
>  <SMILES>
CCO

$$$$
"#,
            5000,
        );

        assert_eq!(collection.records_total, 2);
        assert_eq!(collection.records.len(), 2);
        assert_eq!(collection.records[0].name, "A1");
        assert_eq!(collection.records[1].name, "Mol B");
        assert_eq!(collection.records[1].smiles.as_deref(), Some("CCO"));
    }

    #[test]
    fn delimited_table_keeps_quoted_commas_and_extra_properties() {
        let collection = parse_delimited_table(
            r#"smiles,name,assay note,score
"CC(=O)O","Acetic, acid","active, primary",7.5
C1=CC=CC=C1,Benzene,,3.1
"#,
            ',',
            "csv",
            5000,
        )
        .expect("csv with smiles header should parse");

        assert_eq!(collection.records_total, 2);
        assert_eq!(collection.records[0].name, "Acetic, acid");
        assert_eq!(collection.records[0].smiles.as_deref(), Some("CC(=O)O"));
        assert_eq!(
            collection.records[0]
                .props
                .get("assay note")
                .map(String::as_str),
            Some("active, primary")
        );
        assert_eq!(
            collection.records[0].props.get("score").map(String::as_str),
            Some("7.5")
        );
        assert!(!collection.records[1].props.contains_key("assay note"));
    }

    #[test]
    fn delimited_rows_fallback_skips_header_and_non_smiles_rows() {
        let collection = parse_delimited_rows_as_smiles(
            r#"name	value
not-a-smiles	ignored
CCO	Ethanol	liquid
c1ccccc1	Benzene	aromatic
"#,
            '\t',
            "tsv",
            5000,
        );

        assert_eq!(collection.records_total, 2);
        assert_eq!(collection.records[0].index, 0);
        assert_eq!(collection.records[0].name, "Ethanol");
        assert_eq!(collection.records[0].smiles.as_deref(), Some("CCO"));
        assert_eq!(
            collection.records[0]
                .props
                .get("Column 3")
                .map(String::as_str),
            Some("liquid")
        );
        assert_eq!(collection.records[1].name, "Benzene");
    }

    #[test]
    fn smiles_detection_rejects_headers_and_plain_words() {
        for value in [
            "smiles",
            "name",
            "compound",
            "ethanol",
            "water sample",
            "#comment",
        ] {
            assert!(
                !looks_like_smiles(value),
                "{value} should not parse as SMILES"
            );
        }

        for value in ["CCO", "C1=CC=CC=C1", "c1ccccc1", "ClCBr"] {
            assert!(looks_like_smiles(value), "{value} should parse as SMILES");
        }
    }

    #[test]
    fn sdf_properties_and_molblock_stop_at_m_end() {
        let lines = normalized_lines(
            r#"Mol A
  Burrete

  0  0  0  0  0  0            999 V2000
M  END
>  <ID>
A1

>  <Long Note>
line one
line two

$$$$
"#,
        );

        let props = parse_sdf_properties(&lines);
        assert_eq!(props.get("ID").map(String::as_str), Some("A1"));
        assert_eq!(
            props.get("Long Note").map(String::as_str),
            Some("line one\nline two")
        );

        let molblock = extract_molblock(&lines);
        assert!(molblock.contains("M  END"));
        assert!(!molblock.contains("<ID>"));
    }
}
