use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
};

use burrete_compute_protocol::{ArtifactFile, ArtifactManifest};
use rustix::{
    fs::{fstat, open, openat, FileType, Mode, OFlags},
    process::geteuid,
};
use sha2::{Digest, Sha256};

use super::{
    error::{ComputeCoordinatorError, ComputeResult},
    store::ComputeStore,
};

const DIRECTORY_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;
const DIRECTORY_FLAGS: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::CLOEXEC)
    .union(OFlags::NOFOLLOW);
const READ_FILE_FLAGS: OFlags = OFlags::RDONLY
    .union(OFlags::CLOEXEC)
    .union(OFlags::NOFOLLOW);

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
    let root = open(&artifact_root, DIRECTORY_FLAGS, Mode::empty())
        .map_err(|error| filesystem(format!("cannot open compute artifact root: {error}")))?;
    validate_directory_fd(&root, "compute artifact root")?;
    let artifact_leaf = format!("artifact-{}", artifact.artifact_id);
    let artifact_directory = openat(&root, artifact_leaf, DIRECTORY_FLAGS, Mode::empty())
        .map_err(|error| filesystem(format!("cannot open published artifact: {error}")))?;
    validate_directory_fd(&artifact_directory, "published artifact")?;
    let content_directory = openat(
        &artifact_directory,
        directory_name,
        DIRECTORY_FLAGS,
        Mode::empty(),
    )
    .map_err(|error| filesystem(format!("cannot open artifact content directory: {error}")))?;
    validate_directory_fd(&content_directory, "artifact content directory")?;
    let file = openat(
        &content_directory,
        file_name,
        READ_FILE_FLAGS,
        Mode::empty(),
    )
    .map_err(|error| {
        filesystem(format!(
            "cannot open artifact file {relative_path}: {error}"
        ))
    })?;
    validate_file_fd(&file, descriptor)?;
    let mut file: File = file.into();
    verify_file_hash(&mut file, descriptor)?;
    file.seek(SeekFrom::Start(0))?;
    Ok(file)
}

fn validate_directory_fd(fd: &std::os::fd::OwnedFd, label: &str) -> ComputeResult<()> {
    let metadata =
        fstat(fd).map_err(|error| filesystem(format!("cannot inspect {label}: {error}")))?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::Directory
        || metadata.st_uid != geteuid().as_raw()
        || u32::from(metadata.st_mode & 0o7777) != DIRECTORY_MODE
    {
        return Err(filesystem(format!(
            "{label} is not an owned private 0700 directory"
        )));
    }
    Ok(())
}

fn validate_file_fd(fd: &std::os::fd::OwnedFd, descriptor: &ArtifactFile) -> ComputeResult<()> {
    let metadata = fstat(fd).map_err(|error| {
        filesystem(format!(
            "cannot inspect artifact file {}: {error}",
            descriptor.relative_path
        ))
    })?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile
        || metadata.st_uid != geteuid().as_raw()
        || u32::from(metadata.st_mode & 0o7777) != FILE_MODE
        || metadata.st_nlink != 1
        || u64::try_from(metadata.st_size).ok() != Some(descriptor.byte_count)
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
