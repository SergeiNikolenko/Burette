use serde_json::Value;
use tauri::{Emitter, Manager};

const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;

#[tauri::command]
pub(crate) async fn grid_transfer_source_version<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: tauri::State<'_, crate::preview::grid_store::GridRuntimeRegistry>,
    document_id: String,
) -> Result<String, String> {
    if document_id.is_empty() || document_id.len() > 1024 || document_id.contains('\0') {
        return Err("Invalid collection source.".into());
    }
    let lease = registry.acquire_snapshot_lease(&crate::windows::runtime_document_id(
        window.label(),
        &document_id,
    ))?;
    tauri::async_runtime::spawn_blocking(move || {
        let connection = rusqlite::Connection::open_with_flags(
            lease.database_path_for_freeze(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|error| error.to_string())?;
        let identity = crate::preview::grid_identity::read_source_identity(&connection)?;
        Ok(identity.document_fingerprint_sha256)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn validate_message(message: &Value) -> Result<(), String> {
    if !message.is_object() || message.to_string().len() > MAX_PAGE_BYTES {
        return Err("The workspace page is too large to open in another window.".into());
    }
    let id = message.get("id").and_then(Value::as_str).unwrap_or("");
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("Invalid workspace request.".into());
    }
    match message.get("kind").and_then(Value::as_str) {
        Some("ready" | "committed" | "failed" | "commit" | "abort") => Ok(()),
        Some("open") => {
            let location = &message["location"];
            if !matches!(
                location["kind"].as_str(),
                Some(
                    "file"
                        | "text-file"
                        | "document"
                        | "launcher"
                        | "jobs"
                        | "chemical-space"
                        | "ketcher"
                        | "tool"
                        | "fep-network"
                        | "fep-setup"
                        | "pose-review"
                )
            ) {
                return Err("This screen cannot be opened in another window.".into());
            }
            for key in [
                "path",
                "sourcePath",
                "collectionPath",
                "gridPath",
                "dockingPath",
                "receptorPath",
            ] {
                if let Some(path) = location.get(key).filter(|value| !value.is_null()) {
                    let path = path.as_str().ok_or("Invalid workspace source.")?;
                    if path.len() > 4096
                        || !std::path::Path::new(path).is_absolute()
                        || path.contains('\0')
                    {
                        return Err("Save the source before opening it in another window.".into());
                    }
                }
            }
            if message.get("title").is_some_and(|title| {
                !title.is_string() || title.as_str().is_some_and(|title| title.len() > 800)
            }) {
                return Err("Invalid workspace title.".into());
            }
            Ok(())
        }
        _ => Err("Invalid workspace request.".into()),
    }
}

/// The host supplies the sender identity; web content cannot impersonate a peer.
#[tauri::command]
pub(crate) fn relay_workspace_page<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    target: String,
    mut message: Value,
) -> Result<(), String> {
    validate_message(&message)?;
    if app.get_webview_window(&target).is_none() {
        return Err("The other window is closed.".into());
    }
    message["from"] = Value::String(window.label().to_owned());
    app.emit_to(&target, "burette-workspace-page", message)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transfer_fingerprint_uses_the_calling_windows_loaded_rows() {
        use crate::preview::grid_store::{build_grid_store, GridRuntimeRegistry};
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder()
            .manage(GridRuntimeRegistry::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let source = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let receiver =
            tauri::WebviewWindowBuilder::new(&app, "workspace-other", tauri::WebviewUrl::default())
                .build()
                .unwrap();
        let registry = app.state::<GridRuntimeRegistry>();
        for (label, contents) in [
            ("main", b"smiles,name\nCC,Ethane\n".as_slice()),
            ("workspace-other", b"smiles,name\nCO,Methanol\n".as_slice()),
        ] {
            let dir =
                std::env::temp_dir().join(format!("burette-transfer-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let handle = build_grid_store(&dir, "csv", contents).unwrap().unwrap();
            registry
                .register(
                    &crate::windows::runtime_document_id(label, "same-id"),
                    handle.database_path,
                    handle.summary.format,
                    handle.cancel_token,
                    handle.ingest_worker,
                )
                .unwrap();
        }
        let first = tauri::async_runtime::block_on(grid_transfer_source_version(
            source,
            app.state(),
            "same-id".into(),
        ))
        .unwrap();
        let second = tauri::async_runtime::block_on(grid_transfer_source_version(
            receiver,
            app.state(),
            "same-id".into(),
        ))
        .unwrap();
        assert_ne!(first, second);
        registry.unregister("main:same-id").unwrap();
        registry.unregister("workspace-other:same-id").unwrap();
    }

    #[test]
    fn workspace_pages_require_bounded_known_locations_and_absolute_sources() {
        for kind in ["ready", "committed", "failed", "commit", "abort"] {
            assert!(validate_message(
                &serde_json::json!({"kind":kind, "id":uuid::Uuid::new_v4().to_string()})
            )
            .is_ok());
        }
        let mut message = serde_json::json!({"kind":"open", "id":uuid::Uuid::new_v4().to_string(), "location":{"kind":"chemical-space", "collectionPath":"/data/collection.sdf"}});
        assert!(validate_message(&message).is_ok());
        message["location"]["collectionPath"] = "https://other/source.sdf".into();
        assert!(validate_message(&message).is_err());
        message["location"] = serde_json::json!({"kind":"unknown"});
        assert!(validate_message(&message).is_err());
        message["location"] =
            serde_json::json!({"kind":"ketcher", "draftKet":"x".repeat(MAX_PAGE_BYTES)});
        assert!(validate_message(&message).is_err());
    }
}
