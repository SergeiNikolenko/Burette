use crate::is_supported_structure_path;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingOpenPayload {
    pub workspace: String,
    pub file: Option<String>,
}

/// Shared path normalization for OS-level opens: CLI arguments, second app
/// launches, and macOS file-open events all flow through this layer so their
/// supported-file behavior cannot drift.
pub fn resolve_open_targets(path: &Path) -> Vec<PathBuf> {
    let Ok(canonical) = path.canonicalize() else {
        return Vec::new();
    };
    let Ok(metadata) = canonical.metadata() else {
        return Vec::new();
    };

    if metadata.is_file() {
        return is_supported_structure_path(&canonical)
            .then_some(canonical)
            .into_iter()
            .collect();
    }

    if metadata.is_dir() {
        return vec![canonical];
    }

    Vec::new()
}

pub fn resolve_open_payload(path: &Path) -> Option<PendingOpenPayload> {
    let Ok(canonical) = path.canonicalize() else {
        return None;
    };
    let Ok(metadata) = canonical.metadata() else {
        return None;
    };

    if metadata.is_dir() {
        return Some(PendingOpenPayload {
            workspace: canonical.to_string_lossy().to_string(),
            file: None,
        });
    }

    if metadata.is_file() && is_supported_structure_path(&canonical) {
        let parent = canonical.parent()?.to_path_buf();
        return Some(PendingOpenPayload {
            workspace: parent.to_string_lossy().to_string(),
            file: Some(canonical.to_string_lossy().to_string()),
        });
    }

    None
}

pub fn open_payloads_from_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PendingOpenPayload> {
    paths
        .into_iter()
        .filter_map(|path| resolve_open_payload(&path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "burrete-open-target-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    #[test]
    fn resolves_supported_structure_file() {
        let root = temp_workspace("file");
        let file = root.join("mini.pdb");
        fs::write(&file, b"HEADER\n").expect("write pdb");

        let targets = resolve_open_targets(&file);

        assert_eq!(targets, vec![file.canonicalize().expect("canonical file")]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resolves_supported_file_to_workspace_payload() {
        let root = temp_workspace("file-payload");
        let file = root.join("mini.pdb");
        fs::write(&file, b"HEADER\n").expect("write pdb");

        let payload = resolve_open_payload(&file).expect("payload");

        assert_eq!(payload.workspace, root.canonicalize().unwrap().to_string_lossy());
        assert_eq!(
            payload.file.as_deref(),
            Some(file.canonicalize().unwrap().to_string_lossy().as_ref())
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_unsupported_file() {
        let root = temp_workspace("unsupported");
        let file = root.join("notes.txt");
        fs::write(&file, b"ignore").expect("write txt");

        assert!(resolve_open_targets(&file).is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resolves_directory_for_folder_open() {
        let root = temp_workspace("directory");

        let targets = resolve_open_targets(&root);

        assert_eq!(targets, vec![root.canonicalize().expect("canonical root")]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resolves_directory_to_workspace_only_payload() {
        let root = temp_workspace("directory-payload");

        let payload = resolve_open_payload(&root).expect("payload");

        assert_eq!(payload.workspace, root.canonicalize().unwrap().to_string_lossy());
        assert_eq!(payload.file, None);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn ignores_missing_path() {
        let root = temp_workspace("missing");
        let missing = root.join("missing.pdb");

        assert!(resolve_open_targets(&missing).is_empty());
        fs::remove_dir_all(root).ok();
    }
}
