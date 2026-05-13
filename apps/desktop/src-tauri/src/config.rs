use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

#[derive(Debug, Deserialize)]
struct SettingsSchemaFile {
    settings: Vec<SettingDef>,
}

#[derive(Debug, Deserialize)]
struct SettingDef {
    key: String,
    default: Value,
}

const SETTINGS_SCHEMA_JSON: &str = include_str!("../../shared/settings.schema.json");

fn settings_schema() -> Vec<SettingDef> {
    let parsed: SettingsSchemaFile =
        serde_json::from_str(SETTINGS_SCHEMA_JSON).expect("settings.schema.json is malformed");
    parsed.settings
}

fn known_setting_keys() -> HashSet<String> {
    settings_schema()
        .into_iter()
        .map(|setting| setting.key)
        .collect()
}

pub fn is_known_setting(key: &str) -> bool {
    known_setting_keys().contains(key)
}

pub fn default_settings() -> Map<String, Value> {
    settings_schema()
        .into_iter()
        .map(|setting| (setting.key, setting.default))
        .collect()
}

fn merge_value(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            for (key, value) in overlay_map {
                match base_map.get_mut(&key) {
                    Some(existing) => merge_value(existing, value),
                    None => {
                        base_map.insert(key, value);
                    }
                }
            }
        }
        (base_slot, overlay_value) => {
            *base_slot = overlay_value;
        }
    }
}

fn merge_settings(base: &mut Map<String, Value>, overlay: Map<String, Value>) {
    for (key, value) in overlay {
        match base.get_mut(&key) {
            Some(existing) => merge_value(existing, value),
            None => {
                base.insert(key, value);
            }
        }
    }
}

fn read_settings_file(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(format!("{} must contain a JSON object", path.display())),
    }
}

fn write_settings_file(path: &Path, settings: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let data = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(path, data).map_err(|err| err.to_string())
}

pub fn global_settings_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    Ok(dir.join("settings.json"))
}

fn workspace_settings_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".burrete").join("settings.json")
}

pub fn load_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
    workspace_root: Option<&Path>,
) -> Result<Map<String, Value>, String> {
    let mut settings = default_settings();
    merge_settings(&mut settings, read_settings_file(&global_settings_path(app)?)?);
    if let Some(root) = workspace_root {
        merge_settings(&mut settings, read_settings_file(&workspace_settings_path(root))?);
    }
    Ok(settings)
}

pub fn set_setting<R: Runtime>(
    app: &tauri::AppHandle<R>,
    workspace_root: Option<&Path>,
    key: &str,
    value: Value,
    scope: &str,
) -> Result<(), String> {
    if !is_known_setting(key) {
        return Err(format!("Unknown setting: {key}"));
    }
    let path = match scope {
        "workspace" => workspace_root
            .map(workspace_settings_path)
            .ok_or_else(|| "No workspace is open".to_string())?,
        _ => global_settings_path(app)?,
    };
    let mut settings = read_settings_file(&path)?;
    settings.insert(key.to_string(), value);
    write_settings_file(&path, &settings)
}

pub fn reset_setting<R: Runtime>(
    app: &tauri::AppHandle<R>,
    workspace_root: Option<&Path>,
    key: &str,
    scope: &str,
) -> Result<(), String> {
    if !is_known_setting(key) {
        return Err(format!("Unknown setting: {key}"));
    }
    let path = match scope {
        "workspace" => workspace_root
            .map(workspace_settings_path)
            .ok_or_else(|| "No workspace is open".to_string())?,
        _ => global_settings_path(app)?,
    };
    let mut settings = read_settings_file(&path)?;
    settings.remove(key);
    write_settings_file(&path, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("burrete-{name}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn defaults_include_burrete_schema_keys() {
        let settings = default_settings();
        assert!(settings.contains_key("theme"));
        assert!(settings.contains_key("themeOverrides"));
        assert!(settings.contains_key("rendererMode"));
    }

    #[test]
    fn nested_workspace_values_merge_without_dropping_theme_defaults() {
        let mut base = default_settings();
        let mut overlay = Map::new();
        overlay.insert(
            "themeOverrides".into(),
            serde_json::json!({
                "dark": {
                    "backgroundOpacity": 0.5
                }
            }),
        );

        merge_settings(&mut base, overlay);

        assert_eq!(
            base["themeOverrides"]["dark"]["backgroundOpacity"],
            serde_json::json!(0.5)
        );
        assert_eq!(
            base["themeOverrides"]["dark"]["accent"],
            serde_json::json!("#ff6a00")
        );
    }

    #[test]
    fn settings_file_round_trips_json_objects() {
        let dir = temp_dir("settings-round-trip");
        let path = dir.join("settings.json");
        let mut settings = Map::new();
        settings.insert("theme".into(), Value::String("dark".into()));

        write_settings_file(&path, &settings).expect("write settings");
        let loaded = read_settings_file(&path).expect("read settings");

        assert_eq!(loaded.get("theme"), Some(&Value::String("dark".into())));
        let _ = fs::remove_dir_all(dir);
    }
}
