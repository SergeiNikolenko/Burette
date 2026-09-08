use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderContents {
    files: Vec<String>,
    folders: Vec<String>,
    truncated: bool,
}

fn collect(root: &Path, recursive: bool) -> Result<FolderContents, String> {
    let metadata = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
    if !root.is_absolute() || !metadata.file_type().is_dir() {
        return Err("Choose an absolute folder path, excluding symbolic links".into());
    }
    let mut result = FolderContents {
        files: vec![],
        folders: vec![],
        truncated: false,
    };
    let mut pending = vec![root.to_path_buf()];
    let mut visited = 0;
    while let Some(folder) = pending.pop() {
        for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            visited += 1;
            if visited > 2000 {
                result.truncated = true;
                break;
            }
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            let path = entry.path();
            if kind.is_dir() {
                result.folders.push(path.to_string_lossy().into_owned());
                if recursive {
                    pending.push(path);
                }
            } else if kind.is_file() {
                result.files.push(path.to_string_lossy().into_owned());
            }
        }
        if result.truncated {
            break;
        }
    }
    result.files.sort();
    result.folders.sort();
    Ok(result)
}

#[tauri::command]
pub(crate) async fn read_folder_contents(
    path: String,
    recursive: bool,
) -> Result<FolderContents, String> {
    tauri::async_runtime::spawn_blocking(move || collect(&PathBuf::from(path), recursive))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recursion_and_empty_folders_are_explicit() {
        let root =
            std::env::temp_dir().join(format!("burette-folder-list-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("one.pdb"), "one").unwrap();
        fs::write(root.join("nested/two.sdf"), "two").unwrap();
        let direct = collect(&root, false).unwrap();
        assert_eq!(
            (direct.files.len(), direct.folders.len(), direct.truncated),
            (1, 2, false)
        );
        assert_eq!(collect(&root, true).unwrap().files.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}
