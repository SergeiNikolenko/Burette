use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{hash_map::DefaultHasher, BTreeMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::time::Instant;
use tauri::{Emitter, Manager, RunEvent, Runtime};

const MAX_STRUCTURE_FILE_SIZE: u64 = 75 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerPreferences {
    theme: String,
    canvas_background: String,
    renderer_mode: String,
    xyz_fast_style: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewerDocument {
    id: String,
    path: String,
    title: String,
    extension: String,
    renderer: String,
    runtime_path: String,
    byte_count: u64,
}

#[derive(Clone)]
struct FormatInfo {
    molstar_format: &'static str,
    is_binary: bool,
    external_only: bool,
}

#[tauri::command]
fn startup_documents() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| Path::new(arg).is_file())
        .collect()
}

#[tauri::command]
fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
) -> Result<Vec<ViewerDocument>, String> {
    paths
        .into_iter()
        .map(|path| open_document(&app, PathBuf::from(path), &preferences))
        .collect()
}

#[tauri::command]
fn clear_preview_cache<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer");
    if !base.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&base).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_name() != "assets" {
            let _ = fs::remove_dir_all(entry.path());
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[tauri::command]
fn open_logs_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let releases_url = "https://github.com/SergeiNikolenko/Burrete/releases";
    if url != releases_url && !url.starts_with(&(String::from(releases_url) + "/")) {
        return Err("Only Burrete release URLs can be opened from Settings".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|err| err.to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn reset_quick_look() -> Result<(), String> {
    Command::new("/usr/bin/qlmanage")
        .arg("-r")
        .spawn()
        .map_err(|err| err.to_string())?;
    Command::new("/usr/bin/qlmanage")
        .args(["-r", "cache"])
        .spawn()
        .map_err(|err| err.to_string())?;
    Command::new("/usr/bin/killall")
        .arg("quicklookd")
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn reset_quick_look() -> Result<(), String> {
    Err("Quick Look reset is only available on macOS".into())
}

fn open_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: PathBuf,
    preferences: &ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata = fs::metadata(&canonical).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", canonical.display()));
    }
    if metadata.len() > MAX_STRUCTURE_FILE_SIZE {
        return Err(format!(
            "{} is larger than the 75 MB preview limit",
            canonical.display()
        ));
    }
    let data = fs::read(&canonical).map_err(|err| err.to_string())?;
    if data.is_empty() {
        return Err(format!("{} is empty", canonical.display()));
    }

    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if let Some(runtime_path) =
        create_grid_runtime(app, &canonical, &extension, &data, preferences)?
    {
        return Ok(ViewerDocument {
            id: stable_id(&canonical),
            path: canonical.to_string_lossy().to_string(),
            title: file_title(&canonical),
            extension,
            renderer: "grid2d".to_string(),
            runtime_path: runtime_path.to_string_lossy().to_string(),
            byte_count: metadata.len(),
        });
    }
    if grid_requires_preview(&extension) {
        return Err(format!(
            "{} does not contain supported molecule grid records",
            canonical.display()
        ));
    }

    let format = format_for_extension(&extension)?;
    let renderer = resolve_renderer(&format, &preferences.renderer_mode);
    let runtime_path = create_runtime(
        app,
        &canonical,
        &extension,
        &format,
        &renderer,
        &data,
        preferences,
    )?;
    Ok(ViewerDocument {
        id: stable_id(&canonical),
        path: canonical.to_string_lossy().to_string(),
        title: file_title(&canonical),
        extension,
        renderer,
        runtime_path: runtime_path.to_string_lossy().to_string(),
        byte_count: metadata.len(),
    })
}

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

fn create_grid_runtime<R: Runtime>(
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
        "capabilities": {
            "selection": true,
            "export": true,
            "substructureSearch": true,
            "rendererSwitch": matches!(extension, "sdf" | "sd")
        }
    });
    let config_text = serde_json::to_string(&config).map_err(|err| err.to_string())?;
    let records_text = serde_json::to_string(&records_payload).map_err(|err| err.to_string())?;
    let wasm_path = assets.join("rdkit").join("RDKit_minimal.wasm");
    let wasm_base64 =
        BASE64.encode(fs::read(&wasm_path).map_err(|err| format!("read RDKit wasm: {err}"))?);

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
        format!("window.BurreteGridRecords = {records_text};\nwindow.BurreteRDKitWasmBase64 = \"{wasm_base64}\";\n"),
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
    let grid_css = asset_url(&assets.join("grid.css"));
    let config_js = asset_url(&runtime.join("preview-config.js"));
    let records_js = asset_url(&runtime.join("preview-grid-records.js"));
    let rdkit_js = asset_url(&assets.join("rdkit").join("RDKit_minimal.js"));
    let grid_js = asset_url(&assets.join("grid-viewer.js"));
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Burrete Grid - {title}</title>
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

fn grid_can_preview(extension: &str) -> bool {
    matches!(extension, "csv" | "sd" | "sdf" | "smi" | "smiles" | "tsv")
}

fn grid_requires_preview(extension: &str) -> bool {
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
        if line.trim() == "$$" {
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
        } else if ch == 'B' && chars.peek() == Some(&'r') {
            has_atom = true;
            chars.next();
        } else if ch == 'C' && chars.peek() == Some(&'l') {
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

fn normalized_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_string)
        .collect()
}

fn decode_text(data: &[u8]) -> String {
    String::from_utf8_lossy(data).into_owned()
}

fn clipped(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let keep = limit.saturating_sub(3);
    value.chars().take(keep).collect::<String>() + "..."
}

fn create_runtime<R: Runtime>(
    app: &tauri::AppHandle<R>,
    file_path: &Path,
    extension: &str,
    format: &FormatInfo,
    renderer: &str,
    data: &[u8],
    preferences: &ViewerPreferences,
) -> Result<PathBuf, String> {
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

    let payload = if renderer == "xyz-fast" {
        xyz_first_frame(data).unwrap_or_else(|| XyzPayload {
            data: data.to_vec(),
            atom_count: None,
            frame_count: None,
            comment: None,
        })
    } else {
        XyzPayload {
            data: data.to_vec(),
            atom_count: None,
            frame_count: None,
            comment: None,
        }
    };

    let mut config = json!({
        "format": format.molstar_format,
        "molstarFormat": format.molstar_format,
        "binary": format.is_binary,
        "renderer": renderer,
        "requestedRenderer": normalize_renderer_mode(&preferences.renderer_mode),
        "allowMolstarFallback": true,
        "label": file_path.file_name().and_then(|value| value.to_str()).unwrap_or("structure"),
        "byteCount": data.len(),
        "previewByteCount": payload.data.len(),
        "quickLookBuild": "burrete-tauri",
        "debug": false,
        "theme": preferences.theme,
        "canvasBackground": preferences.canvas_background,
        "uiScale": 1.0,
        "overlayOpacity": 0.90,
        "transparentBackground": preferences.canvas_background == "transparent",
        "sdfGrid": true,
        "appViewer": true,
        "tauriViewer": true,
        "xyzrenderViewer": false,
        "molstarAvailable": !format.external_only,
        "canOpenInVesta": matches!(extension, "xyz" | "cub" | "cube"),
        "showPanelControls": true,
        "defaultLayoutState": { "left": "collapsed", "right": "hidden", "top": "hidden", "bottom": "hidden" }
    });

    if renderer == "xyz-fast" {
        config["xyzFast"] = json!({
            "style": preferences.xyz_fast_style,
            "firstFrameOnly": true,
            "showCell": true,
            "sourceByteCount": data.len(),
            "previewByteCount": payload.data.len(),
            "atomCount": payload.atom_count,
            "frameCount": payload.frame_count,
            "comment": payload.comment
        });
    }

    if renderer == "xyzrender-external" {
        let artifact = create_xyzrender_artifact(file_path, &runtime, preferences)?;
        config["xyzrenderViewer"] = json!(true);
        config["xyzrenderPreset"] = json!(artifact.preset);
        config["xyzrenderPresetOptions"] = xyzrender_preset_options();
        config["externalArtifact"] = json!({
            "path": artifact.relative_path,
            "type": artifact.output_type,
            "renderer": "xyzrender",
            "preset": artifact.preset,
            "config": artifact.config_argument,
            "elapsedMs": artifact.elapsed_ms,
            "log": artifact.log
        });
    }

    let config_text = serde_json::to_string(&config).map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("index.html"),
        viewer_html(file_path, &runtime, &assets, renderer, preferences),
    )
    .map_err(|err| err.to_string())?;
    fs::write(runtime.join("viewer-runtime.css"), viewer_runtime_css())
        .map_err(|err| err.to_string())?;
    fs::write(runtime.join("viewer-bridge.js"), viewer_bridge_js())
        .map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-config.js"),
        format!("window.BurreteConfig = {config_text};\n"),
    )
    .map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-data.js"),
        format!(
            "window.BurreteDataBase64 = \"{}\";\n",
            BASE64.encode(&payload.data)
        ),
    )
    .map_err(|err| err.to_string())?;
    Ok(runtime.join("index.html"))
}

fn copy_web_assets<R: Runtime>(app: &tauri::AppHandle<R>, assets: &Path) -> Result<(), String> {
    let source = bundled_web_dir(app)?;
    for name in [
        "molstar.js",
        "molstar.css",
        "burette-agent.js",
        "viewer.js",
        "xyz-fast.js",
        "grid-viewer.js",
        "grid.css",
    ] {
        fs::copy(source.join(name), assets.join(name))
            .map_err(|err| format!("copy {name}: {err}"))?;
    }
    let rdkit_source = source.join("rdkit");
    if rdkit_source.exists() {
        copy_dir_all(&rdkit_source, &assets.join("rdkit"))?;
    }
    Ok(())
}

fn bundled_web_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource) = app
        .path()
        .resolve("Web", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            return Ok(resource);
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest_dir
        .parent()
        .unwrap_or(&manifest_dir)
        .join("PreviewExtension")
        .join("Web");
    if dev.exists() {
        return Ok(dev);
    }
    Err("Burrete Web runtime assets were not found".into())
}

fn copy_dir_all(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    for entry in fs::read_dir(source).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let ty = entry.file_type().map_err(|err| err.to_string())?;
        let next_dest = destination.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &next_dest)?;
        } else {
            fs::copy(entry.path(), next_dest).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn viewer_html(
    file_path: &Path,
    runtime: &Path,
    assets: &Path,
    renderer: &str,
    preferences: &ViewerPreferences,
) -> String {
    let title = escape_html(
        file_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("structure"),
    );
    let background_class = if preferences.canvas_background == "transparent" {
        "burette-transparent-background"
    } else {
        "burette-opaque-background"
    };
    let runtime_css = asset_url(&runtime.join("viewer-runtime.css"));
    let bridge_js = asset_url(&runtime.join("viewer-bridge.js"));
    let config_js = asset_url(&runtime.join("preview-config.js"));
    let data_js = asset_url(&runtime.join("preview-data.js"));
    let agent_js = asset_url(&assets.join("burette-agent.js"));
    let viewer_js = asset_url(&assets.join("viewer.js"));
    let molstar_css = asset_url(&assets.join("molstar.css"));
    let molstar_js = asset_url(&assets.join("molstar.js"));
    let xyz_fast_js = asset_url(&assets.join("xyz-fast.js"));
    let renderer_assets = match renderer {
        "xyz-fast" => format!(r#"<script src="{xyz_fast_js}"></script>"#),
        "xyzrender-external" => format!(r#"<link rel="stylesheet" href="{molstar_css}" />"#),
        _ => format!(
            r#"<link rel="stylesheet" href="{molstar_css}" /><script src="{molstar_js}"></script>"#
        ),
    };
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Burrete - {title}</title>
  <link rel="stylesheet" href="{runtime_css}" />
  <script src="{bridge_js}"></script>
</head>
<body class="{background_class}">
  <div id="app"></div>
  <div id="buret-toolbar" role="toolbar" aria-label="Burrete viewer controls">
    <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">••</button>
    <button class="buret-button buret-panel-toggle active" type="button" data-buret-toggle="left" title="Toggle left panel">L</button>
    <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" title="Toggle right panel">R</button>
    <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" title="Toggle sequence panel">Seq</button>
    <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" title="Toggle log panel">Log</button>
    <button class="buret-button" type="button" data-buret-action="theme" title="Switch theme">Light</button>
    <button class="buret-button hidden" type="button" data-buret-action="open-vesta" title="Open in VESTA">VESTA</button>
    <div class="buret-renderer-control" data-buret-renderer-control>
      <button class="buret-button" type="button" data-buret-renderer="xyz-fast">Fast</button>
      <button class="buret-button" type="button" data-buret-renderer="molstar">Mol*</button>
      <button class="buret-button" type="button" data-buret-renderer="xyzrender-external">xyzr</button>
      <select class="buret-select" data-buret-xyzrender-preset aria-label="External xyzrender preset"></select>
    </div>
  </div>
  <div id="status" class="hidden">Loading {title}...</div>
  {renderer_assets}
  <script src="{config_js}"></script>
  <script src="{data_js}"></script>
  <script src="{agent_js}"></script>
  <script src="{viewer_js}"></script>
</body>
</html>"#
    )
}

fn asset_url(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("http://asset.localhost/{}", percent_encode_path(path))
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("asset://localhost/{}", percent_encode_path(path))
    }
}

fn percent_encode_path(path: &Path) -> String {
    path.to_string_lossy()
        .as_bytes()
        .iter()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn viewer_runtime_css() -> &'static str {
    r#"html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
.burette-opaque-background{background:#0b0b0c}
.burette-transparent-background{background:transparent}
#status{position:absolute;left:14px;right:14px;bottom:14px;z-index:20;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(18,18,18,.84);font-size:12px;white-space:pre-wrap}
#status.hidden{display:none}
#status.error{display:block;color:#ffb4ab}
#buret-toolbar{position:absolute;top:12px;right:12px;z-index:30;display:flex;gap:6px;align-items:center;padding:6px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(18,18,18,.76);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.buret-button,.buret-select{height:28px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.08);color:#fff;padding:0 8px;font:600 11px -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
.buret-button:hover{background:rgba(255,255,255,.14)}
.buret-button.active{background:rgba(225,121,9,.34);border-color:rgba(225,121,9,.55)}
.buret-grip{width:28px;padding:0}
.buret-grip svg{width:17px;height:17px}
.hidden{display:none!important}"#
}

fn viewer_bridge_js() -> &'static str {
    r#"(() => {
  const postToParent = (body) => {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ source: 'burrete-viewer', body }, window.location.origin);
      } catch (_) {
        try {
          window.parent.postMessage({ source: 'burrete-viewer', body }, '*');
        } catch (_) {}
      }
    }
  };
  window.webkit = window.webkit || { messageHandlers: { burrete: { postMessage: postToParent } } };
  window.__mqlPost = (type, message) => postToParent({ type, message: message || '' });
  window.__mqlAction = (name) => window.webkit.messageHandlers.burrete.postMessage({ type: 'action', message: name });
  window.__mqlDebug = () => {};
  window.BurreteInlineMode = true;
  window.BurreteDebug = false;
  window.BurretePanelControlsVisible = false;
  window.BurreteCacheBuster = String(Date.now());
})();"#
}

fn format_for_extension(extension: &str) -> Result<FormatInfo, String> {
    let format = match extension {
        "pdb" => FormatInfo {
            molstar_format: "pdb",
            is_binary: false,
            external_only: false,
        },
        "cif" | "mmcif" => FormatInfo {
            molstar_format: "mmcif",
            is_binary: false,
            external_only: false,
        },
        "bcif" => FormatInfo {
            molstar_format: "mmcif",
            is_binary: true,
            external_only: false,
        },
        "sdf" | "sd" => FormatInfo {
            molstar_format: "sdf",
            is_binary: false,
            external_only: false,
        },
        "mol" => FormatInfo {
            molstar_format: "mol",
            is_binary: false,
            external_only: false,
        },
        "mol2" => FormatInfo {
            molstar_format: "mol2",
            is_binary: false,
            external_only: false,
        },
        "xyz" => FormatInfo {
            molstar_format: "xyz",
            is_binary: false,
            external_only: false,
        },
        "gro" => FormatInfo {
            molstar_format: "gro",
            is_binary: false,
            external_only: false,
        },
        "cub" | "cube" => FormatInfo {
            molstar_format: "xyz",
            is_binary: false,
            external_only: true,
        },
        other => return Err(format!("Unsupported structure extension: {other}")),
    };
    Ok(format)
}

struct XyzrenderArtifact {
    relative_path: &'static str,
    output_type: &'static str,
    preset: &'static str,
    config_argument: &'static str,
    elapsed_ms: u128,
    log: String,
}

fn create_xyzrender_artifact(
    input_path: &Path,
    output_directory: &Path,
    _preferences: &ViewerPreferences,
) -> Result<XyzrenderArtifact, String> {
    let output_path = output_directory.join("xyzrender.svg");
    let log_path = output_directory.join("xyzrender.log");
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&log_path);
    let started = Instant::now();
    let output = Command::new(resolve_xyzrender_executable()?)
        .arg(input_path)
        .arg("-o")
        .arg(&output_path)
        .arg("--config")
        .arg("default")
        .output()
        .map_err(|err| format!("External xyzrender could not be started: {err}"))?;
    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    let _ = fs::write(&log_path, &log);
    if !output.status.success() {
        return Err(format!(
            "External xyzrender failed with exit status {}. {}",
            output.status.code().unwrap_or(-1),
            truncate_text(&log, 320)
        ));
    }
    let metadata = fs::metadata(&output_path).map_err(|_| {
        "External xyzrender finished but did not produce an SVG output file".to_string()
    })?;
    if metadata.len() == 0 {
        return Err("External xyzrender produced an empty SVG output file".into());
    }
    Ok(XyzrenderArtifact {
        relative_path: "xyzrender.svg",
        output_type: "svg",
        preset: "default",
        config_argument: "default",
        elapsed_ms: started.elapsed().as_millis(),
        log,
    })
}

fn resolve_xyzrender_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/xyzrender"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join("xyzrender")));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/xyzrender"),
        PathBuf::from("/usr/local/bin/xyzrender"),
    ]);
    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("External xyzrender executable was not found. Install xyzrender in ~/.local/bin or make it available on PATH.".into())
}

fn xyzrender_preset_options() -> serde_json::Value {
    json!([
        { "value": "default", "label": "Default" },
        { "value": "flat", "label": "Flat" },
        { "value": "paton", "label": "Paton" },
        { "value": "pmol", "label": "PMol" },
        { "value": "skeletal", "label": "Skeletal" },
        { "value": "bubble", "label": "Bubble" },
        { "value": "tube", "label": "Tube" },
        { "value": "btube", "label": "BTube" },
        { "value": "mtube", "label": "MTube" },
        { "value": "wire", "label": "Wire" },
        { "value": "graph", "label": "Graph" },
        { "value": "custom", "label": "Custom JSON" }
    ])
}

fn truncate_text(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>()
        + "..."
}

fn normalize_renderer_mode(raw: &str) -> &str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "xyz-fast" | "fast-xyz" | "xyzfast" => "xyz-fast",
        "molstar" | "mol*" | "interactive" => "molstar",
        "xyzrender-external" | "external-xyzrender" | "xyzrender" => "xyzrender-external",
        _ => "auto",
    }
}

fn resolve_renderer(format: &FormatInfo, requested: &str) -> String {
    if format.external_only {
        return "xyzrender-external".to_string();
    }
    let is_xyz = format.molstar_format == "xyz" && !format.is_binary;
    match normalize_renderer_mode(requested) {
        "molstar" => "molstar".to_string(),
        "xyz-fast" => if is_xyz { "xyz-fast" } else { "molstar" }.to_string(),
        "xyzrender-external" => if is_xyz {
            "xyzrender-external"
        } else {
            "molstar"
        }
        .to_string(),
        _ => if is_xyz { "xyz-fast" } else { "molstar" }.to_string(),
    }
}

struct XyzPayload {
    data: Vec<u8>,
    atom_count: Option<usize>,
    frame_count: Option<usize>,
    comment: Option<String>,
}

fn xyz_first_frame(data: &[u8]) -> Option<XyzPayload> {
    let text = String::from_utf8_lossy(data)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let mut start = 0;
    while start < lines.len() && lines[start].trim().is_empty() {
        start += 1;
    }
    let atom_count: usize = lines.get(start)?.split_whitespace().next()?.parse().ok()?;
    if atom_count == 0 || start + atom_count + 1 >= lines.len() {
        return None;
    }
    let end = start + atom_count + 2;
    let mut first_frame = lines[start..end].join("\n");
    if !first_frame.ends_with('\n') {
        first_frame.push('\n');
    }
    Some(XyzPayload {
        data: first_frame.into_bytes(),
        atom_count: Some(atom_count),
        frame_count: count_xyz_frames(&lines, start),
        comment: lines.get(start + 1).map(|value| value.to_string()),
    })
}

fn count_xyz_frames(lines: &[&str], mut index: usize) -> Option<usize> {
    let mut frames = 0;
    while index < lines.len() && frames < 100_000 {
        while index < lines.len() && lines[index].trim().is_empty() {
            index += 1;
        }
        let Some(atom_count) = lines
            .get(index)
            .and_then(|line| line.split_whitespace().next())
            .and_then(|value| value.parse::<usize>().ok())
        else {
            break;
        };
        if atom_count == 0 || index + atom_count + 1 >= lines.len() {
            break;
        }
        frames += 1;
        index += atom_count + 2;
    }
    (frames > 0).then_some(frames)
}

fn file_title(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("structure")
        .to_string()
}

fn stable_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn prune_runtime_dirs(base: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    let mut runtimes: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != "assets")
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();
    runtimes.sort_by_key(|(_, modified)| *modified);
    let overflow = runtimes.len().saturating_sub(24);
    for (path, _) in runtimes.into_iter().take(overflow) {
        let _ = fs::remove_dir_all(path);
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(true);
                let _ = window.set_shadow(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup_documents,
            open_documents,
            clear_preview_cache,
            open_logs_folder,
            open_external_url,
            reset_quick_look,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Burrete Tauri application")
        .run(|app, event| {
            if let RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_file())
                    .map(|path| path.to_string_lossy().to_string())
                    .collect();
                if !paths.is_empty() {
                    let _ = app.emit("open-documents", paths);
                }
            }
        });
}
