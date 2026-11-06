use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use burette_compute_protocol::{ArtifactFile, ArtifactManifest};
use sha2::{Digest, Sha256};

use super::{
    error::{ComputeCoordinatorError, ComputeResult},
    platform_fs::{self, DirectoryFd},
    store::ComputeStore,
};

const DIRECTORY_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

pub(crate) fn open_verified_artifact_file(
    store: &ComputeStore,
    artifact: &ArtifactManifest,
    relative_path: &str,
) -> ComputeResult<File> {
    let descriptor = artifact
        .files
        .iter()
        .find(|file| file.relative_path == relative_path)
        .ok_or_else(|| protocol(format!("artifact does not contain {relative_path}")))?;
    let (directory_name, file_name) = relative_path
        .split_once('/')
        .filter(|(directory, file)| {
            !directory.is_empty() && !file.is_empty() && !file.contains('/')
        })
        .ok_or_else(|| protocol("artifact read path must contain exactly two components"))?;
    let artifact_root = store.artifact_root()?;
    let root = open_artifact_root(&artifact_root)
        .map_err(|error| filesystem(format!("cannot open compute artifact root: {error}")))?;
    validate_directory_fd(&root, "compute artifact root")?;
    let artifact_leaf = format!("artifact-{}", artifact.artifact_id);
    let artifact_directory = platform_fs::open_directory_at(&root, artifact_leaf)
        .map_err(|error| filesystem(format!("cannot open published artifact: {error}")))?;
    validate_directory_fd(&artifact_directory, "published artifact")?;
    let content_directory = platform_fs::open_directory_at(&artifact_directory, directory_name)
        .map_err(|error| filesystem(format!("cannot open artifact content directory: {error}")))?;
    validate_directory_fd(&content_directory, "artifact content directory")?;
    let mut file = platform_fs::open_file_at(&content_directory, file_name).map_err(|error| {
        filesystem(format!(
            "cannot open artifact file {relative_path}: {error}"
        ))
    })?;
    validate_file_fd(&file, descriptor)?;
    verify_file_hash(&mut file, descriptor)?;
    file.seek(SeekFrom::Start(0))?;
    Ok(file)
}

/// Opens the artifact root the way the Unix reader always has: a plain
/// `O_NOFOLLOW` open of the final component, without walking the ancestors.
#[cfg(unix)]
fn open_artifact_root(path: &Path) -> Result<DirectoryFd, platform_fs::Errno> {
    use rustix::fs::{open, Mode, OFlags};
    open(
        path,
        OFlags::RDONLY
            .union(OFlags::DIRECTORY)
            .union(OFlags::CLOEXEC)
            .union(OFlags::NOFOLLOW),
        Mode::empty(),
    )
}

/// Opens the artifact root from its parent so the final component is opened
/// without following a reparse point, like the Unix `O_NOFOLLOW` open.
#[cfg(windows)]
fn open_artifact_root(path: &Path) -> Result<DirectoryFd, String> {
    let (Some(parent), Some(leaf)) = (path.parent(), path.file_name()) else {
        return Err("artifact root must have a parent directory".into());
    };
    let parent = platform_fs::open_directory_path(parent).map_err(|error| error.to_string())?;
    platform_fs::open_directory_at(&parent, leaf).map_err(|error| error.to_string())
}

fn validate_directory_fd(fd: &DirectoryFd, label: &str) -> ComputeResult<()> {
    let metadata = platform_fs::stat(fd)
        .map_err(|error| filesystem(format!("cannot inspect {label}: {error}")))?;
    if !metadata.is_directory()
        || !metadata.owned_by_current_user()
        || !metadata.has_mode(DIRECTORY_MODE)
    {
        return Err(filesystem(format!(
            "{label} is not an owned private 0700 directory"
        )));
    }
    Ok(())
}

fn validate_file_fd(file: &File, descriptor: &ArtifactFile) -> ComputeResult<()> {
    let metadata = platform_fs::stat(file).map_err(|error| {
        filesystem(format!(
            "cannot inspect artifact file {}: {error}",
            descriptor.relative_path
        ))
    })?;
    if !metadata.is_regular_file()
        || !metadata.owned_by_current_user()
        || !metadata.has_mode(FILE_MODE)
        || metadata.link_count() != 1
        || metadata.byte_length() != Some(descriptor.byte_count)
    {
        return Err(filesystem(format!(
            "artifact file identity changed: {}",
            descriptor.relative_path
        )));
    }
    Ok(())
}

fn verify_file_hash(file: &mut File, descriptor: &ArtifactFile) -> ComputeResult<()> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if encode_hex(hasher.finalize()) != descriptor.sha256 {
        return Err(filesystem(format!(
            "artifact file hash changed: {}",
            descriptor.relative_path
        )));
    }
    Ok(())
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    let mut encoded = String::with_capacity(bytes.as_ref().len() * 2);
    use std::fmt::Write as _;
    for byte in bytes.as_ref() {
        write!(encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn filesystem(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Filesystem(message.into())
}
