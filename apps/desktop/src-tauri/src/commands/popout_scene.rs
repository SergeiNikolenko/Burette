use base64::Engine;
use std::{fs, io::Write};
use tauri::{Emitter, Manager};

const MAX_SCENE_BYTES: usize = 24 * 1024 * 1024;

/// This relay is deliberately limited to scene handoffs. The native caller,
/// rather than a payload supplied by another window, determines the sender.
#[tauri::command]
pub(crate) fn relay_popout_handoff<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    target: String,
    mut message: serde_json::Value,
) -> Result<(), String> {
    if message.to_string().len() > 8 * 1024 * 1024 || !message.is_object() {
        return Err("Invalid scene handoff.".into());
    }
    let kind = message.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "offer" | "return" => {
            let path = message
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("Missing scene.")?;
            let root = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("popout-scenes");
            let scene = std::path::Path::new(path)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if scene.parent() != Some(root.canonicalize().map_err(|e| e.to_string())?.as_path())
                || scene.extension().is_none_or(|extension| {
                    extension != "molx" && sheet_checkpoint(&app, &scene).ok().flatten().is_none()
                })
            {
                return Err("Only a saved popout scene can be handed off.".into());
            }
        }
        "ready" | "commit" | "committed" | "failed" | "cancel" => {}
        _ => return Err("Unknown scene handoff.".into()),
    }
    let target_window = app
        .get_webview_window(&target)
        .ok_or("The other window is closed.")?;
    if kind == "return" {
        let _ = target_window.set_focus();
    }
    message["from"] = serde_json::Value::String(window.label().to_owned());
    app.emit_to(&target, "burette-scene-window-handoff", message)
        .map_err(|e| e.to_string())
}

fn scene_bytes(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > MAX_SCENE_BYTES.div_ceil(3) * 4 {
        return Err("The scene is too large to move to another window.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "The scene archive is invalid.")?;
    if bytes.len() > MAX_SCENE_BYTES || !bytes.starts_with(b"PK\x03\x04") {
        return Err("The scene archive is invalid or too large.".into());
    }
    Ok(bytes)
}

/// A popout checkpoints the complete Mol* archive, including its asset files.
/// Each checkpoint is a new private recovery document; original files are never overwritten.
#[tauri::command]
pub(crate) fn save_popout_scene<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data_base64: String,
    source_path: Option<String>,
    scene_unsaved: Option<bool>,
    scene_source_paths: Option<Vec<String>>,
) -> Result<String, String> {
    let bytes = scene_bytes(&data_base64)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("popout-scenes");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{}.molx", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&path);
        return Err(error.to_string());
    }
    if let Err(error) = write_source_descriptor(
        &path,
        source_path.as_deref(),
        scene_unsaved,
        scene_source_paths,
    ) {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("source.json"));
        return Err(error);
    }
    Ok(path.to_string_lossy().into_owned())
}

fn write_source_descriptor(
    path: &std::path::Path,
    source: Option<&str>,
    scene_unsaved: Option<bool>,
    scene_source_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let Some(source) = source
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute())
    else {
        return Ok(());
    };
    let source = source.canonicalize().unwrap_or(source);
    let paths = scene_source_paths.unwrap_or_default();
    if paths.len() > 200 {
        return Err("Too many scene source paths.".into());
    }
    let bytes = serde_json::to_vec(&serde_json::json!({ "sourcePath": source, "sceneUnsaved": scene_unsaved.unwrap_or(false), "sceneSourcePaths": paths }))
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8192 {
        return Err("Source path is too long.".into());
    }
    fs::write(path.with_extension("source.json"), bytes).map_err(|e| e.to_string())
}

/// Only application-owned UUID checkpoints may carry a source identity.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoverySource {
    #[serde(skip_serializing)]
    pub(crate) source_path: std::path::PathBuf,
    #[serde(default)]
    scene_unsaved: bool,
    #[serde(default)]
    scene_source_paths: Vec<String>,
}

pub(crate) fn recovery_source<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &std::path::Path,
) -> Result<Option<RecoverySource>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("popout-scenes");
    if path.parent() != Some(root.as_path())
        || path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| uuid::Uuid::parse_str(s).ok())
            .is_none()
    {
        return Ok(None);
    }
    let sidecar = path.with_extension("source.json");
    if !sidecar.exists() {
        return Ok(None);
    }
    if fs::metadata(&sidecar).map_err(|e| e.to_string())?.len() > 8192 {
        return Err("Invalid recovery source.".into());
    }
    let descriptor: RecoverySource =
        serde_json::from_slice(&fs::read(sidecar).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if !descriptor.source_path.is_absolute() || descriptor.scene_source_paths.len() > 200 {
        return Err("Invalid recovery source.".into());
    }
    Ok(Some(descriptor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_relay_delivers_scene_commit_and_ack_to_their_peer() {
        use std::sync::{Arc, Mutex};
        use tauri::{
            test::{mock_builder, mock_context, noop_assets},
            Listener,
        };

        // Pin HOME before resolving app_data_dir; see isolated_test_home.
        crate::preview::runtime::document_open_tests::isolated_test_home();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let source = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let destination =
            tauri::WebviewWindowBuilder::new(&app, "workspace-other", tauri::WebviewUrl::default())
                .build()
                .unwrap();
        let delivered = Arc::new(Mutex::new(Vec::new()));
        for window in [&source, &destination] {
            let delivered = Arc::clone(&delivered);
            let label = window.label().to_owned();
            window.listen("burette-scene-window-handoff", move |event| {
                let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
                delivered.lock().unwrap().push((label.clone(), payload));
            });
        }
        for (kind, sender, receiver) in [
            ("ready", &destination, &source),
            ("commit", &source, &destination),
            ("committed", &destination, &source),
            ("failed", &destination, &source),
            ("cancel", &source, &destination),
        ] {
            relay_popout_handoff(
                app.handle().clone(),
                sender.clone(),
                receiver.label().into(),
                serde_json::json!({"kind": kind, "id": "transfer", "from": "spoofed"}),
            )
            .unwrap();
            let messages = delivered.lock().unwrap().drain(..).collect::<Vec<_>>();
            assert_eq!(
                messages,
                vec![(
                    receiver.label().to_owned(),
                    serde_json::json!({"kind": kind, "id": "transfer", "from": sender.label()})
                )]
            );
        }
        assert!(relay_popout_handoff(
            app.handle().clone(),
            source,
            destination.label().into(),
            serde_json::json!({"kind": "unknown", "id": "transfer"})
        )
        .is_err());
        assert!(delivered.lock().unwrap().is_empty());
    }

    #[test]
    fn recovery_descriptor_preserves_original_identity_and_dirty_state() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        // Pin HOME before resolving app_data_dir; see isolated_test_home.
        crate::preview::runtime::document_open_tests::isolated_test_home();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let root = app.path().app_data_dir().unwrap().join("popout-scenes");
        fs::create_dir_all(&root).unwrap();
        let source = root.join(format!("original-{}.pdb", uuid::Uuid::new_v4()));
        fs::write(&source, b"ATOM").unwrap();
        let checkpoint = root.join(format!("{}.molx", uuid::Uuid::new_v4()));
        fs::write(&checkpoint, b"PK\x03\x04scene").unwrap();
        write_source_descriptor(
            &checkpoint,
            source.to_str(),
            Some(true),
            Some(vec![source.to_string_lossy().into_owned()]),
        )
        .unwrap();
        let descriptor = recovery_source(app.handle(), &checkpoint).unwrap().unwrap();
        assert_eq!(descriptor.source_path, source.canonicalize().unwrap());
        assert_eq!(
            serde_json::to_value(descriptor).unwrap(),
            serde_json::json!({
                "sceneUnsaved": true, "sceneSourcePaths": [source.to_string_lossy()]
            })
        );
        // An ordinary user filename cannot opt into the private recovery protocol.
        assert!(recovery_source(app.handle(), &source).unwrap().is_none());
        fs::remove_file(checkpoint.with_extension("source.json")).unwrap();
        fs::remove_file(checkpoint).unwrap();
        fs::remove_file(source).unwrap();
    }

    #[test]
    fn sheet_checkpoints_require_complete_geometry_and_local_gif_assets() {
        let mut sheet = serde_json::json!({ "version": 1, "items": [{
            "svg": "<svg></svg>", "geometry": { "left": 10, "top": 20, "width": 200, "height": 180, "rotation": 45 },
            "animation": "data:image/gif;base64,R0lGODlh",
        }] });
        assert!(validate_sheet(&sheet).is_ok());
        sheet["items"][0]["animation"] = serde_json::json!("https://example.com/movie.gif");
        assert!(validate_sheet(&sheet).is_err());
        sheet["items"][0]["animation"] = serde_json::Value::Null;
        sheet["items"][0]["geometry"]["left"] = serde_json::Value::Null;
        assert!(validate_sheet(&sheet).is_err());
        assert!(validate_sheet(&serde_json::json!({ "version": 1, "items": [] })).is_err());
    }

    #[test]
    fn sheet_recheckpoint_reads_recovery_when_original_is_missing() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        // Pin HOME before resolving app_data_dir; see isolated_test_home.
        crate::preview::runtime::document_open_tests::isolated_test_home();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let root = app.path().app_data_dir().unwrap().join("popout-scenes");
        fs::create_dir_all(&root).unwrap();
        let original = root.join(format!("missing-{}.pdb", uuid::Uuid::new_v4()));
        fs::write(&original, b"ATOM recovery").unwrap();
        let sheet = serde_json::json!({ "version": 1, "items": [{
            "svg": "<svg></svg>",
            "inputDataBase64": "QVRPTQ==", "inputExtension": "pdb",
            "geometry": { "left": 0, "top": 0, "width": 200, "height": 180, "rotation": 0 }
        }] });
        let recovery = std::path::PathBuf::from(
            save_popout_sheet(
                app.handle().clone(),
                original.to_string_lossy().into_owned(),
                None,
                sheet.clone(),
                Some(true),
                None,
            )
            .unwrap(),
        );
        fs::remove_file(&original).unwrap();
        let checkpoint = save_popout_sheet(
            app.handle().clone(),
            original.to_string_lossy().into_owned(),
            Some(recovery.to_string_lossy().into_owned()),
            sheet.clone(),
            Some(true),
            None,
        )
        .map(std::path::PathBuf::from)
        .unwrap();
        assert_eq!(fs::read(&checkpoint).unwrap(), b"ATOM recovery");
        assert_eq!(
            sheet_checkpoint(app.handle(), &checkpoint).unwrap(),
            Some(sheet)
        );
        let descriptor = recovery_source(app.handle(), &checkpoint).unwrap().unwrap();
        assert_eq!(descriptor.source_path, original);
        assert!(descriptor.scene_unsaved);
        assert!(!original.exists());
        for file in [
            recovery.with_extension("sheet.json"),
            recovery.with_extension("source.json"),
            recovery,
            checkpoint.with_extension("sheet.json"),
            checkpoint.with_extension("source.json"),
            checkpoint,
        ] {
            fs::remove_file(file).unwrap();
        }
    }

    #[test]
    fn sheet_recheckpoint_rejects_unrelated_recovery_sources() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        // Pin HOME before resolving app_data_dir; see isolated_test_home.
        crate::preview::runtime::document_open_tests::isolated_test_home();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let root = app.path().app_data_dir().unwrap().join("popout-scenes");
        fs::create_dir_all(&root).unwrap();
        let original = root.join(format!("original-{}.pdb", uuid::Uuid::new_v4()));
        let recovery = root.join(format!("{}.pdb", uuid::Uuid::new_v4()));
        let sheet = serde_json::json!({ "version": 1, "items": [{
            "svg": "<svg></svg>", "inputDataBase64": "QVRPTQ==", "inputExtension": "pdb",
            "geometry": { "left": 0, "top": 0, "width": 200, "height": 180, "rotation": 0 }
        }] });
        fs::write(&original, b"ATOM original").unwrap();
        // Use the production writer to create a complete checkpoint.
        let checkpoint = std::path::PathBuf::from(
            save_popout_sheet(
                app.handle().clone(),
                original.to_string_lossy().into_owned(),
                None,
                sheet.clone(),
                Some(true),
                None,
            )
            .unwrap(),
        );
        let attempt = |source: &std::path::Path, candidate: &std::path::Path| {
            save_popout_sheet(
                app.handle().clone(),
                source.to_string_lossy().into_owned(),
                Some(candidate.to_string_lossy().into_owned()),
                sheet.clone(),
                Some(true),
                None,
            )
        };
        assert!(
            attempt(&recovery, &checkpoint).is_err(),
            "mismatched document identity"
        );
        assert!(
            attempt(&original, &original).is_err(),
            "ordinary source is not a checkpoint"
        );
        let outside = root
            .parent()
            .unwrap()
            .join(format!("{}.pdb", uuid::Uuid::new_v4()));
        fs::write(&outside, b"ATOM outside").unwrap();
        assert!(
            attempt(&original, &outside).is_err(),
            "outside recovery directory"
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, &recovery).unwrap();
            assert!(
                attempt(&original, &recovery).is_err(),
                "symlink escapes recovery directory"
            );
            fs::remove_file(&recovery).unwrap();
        }
        fs::remove_file(checkpoint.with_extension("sheet.json")).unwrap();
        assert!(
            attempt(&original, &checkpoint).is_err(),
            "missing sheet sidecar"
        );
        for file in [
            original,
            outside,
            checkpoint.with_extension("source.json"),
            checkpoint,
        ] {
            fs::remove_file(file).unwrap();
        }
    }

    #[test]
    fn checkpoints_require_bounded_zip_bytes() {
        let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
        assert_eq!(
            scene_bytes(&encode(b"PK\x03\x04scene")).unwrap(),
            b"PK\x03\x04scene"
        );
        assert!(scene_bytes("not base64").is_err());
        assert!(scene_bytes(&encode(b"{}")).is_err());
        assert!(scene_bytes(&"A".repeat(MAX_SCENE_BYTES.div_ceil(3) * 4 + 1)).is_err());
    }
}

/// Sheet checkpoints only load beside recovery sources created by this module.
/// Ordinary user files never cause a sidecar to be interpreted as application state.
pub(crate) fn sheet_checkpoint<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &std::path::Path,
) -> Result<Option<serde_json::Value>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("popout-scenes");
    if path.parent() != Some(root.as_path()) {
        return Ok(None);
    }
    if path
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
        .is_none()
    {
        return Ok(None);
    }
    let sidecar = path.with_extension("sheet.json");
    if !sidecar.exists() {
        return Ok(None);
    }
    if fs::metadata(&sidecar).map_err(|e| e.to_string())?.len() > MAX_SCENE_BYTES as u64 {
        return Err("The saved sheet is too large.".into());
    }
    let sheet: serde_json::Value =
        serde_json::from_slice(&fs::read(sidecar).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    validate_sheet(&sheet)?;
    Ok(Some(sheet))
}

fn validate_sheet(sheet: &serde_json::Value) -> Result<(), String> {
    let items = sheet
        .get("items")
        .and_then(|v| v.as_array())
        .ok_or("Invalid saved sheet.")?;
    if sheet.get("version").and_then(|v| v.as_u64()) != Some(1)
        || items.is_empty()
        || items.len() > 200
    {
        return Err("Invalid saved sheet.".into());
    }
    for item in items {
        if let Some(animation) = item.get("animation").filter(|value| !value.is_null()) {
            let data = animation.as_str().ok_or("Invalid sheet animation.")?;
            let (encoded, gif) = if let Some(encoded) = data.strip_prefix("data:image/gif;base64,")
            {
                (encoded, true)
            } else if let Some(encoded) = data.strip_prefix("data:image/png;base64,") {
                (encoded, false)
            } else {
                return Err("Invalid sheet animation.".into());
            };
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| "Invalid sheet animation.")?;
            let valid = if gif {
                bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
            } else {
                bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            };
            if !valid {
                return Err("Invalid sheet animation.".into());
            }
        }
        if !item
            .get("svg")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains("<svg"))
        {
            return Err("The sheet is still rendering.".into());
        }
        for key in ["left", "top", "width", "height", "rotation"] {
            if !item
                .get("geometry")
                .and_then(|v| v.get(key))
                .and_then(|v| v.as_f64())
                .is_some_and(f64::is_finite)
            {
                return Err("Invalid sheet placement.".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn save_popout_sheet<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source_path: String,
    recovery_path: Option<String>,
    mut sheet: serde_json::Value,
    scene_unsaved: Option<bool>,
    scene_source_paths: Option<Vec<String>>,
) -> Result<String, String> {
    if sheet.to_string().len() > MAX_SCENE_BYTES {
        return Err("The sheet is too large to move.".into());
    }
    validate_sheet(&sheet)?;
    // The original name remains the document identity even when its volume is
    // unavailable. A moved sheet already has a self-contained recovery source.
    let source = std::path::Path::new(recovery_path.as_deref().unwrap_or(&source_path));
    if recovery_path.is_some() {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("popout-scenes");
        let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
        // Check every file before reading descriptors: symlinks must not turn
        // an application checkpoint into an unrelated local file.
        for file in [
            source.to_path_buf(),
            source.with_extension("source.json"),
            source.with_extension("sheet.json"),
        ] {
            if file.canonicalize().map_err(|e| e.to_string())?.parent()
                != Some(canonical_root.as_path())
            {
                return Err("Invalid sheet recovery source.".into());
            }
        }
        let descriptor =
            recovery_source(&app, source)?.ok_or("Missing sheet recovery identity.")?;
        if descriptor.source_path != std::path::Path::new(&source_path)
            || sheet_checkpoint(&app, source)?.is_none()
        {
            return Err("The sheet recovery source does not match this document.".into());
        }
    }
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .filter(|s| s.len() <= 10 && s.chars().all(|c| c.is_ascii_alphanumeric()))
        .ok_or("Invalid source file.")?;
    let mut total = 0;
    for item in sheet["items"].as_array_mut().ok_or("Invalid sheet.")? {
        if item
            .get("inputDataBase64")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty())
        {
            let input = item
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("Missing sheet source.")?;
            let size = fs::metadata(input).map_err(|e| e.to_string())?.len();
            if size > MAX_SCENE_BYTES as u64 {
                return Err("The sheet source is too large to move.".into());
            }
            let bytes = fs::read(input).map_err(|e| e.to_string())?;
            total += bytes.len();
            if total > MAX_SCENE_BYTES {
                return Err("The sheet is too large to move.".into());
            }
            let extension = std::path::Path::new(input)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("xyz")
                .to_owned();
            item["inputDataBase64"] =
                serde_json::Value::String(base64::engine::general_purpose::STANDARD.encode(bytes));
            item["inputExtension"] = serde_json::Value::String(extension);
        }
    }
    let encoded = serde_json::to_vec(&sheet).map_err(|e| e.to_string())?;
    if encoded.len() > MAX_SCENE_BYTES
        || fs::metadata(source).map_err(|e| e.to_string())?.len() > MAX_SCENE_BYTES as u64
    {
        return Err("The sheet is too large to move.".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("popout-scenes");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    // Source and sidecar are new recovery files; existing user data is untouched.
    for (destination, bytes) in [
        (path.clone(), fs::read(source).map_err(|e| e.to_string())?),
        (path.with_extension("sheet.json"), encoded),
    ] {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(destination).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    if let Err(error) =
        write_source_descriptor(&path, Some(&source_path), scene_unsaved, scene_source_paths)
    {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sheet.json"));
        let _ = fs::remove_file(path.with_extension("source.json"));
        return Err(error);
    }
    Ok(path.to_string_lossy().into_owned())
}
