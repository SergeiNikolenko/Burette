use super::{run, validate, Request};
use serde::Deserialize;
use std::{fs, io::Write, os::unix::fs::OpenOptionsExt, path::Path};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Destination {
    Desktop,
    Choose,
}

// Exclusive creation preserves existing files and symlinks, including concurrent downloads.
fn save_download(
    directory: &Path,
    name: &str,
    bytes: &[u8],
    destination: Destination,
) -> Result<String, String> {
    let name_path = Path::new(name);
    let stem = name_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Choose a file name")?;
    let extension = name_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    for index in 0..100 {
        let candidate = if index == 0 {
            name.to_owned()
        } else {
            format!("{stem} ({index}){extension}")
        };
        let output = directory.join(candidate);
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&output)
        {
            Ok(file) => file,
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists
                    && matches!(destination, Destination::Desktop) =>
            {
                continue
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err("A file with this name already exists. Choose another name.".into())
            }
            Err(error) => return Err(error.to_string()),
        };
        let result = file.write_all(bytes).and_then(|()| file.sync_all());
        drop(file);
        if let Err(error) = result {
            let _ = fs::remove_file(&output);
            return Err(error.to_string());
        }
        return Ok(output.to_string_lossy().into_owned());
    }
    Err("Too many files with this name. Choose another destination.".into())
}

#[tauri::command]
pub(crate) async fn ssh_download(
    app: tauri::AppHandle,
    request: Request,
    destination: Destination,
) -> Result<Option<String>, String> {
    validate(&request)?;
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let name = Path::new(&request.path)
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Choose a file")?;
        let output = match destination {
            Destination::Desktop => desktop.join(name),
            Destination::Choose => {
                let Some(path) = app
                    .dialog()
                    .file()
                    .set_title("Download File")
                    .set_directory(&desktop)
                    .set_file_name(name)
                    .blocking_save_file()
                else {
                    return Ok(None);
                };
                path.into_path().map_err(|e| e.to_string())?
            }
        };
        let bytes = run(&request, "read")?;
        let directory = output.parent().ok_or("Choose a destination folder")?;
        let name = output
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Choose a file name")?;
        save_download(directory, name, &bytes, destination).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloads_preserve_bytes_and_existing_files_and_clean_staging() {
        let directory =
            std::env::temp_dir().join(format!("burette-download-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("molecule.sdf"), b"existing").unwrap();
        std::os::unix::fs::symlink(
            directory.join("molecule.sdf"),
            directory.join("molecule (1).sdf"),
        )
        .unwrap();
        let bytes = b"\0binary\xff\r\n";
        let output =
            save_download(&directory, "molecule.sdf", bytes, Destination::Desktop).unwrap();
        assert_eq!(Path::new(&output), directory.join("molecule (2).sdf"));
        assert_eq!(fs::read(output).unwrap(), bytes);
        assert!(
            save_download(&directory, "molecule.sdf", b"replace", Destination::Choose).is_err()
        );
        assert_eq!(
            fs::read(directory.join("molecule.sdf")).unwrap(),
            b"existing"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 3);
        fs::remove_dir_all(directory).unwrap();
    }
}
