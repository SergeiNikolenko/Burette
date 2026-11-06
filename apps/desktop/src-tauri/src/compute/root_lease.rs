use std::{
    fs::File,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use rustix::{
    fs::{fsync, ftruncate, seek, Dir, SeekFrom},
    io::write,
};
use serde::Serialize;
use uuid::Uuid;

use crate::compute::{
    error::{ComputeCoordinatorError, ComputeResult},
    platform_fs::{self, DirectoryFd, Errno},
};

const LOCK_FILE_NAME: &str = ".compute-owner.lock";
const SNAPSHOTS_DIRECTORY_NAME: &str = "snapshots";
const SNAPSHOTS_TEMP_PREFIX: &str = ".snapshots.create-";
const MAX_SNAPSHOTS_TEMP_ATTEMPTS: usize = 8;
const MAX_COMPUTE_ROOT_ENTRIES: usize = 4_096;
const LOCK_DIAGNOSTIC_SCHEMA: &str = "burette.compute-owner.v1";
const MAX_LOCK_DIAGNOSTIC_BYTES: usize = 512;

/// Process-lifetime ownership of the durable compute root.
///
/// The descriptor fields are intentionally never duplicated: closing the lock
/// descriptor is what releases the advisory lease. Filesystem access goes
/// through [`platform_fs`], which documents the Unix and Windows capabilities.
#[derive(Debug)]
pub(crate) struct ComputeRootLease {
    compute_root: PathBuf,
    root_identity: FileIdentity,
    lock_identity: FileIdentity,
    root_directory: DirectoryFd,
    lock_file: File,
    snapshots_initialization: Mutex<()>,
}

/// A private child directory structurally bound to the retained compute root.
///
/// `path` is diagnostic only. Trusted access uses `directory`, while `lease`
/// keeps process ownership alive and verifies the child's current root entry.
#[derive(Debug)]
pub(crate) struct ComputeRootChildDirectory {
    lease: Arc<ComputeRootLease>,
    path: PathBuf,
    directory: DirectoryFd,
    identity: FileIdentity,
}

impl ComputeRootLease {
    pub(crate) fn acquire(compute_root: &Path) -> ComputeResult<Self> {
        let (root_directory, root_identity) = create_or_open_compute_root(compute_root)?;
        let lock_file = create_or_open_lock_file(&root_directory)?;
        let lock_identity = validate_private_lock_file(&lock_file)?;

        match platform_fs::try_lock_exclusive(&lock_file) {
            Ok(true) => {}
            Ok(false) => {
                return Err(ComputeCoordinatorError::Unavailable(
                    "the compute root is already owned by another Burette process".into(),
                ));
            }
            Err(error) => {
                return Err(filesystem(format!(
                    "cannot acquire the compute root owner lock: {error}"
                )));
            }
        }

        let locked_identity = validate_private_lock_file(&lock_file)?;
        if locked_identity != lock_identity {
            return Err(filesystem(
                "compute root owner lock identity changed during acquisition",
            ));
        }
        validate_lock_directory_entry(&root_directory, locked_identity)?;
        validate_root_path_identity(compute_root, root_identity)?;

        let instance_id = Uuid::new_v4().to_string();
        let diagnostic = LockDiagnostic {
            schema_version: LOCK_DIAGNOSTIC_SCHEMA,
            instance_id: &instance_id,
            pid: std::process::id(),
            started_at_ms: now_ms(),
        };
        write_lock_diagnostic(&lock_file, &diagnostic)?;
        platform_fs::sync_directory(&root_directory)
            .map_err(|error| filesystem(format!("cannot sync the compute root: {error}")))?;

        let lease = Self {
            compute_root: compute_root.to_path_buf(),
            root_identity,
            lock_identity,
            root_directory,
            lock_file,
            snapshots_initialization: Mutex::new(()),
        };
        lease.verify_path_identity()?;
        Ok(lease)
    }

    pub(crate) fn compute_root(&self) -> &Path {
        &self.compute_root
    }

    pub(crate) fn open_or_create_snapshots_directory(
        self: &Arc<Self>,
    ) -> ComputeResult<ComputeRootChildDirectory> {
        let _initialization = self.snapshots_initialization.lock().map_err(|_| {
            ComputeCoordinatorError::Unavailable(
                "compute snapshots initialization state is poisoned".into(),
            )
        })?;
        self.verify_path_identity()?;
        cleanup_abandoned_snapshots_directories(&self.root_directory)?;
        match platform_fs::stat_at_nofollow(&self.root_directory, SNAPSHOTS_DIRECTORY_NAME) {
            Ok(_) => return self.open_existing_snapshots_directory(),
            Err(Errno::NOENT) => {}
            Err(error) => {
                return Err(filesystem(format!(
                    "cannot inspect the compute snapshots directory entry: {error}"
                )));
            }
        }

        let (temporary_leaf, directory, identity) =
            create_temporary_snapshots_directory(&self.root_directory)?;
        match rename_snapshots_noreplace(&self.root_directory, &temporary_leaf) {
            Ok(true) => {
                validate_directory_entry(
                    &self.root_directory,
                    SNAPSHOTS_DIRECTORY_NAME,
                    "compute snapshots directory",
                    identity,
                )?;
                #[cfg(windows)]
                let directory = reopen_published_snapshots_directory(
                    &self.root_directory,
                    directory,
                    identity,
                )?;
                require_empty_directory(&directory, "new compute snapshots directory")?;
                self.finish_snapshots_directory(directory, identity)
            }
            Ok(false) => {
                remove_owned_empty_directory(
                    &self.root_directory,
                    &temporary_leaf,
                    "temporary compute snapshots directory",
                    &directory,
                    identity,
                )?;
                self.open_existing_snapshots_directory()
            }
            Err(rename_error) => {
                if let Err(cleanup_error) = remove_owned_empty_directory(
                    &self.root_directory,
                    &temporary_leaf,
                    "temporary compute snapshots directory",
                    &directory,
                    identity,
                ) {
                    return Err(filesystem(format!(
                        "{rename_error}; temporary snapshots cleanup also failed: {cleanup_error}"
                    )));
                }
                Err(rename_error)
            }
        }
    }

    fn open_existing_snapshots_directory(
        self: &Arc<Self>,
    ) -> ComputeResult<ComputeRootChildDirectory> {
        self.verify_path_identity()?;
        let directory =
            platform_fs::open_directory_at(&self.root_directory, SNAPSHOTS_DIRECTORY_NAME)
                .map_err(|error| {
                    filesystem(format!(
                        "cannot open the compute snapshots directory: {error}"
                    ))
                })?;
        let identity = validate_private_directory(&directory, "compute snapshots directory")?;
        validate_directory_entry(
            &self.root_directory,
            SNAPSHOTS_DIRECTORY_NAME,
            "compute snapshots directory",
            identity,
        )?;
        self.finish_snapshots_directory(directory, identity)
    }

    fn finish_snapshots_directory(
        self: &Arc<Self>,
        directory: DirectoryFd,
        identity: FileIdentity,
    ) -> ComputeResult<ComputeRootChildDirectory> {
        let child = ComputeRootChildDirectory {
            lease: Arc::clone(self),
            path: self.compute_root.join(SNAPSHOTS_DIRECTORY_NAME),
            directory,
            identity,
        };
        child.verify()?;
        platform_fs::sync_directory(&child.directory).map_err(|error| {
            filesystem(format!(
                "cannot sync the compute snapshots directory: {error}"
            ))
        })?;
        platform_fs::sync_directory(&self.root_directory).map_err(|error| {
            filesystem(format!(
                "cannot sync the compute root after opening snapshots: {error}"
            ))
        })?;
        child.verify()?;
        Ok(child)
    }

    /// Revalidates both held capabilities and their current directory entries.
    ///
    /// Callers must fail closed when this check fails: a path-based open after
    /// root replacement must never silently join a second coordinator root.
    pub(crate) fn verify_path_identity(&self) -> ComputeResult<()> {
        if validate_private_directory(&self.root_directory, "compute root")? != self.root_identity {
            return Err(filesystem(
                "held compute root descriptor changed filesystem identity",
            ));
        }
        if validate_private_lock_file(&self.lock_file)? != self.lock_identity {
            return Err(filesystem(
                "held compute owner lock changed filesystem identity",
            ));
        }
        validate_lock_directory_entry(&self.root_directory, self.lock_identity)?;
        validate_root_path_identity(&self.compute_root, self.root_identity)
    }
}

impl ComputeRootChildDirectory {
    /// Diagnostic locator only. Consumers must use the retained descriptor.
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn directory(&self) -> &DirectoryFd {
        &self.directory
    }

    pub(crate) fn verify(&self) -> ComputeResult<()> {
        self.lease.verify_path_identity()?;
        if validate_private_directory(&self.directory, "compute snapshots directory")?
            != self.identity
        {
            return Err(filesystem(
                "held compute snapshots descriptor changed filesystem identity",
            ));
        }
        validate_directory_entry(
            &self.lease.root_directory,
            SNAPSHOTS_DIRECTORY_NAME,
            "compute snapshots directory",
            self.identity,
        )?;
        self.lease.verify_path_identity()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LockDiagnostic<'a> {
    schema_version: &'static str,
    instance_id: &'a str,
    pid: u32,
    /// Unix epoch milliseconds captured immediately after lock acquisition.
    started_at_ms: u64,
}

fn create_or_open_compute_root(compute_root: &Path) -> ComputeResult<(DirectoryFd, FileIdentity)> {
    if !compute_root.is_absolute() {
        return Err(filesystem("compute root must be an absolute path"));
    }
    let parent = compute_root
        .parent()
        .ok_or_else(|| filesystem("compute root must have a parent directory"))?;
    let leaf = compute_root
        .file_name()
        .ok_or_else(|| filesystem("compute root must have a final directory name"))?;
    let parent_directory = open_absolute_directory_nofollow(parent)?;
    let created = match platform_fs::create_directory_at(&parent_directory, leaf) {
        Ok(()) => true,
        Err(Errno::EXIST) => false,
        Err(error) => {
            return Err(filesystem(format!(
                "cannot create the compute root: {error}"
            )));
        }
    };
    let root_directory = platform_fs::open_directory_at(&parent_directory, leaf)
        .map_err(|error| filesystem(format!("cannot open the compute root: {error}")))?;
    if created {
        platform_fs::restrict_directory_permissions(&root_directory).map_err(|error| {
            filesystem(format!(
                "cannot set private compute root permissions: {error}"
            ))
        })?;
        platform_fs::sync_directory(&root_directory)
            .map_err(|error| filesystem(format!("cannot sync the compute root: {error}")))?;
        platform_fs::sync_directory(&parent_directory)
            .map_err(|error| filesystem(format!("cannot sync the compute root parent: {error}")))?;
    }
    let identity = validate_private_directory(&root_directory, "compute root")?;
    Ok((root_directory, identity))
}

fn create_or_open_lock_file(root_directory: &DirectoryFd) -> ComputeResult<File> {
    match platform_fs::create_read_write_file_at(root_directory, LOCK_FILE_NAME) {
        Ok(file) => {
            platform_fs::restrict_file_permissions(&file).map_err(|error| {
                filesystem(format!(
                    "cannot set private compute owner lock permissions: {error}"
                ))
            })?;
            Ok(file)
        }
        Err(Errno::EXIST) => platform_fs::open_read_write_file_at(root_directory, LOCK_FILE_NAME)
            .map_err(|error| filesystem(format!("cannot open the compute owner lock: {error}"))),
        Err(error) => Err(filesystem(format!(
            "cannot create the compute owner lock: {error}"
        ))),
    }
}

fn open_absolute_directory_nofollow(path: &Path) -> ComputeResult<DirectoryFd> {
    if !path.is_absolute() {
        return Err(filesystem("compute root path must be absolute"));
    }
    let mut directory = platform_fs::open_absolute_root(path)
        .map_err(|error| filesystem(format!("cannot open the filesystem root: {error}")))?;
    for component in path.components() {
        match component {
            Component::RootDir => {}
            // The drive or UNC prefix was opened as part of the root.
            Component::Prefix(_) if cfg!(windows) => {}
            Component::Normal(name) => {
                directory = platform_fs::open_directory_at(&directory, name).map_err(|error| {
                    filesystem(format!(
                        "compute root path contains an unavailable or symlink component '{}': {error}",
                        name.to_string_lossy()
                    ))
                })?;
            }
            Component::CurDir | Component::ParentDir | Component::Prefix(_) => {
                return Err(filesystem(
                    "compute root cannot contain relative path components",
                ));
            }
        }
    }
    Ok(directory)
}

fn validate_private_directory(directory: &DirectoryFd, label: &str) -> ComputeResult<FileIdentity> {
    let metadata = platform_fs::stat(directory)
        .map_err(|error| filesystem(format!("cannot inspect the {label}: {error}")))?;
    if !metadata.is_directory() {
        return Err(filesystem(format!("{label} must be a directory")));
    }
    if !metadata.owned_by_current_user() {
        return Err(filesystem(format!(
            "{label} must be owned by the current user"
        )));
    }
    if !metadata.has_mode(0o700) {
        return Err(filesystem(format!("{label} permissions must be 0700")));
    }
    Ok(identity(metadata.device(), metadata.inode()))
}

fn validate_private_lock_file(file: &File) -> ComputeResult<FileIdentity> {
    let metadata = platform_fs::stat(file)
        .map_err(|error| filesystem(format!("cannot inspect the compute owner lock: {error}")))?;
    if !metadata.is_regular_file() {
        return Err(filesystem("compute owner lock must be a regular file"));
    }
    if !metadata.owned_by_current_user() {
        return Err(filesystem(
            "compute owner lock must be owned by the current user",
        ));
    }
    if !metadata.has_mode(0o600) {
        return Err(filesystem("compute owner lock permissions must be 0600"));
    }
    if metadata.link_count() != 1 {
        return Err(filesystem(
            "compute owner lock must have exactly one filesystem link",
        ));
    }
    Ok(identity(metadata.device(), metadata.inode()))
}

fn validate_lock_directory_entry(
    root_directory: &DirectoryFd,
    expected: FileIdentity,
) -> ComputeResult<()> {
    let metadata =
        platform_fs::stat_at_nofollow(root_directory, LOCK_FILE_NAME).map_err(|error| {
            filesystem(format!(
                "cannot inspect the compute owner lock directory entry: {error}"
            ))
        })?;
    if !metadata.is_regular_file() || identity(metadata.device(), metadata.inode()) != expected {
        return Err(filesystem(
            "compute owner lock directory entry changed during acquisition",
        ));
    }
    Ok(())
}

fn create_temporary_snapshots_directory(
    root_directory: &DirectoryFd,
) -> ComputeResult<(String, DirectoryFd, FileIdentity)> {
    for _ in 0..MAX_SNAPSHOTS_TEMP_ATTEMPTS {
        let leaf = format!("{SNAPSHOTS_TEMP_PREFIX}{}", Uuid::new_v4());
        match platform_fs::create_directory_at(root_directory, leaf.as_str()) {
            Ok(()) => {}
            Err(Errno::EXIST) => continue,
            Err(error) => {
                return Err(filesystem(format!(
                    "cannot create a temporary compute snapshots directory: {error}"
                )));
            }
        }
        let directory = match platform_fs::open_directory_at(root_directory, leaf.as_str()) {
            Ok(directory) => directory,
            Err(error) => {
                let open_error = filesystem(format!(
                    "cannot open the temporary compute snapshots directory: {error}"
                ));
                cleanup_unopened_temporary_directory(root_directory, &leaf, &open_error)?;
                return Err(open_error);
            }
        };
        let identity =
            match inspect_directory_identity(&directory, "temporary compute snapshots directory") {
                Ok(identity) => identity,
                Err(error) => {
                    cleanup_unopened_temporary_directory(root_directory, &leaf, &error)?;
                    return Err(error);
                }
            };
        let prepared = (|| {
            platform_fs::restrict_directory_permissions(&directory).map_err(|error| {
                filesystem(format!(
                    "cannot set private temporary snapshots permissions: {error}"
                ))
            })?;
            if validate_private_directory(&directory, "temporary compute snapshots directory")?
                != identity
            {
                return Err(filesystem(
                    "temporary compute snapshots descriptor changed filesystem identity",
                ));
            }
            validate_directory_entry(
                root_directory,
                &leaf,
                "temporary compute snapshots directory",
                identity,
            )?;
            require_empty_directory(&directory, "temporary compute snapshots directory")?;
            platform_fs::sync_directory(&directory).map_err(|error| {
                filesystem(format!(
                    "cannot sync the temporary compute snapshots directory: {error}"
                ))
            })
        })();
        if let Err(error) = prepared {
            if let Err(cleanup_error) = remove_owned_empty_directory(
                root_directory,
                &leaf,
                "temporary compute snapshots directory",
                &directory,
                identity,
            ) {
                return Err(filesystem(format!(
                    "{error}; temporary snapshots cleanup also failed: {cleanup_error}"
                )));
            }
            return Err(error);
        }
        return Ok((leaf, directory, identity));
    }
    Err(filesystem(format!(
        "cannot allocate a unique temporary snapshots directory after {MAX_SNAPSHOTS_TEMP_ATTEMPTS} attempts"
    )))
}

fn cleanup_abandoned_snapshots_directories(root_directory: &DirectoryFd) -> ComputeResult<()> {
    for leaf in temporary_snapshots_leaves(root_directory)? {
        let encoded_id = leaf
            .strip_prefix(SNAPSHOTS_TEMP_PREFIX)
            .expect("temporary snapshots prefix was checked");
        let identifier = Uuid::parse_str(encoded_id).map_err(|_| {
            filesystem("compute root contains a malformed temporary snapshots directory")
        })?;
        if identifier.is_nil() || identifier.to_string() != encoded_id {
            return Err(filesystem(
                "compute root contains a non-canonical temporary snapshots directory",
            ));
        }
        let abandoned =
            platform_fs::open_directory_at(root_directory, leaf.as_str()).map_err(|error| {
                filesystem(format!(
                    "cannot open an abandoned temporary snapshots directory: {error}"
                ))
            })?;
        let identity =
            validate_private_directory(&abandoned, "abandoned temporary snapshots directory")?;
        remove_owned_empty_directory(
            root_directory,
            &leaf,
            "abandoned temporary snapshots directory",
            &abandoned,
            identity,
        )?;
    }
    Ok(())
}

/// Bounded scan of the compute root for temporary snapshots directories.
#[cfg(unix)]
fn temporary_snapshots_leaves(root_directory: &DirectoryFd) -> ComputeResult<Vec<String>> {
    let mut directory = Dir::read_from(root_directory)
        .map_err(|error| filesystem(format!("cannot enumerate the compute root: {error}")))?;
    let mut temporary_leaves = Vec::new();
    let mut entry_count = 0_usize;
    for entry in &mut directory {
        let entry =
            entry.map_err(|error| filesystem(format!("cannot read the compute root: {error}")))?;
        let name = entry
            .file_name()
            .to_str()
            .map_err(|_| filesystem("compute root contains a non-UTF-8 entry"))?;
        if name == "." || name == ".." {
            continue;
        }
        if entry_count >= MAX_COMPUTE_ROOT_ENTRIES {
            return Err(filesystem(format!(
                "compute root exceeds the {MAX_COMPUTE_ROOT_ENTRIES}-entry startup bound"
            )));
        }
        entry_count += 1;
        if name.starts_with(SNAPSHOTS_TEMP_PREFIX) {
            temporary_leaves.push(name.to_owned());
        }
    }
    Ok(temporary_leaves)
}

/// Bounded scan of the compute root for temporary snapshots directories.
#[cfg(windows)]
fn temporary_snapshots_leaves(root_directory: &DirectoryFd) -> ComputeResult<Vec<String>> {
    let entries = platform_fs::read_entry_names(root_directory)
        .map_err(|error| filesystem(format!("cannot enumerate the compute root: {error}")))?;
    let mut temporary_leaves = Vec::new();
    for (entry_count, name) in entries.enumerate() {
        let name = name
            .map_err(|error| filesystem(format!("cannot read the compute root: {error}")))?
            .into_string()
            .map_err(|_| filesystem("compute root contains a non-UTF-8 entry"))?;
        if entry_count >= MAX_COMPUTE_ROOT_ENTRIES {
            return Err(filesystem(format!(
                "compute root exceeds the {MAX_COMPUTE_ROOT_ENTRIES}-entry startup bound"
            )));
        }
        if name.starts_with(SNAPSHOTS_TEMP_PREFIX) {
            temporary_leaves.push(name);
        }
    }
    Ok(temporary_leaves)
}

fn validate_directory_entry(
    root_directory: &DirectoryFd,
    name: &str,
    label: &str,
    expected: FileIdentity,
) -> ComputeResult<()> {
    let metadata = platform_fs::stat_at_nofollow(root_directory, name)
        .map_err(|error| filesystem(format!("cannot inspect the {label} entry: {error}")))?;
    if !metadata.is_directory() || identity(metadata.device(), metadata.inode()) != expected {
        return Err(filesystem(format!(
            "{label} entry changed after capability creation"
        )));
    }
    Ok(())
}

#[cfg(unix)]
fn require_empty_directory(directory: &DirectoryFd, label: &str) -> ComputeResult<()> {
    let mut entries = Dir::read_from(directory)
        .map_err(|error| filesystem(format!("cannot enumerate the {label}: {error}")))?;
    for entry in &mut entries {
        let entry =
            entry.map_err(|error| filesystem(format!("cannot read the {label}: {error}")))?;
        let name = entry.file_name().to_bytes();
        if name != b"." && name != b".." {
            return Err(filesystem(format!("{label} contains an unexpected entry")));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn require_empty_directory(directory: &DirectoryFd, label: &str) -> ComputeResult<()> {
    let mut entries = platform_fs::read_entry_names(directory)
        .map_err(|error| filesystem(format!("cannot enumerate the {label}: {error}")))?;
    match entries.next() {
        None => Ok(()),
        Some(Err(error)) => Err(filesystem(format!("cannot read the {label}: {error}"))),
        Some(Ok(_)) => Err(filesystem(format!("{label} contains an unexpected entry"))),
    }
}

#[cfg(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    windows
))]
fn rename_snapshots_noreplace(
    root_directory: &DirectoryFd,
    temporary_leaf: &str,
) -> ComputeResult<bool> {
    match platform_fs::rename_noreplace_at(root_directory, temporary_leaf, SNAPSHOTS_DIRECTORY_NAME)
    {
        Ok(()) => Ok(true),
        Err(Errno::EXIST) => Ok(false),
        Err(error) => Err(filesystem(format!(
            "cannot atomically publish the compute snapshots directory: {error}"
        ))),
    }
}

/// Windows capabilities resolve children through the handle's current path.
/// The retained snapshots capability is reopened through its published name
/// so it does not depend on the filesystem reporting a renamed path for the
/// handle that was opened under the temporary name (Wine does not).
#[cfg(windows)]
fn reopen_published_snapshots_directory(
    root_directory: &DirectoryFd,
    temporary: DirectoryFd,
    identity: FileIdentity,
) -> ComputeResult<DirectoryFd> {
    let published = platform_fs::open_directory_at(root_directory, SNAPSHOTS_DIRECTORY_NAME)
        .map_err(|error| {
            filesystem(format!(
                "cannot open the compute snapshots directory: {error}"
            ))
        })?;
    if inspect_directory_identity(&published, "compute snapshots directory")? != identity {
        return Err(filesystem(
            "compute snapshots directory changed during publication",
        ));
    }
    drop(temporary);
    Ok(published)
}

#[cfg(all(
    unix,
    not(any(target_vendor = "apple", target_os = "linux", target_os = "android"))
))]
fn rename_snapshots_noreplace(
    _root_directory: &DirectoryFd,
    _temporary_leaf: &str,
) -> ComputeResult<bool> {
    Err(ComputeCoordinatorError::Unavailable(
        "atomic no-replace snapshots publication is unsupported on this Unix platform".into(),
    ))
}

fn remove_owned_empty_directory(
    root_directory: &DirectoryFd,
    leaf: &str,
    label: &str,
    directory: &DirectoryFd,
    identity: FileIdentity,
) -> ComputeResult<()> {
    if inspect_directory_identity(directory, label)? != identity {
        return Err(filesystem(format!(
            "held {label} descriptor changed filesystem identity"
        )));
    }
    validate_directory_entry(root_directory, leaf, label, identity)?;
    require_empty_directory(directory, label)?;
    validate_directory_entry(root_directory, leaf, label, identity)?;
    platform_fs::remove_directory_at(root_directory, leaf)
        .map_err(|error| filesystem(format!("cannot remove the {label}: {error}")))?;
    platform_fs::sync_directory(root_directory)
        .map_err(|error| filesystem(format!("cannot sync removal of the {label}: {error}")))
}

fn inspect_directory_identity(directory: &DirectoryFd, label: &str) -> ComputeResult<FileIdentity> {
    let metadata = platform_fs::stat(directory)
        .map_err(|error| filesystem(format!("cannot inspect the {label}: {error}")))?;
    if !metadata.is_directory() {
        return Err(filesystem(format!("{label} must be a directory")));
    }
    Ok(identity(metadata.device(), metadata.inode()))
}

fn cleanup_unopened_temporary_directory(
    root_directory: &DirectoryFd,
    leaf: &str,
    original_error: &ComputeCoordinatorError,
) -> ComputeResult<()> {
    match platform_fs::remove_directory_at(root_directory, leaf) {
        Ok(()) | Err(Errno::NOENT) => {
            platform_fs::sync_directory(root_directory).map_err(|error| {
                filesystem(format!(
                    "{original_error}; cannot sync temporary snapshots cleanup: {error}"
                ))
            })
        }
        Err(error) => Err(filesystem(format!(
            "{original_error}; cannot safely clean the temporary snapshots directory: {error}"
        ))),
    }
}

fn validate_root_path_identity(compute_root: &Path, expected: FileIdentity) -> ComputeResult<()> {
    let reopened = open_absolute_directory_nofollow(compute_root).map_err(|error| {
        filesystem(format!(
            "compute root path is no longer trustworthy: {error}"
        ))
    })?;
    let actual = validate_private_directory(&reopened, "compute root")?;
    if actual != expected {
        return Err(filesystem(
            "compute root was replaced during owner lock acquisition",
        ));
    }
    Ok(())
}

fn encode_lock_diagnostic(diagnostic: &LockDiagnostic<'_>) -> ComputeResult<Vec<u8>> {
    let mut encoded = serde_json::to_vec(diagnostic)?;
    encoded.push(b'\n');
    if encoded.len() > MAX_LOCK_DIAGNOSTIC_BYTES {
        return Err(ComputeCoordinatorError::Serialization(format!(
            "compute owner diagnostic exceeds {MAX_LOCK_DIAGNOSTIC_BYTES} bytes"
        )));
    }
    Ok(encoded)
}

#[cfg(unix)]
fn write_lock_diagnostic(file: &File, diagnostic: &LockDiagnostic<'_>) -> ComputeResult<()> {
    let encoded = encode_lock_diagnostic(diagnostic)?;

    seek(file, SeekFrom::Start(0))
        .map_err(|error| filesystem(format!("cannot seek the compute owner lock: {error}")))?;
    ftruncate(file, 0)
        .map_err(|error| filesystem(format!("cannot truncate the compute owner lock: {error}")))?;
    let mut remaining = encoded.as_slice();
    while !remaining.is_empty() {
        match write(file, remaining) {
            Ok(0) => {
                return Err(filesystem(
                    "cannot write the compute owner diagnostic: zero-byte write",
                ));
            }
            Ok(written) => remaining = &remaining[written..],
            Err(Errno::INTR) => {}
            Err(error) => {
                return Err(filesystem(format!(
                    "cannot write the compute owner diagnostic: {error}"
                )));
            }
        }
    }
    fsync(file)
        .map_err(|error| filesystem(format!("cannot fully sync the compute owner lock: {error}")))
}

#[cfg(windows)]
fn write_lock_diagnostic(mut file: &File, diagnostic: &LockDiagnostic<'_>) -> ComputeResult<()> {
    use std::io::{Seek, SeekFrom, Write};

    let encoded = encode_lock_diagnostic(diagnostic)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| filesystem(format!("cannot seek the compute owner lock: {error}")))?;
    file.set_len(0)
        .map_err(|error| filesystem(format!("cannot truncate the compute owner lock: {error}")))?;
    file.write_all(&encoded).map_err(|error| {
        filesystem(format!(
            "cannot write the compute owner diagnostic: {error}"
        ))
    })?;
    file.sync_all()
        .map_err(|error| filesystem(format!("cannot fully sync the compute owner lock: {error}")))
}

fn identity(device: u64, inode: u64) -> FileIdentity {
    FileIdentity { device, inode }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn filesystem(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Filesystem(message.into())
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        fs::{self, hard_link},
        os::unix::fs::{symlink, MetadataExt, PermissionsExt},
        path::{Path, PathBuf},
        process::{Child, Command, Stdio},
        sync::{Arc, Barrier},
        thread,
        time::{Duration, Instant},
    };

    use rustix::{
        io::{fcntl_getfd, FdFlags},
        process::geteuid,
    };
    use serde_json::Value;

    use super::*;

    const CHILD_PATH_ENV: &str = "BURETTE_COMPUTE_ROOT_LEASE_CHILD_PATH";
    const CHILD_EXPECT_ENV: &str = "BURETTE_COMPUTE_ROOT_LEASE_CHILD_EXPECT";
    const CHILD_READY_ENV: &str = "BURETTE_COMPUTE_ROOT_LEASE_CHILD_READY";
    const CHILD_TEST_NAME: &str = "compute::root_lease::tests::lock_subprocess_helper";

    struct TestRoot {
        parent: PathBuf,
        compute_root: PathBuf,
    }

    impl TestRoot {
        fn new() -> Self {
            let temp = std::env::temp_dir()
                .canonicalize()
                .expect("canonical temporary directory");
            let parent = temp.join(format!("burette-compute-root-{}", Uuid::new_v4()));
            fs::create_dir(&parent).expect("create test parent");
            Self {
                compute_root: parent.join("compute"),
                parent,
            }
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.parent);
        }
    }

    #[test]
    fn creates_private_root_and_bounded_owner_diagnostic() {
        let test = TestRoot::new();
        let lease = ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root");

        let root_metadata = fs::metadata(&test.compute_root).expect("compute root metadata");
        assert_eq!(root_metadata.mode() & 0o7777, 0o700);
        assert_eq!(root_metadata.uid(), geteuid().as_raw());

        let lock_path = test.compute_root.join(LOCK_FILE_NAME);
        let lock_metadata = fs::metadata(&lock_path).expect("owner lock metadata");
        assert_eq!(lock_metadata.mode() & 0o7777, 0o600);
        assert_eq!(lock_metadata.uid(), geteuid().as_raw());
        assert_eq!(lock_metadata.nlink(), 1);
        assert!(fcntl_getfd(&lease.root_directory)
            .expect("compute root descriptor flags")
            .contains(FdFlags::CLOEXEC));
        assert!(fcntl_getfd(&lease.lock_file)
            .expect("owner lock descriptor flags")
            .contains(FdFlags::CLOEXEC));

        let encoded = fs::read(&lock_path).expect("owner diagnostic");
        assert!(encoded.len() <= MAX_LOCK_DIAGNOSTIC_BYTES);
        assert_eq!(encoded.last(), Some(&b'\n'));
        let diagnostic: Value = serde_json::from_slice(&encoded).expect("diagnostic JSON");
        assert_eq!(diagnostic.as_object().expect("diagnostic object").len(), 4);
        assert_eq!(diagnostic["schemaVersion"], LOCK_DIAGNOSTIC_SCHEMA);
        assert_eq!(diagnostic["pid"], std::process::id());
        assert!(diagnostic["startedAtMs"].as_u64().expect("start timestamp") > 0);
        assert!(!Uuid::parse_str(
            diagnostic["instanceId"]
                .as_str()
                .expect("instance identifier")
        )
        .expect("UUID instance")
        .is_nil());
    }

    #[test]
    fn creates_descriptor_relative_private_snapshots_capability() {
        let test = TestRoot::new();
        let lease =
            Arc::new(ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root"));
        let snapshots = lease
            .open_or_create_snapshots_directory()
            .expect("create snapshots capability");

        assert_eq!(snapshots.path(), test.compute_root.join("snapshots"));
        let metadata = fs::metadata(snapshots.path()).expect("snapshots metadata");
        assert_eq!(metadata.mode() & 0o7777, 0o700);
        assert_eq!(metadata.uid(), geteuid().as_raw());
        assert!(fcntl_getfd(snapshots.directory())
            .expect("snapshots descriptor flags")
            .contains(FdFlags::CLOEXEC));
        snapshots.verify().expect("verify snapshots capability");

        drop(lease);
        snapshots
            .verify()
            .expect("child capability must retain the compute root lease");
    }

    #[test]
    fn concurrent_snapshots_creation_converges_and_reopens_the_same_identity() {
        const CONTENDERS: usize = 16;

        let test = TestRoot::new();
        let lease =
            Arc::new(ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root"));
        let barrier = Arc::new(Barrier::new(CONTENDERS + 1));
        let identities = thread::scope(|scope| {
            let handles = (0..CONTENDERS)
                .map(|_| {
                    let lease = Arc::clone(&lease);
                    let barrier = Arc::clone(&barrier);
                    scope.spawn(move || {
                        barrier.wait();
                        let snapshots = lease
                            .open_or_create_snapshots_directory()
                            .expect("open concurrent snapshots capability");
                        snapshots
                            .verify()
                            .expect("verify concurrent snapshots capability");
                        snapshots.identity
                    })
                })
                .collect::<Vec<_>>();
            barrier.wait();
            handles
                .into_iter()
                .map(|handle| handle.join().expect("join snapshots contender"))
                .collect::<Vec<_>>()
        });
        let expected = identities[0];
        assert!(identities.iter().all(|identity| *identity == expected));
        assert!(fs::read_dir(&test.compute_root)
            .expect("enumerate compute root")
            .all(|entry| !entry
                .expect("compute root entry")
                .file_name()
                .to_string_lossy()
                .starts_with(SNAPSHOTS_TEMP_PREFIX)));

        // Every contender clones the lease into its `ComputeRootChildDirectory`,
        // so the lock is only released if this drop is the last reference. Assert
        // that rather than trusting it: a leaked clone would otherwise surface as
        // a confusing "owned by another Burette process" failure below.
        let lease = Arc::into_inner(lease).expect("the test must hold the last lease reference");
        drop(lease);
        let reopened_lease = Arc::new(
            ComputeRootLease::acquire(&test.compute_root).unwrap_or_else(|error| {
                // The owner writes its pid into the lock file, so report it: it
                // distinguishes a descriptor this process failed to close from a
                // genuine foreign owner.
                let owner = fs::read_to_string(test.compute_root.join(LOCK_FILE_NAME))
                    .unwrap_or_else(|read_error| format!("<unreadable: {read_error}>"));
                panic!(
                    "reacquire compute root: {error:?}; this pid: {}; lock diagnostic: {}",
                    std::process::id(),
                    owner.trim()
                )
            }),
        );
        let reopened = reopened_lease
            .open_or_create_snapshots_directory()
            .expect("reopen durable snapshots capability");
        assert_eq!(reopened.identity, expected);
        reopened
            .verify()
            .expect("verify reopened snapshots capability");
    }

    #[test]
    fn restart_removes_only_canonical_empty_snapshots_creation_orphans() {
        let test = TestRoot::new();
        let lease =
            Arc::new(ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root"));
        let orphan = test
            .compute_root
            .join(format!("{SNAPSHOTS_TEMP_PREFIX}{}", Uuid::new_v4()));
        fs::create_dir(&orphan).expect("create abandoned snapshots directory");
        fs::set_permissions(&orphan, fs::Permissions::from_mode(0o700))
            .expect("make abandoned snapshots directory private");

        lease
            .open_or_create_snapshots_directory()
            .expect("reconcile abandoned snapshots directory");
        assert!(!orphan.exists());

        let malformed = test
            .compute_root
            .join(format!("{SNAPSHOTS_TEMP_PREFIX}not-a-uuid"));
        fs::create_dir(&malformed).expect("create malformed snapshots directory");
        fs::set_permissions(&malformed, fs::Permissions::from_mode(0o700))
            .expect("make malformed snapshots directory private");
        assert!(lease.open_or_create_snapshots_directory().is_err());
        assert!(malformed.is_dir());
    }

    #[test]
    fn rejects_unsafe_existing_snapshots_entries() {
        let symlink_test = TestRoot::new();
        let symlink_lease = Arc::new(
            ComputeRootLease::acquire(&symlink_test.compute_root)
                .expect("acquire symlink test root"),
        );
        let external = symlink_test.parent.join("external-snapshots");
        fs::create_dir(&external).expect("create external snapshots directory");
        symlink(&external, symlink_test.compute_root.join("snapshots"))
            .expect("create snapshots symlink");
        assert!(symlink_lease.open_or_create_snapshots_directory().is_err());

        let file_test = TestRoot::new();
        let file_lease = Arc::new(
            ComputeRootLease::acquire(&file_test.compute_root).expect("acquire file test root"),
        );
        let file_path = file_test.compute_root.join("snapshots");
        fs::write(&file_path, b"not a directory").expect("create snapshots file");
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o600))
            .expect("make snapshots file private");
        assert!(file_lease.open_or_create_snapshots_directory().is_err());

        let mode_test = TestRoot::new();
        let mode_lease = Arc::new(
            ComputeRootLease::acquire(&mode_test.compute_root).expect("acquire mode test root"),
        );
        let mode_path = mode_test.compute_root.join("snapshots");
        fs::create_dir(&mode_path).expect("create snapshots directory");
        fs::set_permissions(&mode_path, fs::Permissions::from_mode(0o755))
            .expect("make snapshots directory non-private");
        let error = mode_lease
            .open_or_create_snapshots_directory()
            .expect_err("non-private snapshots directory must be rejected");
        assert!(error.to_string().contains("permissions must be 0700"));
    }

    #[test]
    fn rejects_symlink_components_and_non_private_existing_roots() {
        let test = TestRoot::new();
        let real_parent = test.parent.join("real");
        fs::create_dir(&real_parent).expect("real parent");
        let linked_parent = test.parent.join("linked");
        symlink(&real_parent, &linked_parent).expect("linked parent");
        assert!(ComputeRootLease::acquire(&linked_parent.join("compute")).is_err());

        fs::create_dir(&test.compute_root).expect("existing compute root");
        fs::set_permissions(&test.compute_root, fs::Permissions::from_mode(0o755))
            .expect("set public permissions");
        let error = ComputeRootLease::acquire(&test.compute_root)
            .expect_err("public compute root must be rejected");
        assert!(error.to_string().contains("permissions must be 0700"));
    }

    #[test]
    fn rejects_hard_linked_owner_lock() {
        let test = TestRoot::new();
        fs::create_dir(&test.compute_root).expect("compute root");
        fs::set_permissions(&test.compute_root, fs::Permissions::from_mode(0o700))
            .expect("private compute root");
        let external = test.parent.join("external-lock");
        fs::write(&external, b"untrusted").expect("external lock");
        fs::set_permissions(&external, fs::Permissions::from_mode(0o600))
            .expect("private external lock");
        hard_link(&external, test.compute_root.join(LOCK_FILE_NAME)).expect("hard-linked lock");

        let error = ComputeRootLease::acquire(&test.compute_root)
            .expect_err("hard-linked lock must be rejected");
        assert!(error.to_string().contains("exactly one filesystem link"));
    }

    #[test]
    fn real_process_contention_fails_and_reacquires_after_drop() {
        let test = TestRoot::new();
        let lease = ComputeRootLease::acquire(&test.compute_root).expect("parent lease");
        run_child(&test.compute_root, "blocked");
        drop(lease);
        run_child(&test.compute_root, "acquired");
    }

    #[test]
    fn path_replacement_is_detected_before_path_based_access() {
        let test = TestRoot::new();
        let lease = ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root");
        let displaced = test.parent.join("displaced-compute");
        fs::rename(&test.compute_root, &displaced).expect("displace held compute root");
        fs::create_dir(&test.compute_root).expect("create replacement compute root");
        fs::set_permissions(&test.compute_root, fs::Permissions::from_mode(0o700))
            .expect("make replacement root private");

        let error = lease
            .verify_path_identity()
            .expect_err("replacement root must fail closed");
        assert!(error.to_string().contains("replaced"));
    }

    #[test]
    fn snapshots_capability_rejects_compute_root_replacement() {
        let test = TestRoot::new();
        let lease =
            Arc::new(ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root"));
        let snapshots = lease
            .open_or_create_snapshots_directory()
            .expect("create snapshots capability");
        let displaced = test.parent.join("displaced-compute-with-snapshots");
        fs::rename(&test.compute_root, &displaced).expect("displace held compute root");
        fs::create_dir(&test.compute_root).expect("create replacement compute root");
        fs::set_permissions(&test.compute_root, fs::Permissions::from_mode(0o700))
            .expect("make replacement root private");

        let error = snapshots
            .verify()
            .expect_err("replacement compute root must fail child verification");
        assert!(error.to_string().contains("replaced"));
    }

    #[test]
    fn snapshots_capability_rejects_child_entry_replacement() {
        let test = TestRoot::new();
        let lease =
            Arc::new(ComputeRootLease::acquire(&test.compute_root).expect("acquire compute root"));
        let snapshots = lease
            .open_or_create_snapshots_directory()
            .expect("create snapshots capability");
        let snapshots_path = test.compute_root.join(SNAPSHOTS_DIRECTORY_NAME);
        let displaced = test.compute_root.join("displaced-snapshots");
        fs::rename(&snapshots_path, &displaced).expect("displace snapshots directory");
        fs::create_dir(&snapshots_path).expect("create replacement snapshots directory");
        fs::set_permissions(&snapshots_path, fs::Permissions::from_mode(0o700))
            .expect("make replacement snapshots directory private");

        let error = snapshots
            .verify()
            .expect_err("replacement snapshots entry must fail closed");
        assert!(error.to_string().contains("entry changed"));
    }

    #[test]
    fn kernel_releases_process_lock_after_sigkill() {
        let test = TestRoot::new();
        let ready = test.parent.join("child-ready");
        let mut child = spawn_holding_child(&test.compute_root, &ready);
        wait_until_ready(&mut child, &ready);

        assert!(matches!(
            ComputeRootLease::acquire(&test.compute_root),
            Err(ComputeCoordinatorError::Unavailable(_))
        ));
        child.kill().expect("SIGKILL lock owner");
        child.wait().expect("reap killed lock owner");

        ComputeRootLease::acquire(&test.compute_root)
            .expect("kernel must release lock after process death");
    }

    #[test]
    fn lock_subprocess_helper() {
        let Some(path) = std::env::var_os(CHILD_PATH_ENV) else {
            return;
        };
        let expectation = std::env::var(CHILD_EXPECT_ENV).expect("child expectation");
        let outcome = ComputeRootLease::acquire(Path::new(&path));
        match (expectation.as_str(), outcome) {
            ("blocked", Err(ComputeCoordinatorError::Unavailable(_))) => {}
            ("acquired", Ok(_lease)) => {}
            ("hold", Ok(lease)) => {
                let ready = std::env::var_os(CHILD_READY_ENV).expect("child ready path");
                fs::write(ready, b"ready\n").expect("publish child readiness");
                loop {
                    std::hint::black_box(&lease);
                    thread::sleep(Duration::from_secs(1));
                }
            }
            (expected, other) => panic!("expected child lease {expected}, got {other:?}"),
        }
    }

    fn run_child(compute_root: &Path, expectation: &str) {
        let output = Command::new(std::env::current_exe().expect("current test binary"))
            .arg("--exact")
            .arg(CHILD_TEST_NAME)
            .arg("--nocapture")
            .env(CHILD_PATH_ENV, compute_root)
            .env(CHILD_EXPECT_ENV, expectation)
            .output()
            .expect("run lock contender");
        assert!(
            output.status.success(),
            "lock contender failed:\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn spawn_holding_child(compute_root: &Path, ready: &Path) -> Child {
        Command::new(std::env::current_exe().expect("current test binary"))
            .arg("--exact")
            .arg(CHILD_TEST_NAME)
            .arg("--nocapture")
            .env(CHILD_PATH_ENV, compute_root)
            .env(CHILD_EXPECT_ENV, "hold")
            .env(CHILD_READY_ENV, ready)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn lock owner")
    }

    fn wait_until_ready(child: &mut Child, ready: &Path) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            assert_eq!(child.try_wait().expect("inspect lock owner"), None);
            if ready.is_file() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        let _ = child.wait();
        panic!("lock owner did not become ready");
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use std::fs;

    use super::*;

    #[test]
    fn lease_excludes_a_second_owner_keeps_the_diagnostic_readable_and_detects_replacement() {
        let parent = std::env::temp_dir().join(format!("burette-compute-root-{}", Uuid::new_v4()));
        fs::create_dir(&parent).expect("create test parent");
        let compute_root = parent.join("compute");

        let lease = Arc::new(ComputeRootLease::acquire(&compute_root).expect("acquire root"));
        assert!(matches!(
            ComputeRootLease::acquire(&compute_root),
            Err(ComputeCoordinatorError::Unavailable(_))
        ));
        let diagnostic = fs::read(compute_root.join(LOCK_FILE_NAME)).expect("read diagnostic");
        assert_eq!(diagnostic.last(), Some(&b'\n'));
        let snapshots = lease
            .open_or_create_snapshots_directory()
            .expect("create snapshots capability");
        snapshots.verify().expect("verify snapshots capability");
        let identity = snapshots.identity;
        drop((snapshots, lease));

        let lease = Arc::new(ComputeRootLease::acquire(&compute_root).expect("reacquire root"));
        let reopened = lease
            .open_or_create_snapshots_directory()
            .expect("reopen snapshots capability");
        assert_eq!(reopened.identity, identity);

        fs::rename(&compute_root, parent.join("displaced")).expect("displace held root");
        fs::create_dir(&compute_root).expect("create replacement root");
        reopened
            .verify()
            .expect_err("replacement root must fail closed");

        drop((reopened, lease));
        let _ = fs::remove_dir_all(parent);
    }
}
