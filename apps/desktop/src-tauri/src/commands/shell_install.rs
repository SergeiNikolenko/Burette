//! Install/uninstall the `burrete` command on the user's PATH.

#![cfg(target_os = "macos")]

use crate::burrete_cli::INSTALL_TARGET;
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    pub target: String,
    pub source: Option<String>,
    pub installed: bool,
    pub state: CliInstallState,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CliInstallState {
    Missing,
    Installed,
    Stale,
    Foreign,
}

#[derive(Debug)]
pub enum InstallError {
    SourceUnknown,
    TargetOccupied(PathBuf),
    Io(io::Error),
    Elevation(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SourceUnknown => write!(
                f,
                "could not determine the Burrete binary path (std::env::current_exe failed)."
            ),
            Self::TargetOccupied(path) => write!(
                f,
                "{} already exists and is not a symlink. Remove it manually if you want Burrete to manage it.",
                path.display()
            ),
            Self::Io(err) => write!(f, "{err}"),
            Self::Elevation(msg) => write!(f, "administrator authorization failed: {msg}"),
        }
    }
}

impl std::error::Error for InstallError {}

impl From<io::Error> for InstallError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

impl serde::Serialize for InstallError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(&self.to_string())
    }
}

fn source_binary() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

fn classify_target(target: &Path, source: Option<&Path>) -> CliInstallState {
    match target.symlink_metadata() {
        Err(err) if err.kind() == io::ErrorKind::NotFound => CliInstallState::Missing,
        Err(_) => CliInstallState::Foreign,
        Ok(meta) => {
            if !meta.file_type().is_symlink() {
                return CliInstallState::Foreign;
            }
            match (fs::read_link(target).ok(), source) {
                (Some(link), Some(src)) if paths_equivalent(&link, src) => {
                    CliInstallState::Installed
                }
                (Some(_), _) => CliInstallState::Stale,
                (None, _) => CliInstallState::Foreign,
            }
        }
    }
}

fn paths_equivalent(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

fn try_symlink_direct(source: &Path, target: &Path) -> Result<bool, InstallError> {
    let parent = target.parent().ok_or_else(|| {
        InstallError::Io(io::Error::new(
            io::ErrorKind::InvalidInput,
            "install target has no parent directory",
        ))
    })?;

    if let Err(err) = fs::create_dir_all(parent) {
        if err.kind() == io::ErrorKind::PermissionDenied {
            return Ok(false);
        }
        return Err(err.into());
    }

    match target.symlink_metadata() {
        Ok(meta) if meta.file_type().is_symlink() => {
            if let Err(err) = fs::remove_file(target) {
                if err.kind() == io::ErrorKind::PermissionDenied {
                    return Ok(false);
                }
                return Err(err.into());
            }
        }
        Ok(_) => return Err(InstallError::TargetOccupied(target.to_path_buf())),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err.into()),
    }

    match std::os::unix::fs::symlink(source, target) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == io::ErrorKind::PermissionDenied => Ok(false),
        Err(err) => Err(err.into()),
    }
}

fn elevate_symlink(source: &Path, target: &Path) -> Result<(), InstallError> {
    let parent = target.parent().ok_or_else(|| {
        InstallError::Io(io::Error::new(
            io::ErrorKind::InvalidInput,
            "install target has no parent directory",
        ))
    })?;

    let script = r#"on run argv
  set parentDir to item 1 of argv
  set srcPath to item 2 of argv
  set tgtPath to item 3 of argv
  do shell script "mkdir -p " & quoted form of parentDir & " && rm -f " & quoted form of tgtPath & " && ln -s " & quoted form of srcPath & " " & quoted form of tgtPath with administrator privileges
end run"#;

    let output = Command::new("osascript")
        .args(["-e", script, "--"])
        .arg(parent)
        .arg(source)
        .arg(target)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(InstallError::Elevation(if stderr.is_empty() {
            "user cancelled or authorization declined".into()
        } else {
            stderr
        }));
    }
    Ok(())
}

fn elevate_unlink(target: &Path) -> Result<(), InstallError> {
    let script = r#"on run argv
  set tgtPath to item 1 of argv
  do shell script "rm -f " & quoted form of tgtPath with administrator privileges
end run"#;

    let output = Command::new("osascript")
        .args(["-e", script, "--"])
        .arg(target)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(InstallError::Elevation(if stderr.is_empty() {
            "user cancelled or authorization declined".into()
        } else {
            stderr
        }));
    }
    Ok(())
}

fn build_status(source: Option<PathBuf>) -> CliInstallStatus {
    let target = PathBuf::from(INSTALL_TARGET);
    let state = classify_target(&target, source.as_deref());
    CliInstallStatus {
        target: INSTALL_TARGET.to_string(),
        source: source.map(|path| path.to_string_lossy().into_owned()),
        installed: state == CliInstallState::Installed,
        state,
    }
}

#[tauri::command]
pub fn cli_status<R: Runtime>(_app: AppHandle<R>) -> CliInstallStatus {
    build_status(source_binary())
}

#[tauri::command]
pub fn install_cli<R: Runtime>(_app: AppHandle<R>) -> Result<CliInstallStatus, InstallError> {
    let source = source_binary().ok_or(InstallError::SourceUnknown)?;
    let target = PathBuf::from(INSTALL_TARGET);

    if !try_symlink_direct(&source, &target)? {
        elevate_symlink(&source, &target)?;
    }

    Ok(build_status(Some(source)))
}

#[tauri::command]
pub fn uninstall_cli<R: Runtime>(_app: AppHandle<R>) -> Result<CliInstallStatus, InstallError> {
    let source = source_binary();
    let target = PathBuf::from(INSTALL_TARGET);

    match classify_target(&target, source.as_deref()) {
        CliInstallState::Missing => return Ok(build_status(source)),
        CliInstallState::Foreign => return Err(InstallError::TargetOccupied(target)),
        CliInstallState::Installed | CliInstallState::Stale => {}
    }

    match fs::remove_file(&target) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::PermissionDenied => elevate_unlink(&target)?,
        Err(err) => return Err(err.into()),
    }

    Ok(build_status(source))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "burrete-shell-install-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    fn make_source(dir: &Path, name: &str) -> PathBuf {
        let source_dir = dir.join("app");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join(name);
        fs::write(&source, b"").unwrap();
        source
    }

    fn target_path(dir: &Path) -> PathBuf {
        dir.join("usr/local/bin/burrete")
    }

    #[test]
    fn classify_missing_target_reports_missing() {
        let dir = temp_workspace("missing");
        assert_eq!(
            classify_target(&target_path(&dir), None),
            CliInstallState::Missing
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn classify_installed_when_symlink_matches_source() {
        let dir = temp_workspace("installed");
        let source = make_source(&dir, "burrete");
        let target = target_path(&dir);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        symlink(&source, &target).unwrap();

        assert_eq!(
            classify_target(&target, Some(&source)),
            CliInstallState::Installed
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn classify_stale_when_symlink_points_elsewhere() {
        let dir = temp_workspace("stale");
        let source = make_source(&dir, "burrete");
        let other = make_source(&dir, "old-burrete");
        let target = target_path(&dir);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        symlink(&other, &target).unwrap();

        assert_eq!(
            classify_target(&target, Some(&source)),
            CliInstallState::Stale
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn classify_foreign_when_target_is_regular_file() {
        let dir = temp_workspace("foreign");
        let source = make_source(&dir, "burrete");
        let target = target_path(&dir);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"not ours").unwrap();

        assert_eq!(
            classify_target(&target, Some(&source)),
            CliInstallState::Foreign
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn try_symlink_creates_link_and_replaces_stale_one() {
        let dir = temp_workspace("replace");
        let source = make_source(&dir, "burrete");
        let target = target_path(&dir);

        assert!(try_symlink_direct(&source, &target).unwrap());
        assert_eq!(fs::read_link(&target).unwrap(), source);

        let other = make_source(&dir, "new-burrete");
        assert!(try_symlink_direct(&other, &target).unwrap());
        assert_eq!(fs::read_link(&target).unwrap(), other);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn try_symlink_refuses_to_replace_regular_file() {
        let dir = temp_workspace("regular-file");
        let source = make_source(&dir, "burrete");
        let target = target_path(&dir);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"not ours").unwrap();

        match try_symlink_direct(&source, &target) {
            Err(InstallError::TargetOccupied(path)) => assert_eq!(path, target),
            other => panic!("expected TargetOccupied, got {other:?}"),
        }
        fs::remove_dir_all(dir).ok();
    }
}
