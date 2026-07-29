use super::numpy_artifact::{is_numpy_artifact_extension, numpy_artifact_text_summary};
use base64::Engine;
use flate2::read::GzDecoder;
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Runtime;

use crate::menu::OpenDocumentRegistry;

const TEXT_FILE_READ_LIMIT: usize = 12 * 1024 * 1024;
const IMAGE_PREVIEW_READ_LIMIT: u64 = 24 * 1024 * 1024;
const IMAGE_PREVIEW_BATCH_READ_LIMIT: u64 = 48 * 1024 * 1024;
const OPENMM_BINARY_ARTIFACT_EXTENSIONS: &[&str] = &["chk", "checkpoint"];
const MOLECULAR_BINARY_METADATA_EXTENSIONS: &[&str] = &[
    "chk",
    "checkpoint",
    "coor",
    "dcd",
    "dms",
    "edr",
    "gsd",
    "h5md",
    "namdbin",
    "nc",
    "ncdf",
    "ncrst",
    "netcdf",
    "nctraj",
    "tng",
    "tpr",
    "trr",
    "trz",
    "xtc",
];

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
    #[serde(skip_serializing_if = "Option::is_none")]
    open_claim_id: Option<String>,
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
pub(crate) fn open_text_files<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: tauri::State<'_, OpenDocumentRegistry>,
    paths: Vec<String>,
    open_state_revision: u64,
) -> Result<OpenTextFilesResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    let mut remaining_image_preview_bytes = IMAGE_PREVIEW_BATCH_READ_LIMIT;
    for path in paths {
        let path = PathBuf::from(&path);
        let path = match canonical_text_file_path(&path) {
            Ok(path) => path,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        match open_text_file_with_provisional_claim(
            &registry,
            window.label(),
            path,
            open_state_revision,
            remaining_image_preview_bytes,
        ) {
            Ok(document) => {
                if document.language == "image" && !document.content.is_empty() {
                    remaining_image_preview_bytes =
                        remaining_image_preview_bytes.saturating_sub(document.byte_count);
                }
                documents.push(document);
            }
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenTextFilesResult { documents, errors })
}

fn canonical_text_file_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))
}

fn open_text_file_with_provisional_claim(
    registry: &OpenDocumentRegistry,
    window_label: &str,
    path: PathBuf,
    baseline_revision: u64,
    image_preview_limit: u64,
) -> Result<TextFileDocument, String> {
    let claim_id = registry.begin_provisional_open(window_label, &path, baseline_revision)?;
    match read_text_file_impl_with_image_limit(path, None, image_preview_limit) {
        Ok(mut document) => {
            document.open_claim_id = claim_id;
            Ok(document)
        }
        Err(error) => {
            if let Some(claim_id) = claim_id {
                let _ = registry.abort_open_claim(window_label, &claim_id);
            }
            Err(error)
        }
    }
}

fn read_text_file_impl(
    path: PathBuf,
    max_bytes: Option<usize>,
) -> Result<TextFileDocument, String> {
    read_text_file_impl_with_image_limit(path, max_bytes, IMAGE_PREVIEW_READ_LIMIT)
}

fn read_text_file_impl_with_image_limit(
    path: PathBuf,
    max_bytes: Option<usize>,
    image_preview_limit: u64,
) -> Result<TextFileDocument, String> {
    let metadata = fs::metadata(&path).map_err(|err| format!("{}: {err}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let extension = file_extension(&path);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    if is_numpy_artifact_extension(&extension) {
        return Ok(TextFileDocument {
            id: uuid::Uuid::new_v4().to_string(),
            path: path.to_string_lossy().to_string(),
            title: file_title(&path),
            extension,
            language: "markdown".to_string(),
            byte_count: metadata.len(),
            content: numpy_artifact_text_summary(&path, metadata.len())?,
            truncated: false,
            modified_at,
            open_claim_id: None,
        });
    }
    if let Some(mime_type) = image_mime_type(&extension) {
        let preview_limit = image_preview_limit.min(IMAGE_PREVIEW_READ_LIMIT);
        let (content, truncated) = if metadata.len() <= preview_limit {
            let bytes = fs::read(&path).map_err(|err| format!("{}: {err}", path.display()))?;
            (
                format!(
                    "data:{mime_type};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ),
                false,
            )
        } else {
            (String::new(), true)
        };
        return Ok(TextFileDocument {
            id: uuid::Uuid::new_v4().to_string(),
            path: path.to_string_lossy().to_string(),
            title: file_title(&path),
            extension,
            language: "image".to_string(),
            byte_count: metadata.len(),
            content,
            truncated,
            modified_at,
            open_claim_id: None,
        });
    }
    let read_limit = read_limit(max_bytes);
    let text_bytes = readable_text_bytes(&path, &extension, read_limit + 1)?;
    if looks_binary(&text_bytes) {
        if is_molecular_binary_metadata_artifact(&extension) {
            return Ok(TextFileDocument {
                id: uuid::Uuid::new_v4().to_string(),
                path: path.to_string_lossy().to_string(),
                title: file_title(&path),
                extension,
                language: "text".to_string(),
                byte_count: metadata.len(),
                content: molecular_binary_artifact_summary(&path, metadata.len()),
                truncated: false,
                modified_at,
                open_claim_id: None,
            });
        }
        return Ok(TextFileDocument {
            id: uuid::Uuid::new_v4().to_string(),
            path: path.to_string_lossy().to_string(),
            title: file_title(&path),
            extension: extension.clone(),
            language: "binary metadata".to_string(),
            byte_count: metadata.len(),
            content: binary_file_summary(&path, metadata.len(), &extension),
            truncated: false,
            modified_at,
            open_claim_id: None,
        });
    }

    let truncated = text_bytes.len() > read_limit;
    let readable_bytes = if truncated {
        &text_bytes[..read_limit]
    } else {
        text_bytes.as_slice()
    };
    let content = String::from_utf8_lossy(readable_bytes).into_owned();

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
        open_claim_id: None,
    })
}

fn is_openmm_binary_artifact(extension: &str) -> bool {
    OPENMM_BINARY_ARTIFACT_EXTENSIONS.contains(&extension)
}

fn is_molecular_binary_metadata_artifact(extension: &str) -> bool {
    MOLECULAR_BINARY_METADATA_EXTENSIONS.contains(&extension)
}

fn molecular_binary_artifact_summary(path: &Path, byte_count: u64) -> String {
    let extension = file_extension(path);
    if is_openmm_binary_artifact(&extension) {
        return format!(
            "Binary OpenMM checkpoint artifact\n\nFile: {}\nSize: {} bytes\n\nBurette registers this file as an OpenMM workflow artifact, but does not deserialize checkpoint payloads. OpenMM checkpoints are tied to the matching System, Platform, OpenMM version, and hardware context, so this viewer shows metadata instead of raw binary bytes.\n",
            path.display(),
            byte_count
        );
    }
    format!(
        "Binary molecular workflow artifact\n\nFile: {}\nSize: {} bytes\nFormat: .{}\n\nBurette registers this file as an MDAnalysis-compatible molecular artifact. This text viewer shows metadata because the file is a binary payload; structure preview can still use it when a compatible topology/trajectory pair is available.\n",
        path.display(),
        byte_count,
        extension
    )
}

fn binary_file_summary(path: &Path, byte_count: u64, extension: &str) -> String {
    format!(
        "Binary file\n\nFile: {}\nSize: {} bytes\nFormat: {}\n\nBurette does not have an inline renderer for this binary format yet. The file remains available in the project and can be opened with its default application.\n",
        path.display(),
        byte_count,
        if extension.is_empty() {
            "unknown".to_string()
        } else {
            format!(".{extension}")
        }
    )
}

fn image_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
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
        "csv" => "csv",
        "tsv" => "tsv",
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
    use super::{
        canonical_text_file_path, open_text_file_with_provisional_claim, read_text_file_impl,
        read_text_file_impl_with_image_limit, IMAGE_PREVIEW_READ_LIMIT, TEXT_FILE_READ_LIMIT,
    };
    use crate::menu::OpenDocumentRegistry;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::Write;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "burette-text-file-test-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    fn npy_f32(shape: &[usize], values: &[f32]) -> Vec<u8> {
        let shape_text = if shape.len() == 1 {
            format!("{},", shape[0])
        } else {
            shape
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mut header =
            format!("{{'descr': '<f4', 'fortran_order': False, 'shape': ({shape_text}), }}");
        let padding = (16 - ((10 + header.len() + 1) % 16)) % 16;
        header.push_str(&" ".repeat(padding));
        header.push('\n');
        let mut bytes = b"\x93NUMPY\x01\x00".to_vec();
        bytes.extend_from_slice(&(header.len() as u16).to_le_bytes());
        bytes.extend_from_slice(header.as_bytes());
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
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
    fn opens_relative_text_files_with_canonical_document_paths() {
        let path = std::path::PathBuf::from(format!(
            "burette-text-file-test-{}-relative.txt",
            uuid::Uuid::new_v4()
        ));
        fs::write(&path, "relative path\n").expect("fixture should write");
        let canonical = canonical_text_file_path(&path).expect("fixture should canonicalize");
        let registry = OpenDocumentRegistry::default();

        let document = open_text_file_with_provisional_claim(
            &registry,
            "main",
            canonical.clone(),
            7,
            IMAGE_PREVIEW_READ_LIMIT,
        )
        .expect("relative text file should open");

        assert!(canonical.is_absolute());
        assert_eq!(document.path, canonical.to_string_lossy());
        assert!(document.open_claim_id.is_some());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn failed_text_open_releases_its_provisional_claim() {
        let path = temp_path("broken.mae.gz");
        fs::write(&path, [b'n', b'o', b't', b'-', b'g', b'z']).expect("fixture should write");
        let path = canonical_text_file_path(&path).expect("fixture should canonicalize");
        let registry = OpenDocumentRegistry::default();

        let error = open_text_file_with_provisional_claim(
            &registry,
            "main",
            path.clone(),
            7,
            IMAGE_PREVIEW_READ_LIMIT,
        )
        .expect_err("binary file should fail");
        assert!(error.contains("failed to decompress MAEGZ text"));

        registry
            .with_write_permit("workspace", &path, None, || Ok(()))
            .expect("a failed open must release its provisional claim");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn shows_metadata_for_unknown_binary_file() {
        let path = temp_path("data.bin");
        fs::write(&path, [b'a', 0, b'b']).expect("fixture should write");
        let document =
            read_text_file_impl(path.clone(), None).expect("binary metadata should read");
        assert_eq!(document.language, "binary metadata");
        assert!(document
            .content
            .contains("Burette does not have an inline renderer"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reads_png_as_inline_image_preview() {
        let path = temp_path("plot.png");
        fs::write(&path, [0x89, b'P', b'N', b'G']).expect("fixture should write");
        let document = read_text_file_impl(path.clone(), None).expect("image should read");
        assert_eq!(document.language, "image");
        assert!(document.content.starts_with("data:image/png;base64,"));
        assert!(!document.truncated);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn omits_image_content_when_the_remaining_batch_budget_is_too_small() {
        let path = temp_path("bounded-plot.png");
        fs::write(&path, [0x89, b'P', b'N', b'G']).expect("fixture should write");
        let document = read_text_file_impl_with_image_limit(path.clone(), None, 3)
            .expect("image metadata should still read");
        assert_eq!(document.language, "image");
        assert!(document.content.is_empty());
        assert!(document.truncated);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn shows_metadata_for_openmm_binary_checkpoint_artifacts() {
        let path = temp_path("state.chk");
        fs::write(&path, [b'O', b'M', b'M', 0, b'C']).expect("fixture should write");
        let document =
            read_text_file_impl(path.clone(), None).expect("checkpoint metadata should read");
        assert_eq!(document.extension, "chk");
        assert_eq!(document.language, "text");
        assert!(document
            .content
            .contains("Binary OpenMM checkpoint artifact"));
        assert!(document
            .content
            .contains("does not deserialize checkpoint payloads"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn shows_metadata_for_binary_molecular_artifacts() {
        let path = temp_path("energy.edr");
        fs::write(&path, [b'E', b'D', b'R', 0, b'D']).expect("fixture should write");
        let document =
            read_text_file_impl(path.clone(), None).expect("binary metadata should read");
        assert_eq!(document.extension, "edr");
        assert_eq!(document.language, "text");
        assert!(document
            .content
            .contains("Binary molecular workflow artifact"));
        assert!(document
            .content
            .contains("MDAnalysis-compatible molecular artifact"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn renders_numpy_arrays_as_text_summary() {
        let path = temp_path("pae.npy");
        fs::write(&path, npy_f32(&[2, 2], &[0.25, 1.0, 1.1, 0.3])).expect("fixture should write");
        let document = read_text_file_impl(path.clone(), None).expect("npy summary should read");
        assert_eq!(document.extension, "npy");
        assert_eq!(document.language, "markdown");
        assert!(document.content.contains("NumPy NPY array"));
        assert!(document
            .content
            .contains("| Array | Shape | Dtype | Values |"));
        assert!(document.content.contains("(2, 2)"));
        assert!(!document.truncated);
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
