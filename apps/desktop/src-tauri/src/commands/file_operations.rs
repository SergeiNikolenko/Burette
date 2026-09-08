use serde::Deserialize;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub(crate) enum FileOperation {
    Rename { path: String, name: String },
    Duplicate { path: String },
    SaveCopy { path: String, destination: String },
    Trash { path: String },
    RenameFolder { path: String, name: String },
    CreateFolder { path: String, name: String },
    TrashFolder { path: String },
}

// These commands operate on explicit sidebar paths. Existing destinations are
// never overwritten, and Trash always goes through the system recycle bin.
#[tauri::command]
pub(crate) async fn operate_sidebar_file(request: FileOperation) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || operate(request))
        .await
        .map_err(|error| error.to_string())?
}

fn child_path(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.trim() != name
        || matches!(name, "." | "..")
        || name.contains(['/', '\\', '\0', ':'])
    {
        return Err("Enter a filename without path separators.".into());
    }
    Ok(parent.join(name))
}

fn regular_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !path.is_absolute() || !metadata.file_type().is_file() {
        return Err("Choose a regular file. Folders and symbolic links are not supported.".into());
    }
    Ok(path)
}

fn regular_folder(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !path.is_absolute()
        || path
            .components()
            .any(|part| part == std::path::Component::ParentDir)
        || path.parent().is_none()
        || !metadata.file_type().is_dir()
        || fs::canonicalize(&path)
            .map_err(|error| error.to_string())?
            .parent()
            .is_none()
    {
        return Err("Choose a folder, excluding filesystem roots and symbolic links".into());
    }
    Ok(path)
}

fn copy_new(source: &Path, destination: &Path) -> io::Result<()> {
    let mut source_file = File::open(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let result = io::copy(&mut source_file, &mut output)
        .and_then(|_| output.set_permissions(source_file.metadata()?.permissions()))
        .and_then(|_| output.sync_all());
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn operate(request: FileOperation) -> Result<Option<String>, String> {
    let output = match request {
        FileOperation::CreateFolder { path, name } => {
            let parent = regular_folder(&path)?;
            let target = child_path(&parent, &name)?;
            fs::create_dir(&target).map_err(|error| error.to_string())?;
            target
        }
        FileOperation::RenameFolder { path, name } => {
            let source = regular_folder(&path)?;
            let target = child_path(source.parent().ok_or("Folder has no parent")?, &name)?;
            if target == source {
                return Ok(Some(path));
            }
            #[cfg(target_os = "macos")]
            rename_new(&source, &target).map_err(|error| error.to_string())?;
            #[cfg(not(target_os = "macos"))]
            return Err("Folder rename is currently available on macOS".into());
            target
        }
        FileOperation::TrashFolder { path } => {
            let source = regular_folder(&path)?;
            trash_file(&source)?;
            return Ok(None);
        }
        FileOperation::Rename { path, name } => {
            let source = regular_file(&path)?;
            let target = child_path(source.parent().ok_or("File has no parent folder")?, &name)?;
            if target == source {
                return Ok(Some(path));
            }
            rename_new(&source, &target).map_err(|error| error.to_string())?;
            target
        }
        FileOperation::Duplicate { path } => {
            let source = regular_file(&path)?;
            let parent = source.parent().ok_or("File has no parent folder")?;
            let stem = source
                .file_stem()
                .ok_or("File has no name")?
                .to_string_lossy();
            let suffix = source
                .extension()
                .map(|ext| format!(".{}", ext.to_string_lossy()))
                .unwrap_or_default();
            let mut result = None;
            for index in 1..=1000 {
                let number = if index == 1 {
                    String::new()
                } else {
                    format!(" {index}")
                };
                let target = parent.join(format!("{stem} copy{number}{suffix}"));
                match copy_new(&source, &target) {
                    Ok(()) => {
                        result = Some(target);
                        break;
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error.to_string()),
                }
            }
            result.ok_or("Could not find an unused copy name")?
        }
        FileOperation::SaveCopy { path, destination } => {
            let source = regular_file(&path)?;
            let target = PathBuf::from(destination);
            if !target.is_absolute() {
                return Err("Choose an absolute output path.".into());
            }
            copy_new(&source, &target).map_err(|error| error.to_string())?;
            target
        }
        FileOperation::Trash { path } => {
            let source = regular_file(&path)?;
            trash_file(&source)?;
            return Ok(None);
        }
    };
    Ok(Some(output.to_string_lossy().into_owned()))
}

#[cfg(target_os = "macos")]
fn rename_new(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes())?;
    let target = CString::new(target.as_os_str().as_bytes())?;
    // RENAME_EXCL closes the exists-check/rename race without replacing files.
    if unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn rename_new(source: &Path, target: &Path) -> io::Result<()> {
    fs::hard_link(source, target)?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn trash_file(path: &Path) -> Result<(), String> {
    use cocoa::base::{id, nil, BOOL, YES};
    use cocoa::foundation::NSAutoreleasePool;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let name: id = msg_send![class!(NSString), stringWithUTF8String: path.as_ptr()];
        let url: id = msg_send![class!(NSURL), fileURLWithPath: name];
        let manager: id = msg_send![class!(NSFileManager), defaultManager];
        let mut error: id = nil;
        let ok: BOOL = msg_send![manager, trashItemAtURL: url resultingItemURL: std::ptr::null_mut::<id>() error: &mut error];
        let result = if ok == YES {
            Ok(())
        } else if error.is_null() {
            Err("Could not move the file to Trash.".into())
        } else {
            let description: id = msg_send![error, localizedDescription];
            let message: *const std::ffi::c_char = msg_send![description, UTF8String];
            Err(CStr::from_ptr(message).to_string_lossy().into_owned())
        };
        let _: () = msg_send![pool, drain];
        result
    }
}

#[cfg(not(target_os = "macos"))]
fn trash_file(_path: &Path) -> Result<(), String> {
    Err("Moving files to Trash is supported by the macOS app.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn folder_operations_preserve_contents_and_existing_destinations() {
        let root =
            std::env::temp_dir().join(format!("burette-folder-ops-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let created = operate(FileOperation::CreateFolder {
            path: root.to_string_lossy().into(),
            name: "source".into(),
        })
        .unwrap()
        .unwrap();
        fs::write(Path::new(&created).join("molecule.sdf"), "payload").unwrap();
        fs::create_dir(root.join("existing")).unwrap();
        assert!(operate(FileOperation::RenameFolder {
            path: created.clone(),
            name: "existing".into()
        })
        .is_err());
        let renamed = operate(FileOperation::RenameFolder {
            path: created.clone(),
            name: "renamed".into(),
        })
        .unwrap()
        .unwrap();
        assert!(!Path::new(&created).exists());
        assert_eq!(
            fs::read_to_string(Path::new(&renamed).join("molecule.sdf")).unwrap(),
            "payload"
        );
        assert!(operate(FileOperation::CreateFolder {
            path: renamed,
            name: "../escape".into()
        })
        .is_err());
        assert!(regular_folder("/tmp/..").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn moves_test_file_to_system_trash() {
        let name = format!("burette-context-trash-{}.txt", uuid::Uuid::new_v4());
        let source = std::env::temp_dir().join(&name);
        fs::write(&source, "context-menu-trash-check").unwrap();
        assert_eq!(
            operate(FileOperation::Trash {
                path: source.to_string_lossy().into_owned(),
            })
            .unwrap(),
            None
        );
        assert!(!source.exists());
        let trashed = PathBuf::from(std::env::var("HOME").unwrap())
            .join(".Trash")
            .join(name);
        assert_eq!(
            fs::read_to_string(&trashed).unwrap(),
            "context-menu-trash-check"
        );
        fs::remove_file(trashed).unwrap();
    }

    #[test]
    fn file_operations_preserve_existing_destinations() {
        let folder =
            std::env::temp_dir().join(format!("burette-file-operations-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let source = folder.join("ligand.sdf");
        fs::write(&source, "molecule\n").unwrap();
        let path = source.to_string_lossy().to_string();
        let first = operate(FileOperation::Duplicate { path: path.clone() })
            .unwrap()
            .unwrap();
        let second = operate(FileOperation::Duplicate { path: path.clone() })
            .unwrap()
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&second).unwrap(), "molecule\n");
        assert!(operate(FileOperation::Rename {
            path: path.clone(),
            name: "../escape.sdf".into()
        })
        .is_err());
        assert!(operate(FileOperation::SaveCopy {
            path: path.clone(),
            destination: first.clone()
        })
        .is_err());
        assert!(operate(FileOperation::Rename {
            path: path.clone(),
            name: "ligand copy.sdf".into()
        })
        .is_err());
        assert!(source.exists());
        assert_eq!(fs::read_to_string(&first).unwrap(), "molecule\n");
        let renamed = operate(FileOperation::Rename {
            path,
            name: "renamed.sdf".into(),
        })
        .unwrap()
        .unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(renamed).unwrap(), "molecule\n");
        fs::remove_dir_all(folder).unwrap();
    }
}
