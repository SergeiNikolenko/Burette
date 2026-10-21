use serde_json::Value;
use tauri::{Emitter, Manager};

const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;

fn validate_message(message: &Value) -> Result<(), String> {
    if !message.is_object() || message.to_string().len() > MAX_PAGE_BYTES {
        return Err("The workspace page is too large to open in another window.".into());
    }
    let id = message.get("id").and_then(Value::as_str).unwrap_or("");
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("Invalid workspace request.".into());
    }
    match message.get("kind").and_then(Value::as_str) {
        Some("ready" | "failed") => Ok(()),
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
    fn workspace_pages_require_bounded_known_locations_and_absolute_sources() {
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
