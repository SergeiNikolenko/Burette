use base64::Engine;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

use super::formats::{FormatInfo, normalize_renderer_mode};
use super::runtime::{ViewerPreferences, ViewerReloadOptions};
use super::runtime_utils::{asset_url, escape_html, prune_runtime_dirs, stable_id};
use super::text_xyz::{converted_data_from_text, xyz_data_from_text};
use super::xyz::{XyzPayload, xyz_first_frame};
use super::xyzrender::{
    create_xyzrender_artifact, default_xyzrender_document_defaults, xyzrender_preset_options,
};

const XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT: usize = 1500;

pub(crate) struct CreatedRuntime {
    pub(crate) path: PathBuf,
    pub(crate) renderer: String,
}

pub(crate) struct DockingRuntimeSource {
    pub(crate) path: String,
    pub(crate) label: String,
    pub(crate) extension: String,
    pub(crate) format: String,
    pub(crate) binary: bool,
    pub(crate) data: Vec<u8>,
    pub(crate) byte_count: usize,
}

pub(crate) fn create_runtime<R: Runtime>(
    app: &tauri::AppHandle<R>,
    file_path: &Path,
    extension: &str,
    format: &FormatInfo,
    renderer: &str,
    data: &[u8],
    preferences: &ViewerPreferences,
    reload_options: Option<&ViewerReloadOptions>,
) -> Result<CreatedRuntime, String> {
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

    let label = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("structure");
    let source_xyz_data = xyz_data_from_text(data, extension, label);
    let converted_molstar_data = converted_data_from_text(data, extension, label);
    let external_molstar_data =
        if format.external_only || should_use_converted_molstar_data(format, &converted_molstar_data) {
            converted_molstar_data.clone()
        } else {
            None
        };
    let xyz_payload = if format.molstar_format == "xyz" && !format.is_binary {
        xyz_first_frame(data)
    } else {
        None
    };
    let xyz_frame_count = xyz_payload
        .as_ref()
        .and_then(|payload| payload.frame_count)
        .unwrap_or(0);
    let is_xyz_trajectory = xyz_frame_count > 1;
    let xyzrender_available = xyzrender_available_for_document(format, data);
    let mut renderer = renderer.to_string();
    let requested_renderer = normalize_renderer_mode(&preferences.renderer_mode);
    if is_xyz_trajectory
        && matches!(requested_renderer, "auto" | "xyz-fast")
        && renderer != "molstar"
    {
        renderer = "molstar".to_string();
    }
    if renderer == "xyzrender-external" && !xyzrender_available {
        renderer = "molstar".to_string();
    }
    if renderer == "molstar" && format.external_only && external_molstar_data.is_none() {
        renderer = "xyzrender-external".to_string();
    }
    let mut external_artifact = None;
    let mut external_status = None;
    let default_xyzrender = default_xyzrender_document_defaults(extension, file_path, data);
    let xyzrender_controls = reload_options
        .and_then(|options| options.xyzrender_controls.as_ref())
        .or(default_xyzrender
            .as_ref()
            .map(|defaults| &defaults.controls));
    let xyzrender_artifact_input = default_xyzrender
        .as_ref()
        .and_then(|defaults| defaults.input_path.as_deref())
        .unwrap_or(file_path);
    let xyzrender_input_data = if matches!(extension, "cub" | "cube") {
        None
    } else {
        source_xyz_data.as_deref()
    };
    if renderer == "xyzrender-external" {
        match create_xyzrender_artifact(
            xyzrender_artifact_input,
            &runtime,
            reload_options.and_then(|options| options.xyzrender_preset.as_deref()),
            reload_options.and_then(|options| options.xyzrender_orientation_ref.as_deref()),
            xyzrender_controls,
            xyzrender_input_data,
        ) {
            Ok(artifact) => {
                external_artifact = Some(artifact);
            }
            Err(error)
                if !format.external_only && format.molstar_format == "xyz" && !format.is_binary =>
            {
                renderer = "xyz-fast".to_string();
                external_status = Some(json!({
                    "status": "fallback",
                    "requested": "xyzrender-external",
                    "message": format!("Using Fast XYZ because external xyzrender failed: {error}")
                }));
            }
            Err(error) if external_molstar_data.is_some() => {
                renderer = "molstar".to_string();
                external_status = Some(json!({
                    "status": "fallback",
                    "requested": "xyzrender-external",
                    "message": format!("Using Mol* because external xyzrender failed: {error}")
                }));
            }
            Err(error) => return Err(error),
        }
    }

    let payload = if renderer == "molstar" {
        XyzPayload {
            data: external_molstar_data
                .as_ref()
                .map(|converted| converted.data.clone())
                .unwrap_or_else(|| data.to_vec()),
            atom_count: None,
            frame_count: None,
            comment: None,
        }
    } else if renderer == "xyz-fast" {
        xyz_payload.unwrap_or_else(|| XyzPayload {
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

    let molstar_format =
        if renderer == "molstar" && external_molstar_data.is_some() {
            external_molstar_data
                .as_ref()
                .map(|converted| converted.extension)
                .unwrap_or(format.molstar_format.as_str())
        } else {
            format.molstar_format.as_str()
        };
    let mut config = json!({
        "format": molstar_format,
        "molstarFormat": molstar_format,
        "binary": format.is_binary,
        "renderer": renderer,
        "requestedRenderer": normalize_renderer_mode(&preferences.renderer_mode),
        "allowMolstarFallback": true,
        "label": label,
        "byteCount": data.len(),
        "previewByteCount": payload.data.len(),
        "quickLookBuild": "burrete-tauri",
        "debug": false,
        "theme": preferences.theme_for_runtime(),
        "themeTokens": preferences.theme_tokens(),
        "canvasBackground": preferences.canvas_background_for_runtime(),
        "documentId": stable_id(file_path),
        "uiScale": 0.9,
        "overlayOpacity": 0.90,
        "transparentBackground": preferences.resolved_transparent_background(),
        "sdfGrid": true,
        "sdfPosePager": renderer == "molstar" && molstar_format == "sdf" && !format.is_binary,
        "trajectoryControls": renderer == "molstar" && is_xyz_trajectory,
        "trajectoryFrameCount": xyz_frame_count,
        "appViewer": true,
        "tauriViewer": true,
        "molstarStyle": preferences.resolved_molstar_style(),
        "xyzrenderViewer": false,
        "xyzrenderAvailable": xyzrender_available,
        "molstarAvailable": !format.external_only || external_molstar_data.is_some(),
        "canOpenInVesta": format.can_open_in_vesta,
        "showPanelControls": true,
        "defaultLayoutState": { "left": "hidden", "right": "hidden", "top": "hidden", "bottom": "hidden" }
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

    if let Some(artifact) = external_artifact {
        config["xyzrenderViewer"] = json!(true);
        config["xyzrenderPreset"] = json!(artifact.preset);
        config["xyzrenderPresetOptions"] = xyzrender_preset_options();
        if let Some(controls) = xyzrender_controls {
            config["xyzrenderControls"] =
                serde_json::to_value(controls).map_err(|err| err.to_string())?;
        }
        config["externalArtifact"] = json!({
            "path": artifact.relative_path,
            "type": artifact.output_type,
            "renderer": "xyzrender",
            "preset": artifact.preset,
            "configArgument": artifact.config_argument,
            "elapsedMs": artifact.elapsed_ms,
            "log": artifact.log
        });
    }
    if let Some(status) = external_status {
        config["externalRendererStatus"] = status;
    }

    let config_text = serde_json::to_string(&config).map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("index.html"),
        viewer_html(file_path, &runtime, &assets, &renderer, preferences),
    )
    .map_err(|err| err.to_string())?;
    fs::write(runtime.join("viewer-bridge.js"), viewer_bridge_js())
        .map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-config.js"),
        format!("window.BurreteConfig = {config_text};\n"),
    )
    .map_err(|err| err.to_string())?;
    fs::write(runtime.join("preview-data.bin"), &payload.data).map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-data.js"),
        format!(
            "window.BurreteDataBase64 = {:?};\nwindow.BurreteDataURL = null;\n",
            base64::engine::general_purpose::STANDARD.encode(&payload.data)
        ),
    )
    .map_err(|err| err.to_string())?;
    Ok(CreatedRuntime {
        path: runtime.join("index.html"),
        renderer,
    })
}

pub(crate) fn create_docking_runtime<R: Runtime>(
    app: &tauri::AppHandle<R>,
    document_id: &str,
    label: &str,
    receptor: DockingRuntimeSource,
    ligands: Vec<DockingRuntimeSource>,
    preferences: &ViewerPreferences,
) -> Result<CreatedRuntime, String> {
    if ligands.is_empty() {
        return Err("Choose at least one ligand or pose file for docking view".to_string());
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

    let preview_byte_count = receptor.data.len()
        + ligands
            .iter()
            .map(|ligand| ligand.data.len())
            .sum::<usize>();
    let byte_count = receptor.byte_count
        + ligands
            .iter()
            .map(|ligand| ligand.byte_count)
            .sum::<usize>();
    let source_config = |source: &DockingRuntimeSource| {
        json!({
            "path": source.path,
            "label": source.label,
            "extension": source.extension,
            "format": source.format,
            "binary": source.binary,
            "byteCount": source.byte_count
        })
    };
    let sdf_grid_path = ligands
        .iter()
        .find(|ligand| ligand.format == "sdf" && sdf_record_count(&ligand.data) > 1)
        .map(|ligand| ligand.path.as_str());
    let config = json!({
        "format": receptor.format.as_str(),
        "molstarFormat": receptor.format.as_str(),
        "binary": receptor.binary,
        "renderer": "molstar",
        "requestedRenderer": "molstar",
        "allowMolstarFallback": false,
        "label": label,
        "byteCount": byte_count,
        "previewByteCount": preview_byte_count,
        "quickLookBuild": "burrete-tauri-docking",
        "debug": false,
        "theme": preferences.theme_for_runtime(),
        "themeTokens": preferences.theme_tokens(),
        "canvasBackground": preferences.canvas_background_for_runtime(),
        "documentId": document_id,
        "uiScale": 0.9,
        "overlayOpacity": 0.90,
        "transparentBackground": preferences.resolved_transparent_background(),
        "sdfGrid": false,
        "sdfGridPath": sdf_grid_path,
        "appViewer": true,
        "tauriViewer": true,
        "molstarStyle": preferences.resolved_molstar_style(),
        "xyzrenderViewer": false,
        "xyzrenderAvailable": false,
        "molstarAvailable": true,
        "canOpenInVesta": false,
        "showPanelControls": true,
        "defaultLayoutState": { "left": "hidden", "right": "hidden", "top": "hidden", "bottom": "hidden" },
        "docking": {
            "receptor": source_config(&receptor),
            "ligands": ligands.iter().map(source_config).collect::<Vec<_>>()
        }
    });
    let payloads = json!({
        "receptor": {
            "dataBase64": base64::engine::general_purpose::STANDARD.encode(&receptor.data)
        },
        "ligands": ligands.iter().map(|ligand| json!({
            "dataBase64": base64::engine::general_purpose::STANDARD.encode(&ligand.data)
        })).collect::<Vec<_>>()
    });
    let config_text = serde_json::to_string(&config).map_err(|err| err.to_string())?;
    let payload_text = serde_json::to_string(&payloads).map_err(|err| err.to_string())?;
    let title_path = PathBuf::from(label);
    fs::write(
        runtime.join("index.html"),
        viewer_html(&title_path, &runtime, &assets, "molstar", preferences),
    )
    .map_err(|err| err.to_string())?;
    fs::write(runtime.join("viewer-bridge.js"), viewer_bridge_js())
        .map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-config.js"),
        format!("window.BurreteConfig = {config_text};\n"),
    )
    .map_err(|err| err.to_string())?;
    fs::write(runtime.join("preview-data.bin"), b"\n").map_err(|err| err.to_string())?;
    fs::write(
        runtime.join("preview-data.js"),
        format!(
            "window.BurreteDataBase64 = \"Cg==\";\nwindow.BurreteDataURL = null;\nwindow.BurreteDockingPayloads = {payload_text};\n"
        ),
    )
    .map_err(|err| err.to_string())?;
    Ok(CreatedRuntime {
        path: runtime.join("index.html"),
        renderer: "molstar".to_string(),
    })
}

fn sdf_record_count(data: &[u8]) -> usize {
    String::from_utf8_lossy(data)
        .split("$$$$")
        .filter(|record| !record.trim().is_empty())
        .count()
}

fn should_use_converted_molstar_data(
    format: &FormatInfo,
    data: &Option<super::text_xyz::ConvertedStructureData>,
) -> bool {
    data.is_some()
        && !format.is_binary
        && matches!(format.molstar_format.as_str(), "mmcif" | "cifCore")
}

fn xyzrender_available_for_document(format: &FormatInfo, data: &[u8]) -> bool {
    if format.external_only || !can_use_external_xyzrender(format) {
        return true;
    }
    if !matches!(
        format.molstar_format.as_str(),
        "pdb" | "pdbqt" | "mmcif" | "cifCore"
    ) {
        return true;
    }
    let atom_count = protein_like_atom_record_count(data);
    atom_count == 0 || atom_count <= XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT
}

fn can_use_external_xyzrender(format: &FormatInfo) -> bool {
    !format.is_binary
        && matches!(
            format.molstar_format.as_str(),
            "sdf" | "pdb" | "pdbqt" | "mmcif" | "cifCore"
        )
}

fn protein_like_atom_record_count(data: &[u8]) -> usize {
    let text = String::from_utf8_lossy(data);
    let mut count = 0;
    for line in text.lines() {
        if line.starts_with("ATOM") || line.starts_with("HETATM") {
            count += 1;
            if count > XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT {
                return count;
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::{protein_like_atom_record_count, xyzrender_available_for_document};
    use crate::preview::formats::FormatInfo;

    fn format(molstar_format: &str) -> FormatInfo {
        FormatInfo {
            molstar_format: molstar_format.to_string(),
            is_binary: false,
            external_only: false,
            can_open_in_vesta: false,
        }
    }

    #[test]
    fn disables_xyzrender_for_large_protein_like_pdb() {
        let data = (0..1501)
            .map(|index| {
                format!(
                    "ATOM  {:5}  CA  ALA A{:4}       0.000   0.000   0.000  1.00 20.00           C\n",
                    index + 1,
                    index + 1
                )
            })
            .collect::<String>();
        assert_eq!(protein_like_atom_record_count(data.as_bytes()), 1501);
        assert!(!xyzrender_available_for_document(
            &format("pdb"),
            data.as_bytes()
        ));
    }

    #[test]
    fn keeps_xyzrender_for_small_pdb_ligand() {
        let data =
            b"ATOM      1  C   LIG A   1       0.000   0.000   0.000  1.00 20.00           C\n";
        assert!(xyzrender_available_for_document(&format("pdb"), data));
    }
}

pub(crate) fn copy_web_assets<R: Runtime>(
    app: &tauri::AppHandle<R>,
    assets: &Path,
) -> Result<(), String> {
    let source = bundled_web_dir(app)?;
    for name in [
        "molstar.js",
        "molstar.css",
        "viewer-runtime.css",
        "viewer-shell.js",
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
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or(&manifest_dir);
    let dev = repo_root.join("PreviewExtension").join("Web");
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
    let runtime_css = asset_url(&assets.join("viewer-runtime.css"));
    let shell_js = asset_url(&assets.join("viewer-shell.js"));
    let bridge_js = asset_url(&runtime.join("viewer-bridge.js"));
    let config_js = asset_url(&runtime.join("preview-config.js"));
    let data_js = asset_url(&runtime.join("preview-data.js"));
    let data_bin_js = asset_url(&runtime.join("preview-data.bin"));
    let agent_js = asset_url(&assets.join("burette-agent.js"));
    let viewer_js = asset_url(&assets.join("viewer.js"));
    let molstar_css = asset_url(&assets.join("molstar.css"));
    let molstar_js = asset_url(&assets.join("molstar.js"));
    let xyz_fast_js = asset_url(&assets.join("xyz-fast.js"));
    let (renderer_styles, renderer_scripts) = match renderer {
        "xyz-fast" => (
            "".to_string(),
            format!(r#"<script src="{xyz_fast_js}"></script>"#),
        ),
        "xyzrender-external" => (
            format!(r#"<link rel="stylesheet" href="{molstar_css}" />"#),
            "".to_string(),
        ),
        _ => (
            format!(r#"<link rel="stylesheet" href="{molstar_css}" />"#),
            format!(r#"<script src="{molstar_js}"></script>"#),
        ),
    };
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Burrete - {title}</title>
  {renderer_styles}
  <link rel="stylesheet" href="{runtime_css}" />
  <script src="{bridge_js}"></script>
  <script>
    window.BurretePreviewConfigURL = {config_js:?};
    window.BurretePreviewDataScriptURL = {data_js:?};
    window.BurreteDataURL = {data_bin_js:?};
    window.BurreteMolstarURL = {molstar_js:?};
    window.BurreteXyzFastURL = {xyz_fast_js:?};
  </script>
</head>
<body class="{background_class}">
  <div id="app"></div>
  <script src="{shell_js}"></script>
  <div id="status" class="hidden">Loading {title}...</div>
  {renderer_scripts}
  <script src="{config_js}"></script>
  <script src="{data_js}"></script>
  <script src="{agent_js}"></script>
  <script src="{viewer_js}"></script>
</body>
</html>"#
    )
}

fn viewer_bridge_js() -> &'static str {
    r#"(() => {
  const postToParent = (body) => {
    if (window.BurreteConfig && window.BurreteConfig.documentId) {
      body.documentId = String(window.BurreteConfig.documentId);
    }
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ source: 'burrete-viewer', body }, '*');
      } catch (_) {}
    }
  };
  const webkit = window.webkit || {};
  const messageHandlers = webkit.messageHandlers || {};
  if (!messageHandlers.burrete) {
    messageHandlers.burrete = { postMessage: postToParent };
  }
  webkit.messageHandlers = messageHandlers;
  window.webkit = webkit;
  window.__mqlPost = (type, message) => postToParent({ type, message: message || '' });
  window.__mqlAction = (name) => messageHandlers.burrete.postMessage({ type: 'action', message: name });
  window.__mqlDebug = () => {};
  window.BurreteInlineMode = true;
  window.BurreteDebug = false;
  window.BurretePanelControlsVisible = false;
  window.BurreteCacheBuster = String(Date.now());
})();"#
}
