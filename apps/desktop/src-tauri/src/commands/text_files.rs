use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const TEXT_FILE_READ_LIMIT: usize = 12 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFileDocument {
    id: String,
    path: String,
    title: String,
    extension: String,
    language: String,
    byte_count: u64,
    content: String,
    truncated: bool,
    modified_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenTextFilesResult {
    documents: Vec<TextFileDocument>,
    errors: Vec<String>,
}

#[tauri::command]
pub(crate) fn read_text_file(path: String) -> Result<TextFileDocument, String> {
    read_text_file_impl(PathBuf::from(path))
}

#[tauri::command]
pub(crate) fn open_text_files(paths: Vec<String>) -> Result<OpenTextFilesResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        match read_text_file_impl(PathBuf::from(&path)) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenTextFilesResult { documents, errors })
}

fn read_text_file_impl(path: PathBuf) -> Result<TextFileDocument, String> {
    let metadata = fs::metadata(&path).map_err(|err| format!("{}: {err}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let bytes = fs::read(&path).map_err(|err| format!("{}: {err}", path.display()))?;
    if looks_binary(&bytes) {
        return Err(format!("{} is not a text file", path.display()));
    }

    let truncated = bytes.len() > TEXT_FILE_READ_LIMIT;
    let readable_bytes = if truncated {
        &bytes[..TEXT_FILE_READ_LIMIT]
    } else {
        bytes.as_slice()
    };
    let content = String::from_utf8_lossy(readable_bytes).into_owned();
    let extension = file_extension(&path);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    Ok(TextFileDocument {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_string_lossy().to_string(),
        title: file_title(&path),
        extension: extension.clone(),
        language: language_for_extension(&extension).to_string(),
        byte_count: metadata.len(),
        content,
        truncated,
        modified_at,
    })
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .take(TEXT_FILE_READ_LIMIT)
        .any(|byte| *byte == 0)
}

fn file_title(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Text file")
        .to_string()
}

fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_lowercase()
}

fn language_for_extension(extension: &str) -> &'static str {
    match extension {
        "md" | "markdown" | "mdx" => "markdown",
        "sh" | "bash" | "zsh" => "shell",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "ts" | "tsx" => "typescript",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "py" => "python",
        "rs" => "rust",
        "css" => "css",
        "html" | "htm" => "html",
        "xml" => "xml",
        "log" | "out" | "err" | "txt" => "text",
        _ => "text",
    }
}

#[cfg(test)]
mod tests {
    use super::{read_text_file_impl, TEXT_FILE_READ_LIMIT};
    use std::fs;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "burrete-text-file-test-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn reads_utf8_text_file() {
        let path = temp_path("script.sh");
        fs::write(&path, "echo hello\n").expect("fixture should write");
        let document = read_text_file_impl(path.clone()).expect("text file should read");
        assert!(document.title.ends_with("script.sh"));
        assert_eq!(document.extension, "sh");
        assert_eq!(document.language, "shell");
        assert_eq!(document.content, "echo hello\n");
        assert!(!document.truncated);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_binary_file() {
        let path = temp_path("data.bin");
        fs::write(&path, [b'a', 0, b'b']).expect("fixture should write");
        let error = read_text_file_impl(path.clone()).expect_err("binary file should fail");
        assert!(error.contains("is not a text file"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn truncates_large_text_file() {
        let path = temp_path("large.log");
        fs::write(&path, vec![b'x'; TEXT_FILE_READ_LIMIT + 128]).expect("fixture should write");
        let document = read_text_file_impl(path.clone()).expect("large text file should read");
        assert_eq!(document.content.len(), TEXT_FILE_READ_LIMIT);
        assert!(document.truncated);
        let _ = fs::remove_file(path);
    }
}
