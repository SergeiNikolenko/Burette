use flate2::read::GzDecoder;
use serde::Serialize;
use std::fs;
use std::io::Read;
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
pub(crate) fn read_text_file(
    path: String,
    max_bytes: Option<usize>,
) -> Result<TextFileDocument, String> {
    read_text_file_impl(PathBuf::from(path), max_bytes)
}

#[tauri::command]
pub(crate) fn open_text_files(paths: Vec<String>) -> Result<OpenTextFilesResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        match read_text_file_impl(PathBuf::from(&path), None) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenTextFilesResult { documents, errors })
}

fn read_text_file_impl(
    path: PathBuf,
    max_bytes: Option<usize>,
) -> Result<TextFileDocument, String> {
    let metadata = fs::metadata(&path).map_err(|err| format!("{}: {err}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let extension = file_extension(&path);
    let read_limit = read_limit(max_bytes);
    let text_bytes = readable_text_bytes(&path, &extension, read_limit + 1)?;
    if looks_binary(&text_bytes) {
        return Err(format!("{} is not a text file", path.display()));
    }

    let truncated = text_bytes.len() > read_limit;
    let readable_bytes = if truncated {
        &text_bytes[..read_limit]
    } else {
        text_bytes.as_slice()
    };
    let content = String::from_utf8_lossy(readable_bytes).into_owned();
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
    let title = file_title(path).to_lowercase();
    if title.ends_with(".mae.gz") {
        return "maegz".to_string();
    }
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_lowercase()
}

fn read_limit(max_bytes: Option<usize>) -> usize {
    max_bytes
        .filter(|value| *value > 0)
        .map(|value| value.min(TEXT_FILE_READ_LIMIT))
        .unwrap_or(TEXT_FILE_READ_LIMIT)
}

fn readable_text_bytes(path: &Path, extension: &str, limit: usize) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let mut bytes = Vec::new();
    if extension != "maegz" {
        file.take(limit as u64)
            .read_to_end(&mut bytes)
            .map_err(|err| format!("{}: {err}", path.display()))?;
        return Ok(bytes);
    }
    let decoder = GzDecoder::new(file);
    decoder
        .take(limit as u64)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("{}: failed to decompress MAEGZ text: {err}", path.display()))?;
    Ok(bytes)
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
        "mae" | "maegz" | "cms" => "maestro",
        "log" | "out" | "err" | "txt" => "text",
        _ => "text",
    }
}

#[cfg(test)]
mod tests {
    use super::{read_text_file_impl, TEXT_FILE_READ_LIMIT};
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::Write;

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
        let document = read_text_file_impl(path.clone(), None).expect("text file should read");
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
        let error = read_text_file_impl(path.clone(), None).expect_err("binary file should fail");
        assert!(error.contains("is not a text file"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn truncates_large_text_file() {
        let path = temp_path("large.log");
        fs::write(&path, vec![b'x'; TEXT_FILE_READ_LIMIT + 128]).expect("fixture should write");
        let document =
            read_text_file_impl(path.clone(), None).expect("large text file should read");
        assert_eq!(document.content.len(), TEXT_FILE_READ_LIMIT);
        assert!(document.truncated);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reads_maegz_as_decompressed_maestro_text() {
        let path = temp_path("structure.mae.gz");
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(b"f_m_ct {\n  m_atom[1] {\n  }\n}\n")
            .expect("fixture should compress");
        fs::write(&path, encoder.finish().expect("fixture should finish gzip"))
            .expect("fixture should write");
        let document =
            read_text_file_impl(path.clone(), None).expect("maegz text file should read");
        assert!(document.title.ends_with("structure.mae.gz"));
        assert_eq!(document.extension, "maegz");
        assert_eq!(document.language, "maestro");
        assert!(document.content.contains("f_m_ct"));
        assert!(!document.truncated);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn respects_explicit_preview_limit() {
        let path = temp_path("large.cms");
        fs::write(&path, "f_m_ct {\n".repeat(256)).expect("fixture should write");
        let document =
            read_text_file_impl(path.clone(), Some(64)).expect("limited text file should read");
        assert_eq!(document.content.len(), 64);
        assert!(document.truncated);
        let _ = fs::remove_file(path);
    }
}
