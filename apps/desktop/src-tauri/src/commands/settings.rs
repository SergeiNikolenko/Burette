use serde_json::Value;
use tauri::{Emitter, Manager};

fn workspace_root_for(webview: &tauri::Webview, app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let state = app.state::<crate::state::AppState>().get_or_create(webview.label());
    let workspace_root = state
        .workspace_root
        .read()
        .expect("workspace state lock poisoned")
        .clone();
    workspace_root
}

#[tauri::command]
pub fn get_settings(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let workspace_root = workspace_root_for(&webview, &app);
    Ok(Value::Object(crate::config::load_settings(
        &app,
        workspace_root.as_deref(),
    )?))
}

#[tauri::command]
pub fn get_setting(
    key: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let workspace_root = workspace_root_for(&webview, &app);
    let settings = crate::config::load_settings(&app, workspace_root.as_deref())?;
    Ok(settings.get(&key).cloned().unwrap_or(Value::Null))
}

#[tauri::command]
pub fn set_setting(
    key: String,
    value: Value,
    scope: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace_root = workspace_root_for(&webview, &app);
    crate::config::set_setting(
        &app,
        workspace_root.as_deref(),
        &key,
        value.clone(),
        scope.as_deref().unwrap_or("global"),
    )?;
    let _ = app.emit_to(
        webview.label(),
        "settings:changed",
        serde_json::json!({ "key": key, "value": value }),
    );
    Ok(())
}

#[tauri::command]
pub fn reset_setting(
    key: String,
    scope: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace_root = workspace_root_for(&webview, &app);
    crate::config::reset_setting(
        &app,
        workspace_root.as_deref(),
        &key,
        scope.as_deref().unwrap_or("global"),
    )?;
    let value = crate::config::load_settings(&app, workspace_root.as_deref())?
        .get(&key)
        .cloned()
        .unwrap_or(Value::Null);
    let _ = app.emit_to(
        webview.label(),
        "settings:changed",
        serde_json::json!({ "key": key, "value": value }),
    );
    Ok(())
}
