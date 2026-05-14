use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

use super::runtime::ViewerPreferences;
use super::runtime_utils::{
    asset_url, clipped, decode_text, escape_html, normalized_lines, prune_runtime_dirs,
};
use super::runtime_viewer::copy_web_assets;

#[derive(Debug)]
struct GridCollection {
    format: &'static str,
    records: Vec<GridRecord>,
    records_total: usize,
}

#[derive(Debug)]
struct GridRecord {
    index: usize,
    name: String,
    smiles: Option<String>,
    molblock: Option<String>,
    props: BTreeMap<String, String>,
}

pub(crate) fn create_grid_runtime<R: Runtime>(
    app: &tauri::AppHandle<R>,
    file_path: &Path,
    extension: &str,
    data: &[u8],
    preferences: &ViewerPreferences,
) -> Result<Option<PathBuf>, String> {
    if !grid_can_preview(extension) {
        return Ok(None);
    }

    let text = decode_text(data);
    let collection = match extension {
        "csv" => parse_delimited_table_with_fallback(&text, ',', "csv", 5000)?,
        "tsv" => parse_delimited_table_with_fallback(&text, '\t', "tsv", 5000)?,
        "smi" | "smiles" => parse_smiles_grid(&text, 5000),
        "sdf" | "sd" => parse_sdf_grid(&text, 5000),
        _ => return Ok(None),
    };

    if collection.records_total == 0
        || ((extension == "sdf" || extension == "sd") && collection.records_total <= 1)
    {
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
    copy_web_assets(app, &assets)?;
    prune_runtime_dirs(&base);

    let records_included = collection.records.len();
    let records_payload: Vec<_> = collection
        .records
        .iter()
        .map(|record| {
            let mut payload = json!({
                "index": record.index,
                "name": record.name,
                "props": record.props,
            });
            if let Some(smiles) = &record.smiles {
                payload["smiles"] = json!(smiles);
            }
            if let Some(molblock) = &record.molblock {
                payload["molblock"] = json!(molblock);
            }
            payload
        })
        .collect();
    let config = json!({
        "mode": "grid2d",
        "format": collection.format,
        "renderer": "grid2d",
        "label": file_path.file_name().and_then(|value| value.to_str()).unwrap_or("molecule collection"),
        "byteCount": data.len(),
        "host": "app",
        "quickLookBuild": "burrete-tauri-grid2d",
        "debug": false,
        "appViewer": true,
        "tauriViewer": true,
        "theme": preferences.theme,
        "canvasBackground": preferences.canvas_background,
        "overlayOpacity": 0.90,
        "transparentBackground": preferences.canvas_background == "transparent",
        "recordsTotal": collection.records_total,
        "recordsIncluded": records_included,
        "recordsTruncated": collection.records_total > records_included,
        "pageSize": 96,
        "rdkitWasmPath": asset_url(&assets.join("rdkit").join("RDKit_minimal.wasm")),
        "capabilities": {
            "selection": true,
            "export": true,
            "substructureSearch": true,
            "rendererSwitch": matches!(extension, "sdf" | "sd")
        }
    });
    let config_text = serde_json::to_string(&config).map_err(|err| err.to_string())?;
    let records_text = serde_json::to_string(&records_payload).map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("index.html"),
        grid_html(file_path, &runtime, &assets, preferences),
    )
    .map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-config.js"),
        format!("window.BurreteConfig = {config_text};\n"),
    )
    .map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-grid-records.js"),
        format!("window.BurreteGridRecords = {records_text};\n"),
    )
    .map_err(|err| err.to_string())?;
    Ok(Some(runtime.join("index.html")))
}

fn grid_html(
    file_path: &Path,
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
    let background_class = if preferences.canvas_background == "transparent" {
        "burette-transparent-background"
    } else {
        "burette-opaque-background"
    };
    let grid_css = versioned_asset_url(&assets.join("grid.css"));
    let config_js = asset_url(&runtime.join("preview-config.js"));
    let records_js = asset_url(&runtime.join("preview-grid-records.js"));
    let rdkit_js = versioned_asset_url(&assets.join("rdkit").join("RDKit_minimal.js"));
    let grid_js = versioned_asset_url(&assets.join("grid-viewer.js"));
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Burrete Grid - {title}</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' file: asset: data: blob:; connect-src 'self' file: asset: data: blob:; script-src 'self' 'unsafe-inline' file: asset:; style-src 'self' 'unsafe-inline' file: asset:; img-src 'self' file: asset: data: blob:; worker-src 'self' blob:;" />
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
  <script src="{records_js}"></script>
  <script src="{rdkit_js}"></script>
  <script src="{grid_js}"></script>
</body>
</html>"#
    )
}

fn versioned_asset_url(path: &Path) -> String {
    format!("{}?v=grid-ui-v4", asset_url(path))
}

fn grid_can_preview(extension: &str) -> bool {
    matches!(extension, "csv" | "sd" | "sdf" | "smi" | "smiles" | "tsv")
}

pub(crate) fn grid_requires_preview(extension: &str) -> bool {
    matches!(extension, "csv" | "smi" | "smiles" | "tsv")
}

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

fn is_smiles_column(value: &str) -> bool {
    matches!(
        value,
        "smiles" | "smile" | "canonical_smiles" | "isomeric_smiles" | "cxsmiles" | "smiles_string"
    )
}

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

fn property_name(line: &str) -> Option<String> {
    let open = line.find('<')?;
    let close = line[open + 1..].find('>')? + open + 1;
    (open < close).then(|| line[open + 1..close].trim().to_string())
}

fn extract_molblock(lines: &[String]) -> String {
    if let Some(end) = lines.iter().position(|line| line.trim() == "M  END") {
        return lines[..=end].join("\n");
    }
    lines.join("\n")
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
}
