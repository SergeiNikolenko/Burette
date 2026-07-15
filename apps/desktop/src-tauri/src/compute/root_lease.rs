#[cfg(unix)]
use std::{
    os::fd::OwnedFd,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use rustix::{
    fs::{
        fchmod, flock, fstat, fsync, ftruncate, mkdirat, open, openat, seek, statat, AtFlags,
        FileType, FlockOperation, Mode, OFlags, SeekFrom,
    },
    io::{write, Errno},
    process::geteuid,
};
#[cfg(unix)]
use serde::Serialize;
#[cfg(unix)]
use uuid::Uuid;

use crate::compute::error::{ComputeCoordinatorError, ComputeResult};

#[cfg(unix)]
const LOCK_FILE_NAME: &str = ".compute-owner.lock";
#[cfg(unix)]
const LOCK_DIAGNOSTIC_SCHEMA: &str = "burrete.compute-owner.v1";
#[cfg(unix)]
const MAX_LOCK_DIAGNOSTIC_BYTES: usize = 512;
#[cfg(unix)]
const DIRECTORY_MODE: Mode = Mode::from_bits_truncate(0o700);
#[cfg(unix)]
const FILE_MODE: Mode = Mode::from_bits_truncate(0o600);
#[cfg(unix)]
const DIRECTORY_FLAGS: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::CLOEXEC)
    .union(OFlags::NOFOLLOW);
#[cfg(unix)]
const CREATE_LOCK_FLAGS: OFlags = OFlags::RDWR
    .union(OFlags::CREATE)
    .union(OFlags::EXCL)
    .union(OFlags::CLOEXEC)
    .union(OFlags::NOFOLLOW);
#[cfg(unix)]
const OPEN_LOCK_FLAGS: OFlags = OFlags::RDWR.union(OFlags::CLOEXEC).union(OFlags::NOFOLLOW);

/// Process-lifetime ownership of the durable compute root.
///
/// The descriptor fields are intentionally never duplicated: closing the lock
/// descriptor is what releases the advisory lease.
#[cfg(unix)]
#[derive(Debug)]
pub(crate) struct ComputeRootLease {
    compute_root: PathBuf,
    root_identity: FileIdentity,
    lock_identity: FileIdentity,
    root_directory: OwnedFd,
    lock_file: OwnedFd,
}

#[cfg(unix)]
impl ComputeRootLease {
    pub(crate) fn acquire(compute_root: &Path) -> ComputeResult<Self> {
        let (root_directory, root_identity) = create_or_open_compute_root(compute_root)?;
        let lock_file = create_or_open_lock_file(&root_directory)?;
        let lock_identity = validate_private_lock_file(&lock_file)?;

        match flock(&lock_file, FlockOperation::NonBlockingLockExclusive) {
            Ok(()) => {}
            Err(Errno::AGAIN) => {
                return Err(ComputeCoordinatorError::Unavailable(
                    "the compute root is already owned by another Burrete process".into(),
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
        fsync(&root_directory)
            .map_err(|error| filesystem(format!("cannot sync the compute root: {error}")))?;

        let lease = Self {
            compute_root: compute_root.to_path_buf(),
            root_identity,
            lock_identity,
            root_directory,
            lock_file,
        };
        lease.verify_path_identity()?;
        Ok(lease)
    }

    pub(crate) fn compute_root(&self) -> &Path {
        &self.compute_root
    }

    /// Revalidates both held capabilities and their current directory entries.
    ///
    /// Callers must fail closed when this check fails: a path-based open after
    /// root replacement must never silently join a second coordinator root.
    pub(crate) fn verify_path_identity(&self) -> ComputeResult<()> {
        if validate_private_directory(&self.root_directory)? != self.root_identity {
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

#[cfg(not(unix))]
#[derive(Debug)]
pub(crate) struct ComputeRootLease {
    compute_root: std::path::PathBuf,
}

#[cfg(not(unix))]
impl ComputeRootLease {
    pub(crate) fn acquire(_compute_root: &std::path::Path) -> ComputeResult<Self> {
        Err(ComputeCoordinatorError::Unavailable(
            "compute root ownership requires Unix directory capabilities".into(),
        ))
    }

    pub(crate) fn compute_root(&self) -> &std::path::Path {
        &self.compute_root
    }

    pub(crate) fn verify_path_identity(&self) -> ComputeResult<()> {
        Err(ComputeCoordinatorError::Unavailable(
            "compute root ownership requires Unix directory capabilities".into(),
        ))
    }
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LockDiagnostic<'a> {
    schema_version: &'static str,
    instance_id: &'a str,
    pid: u32,
    /// Unix epoch milliseconds captured immediately after lock acquisition.
    started_at_ms: u64,
}

#[cfg(unix)]
fn create_or_open_compute_root(compute_root: &Path) -> ComputeResult<(OwnedFd, FileIdentity)> {
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
    let created = match mkdirat(&parent_directory, leaf, DIRECTORY_MODE) {
        Ok(()) => true,
        Err(Errno::EXIST) => false,
        Err(error) => {
            return Err(filesystem(format!(
                "cannot create the compute root: {error}"
            )));
        }
    };
    let root_directory = openat(&parent_directory, leaf, DIRECTORY_FLAGS, Mode::empty())
        .map_err(|error| filesystem(format!("cannot open the compute root: {error}")))?;
    if created {
        fchmod(&root_directory, DIRECTORY_MODE).map_err(|error| {
            filesystem(format!(
                "cannot set private compute root permissions: {error}"
            ))
        })?;
        fsync(&root_directory)
            .map_err(|error| filesystem(format!("cannot sync the compute root: {error}")))?;
        fsync(&parent_directory)
            .map_err(|error| filesystem(format!("cannot sync the compute root parent: {error}")))?;
    }
    let identity = validate_private_directory(&root_directory)?;
    Ok((root_directory, identity))
}

#[cfg(unix)]
fn create_or_open_lock_file(root_directory: &OwnedFd) -> ComputeResult<OwnedFd> {
    match openat(root_directory, LOCK_FILE_NAME, CREATE_LOCK_FLAGS, FILE_MODE) {
        Ok(file) => {
            fchmod(&file, FILE_MODE).map_err(|error| {
                filesystem(format!(
                    "cannot set private compute owner lock permissions: {error}"
                ))
            })?;
            Ok(file)
        }
        Err(Errno::EXIST) => openat(
            root_directory,
            LOCK_FILE_NAME,
            OPEN_LOCK_FLAGS,
            Mode::empty(),
        )
        .map_err(|error| filesystem(format!("cannot open the compute owner lock: {error}"))),
        Err(error) => Err(filesystem(format!(
            "cannot create the compute owner lock: {error}"
        ))),
    }
}

#[cfg(unix)]
fn open_absolute_directory_nofollow(path: &Path) -> ComputeResult<OwnedFd> {
    if !path.is_absolute() {
        return Err(filesystem("compute root path must be absolute"));
    }
    let mut directory = open("/", DIRECTORY_FLAGS, Mode::empty())
        .map_err(|error| filesystem(format!("cannot open the filesystem root: {error}")))?;
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => {
                directory = openat(&directory, name, DIRECTORY_FLAGS, Mode::empty()).map_err(
                    |error| {
                        filesystem(format!(
                            "compute root path contains an unavailable or symlink component '{}': {error}",
                            name.to_string_lossy()
                        ))
                    },
                )?;
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

#[cfg(unix)]
fn validate_private_directory(directory: &OwnedFd) -> ComputeResult<FileIdentity> {
    let metadata = fstat(directory)
        .map_err(|error| filesystem(format!("cannot inspect the compute root: {error}")))?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::Directory {
        return Err(filesystem("compute root must be a directory"));
    }
    if metadata.st_uid != geteuid().as_raw() {
        return Err(filesystem("compute root must be owned by the current user"));
    }
    if metadata.st_mode & 0o7777 != 0o700 {
        return Err(filesystem("compute root permissions must be 0700"));
    }
    Ok(identity(metadata.st_dev as u64, metadata.st_ino as u64))
}

#[cfg(unix)]
fn validate_private_lock_file(file: &OwnedFd) -> ComputeResult<FileIdentity> {
    let metadata = fstat(file)
        .map_err(|error| filesystem(format!("cannot inspect the compute owner lock: {error}")))?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile {
        return Err(filesystem("compute owner lock must be a regular file"));
    }
    if metadata.st_uid != geteuid().as_raw() {
        return Err(filesystem(
            "compute owner lock must be owned by the current user",
        ));
    }
    if metadata.st_mode & 0o7777 != 0o600 {
        return Err(filesystem("compute owner lock permissions must be 0600"));
    }
    if metadata.st_nlink != 1 {
        return Err(filesystem(
            "compute owner lock must have exactly one filesystem link",
        ));
    }
    Ok(identity(metadata.st_dev as u64, metadata.st_ino as u64))
}

#[cfg(unix)]
fn validate_lock_directory_entry(
    root_directory: &OwnedFd,
    expected: FileIdentity,
) -> ComputeResult<()> {
    let metadata =
        statat(root_directory, LOCK_FILE_NAME, AtFlags::SYMLINK_NOFOLLOW).map_err(|error| {
            filesystem(format!(
                "cannot inspect the compute owner lock directory entry: {error}"
            ))
        })?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile
        || identity(metadata.st_dev as u64, metadata.st_ino as u64) != expected
    {
        return Err(filesystem(
            "compute owner lock directory entry changed during acquisition",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_root_path_identity(compute_root: &Path, expected: FileIdentity) -> ComputeResult<()> {
    let reopened = open_absolute_directory_nofollow(compute_root).map_err(|error| {
        filesystem(format!(
            "compute root path is no longer trustworthy: {error}"
        ))
    })?;
    let actual = validate_private_directory(&reopened)?;
    if actual != expected {
        return Err(filesystem(
            "compute root was replaced during owner lock acquisition",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn write_lock_diagnostic(file: &OwnedFd, diagnostic: &LockDiagnostic<'_>) -> ComputeResult<()> {
    let mut encoded = serde_json::to_vec(diagnostic)?;
    encoded.push(b'\n');
    if encoded.len() > MAX_LOCK_DIAGNOSTIC_BYTES {
        return Err(ComputeCoordinatorError::Serialization(format!(
            "compute owner diagnostic exceeds {MAX_LOCK_DIAGNOSTIC_BYTES} bytes"
        )));
    }

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

#[cfg(unix)]
fn identity(device: u64, inode: u64) -> FileIdentity {
    FileIdentity { device, inode }
}

#[cfg(unix)]
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
        thread,
        time::{Duration, Instant},
    };

    use rustix::io::{fcntl_getfd, FdFlags};
    use serde_json::Value;

    use super::*;

    const CHILD_PATH_ENV: &str = "BURRETE_COMPUTE_ROOT_LEASE_CHILD_PATH";
    const CHILD_EXPECT_ENV: &str = "BURRETE_COMPUTE_ROOT_LEASE_CHILD_EXPECT";
    const CHILD_READY_ENV: &str = "BURRETE_COMPUTE_ROOT_LEASE_CHILD_READY";
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
            let parent = temp.join(format!("burrete-compute-root-{}", Uuid::new_v4()));
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
