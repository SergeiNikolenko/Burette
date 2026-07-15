#[cfg(unix)]
mod platform {
    use std::{
        fs::File,
        os::fd::OwnedFd,
        path::{Component, Path, PathBuf},
        sync::Mutex,
    };

    use burrete_compute_protocol::MOLECULAR_RECORDS_FILE_NAME;
    use rustix::{
        fs::{
            fstat, fstatvfs, fsync, mkdirat, open, openat, statat, unlinkat, AtFlags, FileType,
            Mode, OFlags,
        },
        io::Errno,
        process::geteuid,
    };
    use uuid::Uuid;

    const DIRECTORY_FLAGS: OFlags = OFlags::RDONLY
        .union(OFlags::DIRECTORY)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const FILE_FLAGS: OFlags = OFlags::WRONLY
        .union(OFlags::CREATE)
        .union(OFlags::EXCL)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const READ_FILE_FLAGS: OFlags = OFlags::RDONLY
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const DIRECTORY_MODE: Mode = Mode::from_bits_truncate(0o700);
    const FILE_MODE: Mode = Mode::from_bits_truncate(0o600);

    const PACK_FILES: [&str; 3] = [
        "source-record-ids.bin",
        "molecule-content-hashes.bin",
        MOLECULAR_RECORDS_FILE_NAME,
    ];
    const SNAPSHOT_FILES: [&str; 1] = ["manifest.json"];

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct DirectoryIdentity {
        device: u64,
        inode: u64,
    }

    #[derive(Debug)]
    pub(crate) struct SnapshotPublicationRoot {
        path: PathBuf,
        directory: OwnedFd,
        identity: DirectoryIdentity,
        reservations: ReservationPool,
    }

    impl SnapshotPublicationRoot {
        pub(crate) fn create(path: &Path) -> Result<Self, String> {
            if !path.is_absolute() {
                return Err("Snapshot publication root must be an absolute path".into());
            }
            let parent = path.parent().ok_or_else(|| {
                "Snapshot publication root requires a parent directory".to_string()
            })?;
            let leaf = path.file_name().ok_or_else(|| {
                "Snapshot publication root requires a final directory name".to_string()
            })?;
            let parent_directory = open_absolute_directory_nofollow(parent)?;
            match mkdirat(&parent_directory, leaf, DIRECTORY_MODE) {
                Ok(()) | Err(Errno::EXIST) => {}
                Err(error) => {
                    return Err(format!("Cannot create snapshot publication root: {error}"));
                }
            }
            let directory = openat(&parent_directory, leaf, DIRECTORY_FLAGS, Mode::empty())
                .map_err(|error| format!("Cannot open snapshot publication root: {error}"))?;
            let identity = validate_private_directory(&directory, "publication root")?;
            fsync(&parent_directory)
                .map_err(|error| format!("Cannot sync snapshot publication parent: {error}"))?;
            Ok(Self {
                path: path.to_path_buf(),
                directory,
                identity,
                reservations: ReservationPool::default(),
            })
        }

        pub(crate) fn open(path: &Path) -> Result<Self, String> {
            let directory = open_absolute_directory_nofollow(path)?;
            let identity = validate_private_directory(&directory, "publication root")?;
            Ok(Self {
                path: path.to_path_buf(),
                directory,
                identity,
                reservations: ReservationPool::default(),
            })
        }

        pub(crate) fn destination_path(&self, snapshot_id: Uuid) -> PathBuf {
            self.path.join(publication_leaf(snapshot_id))
        }

        pub(crate) fn available_bytes(&self) -> Result<u64, String> {
            let statistics = fstatvfs(&self.directory).map_err(|error| {
                format!("Cannot inspect snapshot publication filesystem: {error}")
            })?;
            statistics
                .f_bavail
                .checked_mul(statistics.f_frsize)
                .ok_or_else(|| "Snapshot publication free-space count overflowed".into())
        }

        pub(crate) fn reserve_bytes(
            &self,
            required_bytes: u64,
            headroom_bytes: u64,
        ) -> Result<SnapshotByteReservation<'_>, String> {
            let available_bytes = self.available_bytes()?;
            self.reservations
                .reserve(required_bytes, headroom_bytes, available_bytes)
        }

        fn verify_path_identity(&self) -> Result<(), String> {
            let reopened = open_absolute_directory_nofollow(&self.path).map_err(|error| {
                format!("Snapshot publication root path is no longer trustworthy: {error}")
            })?;
            let reopened_identity = validate_private_directory(&reopened, "publication root")?;
            if reopened_identity != self.identity {
                return Err(
                    "Snapshot publication root was replaced after capability creation".into(),
                );
            }
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct ReservationPool {
        reserved_bytes: Mutex<u64>,
    }

    impl ReservationPool {
        fn reserve(
            &self,
            required_bytes: u64,
            headroom_bytes: u64,
            available_bytes: u64,
        ) -> Result<SnapshotByteReservation<'_>, String> {
            let mut reserved_bytes = self
                .reserved_bytes
                .lock()
                .map_err(|_| "Snapshot publication reservation state is poisoned")?;
            let aggregate_bytes = reserved_bytes
                .checked_add(required_bytes)
                .and_then(|bytes| bytes.checked_add(headroom_bytes))
                .ok_or_else(|| "Snapshot publication reservation count overflowed".to_string())?;
            if aggregate_bytes > available_bytes {
                return Err(format!(
                    "Snapshot publication requires {required_bytes} bytes with {headroom_bytes} bytes of headroom and {} bytes already reserved; only {available_bytes} bytes are available",
                    *reserved_bytes
                ));
            }
            *reserved_bytes = reserved_bytes
                .checked_add(required_bytes)
                .expect("aggregate reservation was checked above");
            Ok(SnapshotByteReservation {
                pool: self,
                reserved_bytes: required_bytes,
            })
        }
    }

    #[derive(Debug)]
    #[must_use = "snapshot byte reservations must remain alive through publication or cleanup"]
    pub(crate) struct SnapshotByteReservation<'a> {
        pool: &'a ReservationPool,
        reserved_bytes: u64,
    }

    impl Drop for SnapshotByteReservation<'_> {
        fn drop(&mut self) {
            let mut reserved_bytes = self
                .pool
                .reserved_bytes
                .lock()
                .expect("snapshot publication reservation state is poisoned");
            *reserved_bytes = reserved_bytes
                .checked_sub(self.reserved_bytes)
                .expect("snapshot publication reservation accounting underflowed");
        }
    }

    #[derive(Debug)]
    pub(crate) struct PublishedSnapshotRoot {
        path: PathBuf,
        directory: OwnedFd,
        identity: DirectoryIdentity,
    }

    impl PublishedSnapshotRoot {
        /// Diagnostic locator only. Consumers must use this capability's
        /// descriptor-relative open method rather than reopening this path.
        pub(crate) fn path(&self) -> &Path {
            &self.path
        }

        pub(crate) fn open_file(&self, relative_path: &str) -> Result<File, String> {
            let (directory_name, file_name) = match relative_path {
                "pack/source-record-ids.bin" => ("pack", "source-record-ids.bin"),
                "pack/molecule-content-hashes.bin" => ("pack", "molecule-content-hashes.bin"),
                "pack/molecular-records.v1.jsonl" => ("pack", MOLECULAR_RECORDS_FILE_NAME),
                "snapshot/manifest.json" => ("snapshot", "manifest.json"),
                _ => return Err("Unrecognized published snapshot file".into()),
            };
            let directory = openat(
                &self.directory,
                directory_name,
                DIRECTORY_FLAGS,
                Mode::empty(),
            )
            .map_err(|error| format!("Cannot open published snapshot directory: {error}"))?;
            validate_private_directory(&directory, "published content directory")?;
            let file = openat(&directory, file_name, READ_FILE_FLAGS, Mode::empty())
                .map_err(|error| format!("Cannot open published snapshot file: {error}"))?;
            validate_private_file(&file)?;
            Ok(file.into())
        }
    }

    pub(crate) struct SnapshotStaging<'a> {
        root: &'a SnapshotPublicationRoot,
        final_leaf: String,
        active_leaf: String,
        staging_directory: OwnedFd,
        pack_directory: OwnedFd,
        snapshot_directory: OwnedFd,
        armed: bool,
    }

    impl<'a> SnapshotStaging<'a> {
        pub(crate) fn create(
            root: &'a SnapshotPublicationRoot,
            snapshot_id: Uuid,
        ) -> Result<Self, String> {
            root.verify_path_identity()?;
            let final_leaf = publication_leaf(snapshot_id);
            ensure_missing(&root.directory, &final_leaf)?;

            let active_leaf = format!(".{final_leaf}.staging-{}", Uuid::new_v4());
            mkdirat(&root.directory, active_leaf.as_str(), DIRECTORY_MODE)
                .map_err(|error| format!("Cannot create snapshot staging directory: {error}"))?;
            let staging_directory = match openat(
                &root.directory,
                active_leaf.as_str(),
                DIRECTORY_FLAGS,
                Mode::empty(),
            ) {
                Ok(directory) => directory,
                Err(error) => {
                    let _ = unlinkat(&root.directory, active_leaf.as_str(), AtFlags::REMOVEDIR);
                    return Err(format!("Cannot open snapshot staging directory: {error}"));
                }
            };

            let directories = create_snapshot_directories(&staging_directory);
            let (pack_directory, snapshot_directory) = match directories {
                Ok(directories) => directories,
                Err(error) => {
                    cleanup_tree(
                        &root.directory,
                        &active_leaf,
                        &staging_directory,
                        None,
                        None,
                    );
                    return Err(error);
                }
            };

            Ok(Self {
                root,
                final_leaf,
                active_leaf,
                staging_directory,
                pack_directory,
                snapshot_directory,
                armed: true,
            })
        }

        pub(crate) fn create_pack_file(&self, name: &'static str) -> Result<File, String> {
            if !PACK_FILES.contains(&name) {
                return Err("Unrecognized snapshot pack file".into());
            }
            create_file(&self.pack_directory, name)
        }

        pub(crate) fn create_manifest_file(&self) -> Result<File, String> {
            create_file(&self.snapshot_directory, SNAPSHOT_FILES[0])
        }

        pub(crate) fn sync_directories(&self) -> Result<(), String> {
            fsync(&self.pack_directory)
                .map_err(|error| format!("Cannot sync snapshot pack directory: {error}"))?;
            fsync(&self.snapshot_directory)
                .map_err(|error| format!("Cannot sync snapshot manifest directory: {error}"))?;
            fsync(&self.staging_directory)
                .map_err(|error| format!("Cannot sync snapshot staging directory: {error}"))
        }

        pub(crate) fn publish(mut self) -> Result<PublishedSnapshotRoot, String> {
            self.root.verify_path_identity()?;
            let staging_identity =
                validate_private_directory(&self.staging_directory, "staging directory")?;
            rename_noreplace(&self.root.directory, &self.active_leaf, &self.final_leaf)?;
            self.active_leaf.clone_from(&self.final_leaf);

            fsync(&self.root.directory)
                .map_err(|error| format!("Cannot sync snapshot publication root: {error}"))?;
            self.root.verify_path_identity()?;

            let published_directory = openat(
                &self.root.directory,
                self.final_leaf.as_str(),
                DIRECTORY_FLAGS,
                Mode::empty(),
            )
            .map_err(|error| format!("Cannot open published snapshot capability: {error}"))?;
            let published_identity =
                validate_private_directory(&published_directory, "published snapshot")?;
            if published_identity != staging_identity {
                return Err("Published snapshot directory identity changed during rename".into());
            }

            self.armed = false;
            Ok(PublishedSnapshotRoot {
                path: self.root.path.join(&self.final_leaf),
                directory: published_directory,
                identity: published_identity,
            })
        }
    }

    impl Drop for SnapshotStaging<'_> {
        fn drop(&mut self) {
            if self.armed {
                cleanup_tree(
                    &self.root.directory,
                    &self.active_leaf,
                    &self.staging_directory,
                    Some(&self.pack_directory),
                    Some(&self.snapshot_directory),
                );
                let _ = fsync(&self.root.directory);
            }
        }
    }

    fn publication_leaf(snapshot_id: Uuid) -> String {
        format!("snapshot-{snapshot_id}")
    }

    fn open_absolute_directory_nofollow(path: &Path) -> Result<OwnedFd, String> {
        if !path.is_absolute() {
            return Err("Snapshot publication root must be an absolute path".into());
        }

        let mut directory = open("/", DIRECTORY_FLAGS, Mode::empty())
            .map_err(|error| format!("Cannot open filesystem root: {error}"))?;
        for component in path.components() {
            match component {
                Component::RootDir => {}
                Component::Normal(name) => {
                    directory = openat(&directory, name, DIRECTORY_FLAGS, Mode::empty()).map_err(
                        |error| {
                            format!(
                                "Snapshot publication root contains an unavailable or symlink component '{}': {error}",
                                name.to_string_lossy()
                            )
                        },
                    )?;
                }
                Component::CurDir | Component::ParentDir | Component::Prefix(_) => {
                    return Err(
                        "Snapshot publication root cannot contain relative path components".into(),
                    );
                }
            }
        }
        Ok(directory)
    }

    fn validate_private_directory(
        directory: &OwnedFd,
        label: &str,
    ) -> Result<DirectoryIdentity, String> {
        let metadata = fstat(directory)
            .map_err(|error| format!("Cannot inspect snapshot {label}: {error}"))?;
        if metadata.st_uid != geteuid().as_raw() {
            return Err(format!(
                "Snapshot {label} must be owned by the current user"
            ));
        }
        if metadata.st_mode & 0o777 != 0o700 {
            return Err(format!("Snapshot {label} permissions must be 0700"));
        }
        Ok(DirectoryIdentity {
            device: metadata.st_dev as u64,
            inode: metadata.st_ino as u64,
        })
    }

    fn validate_private_file(file: &OwnedFd) -> Result<(), String> {
        let metadata = fstat(file)
            .map_err(|error| format!("Cannot inspect published snapshot file: {error}"))?;
        if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile {
            return Err("Published snapshot content must be a regular file".into());
        }
        if metadata.st_uid != geteuid().as_raw() {
            return Err("Published snapshot file must be owned by the current user".into());
        }
        if metadata.st_mode & 0o777 != 0o600 {
            return Err("Published snapshot file permissions must be 0600".into());
        }
        Ok(())
    }

    fn ensure_missing(directory: &OwnedFd, leaf: &str) -> Result<(), String> {
        match statat(directory, leaf, AtFlags::SYMLINK_NOFOLLOW) {
            Ok(_) => Err(format!(
                "Frozen Grid snapshot destination already exists: {leaf}"
            )),
            Err(Errno::NOENT) => Ok(()),
            Err(error) => Err(format!(
                "Cannot inspect frozen Grid snapshot destination '{leaf}': {error}"
            )),
        }
    }

    fn create_snapshot_directories(
        staging_directory: &OwnedFd,
    ) -> Result<(OwnedFd, OwnedFd), String> {
        mkdirat(staging_directory, "pack", DIRECTORY_MODE)
            .map_err(|error| format!("Cannot create snapshot pack directory: {error}"))?;
        let pack_directory = openat(staging_directory, "pack", DIRECTORY_FLAGS, Mode::empty())
            .map_err(|error| format!("Cannot open snapshot pack directory: {error}"))?;

        if let Err(error) = mkdirat(staging_directory, "snapshot", DIRECTORY_MODE) {
            let _ = unlinkat(staging_directory, "pack", AtFlags::REMOVEDIR);
            return Err(format!(
                "Cannot create snapshot manifest directory: {error}"
            ));
        }
        let snapshot_directory = openat(
            staging_directory,
            "snapshot",
            DIRECTORY_FLAGS,
            Mode::empty(),
        )
        .map_err(|error| format!("Cannot open snapshot manifest directory: {error}"))?;
        Ok((pack_directory, snapshot_directory))
    }

    fn create_file(directory: &OwnedFd, name: &'static str) -> Result<File, String> {
        let file = openat(directory, name, FILE_FLAGS, FILE_MODE)
            .map_err(|error| format!("Cannot create snapshot file '{name}': {error}"))?;
        Ok(file.into())
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
    fn rename_noreplace(
        directory: &OwnedFd,
        source_leaf: &str,
        destination_leaf: &str,
    ) -> Result<(), String> {
        rustix::fs::renameat_with(
            directory,
            source_leaf,
            directory,
            destination_leaf,
            rustix::fs::RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            format!(
                "Cannot publish frozen Grid snapshot without replacement at '{destination_leaf}': {error}"
            )
        })
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux", target_os = "android")))]
    fn rename_noreplace(
        _directory: &OwnedFd,
        _source_leaf: &str,
        _destination_leaf: &str,
    ) -> Result<(), String> {
        Err("Atomic no-replace snapshot publication is unsupported on this Unix platform".into())
    }

    fn cleanup_tree(
        root: &OwnedFd,
        active_leaf: &str,
        staging: &OwnedFd,
        pack: Option<&OwnedFd>,
        snapshot: Option<&OwnedFd>,
    ) {
        if let Some(pack) = pack {
            for file in PACK_FILES {
                let _ = unlinkat(pack, file, AtFlags::empty());
            }
        }
        if let Some(snapshot) = snapshot {
            for file in SNAPSHOT_FILES {
                let _ = unlinkat(snapshot, file, AtFlags::empty());
            }
        }
        let _ = unlinkat(staging, "pack", AtFlags::REMOVEDIR);
        let _ = unlinkat(staging, "snapshot", AtFlags::REMOVEDIR);
        let _ = unlinkat(root, active_leaf, AtFlags::REMOVEDIR);
    }

    #[cfg(test)]
    mod tests {
        use std::sync::{Arc, Barrier};

        use super::ReservationPool;

        #[test]
        fn concurrent_reservations_cannot_overcommit_the_same_quota() {
            let pool = Arc::new(ReservationPool::default());
            let barrier = Arc::new(Barrier::new(3));
            let outcomes = std::thread::scope(|scope| {
                let handles = (0..2)
                    .map(|_| {
                        let pool = Arc::clone(&pool);
                        let barrier = Arc::clone(&barrier);
                        scope.spawn(move || {
                            barrier.wait();
                            let reservation = pool.reserve(60, 10, 100);
                            barrier.wait();
                            reservation.is_ok()
                        })
                    })
                    .collect::<Vec<_>>();
                barrier.wait();
                barrier.wait();
                handles
                    .into_iter()
                    .map(|handle| handle.join().expect("join reservation contender"))
                    .collect::<Vec<_>>()
            });

            assert_eq!(outcomes.iter().filter(|accepted| **accepted).count(), 1);
        }

        #[test]
        fn released_reservation_restores_capacity() {
            let pool = ReservationPool::default();
            let reservation = pool.reserve(60, 10, 100).expect("first reservation");
            assert!(pool.reserve(40, 10, 100).is_err());
            drop(reservation);
            assert!(pool.reserve(40, 10, 100).is_ok());
        }
    }
}

#[cfg(not(unix))]
mod platform {
    use std::{
        fs::File,
        path::{Path, PathBuf},
    };

    use uuid::Uuid;

    #[derive(Debug)]
    pub(crate) struct SnapshotPublicationRoot;

    #[derive(Debug)]
    pub(crate) struct PublishedSnapshotRoot;

    #[derive(Debug)]
    pub(crate) struct SnapshotByteReservation<'a> {
        _root: &'a SnapshotPublicationRoot,
    }

    impl SnapshotPublicationRoot {
        pub(crate) fn create(_path: &Path) -> Result<Self, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn open(_path: &Path) -> Result<Self, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn destination_path(&self, _snapshot_id: Uuid) -> PathBuf {
            PathBuf::new()
        }

        pub(crate) fn available_bytes(&self) -> Result<u64, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn reserve_bytes(
            &self,
            _required_bytes: u64,
            _headroom_bytes: u64,
        ) -> Result<SnapshotByteReservation<'_>, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }
    }

    impl PublishedSnapshotRoot {
        pub(crate) fn path(&self) -> &Path {
            Path::new("")
        }

        pub(crate) fn open_file(&self, _relative_path: &str) -> Result<File, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }
    }

    pub(crate) struct SnapshotStaging<'a> {
        _root: &'a SnapshotPublicationRoot,
    }

    impl<'a> SnapshotStaging<'a> {
        pub(crate) fn create(
            _root: &'a SnapshotPublicationRoot,
            _snapshot_id: Uuid,
        ) -> Result<Self, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn create_pack_file(&self, _name: &'static str) -> Result<File, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn create_manifest_file(&self) -> Result<File, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn sync_directories(&self) -> Result<(), String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn publish(self) -> Result<PublishedSnapshotRoot, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }
    }
}

pub(crate) use platform::{
    PublishedSnapshotRoot, SnapshotByteReservation, SnapshotPublicationRoot, SnapshotStaging,
};
