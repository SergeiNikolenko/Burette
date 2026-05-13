use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

use super::formats::{normalize_renderer_mode, FormatInfo};
use super::runtime::ViewerPreferences;
use super::runtime_utils::{asset_url, escape_html, prune_runtime_dirs};
use super::xyz::{xyz_first_frame, XyzPayload};
use super::xyzrender::{create_xyzrender_artifact, xyzrender_preset_options};

pub(crate) fn create_runtime<R: Runtime>(
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
        "canOpenInVesta": matches!(extension, "cif" | "mcif" | "mmcif" | "xyz" | "cub" | "cube" | "vasp"),
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
        let artifact = create_xyzrender_artifact(file_path, &runtime)?;
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
