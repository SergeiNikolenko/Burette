#[cfg(unix)]
mod platform {
    use std::{
        fs::File,
        os::fd::OwnedFd,
        path::{Component, Path, PathBuf},
    };

    use burrete_compute_protocol::MOLECULAR_RECORDS_FILE_NAME;
    use rustix::{
        fs::{fstat, fsync, mkdirat, open, openat, statat, unlinkat, AtFlags, Mode, OFlags},
        io::Errno,
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
    }

    impl SnapshotPublicationRoot {
        pub(crate) fn open(path: &Path) -> Result<Self, String> {
            let directory = open_absolute_directory_nofollow(path)?;
            let identity = directory_identity(&directory)?;
            Ok(Self {
                path: path.to_path_buf(),
                directory,
                identity,
            })
        }

        pub(crate) fn destination_path(&self, snapshot_id: Uuid) -> PathBuf {
            self.path.join(publication_leaf(snapshot_id))
        }

        fn verify_path_identity(&self) -> Result<(), String> {
            let reopened = open_absolute_directory_nofollow(&self.path).map_err(|error| {
                format!("Snapshot publication root path is no longer trustworthy: {error}")
            })?;
            let reopened_identity = directory_identity(&reopened)?;
            if reopened_identity != self.identity {
                return Err(
                    "Snapshot publication root was replaced after capability creation".into(),
                );
            }
            Ok(())
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

        pub(crate) fn publish(mut self) -> Result<PathBuf, String> {
            self.root.verify_path_identity()?;
            rename_noreplace(&self.root.directory, &self.active_leaf, &self.final_leaf)?;
            self.active_leaf.clone_from(&self.final_leaf);

            fsync(&self.root.directory)
                .map_err(|error| format!("Cannot sync snapshot publication root: {error}"))?;
            self.root.verify_path_identity()?;

            self.armed = false;
            Ok(self.root.path.join(&self.final_leaf))
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

    fn directory_identity(directory: &OwnedFd) -> Result<DirectoryIdentity, String> {
        let metadata = fstat(directory)
            .map_err(|error| format!("Cannot inspect snapshot publication root: {error}"))?;
        Ok(DirectoryIdentity {
            device: metadata.st_dev as u64,
            inode: metadata.st_ino as u64,
        })
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

    impl SnapshotPublicationRoot {
        pub(crate) fn open(_path: &Path) -> Result<Self, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }

        pub(crate) fn destination_path(&self, _snapshot_id: Uuid) -> PathBuf {
            PathBuf::new()
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

        pub(crate) fn publish(self) -> Result<PathBuf, String> {
            Err("Snapshot publication requires Unix directory capabilities".into())
        }
    }
}

#[allow(
    unused_imports,
    reason = "the following commit connects these capabilities to Grid snapshot publication"
)]
pub(crate) use platform::{SnapshotPublicationRoot, SnapshotStaging};
