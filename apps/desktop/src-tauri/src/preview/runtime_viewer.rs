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

pub(crate) fn copy_web_assets<R: Runtime>(
    app: &tauri::AppHandle<R>,
    assets: &Path,
) -> Result<(), String> {
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
    <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
    </button>
    <button class="buret-button buret-panel-toggle active" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel"><span aria-hidden="true">◧</span></button>
    <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel"><span aria-hidden="true">◨</span></button>
    <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel"><span aria-hidden="true">≡</span></button>
    <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel"><span aria-hidden="true">⌘</span></button>
    <button class="buret-button" type="button" data-buret-action="theme" aria-label="Switch theme" title="Switch theme"><span aria-hidden="true">☀</span></button>
    <button class="buret-button hidden" type="button" data-buret-action="open-vesta" aria-label="Open in VESTA" title="Open in VESTA"><span aria-hidden="true">↗</span></button>
    <div class="buret-renderer-control" data-buret-renderer-control>
      <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyz-fast">Fast</button>
      <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="molstar">Mol*</button>
      <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyzrender-external">xyzr</button>
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

fn viewer_runtime_css() -> &'static str {
    r#"html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
:root{--buret-toolbar-safe-top:12px;--buret-toolbar-background:rgba(18,18,18,.72);--buret-toolbar-border:rgba(255,255,255,.12);--buret-toolbar-hover:rgba(255,255,255,.14);--buret-toolbar-color:rgba(255,255,255,.94);--buret-panel-bg:rgba(18,18,18,.76);--buret-panel-bg-strong:rgba(28,28,29,.88);--buret-panel-line:rgba(255,255,255,.12);--buret-panel-text:rgba(255,255,255,.92);--buret-panel-muted:rgba(255,255,255,.58);--buret-panel-hover:rgba(255,255,255,.12);--buret-panel-scrollbar:rgba(255,255,255,.34);--buret-panel-accent:#ff6a00}
body.buret-theme-light{--buret-toolbar-background:rgba(246,244,240,.78);--buret-toolbar-border:rgba(20,20,19,.12);--buret-toolbar-hover:rgba(20,20,19,.1);--buret-toolbar-color:rgba(20,20,19,.9);--buret-panel-bg:rgba(246,244,240,.78);--buret-panel-bg-strong:rgba(255,255,255,.9);--buret-panel-line:rgba(20,20,19,.12);--buret-panel-text:rgba(20,20,19,.88);--buret-panel-muted:rgba(20,20,19,.55);--buret-panel-hover:rgba(20,20,19,.1);--buret-panel-scrollbar:rgba(20,20,19,.26)}
.burette-opaque-background{background:#0b0b0c}
.burette-transparent-background{background:transparent}
#status{position:absolute;left:14px;right:14px;bottom:14px;z-index:20;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(18,18,18,.84);font-size:12px;white-space:pre-wrap}
#status.hidden{display:none}
#status.error{display:block;color:#ffb4ab}
#buret-toolbar{position:absolute;top:var(--buret-toolbar-safe-top);right:12px;left:auto;z-index:30;display:flex;gap:4px;align-items:center;padding:4px;border:1px solid var(--buret-toolbar-border);border-radius:10px;background:var(--buret-toolbar-background);color:var(--buret-toolbar-color);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 8px 22px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.06);user-select:none;touch-action:none}
#buret-toolbar.collapsed{gap:0}
#buret-toolbar.collapsed .buret-button:not(.buret-grip),#buret-toolbar.collapsed .buret-renderer-control{display:none}
#buret-toolbar.collapsed .buret-grip{min-width:30px;padding:0;cursor:pointer}
.buret-button{min-width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:inherit;padding:0 8px;font:600 12px -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;display:grid;place-items:center}
.buret-button:not(.buret-renderer-choice){width:30px;padding:0}
.buret-button:hover,.buret-button.active{background:var(--buret-toolbar-hover)}
.buret-button svg{width:15px;height:15px;display:block}
.buret-button.active{color:#fff}
.buret-button.hidden{display:none}
.buret-grip{cursor:grab;color:currentColor;opacity:.66}
.buret-renderer-control{display:none;align-items:center;gap:4px;padding-left:5px;border-left:1px solid var(--buret-toolbar-border)}
.buret-renderer-control.visible{display:flex}
.buret-renderer-choice{min-width:42px}
.buret-select{height:30px;max-width:118px;border:0;border-radius:8px;background:transparent;color:inherit;padding:0 22px 0 8px;font:600 12px -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
.buret-select:hover,.buret-select:focus{background:var(--buret-toolbar-hover);outline:none}
.msp-plugin,.msp-plugin *{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif!important}
.msp-plugin .msp-layout-standard,.msp-plugin .msp-layout-expanded,.msp-plugin .msp-layout-region,.msp-plugin .msp-layout-static,.msp-plugin .msp-scrollable-container,.msp-plugin .msp-control-row,.msp-plugin .msp-control-row>div,.msp-plugin .msp-control-current,.msp-plugin .msp-control-group-header,.msp-plugin .msp-control-group-header>button,.msp-plugin .msp-control-group-header div,.msp-plugin .msp-control-group-footer,.msp-plugin .msp-row-text,.msp-plugin .msp-help-text,.msp-plugin .msp-help-row,.msp-plugin .msp-help-row>div{background:var(--buret-panel-bg)!important;border-color:var(--buret-panel-line)!important;color:var(--buret-panel-text)!important}
.msp-plugin .msp-form-control,.msp-plugin .msp-control-row select,.msp-plugin .msp-control-row button,.msp-plugin .msp-control-row input[type=text],.msp-plugin .msp-btn{background:var(--buret-panel-bg-strong)!important;border:none!important;border-radius:8px!important;color:var(--buret-panel-text)!important;box-shadow:none!important}
.msp-plugin .msp-form-control:hover,.msp-plugin .msp-control-row select:hover,.msp-plugin .msp-control-row button:hover,.msp-plugin .msp-control-row input[type=text]:hover,.msp-plugin .msp-btn:hover,.msp-plugin .msp-btn-icon:hover,.msp-plugin .msp-btn-icon-small:hover{background:var(--buret-panel-hover)!important;color:var(--buret-panel-text)!important;outline:none!important}
.msp-plugin .msp-control-row>span.msp-control-row-label,.msp-plugin .msp-control-row>button.msp-control-button-label,.msp-plugin .msp-control-group-header>span,.msp-plugin .msp-row-text>div,.msp-plugin .msp-help-row>span,.msp-plugin .msp-help-text>div,.msp-plugin .msp-help-text>p{color:var(--buret-panel-muted)!important}
.msp-plugin .msp-plugin-layout_controls,.msp-plugin .msp-viewport-controls,.msp-plugin .msp-viewport-top-left-controls{filter:drop-shadow(0 8px 22px rgba(0,0,0,.22))}
.msp-plugin ::-webkit-scrollbar-track{background:transparent!important}
.msp-plugin ::-webkit-scrollbar-thumb{background:var(--buret-panel-scrollbar)!important;border-color:transparent!important}
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
