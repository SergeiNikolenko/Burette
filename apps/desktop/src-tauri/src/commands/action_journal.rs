use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Manager, Runtime, WebviewWindow};

/// The user-action journal: one JSON object per line, next to BuretteApp.log
/// in the app cache directory. It answers "what did the user do before this
/// broke" — clicks, menu commands, shortcuts, opened files, job starts and
/// outcomes — without a screen recording.
pub(crate) const ACTION_JOURNAL_NAME: &str = "ActionJournal.jsonl";
pub(crate) const ACTION_JOURNAL_PREVIOUS_NAME: &str = "ActionJournal.previous.jsonl";
const ACTION_JOURNAL_LIMIT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ENTRIES_PER_BATCH: usize = 200;
const MAX_FIELD_CHARS: usize = 512;
const MAX_DETAIL_CHARS: usize = 2048;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionJournalEntry {
    at: String,
    kind: String,
    action: String,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    detail: Option<Value>,
}

#[tauri::command]
pub(crate) fn append_action_journal<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    entries: Vec<ActionJournalEntry>,
) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    append_entries(&dir, window.label(), entries)
}

fn append_entries(
    cache_dir: &Path,
    window_label: &str,
    entries: Vec<ActionJournalEntry>,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut text = String::new();
    for entry in entries.into_iter().take(MAX_ENTRIES_PER_BATCH) {
        text.push_str(&journal_line(window_label, entry));
        text.push('\n');
    }
    static JOURNAL_LOCK: Mutex<()> = Mutex::new(());
    let _guard = JOURNAL_LOCK.lock().map_err(|err| err.to_string())?;
    fs::create_dir_all(cache_dir).map_err(|err| err.to_string())?;
    let path = cache_dir.join(ACTION_JOURNAL_NAME);
    let current = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    if current > 0 && current + text.len() as u64 > ACTION_JOURNAL_LIMIT_BYTES {
        fs::rename(&path, cache_dir.join(ACTION_JOURNAL_PREVIOUS_NAME))
            .map_err(|err| err.to_string())?;
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(text.as_bytes()))
        .map_err(|err| format!("{}: {err}", path.display()))
}

fn journal_line(window_label: &str, entry: ActionJournalEntry) -> String {
    let mut line = json!({
        "at": bounded(&entry.at, 40),
        "window": bounded(window_label, 80),
        "kind": bounded(&entry.kind, 32),
        "action": bounded(&entry.action, MAX_FIELD_CHARS),
    });
    let object = line.as_object_mut().expect("journal line is an object");
    if let Some(target) = entry.target.as_deref().filter(|value| !value.is_empty()) {
        object.insert("target".into(), bounded(target, MAX_FIELD_CHARS).into());
    }
    if let Some(scope) = entry.scope.as_deref().filter(|value| !value.is_empty()) {
        object.insert("scope".into(), bounded(scope, MAX_FIELD_CHARS).into());
    }
    if let Some(detail) = entry.detail.filter(|value| !value.is_null()) {
        let serialized = detail.to_string();
        let detail = if serialized.chars().count() > MAX_DETAIL_CHARS {
            Value::String(bounded(&serialized, MAX_DETAIL_CHARS))
        } else {
            detail
        };
        object.insert("detail".into(), detail);
    }
    line.to_string()
}

fn bounded(value: &str, limit: usize) -> String {
    let single_line = value.replace(['\n', '\r'], " ");
    if single_line.chars().count() <= limit {
        return single_line;
    }
    let mut truncated: String = single_line.chars().take(limit.saturating_sub(1)).collect();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "burette-action-journal-{}-{name}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(action: &str, detail: Option<Value>) -> ActionJournalEntry {
        ActionJournalEntry {
            at: "2026-10-16T00:32:48.154+03:00".into(),
            kind: "click".into(),
            action: action.into(),
            target: Some("Run\nxTB".into()),
            scope: None,
            detail,
        }
    }

    #[test]
    fn journal_appends_bounded_single_line_records() {
        let dir = temp_dir("bounded");
        append_entries(
            &dir,
            "main",
            vec![
                entry("button", Some(json!({ "path": "/tmp/a.sdf" }))),
                entry("button", Some(Value::String("x".repeat(5000)))),
            ],
        )
        .unwrap();
        let text = fs::read_to_string(dir.join(ACTION_JOURNAL_NAME)).unwrap();
        let lines: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(
            lines[0],
            json!({
                "at": "2026-10-16T00:32:48.154+03:00",
                "window": "main",
                "kind": "click",
                "action": "button",
                "target": "Run xTB",
                "detail": { "path": "/tmp/a.sdf" },
            })
        );
        assert!(lines[1]["detail"].as_str().unwrap().chars().count() <= MAX_DETAIL_CHARS);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn journal_rotates_into_one_previous_file() {
        let dir = temp_dir("rotation");
        let path = dir.join(ACTION_JOURNAL_NAME);
        fs::write(&path, vec![b'x'; ACTION_JOURNAL_LIMIT_BYTES as usize]).unwrap();
        append_entries(&dir, "main", vec![entry("button", None)]).unwrap();
        assert_eq!(
            fs::metadata(dir.join(ACTION_JOURNAL_PREVIOUS_NAME))
                .unwrap()
                .len(),
            ACTION_JOURNAL_LIMIT_BYTES
        );
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
