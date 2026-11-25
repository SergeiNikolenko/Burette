//! Directory-capability filesystem primitives for the private compute store.
//!
//! The compute store (compute root lease, frozen molecular snapshots, artifact
//! publication and reading) defends its own data directory against symlink and
//! rename races by holding directory capabilities, opening children relative
//! to them without following links, and re-checking filesystem identities.
//!
//! Unix capabilities are `O_DIRECTORY | O_NOFOLLOW` descriptors used with
//! `openat`, no-replace `renameat`, `fstat` identities and uid/mode checks.
//!
//! Win32 has no public handle-relative open, so a Windows capability is a
//! directory handle whose current path is re-derived from the handle
//! (`GetFinalPathNameByHandleW`) for every child operation. Every open passes
//! `FILE_FLAG_OPEN_REPARSE_POINT` and rejects reparse points (symlinks,
//! junctions, mount points) where Unix relies on `O_NOFOLLOW`. Identities are
//! the volume serial number plus the file index. Callers keep re-checking
//! identities, so a swap between path derivation and open still fails closed.
//! Ownership and mode checks are skipped on Windows: the store lives in the
//! per-user profile, whose inherited ACLs already restrict it to the user,
//! SYSTEM and administrators. Directories cannot be fsynced on Windows; renames
//! use `MOVEFILE_WRITE_THROUGH` instead and directory syncs are no-ops.

#[cfg(unix)]
mod imp {
    use std::{
        ffi::OsStr,
        fs::{DirBuilder, File, Metadata, OpenOptions},
        io,
        os::{
            fd::{AsFd, OwnedFd},
            unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        },
        path::Path,
    };

    use rustix::{
        fs::{
            fchmod, flock, fstat, fstatvfs, fsync, mkdirat, open, openat, statat, unlinkat,
            AtFlags, FileType, FlockOperation, Mode, OFlags, Stat,
        },
        io::fcntl_dupfd_cloexec,
        process::geteuid,
    };

    pub(crate) use rustix::io::Errno;

    /// An `O_DIRECTORY | O_NOFOLLOW` descriptor used as a directory capability.
    pub(crate) type DirectoryFd = OwnedFd;

    const PRIVATE_DIRECTORY_MODE: u32 = 0o700;
    const PRIVATE_FILE_MODE: u32 = 0o600;
    const DIRECTORY_MODE: Mode = Mode::from_bits_truncate(0o700);
    const FILE_MODE: Mode = Mode::from_bits_truncate(0o600);
    const DIRECTORY_FLAGS: OFlags = OFlags::RDONLY
        .union(OFlags::DIRECTORY)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const READ_FILE_FLAGS: OFlags = OFlags::RDONLY
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const CREATE_FILE_FLAGS: OFlags = OFlags::WRONLY
        .union(OFlags::CREATE)
        .union(OFlags::EXCL)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const CREATE_READ_WRITE_FILE_FLAGS: OFlags = OFlags::RDWR
        .union(OFlags::CREATE)
        .union(OFlags::EXCL)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);
    const OPEN_READ_WRITE_FILE_FLAGS: OFlags =
        OFlags::RDWR.union(OFlags::CLOEXEC).union(OFlags::NOFOLLOW);

    pub(crate) struct FileStat(Stat);

    #[allow(
        clippy::unnecessary_cast,
        reason = "stat field widths differ between macOS and Linux"
    )]
    impl FileStat {
        pub(crate) fn is_directory(&self) -> bool {
            FileType::from_raw_mode(self.0.st_mode) == FileType::Directory
        }

        pub(crate) fn is_regular_file(&self) -> bool {
            FileType::from_raw_mode(self.0.st_mode) == FileType::RegularFile
        }

        pub(crate) fn device(&self) -> u64 {
            self.0.st_dev as u64
        }

        pub(crate) fn inode(&self) -> u64 {
            self.0.st_ino as u64
        }

        pub(crate) fn link_count(&self) -> u64 {
            self.0.st_nlink as u64
        }

        pub(crate) fn byte_length(&self) -> Option<u64> {
            u64::try_from(self.0.st_size).ok()
        }

        pub(crate) fn owned_by_current_user(&self) -> bool {
            self.0.st_uid == geteuid().as_raw()
        }

        /// Compares the permission bits (`st_mode & 0o7777`).
        pub(crate) fn has_mode(&self, expected: u32) -> bool {
            self.raw_mode() & 0o7777 == expected
        }

        pub(crate) fn raw_mode(&self) -> u32 {
            self.0.st_mode as u32
        }

        pub(crate) fn owner(&self) -> u32 {
            self.0.st_uid as u32
        }
    }

    pub(crate) fn open_absolute_root(_path: &Path) -> Result<DirectoryFd, Errno> {
        open("/", DIRECTORY_FLAGS, Mode::empty())
    }

    pub(crate) fn open_directory_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<DirectoryFd, Errno> {
        openat(parent, name.as_ref(), DIRECTORY_FLAGS, Mode::empty())
    }

    pub(crate) fn open_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        openat(parent, name.as_ref(), READ_FILE_FLAGS, Mode::empty()).map(File::from)
    }

    pub(crate) fn create_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        openat(parent, name.as_ref(), CREATE_FILE_FLAGS, FILE_MODE).map(File::from)
    }

    pub(crate) fn create_read_write_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        openat(
            parent,
            name.as_ref(),
            CREATE_READ_WRITE_FILE_FLAGS,
            FILE_MODE,
        )
        .map(File::from)
    }

    pub(crate) fn open_read_write_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        openat(
            parent,
            name.as_ref(),
            OPEN_READ_WRITE_FILE_FLAGS,
            Mode::empty(),
        )
        .map(File::from)
    }

    pub(crate) fn create_directory_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        mkdirat(parent, name.as_ref(), DIRECTORY_MODE)
    }

    pub(crate) fn remove_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        unlinkat(parent, name.as_ref(), AtFlags::empty())
    }

    pub(crate) fn remove_directory_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        unlinkat(parent, name.as_ref(), AtFlags::REMOVEDIR)
    }

    pub(crate) fn stat(handle: impl AsFd) -> Result<FileStat, Errno> {
        fstat(handle).map(FileStat)
    }

    pub(crate) fn stat_at_nofollow(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<FileStat, Errno> {
        statat(parent, name.as_ref(), AtFlags::SYMLINK_NOFOLLOW).map(FileStat)
    }

    pub(crate) fn sync_directory(directory: &DirectoryFd) -> Result<(), Errno> {
        fsync(directory)
    }

    pub(crate) fn restrict_directory_permissions(directory: &DirectoryFd) -> Result<(), Errno> {
        fchmod(directory, DIRECTORY_MODE)
    }

    pub(crate) fn restrict_file_permissions(file: &File) -> Result<(), Errno> {
        fchmod(file, FILE_MODE)
    }

    pub(crate) fn duplicate_directory(directory: &DirectoryFd) -> Result<DirectoryFd, Errno> {
        fcntl_dupfd_cloexec(directory, 0)
    }

    /// Free bytes available to this process, or `None` when the count overflows.
    pub(crate) fn available_bytes(directory: &DirectoryFd) -> Result<Option<u64>, Errno> {
        let statistics = fstatvfs(directory)?;
        Ok(statistics.f_bavail.checked_mul(statistics.f_frsize))
    }

    /// Returns `Ok(false)` when another open file description holds the lock.
    pub(crate) fn try_lock_exclusive(file: &File) -> Result<bool, Errno> {
        match flock(file, FlockOperation::NonBlockingLockExclusive) {
            Ok(()) => Ok(true),
            Err(Errno::AGAIN) => Ok(false),
            Err(error) => Err(error),
        }
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
    pub(crate) fn rename_noreplace_at(
        directory: impl AsFd,
        from: impl AsRef<OsStr>,
        to: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        let directory = directory.as_fd();
        rustix::fs::renameat_with(
            directory,
            from.as_ref(),
            directory,
            to.as_ref(),
            rustix::fs::RenameFlags::NOREPLACE,
        )
    }

    /// Opens a directory by path for a later [`rename_noreplace_at`].
    pub(crate) fn open_directory_path(path: &Path) -> io::Result<File> {
        File::open(path)
    }

    pub(crate) fn sync_directory_handle(directory: &File) -> io::Result<()> {
        directory.sync_all()
    }

    pub(crate) fn sync_directory_path(path: &Path) -> io::Result<()> {
        File::open(path)?.sync_all()
    }

    pub(crate) fn create_private_directory_path(path: &Path) -> io::Result<()> {
        DirBuilder::new().mode(PRIVATE_DIRECTORY_MODE).create(path)
    }

    pub(crate) fn create_new_private_file_path(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(PRIVATE_FILE_MODE)
            .open(path)
    }

    pub(crate) fn metadata_owned_by_current_user(metadata: &Metadata) -> bool {
        metadata.uid() == geteuid().as_raw()
    }

    /// Compares `st_mode & mask` with `expected`.
    pub(crate) fn metadata_has_mode(metadata: &Metadata, mask: u32, expected: u32) -> bool {
        metadata.mode() & mask == expected
    }
}

#[cfg(windows)]
mod imp {
    use std::{
        ffi::{OsStr, OsString},
        fmt,
        fs::{self, File, Metadata, OpenOptions},
        io,
        os::windows::{
            ffi::{OsStrExt, OsStringExt},
            fs::OpenOptionsExt,
            io::{AsHandle, AsRawHandle},
        },
        path::{Path, PathBuf},
    };

    use windows_sys::Win32::{
        Foundation::{
            ERROR_ALREADY_EXISTS, ERROR_DIRECTORY, ERROR_FILE_EXISTS, ERROR_FILE_NOT_FOUND,
            ERROR_INVALID_FUNCTION, ERROR_INVALID_NAME, ERROR_INVALID_PARAMETER,
            ERROR_LOCK_VIOLATION, ERROR_NOT_SUPPORTED, ERROR_PATH_NOT_FOUND,
            ERROR_STOPPED_ON_SYMLINK, HANDLE,
        },
        Storage::FileSystem::{
            FileDispositionInfo, FileDispositionInfoEx, GetDiskFreeSpaceExW,
            GetFileInformationByHandle, GetFinalPathNameByHandleW, LockFileEx, MoveFileExW,
            SetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, DELETE,
            FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_DISPOSITION_FLAG_DELETE,
            FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO, FILE_DISPOSITION_INFO_EX,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_NAME_NORMALIZED,
            FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, MOVEFILE_WRITE_THROUGH,
            VOLUME_NAME_DOS,
        },
        System::IO::OVERLAPPED,
    };

    /// A Win32 error code. Missing-path and already-exists codes are folded
    /// into `NOENT` and `EXIST` so call sites can match them like Unix errnos.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) struct Errno(u32);

    impl Errno {
        pub(crate) const NOENT: Self = Self(ERROR_FILE_NOT_FOUND);
        pub(crate) const EXIST: Self = Self(ERROR_ALREADY_EXISTS);
        const INVALID_NAME: Self = Self(ERROR_INVALID_NAME);
        const NOT_DIRECTORY: Self = Self(ERROR_DIRECTORY);
        const REPARSE_POINT: Self = Self(ERROR_STOPPED_ON_SYMLINK);

        fn from_code(code: u32) -> Self {
            match code {
                ERROR_PATH_NOT_FOUND => Self::NOENT,
                ERROR_FILE_EXISTS => Self::EXIST,
                code => Self(code),
            }
        }

        fn from_io(error: io::Error) -> Self {
            // Errors without an OS code only come from std path conversion.
            error
                .raw_os_error()
                .map_or(Self::INVALID_NAME, |code| Self::from_code(code as u32))
        }

        fn last() -> Self {
            Self::from_io(io::Error::last_os_error())
        }
    }

    impl fmt::Display for Errno {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            fmt::Display::fmt(&io::Error::from_raw_os_error(self.0 as i32), formatter)
        }
    }

    /// A directory handle opened with `FILE_FLAG_BACKUP_SEMANTICS` and
    /// `FILE_FLAG_OPEN_REPARSE_POINT` that is verified not to be a reparse point.
    pub(crate) type DirectoryFd = File;

    pub(crate) struct FileStat {
        attributes: u32,
        volume_serial: u32,
        file_index: u64,
        link_count: u32,
        byte_length: u64,
    }

    impl FileStat {
        fn is_reparse_point(&self) -> bool {
            self.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        }

        pub(crate) fn is_directory(&self) -> bool {
            !self.is_reparse_point() && self.attributes & FILE_ATTRIBUTE_DIRECTORY != 0
        }

        pub(crate) fn is_regular_file(&self) -> bool {
            !self.is_reparse_point() && self.attributes & FILE_ATTRIBUTE_DIRECTORY == 0
        }

        pub(crate) fn device(&self) -> u64 {
            u64::from(self.volume_serial)
        }

        pub(crate) fn inode(&self) -> u64 {
            self.file_index
        }

        /// NTFS directories always report one link, so directory link counts
        /// carry no entry information on Windows.
        pub(crate) fn link_count(&self) -> u64 {
            u64::from(self.link_count)
        }

        pub(crate) fn byte_length(&self) -> Option<u64> {
            Some(self.byte_length)
        }

        /// Not checked on Windows; see the module documentation.
        pub(crate) fn owned_by_current_user(&self) -> bool {
            true
        }

        /// Windows has no POSIX permission bits; see the module documentation.
        pub(crate) fn has_mode(&self, _expected: u32) -> bool {
            true
        }
    }

    const SHARE_ALL: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    /// The owner lock covers one byte far past the diagnostic so other
    /// processes can still read which process owns the compute root.
    const OWNER_LOCK_OFFSET_HIGH: u32 = 0x4000_0000;

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain([0]).collect()
    }

    /// Accepts one plain path component: no separators, drive or stream
    /// colons, NULs, or dot entries.
    fn require_leaf(name: &OsStr) -> Result<(), Errno> {
        let separator = name
            .encode_wide()
            .any(|unit| matches!(unit, 0 | 0x2f | 0x3a | 0x5c));
        if name.is_empty() || name == "." || name == ".." || separator {
            return Err(Errno::INVALID_NAME);
        }
        Ok(())
    }

    /// The directory's current path, re-derived from the handle so children
    /// resolve inside the held directory even after it was renamed.
    fn current_path(directory: &DirectoryFd) -> Result<PathBuf, Errno> {
        let mut buffer = vec![0_u16; 512];
        loop {
            // SAFETY: the handle is open and `buffer` holds `buffer.len()` units.
            let length = unsafe {
                GetFinalPathNameByHandleW(
                    directory.as_raw_handle() as HANDLE,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
                )
            } as usize;
            if length == 0 {
                return Err(Errno::last());
            }
            if length < buffer.len() {
                buffer.truncate(length);
                return Ok(PathBuf::from(OsString::from_wide(&buffer)));
            }
            buffer.resize(length, 0);
        }
    }

    fn child_path(parent: &DirectoryFd, name: &OsStr) -> Result<PathBuf, Errno> {
        require_leaf(name)?;
        Ok(current_path(parent)?.join(name))
    }

    fn open_nofollow(
        path: &Path,
        options: &mut OpenOptions,
        directory: bool,
    ) -> Result<(File, FileStat), Errno> {
        let backup_semantics = if directory {
            FILE_FLAG_BACKUP_SEMANTICS
        } else {
            0
        };
        let file = options
            .share_mode(SHARE_ALL)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | backup_semantics)
            .open(path)
            .map_err(Errno::from_io)?;
        let metadata = stat(&file)?;
        Ok((file, metadata))
    }

    fn open_directory_nofollow(path: &Path) -> Result<DirectoryFd, Errno> {
        let (directory, metadata) = open_nofollow(path, OpenOptions::new().read(true), true)?;
        if metadata.is_reparse_point() {
            return Err(Errno::REPARSE_POINT);
        }
        if !metadata.is_directory() {
            return Err(Errno::NOT_DIRECTORY);
        }
        Ok(directory)
    }

    fn open_existing_file_nofollow(path: &Path, options: &mut OpenOptions) -> Result<File, Errno> {
        let (file, metadata) = open_nofollow(path, options, false)?;
        if metadata.is_reparse_point() {
            return Err(Errno::REPARSE_POINT);
        }
        Ok(file)
    }

    pub(crate) fn stat(handle: impl AsHandle) -> Result<FileStat, Errno> {
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: the handle is open and `information` is a valid out-pointer.
        let succeeded = unsafe {
            GetFileInformationByHandle(
                handle.as_handle().as_raw_handle() as HANDLE,
                &mut information,
            )
        };
        if succeeded == 0 {
            return Err(Errno::last());
        }
        Ok(FileStat {
            attributes: information.dwFileAttributes,
            volume_serial: information.dwVolumeSerialNumber,
            file_index: (u64::from(information.nFileIndexHigh) << 32)
                | u64::from(information.nFileIndexLow),
            link_count: information.nNumberOfLinks,
            byte_length: (u64::from(information.nFileSizeHigh) << 32)
                | u64::from(information.nFileSizeLow),
        })
    }

    /// Opens the root directory (`C:\`, `\\server\share\`, ...) of an absolute path.
    pub(crate) fn open_absolute_root(path: &Path) -> Result<DirectoryFd, Errno> {
        let root = path.ancestors().last().ok_or(Errno::INVALID_NAME)?;
        open_directory_nofollow(root)
    }

    pub(crate) fn open_directory_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<DirectoryFd, Errno> {
        open_directory_nofollow(&child_path(parent, name.as_ref())?)
    }

    pub(crate) fn open_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        open_existing_file_nofollow(
            &child_path(parent, name.as_ref())?,
            OpenOptions::new().read(true),
        )
    }

    pub(crate) fn create_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        let path = child_path(parent, name.as_ref())?;
        open_nofollow(
            &path,
            OpenOptions::new().write(true).create_new(true),
            false,
        )
        .map(|(file, _)| file)
    }

    pub(crate) fn create_read_write_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        let path = child_path(parent, name.as_ref())?;
        open_nofollow(
            &path,
            OpenOptions::new().read(true).write(true).create_new(true),
            false,
        )
        .map(|(file, _)| file)
    }

    pub(crate) fn open_read_write_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<File, Errno> {
        open_existing_file_nofollow(
            &child_path(parent, name.as_ref())?,
            OpenOptions::new().read(true).write(true),
        )
    }

    pub(crate) fn create_directory_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        fs::create_dir(child_path(parent, name.as_ref())?).map_err(Errno::from_io)
    }

    pub(crate) fn remove_file_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        // Like `unlink`, a file symlink is removed itself rather than followed.
        let path = child_path(parent, name.as_ref())?;
        let (file, _) = open_nofollow(
            &path,
            OpenOptions::new().access_mode(DELETE | FILE_READ_ATTRIBUTES),
            false,
        )?;
        delete_by_handle(&file)
    }

    pub(crate) fn remove_directory_at(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        let path = child_path(parent, name.as_ref())?;
        let (directory, metadata) = open_nofollow(
            &path,
            OpenOptions::new().access_mode(DELETE | FILE_READ_ATTRIBUTES),
            true,
        )?;
        if metadata.is_reparse_point() {
            return Err(Errno::REPARSE_POINT);
        }
        if !metadata.is_directory() {
            return Err(Errno::NOT_DIRECTORY);
        }
        delete_by_handle(&directory)
    }

    /// Deletes the opened object. POSIX semantics unlink the name at once even
    /// while other handles (opened with `FILE_SHARE_DELETE`) remain open, which
    /// matches `unlinkat`; filesystems without them (FAT) fall back to
    /// delete-on-close, where the name disappears with the last handle.
    fn delete_by_handle(file: &File) -> Result<(), Errno> {
        let handle = file.as_raw_handle() as HANDLE;
        let posix = FILE_DISPOSITION_INFO_EX {
            Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
        };
        // SAFETY: the handle is open with DELETE access; the buffer and size match.
        let succeeded = unsafe {
            SetFileInformationByHandle(
                handle,
                FileDispositionInfoEx,
                (&raw const posix).cast(),
                size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
            )
        };
        if succeeded != 0 {
            return Ok(());
        }
        let error = Errno::last();
        if !matches!(
            error.0,
            ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED | ERROR_INVALID_FUNCTION
        ) {
            return Err(error);
        }
        let legacy = FILE_DISPOSITION_INFO { DeleteFile: true };
        // SAFETY: as above.
        let succeeded = unsafe {
            SetFileInformationByHandle(
                handle,
                FileDispositionInfo,
                (&raw const legacy).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        };
        if succeeded == 0 {
            return Err(Errno::last());
        }
        Ok(())
    }

    /// Like `lstat`: a reparse point is reported as neither file nor directory.
    pub(crate) fn stat_at_nofollow(
        parent: &DirectoryFd,
        name: impl AsRef<OsStr>,
    ) -> Result<FileStat, Errno> {
        let path = child_path(parent, name.as_ref())?;
        open_nofollow(
            &path,
            OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES),
            true,
        )
        .map(|(_, metadata)| metadata)
    }

    /// Windows cannot flush directory metadata through a directory handle.
    pub(crate) fn sync_directory(_directory: &DirectoryFd) -> Result<(), Errno> {
        Ok(())
    }

    /// Permissions are inherited from the per-user profile ACLs.
    pub(crate) fn restrict_directory_permissions(_directory: &DirectoryFd) -> Result<(), Errno> {
        Ok(())
    }

    /// Permissions are inherited from the per-user profile ACLs.
    pub(crate) fn restrict_file_permissions(_file: &File) -> Result<(), Errno> {
        Ok(())
    }

    pub(crate) fn duplicate_directory(directory: &DirectoryFd) -> Result<DirectoryFd, Errno> {
        directory.try_clone().map_err(Errno::from_io)
    }

    /// Free bytes available to this user (quota-aware).
    pub(crate) fn available_bytes(directory: &DirectoryFd) -> Result<Option<u64>, Errno> {
        let mut path = current_path(directory)?.into_os_string();
        path.push("\\");
        let path = wide(Path::new(&path));
        let mut available = 0_u64;
        // SAFETY: `path` is NUL-terminated and the out-pointer is valid.
        let succeeded = unsafe {
            GetDiskFreeSpaceExW(
                path.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if succeeded == 0 {
            return Err(Errno::last());
        }
        Ok(Some(available))
    }

    /// Returns `Ok(false)` when another handle holds the lock. The kernel
    /// releases it when the handle closes or the process dies.
    pub(crate) fn try_lock_exclusive(file: &File) -> Result<bool, Errno> {
        let mut overlapped = OVERLAPPED::default();
        overlapped.Anonymous.Anonymous.OffsetHigh = OWNER_LOCK_OFFSET_HIGH;
        // SAFETY: the handle is open and `overlapped` outlives the synchronous call.
        let succeeded = unsafe {
            LockFileEx(
                file.as_raw_handle() as HANDLE,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped,
            )
        };
        if succeeded != 0 {
            return Ok(true);
        }
        match Errno::last() {
            Errno(ERROR_LOCK_VIOLATION) => Ok(false),
            error => Err(error),
        }
    }

    /// Renames without replacement: `MoveFileExW` without
    /// `MOVEFILE_REPLACE_EXISTING` fails when `to` exists, and
    /// `MOVEFILE_WRITE_THROUGH` stands in for the parent fsync on Unix.
    pub(crate) fn rename_noreplace_at(
        directory: &DirectoryFd,
        from: impl AsRef<OsStr>,
        to: impl AsRef<OsStr>,
    ) -> Result<(), Errno> {
        require_leaf(from.as_ref())?;
        require_leaf(to.as_ref())?;
        let parent = current_path(directory)?;
        let source = wide(&parent.join(from.as_ref()));
        let destination = wide(&parent.join(to.as_ref()));
        // SAFETY: both paths are NUL-terminated.
        let succeeded = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        };
        if succeeded == 0 {
            return Err(Errno::last());
        }
        Ok(())
    }

    /// Names of the held directory's entries, excluding `.` and `..`.
    pub(crate) fn read_entry_names(
        directory: &DirectoryFd,
    ) -> Result<impl Iterator<Item = Result<OsString, Errno>>, Errno> {
        let entries = fs::read_dir(current_path(directory)?).map_err(Errno::from_io)?;
        Ok(entries.map(|entry| entry.map(|entry| entry.file_name()).map_err(Errno::from_io)))
    }

    /// Opens a directory by path for a later [`rename_noreplace_at`].
    pub(crate) fn open_directory_path(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .share_mode(SHARE_ALL)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
    }

    /// Windows cannot flush directory metadata through a directory handle.
    pub(crate) fn sync_directory_handle(_directory: &File) -> io::Result<()> {
        Ok(())
    }

    /// Windows cannot flush directory metadata through a directory handle.
    pub(crate) fn sync_directory_path(_path: &Path) -> io::Result<()> {
        Ok(())
    }

    pub(crate) fn create_private_directory_path(path: &Path) -> io::Result<()> {
        fs::create_dir(path)
    }

    pub(crate) fn create_new_private_file_path(path: &Path) -> io::Result<File> {
        OpenOptions::new().write(true).create_new(true).open(path)
    }

    /// Not checked on Windows; see the module documentation.
    pub(crate) fn metadata_owned_by_current_user(_metadata: &Metadata) -> bool {
        true
    }

    /// Windows has no POSIX permission bits; see the module documentation.
    pub(crate) fn metadata_has_mode(_metadata: &Metadata, _mask: u32, _expected: u32) -> bool {
        true
    }
}

pub(crate) use imp::*;

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use uuid::Uuid;

    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("burette-platform-fs-{}", Uuid::new_v4()));
            fs::create_dir(&path).expect("create test directory");
            Self(path)
        }

        fn open(&self) -> DirectoryFd {
            open_test_directory(&self.0)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    fn open_test_directory(path: &Path) -> DirectoryFd {
        fs::File::open(path).expect("open test directory").into()
    }

    #[cfg(windows)]
    fn open_test_directory(path: &Path) -> DirectoryFd {
        open_directory_path(path).expect("open test directory")
    }

    fn entry_names(path: &Path) -> Vec<String> {
        let mut names = fs::read_dir(path)
            .expect("read test directory")
            .map(|entry| {
                entry
                    .expect("test entry")
                    .file_name()
                    .into_string()
                    .unwrap()
            })
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[test]
    fn rename_noreplace_refuses_an_existing_destination() {
        let test = TestDirectory::new();
        let directory = test.open();
        create_directory_at(&directory, "source").expect("create source");
        create_directory_at(&directory, "destination").expect("create destination");

        assert_eq!(
            rename_noreplace_at(&directory, "source", "destination"),
            Err(Errno::EXIST)
        );
        rename_noreplace_at(&directory, "source", "renamed").expect("rename to a free name");
        assert_eq!(entry_names(&test.0), ["destination", "renamed"]);
    }

    #[test]
    fn exclusive_lock_reports_contention_until_the_holder_closes() {
        let test = TestDirectory::new();
        let directory = test.open();
        let holder = create_read_write_file_at(&directory, "owner.lock").expect("create lock");
        let contender = open_read_write_file_at(&directory, "owner.lock").expect("reopen lock");

        assert_eq!(try_lock_exclusive(&holder), Ok(true));
        assert_eq!(try_lock_exclusive(&contender), Ok(false));
        drop(holder);
        assert_eq!(try_lock_exclusive(&contender), Ok(true));
    }

    #[test]
    fn removal_unlinks_names_while_handles_remain_open() {
        let test = TestDirectory::new();
        let directory = test.open();
        create_directory_at(&directory, "staging").expect("create staging");
        let staging = open_directory_at(&directory, "staging").expect("open staging");
        let file = create_file_at(&staging, "pack.bin").expect("create pack file");
        let reader = open_file_at(&staging, "pack.bin").expect("open pack file");
        let identity = stat(&reader).expect("inspect pack file");
        assert!(identity.is_regular_file());
        assert_eq!(identity.link_count(), 1);

        remove_file_at(&staging, "pack.bin").expect("remove open pack file");
        assert!(entry_names(&test.0.join("staging")).is_empty());
        remove_directory_at(&directory, "staging").expect("remove open staging directory");
        assert!(entry_names(&test.0).is_empty());
        assert_eq!(
            stat_at_nofollow(&directory, "staging").err(),
            Some(Errno::NOENT)
        );
        drop((file, reader, staging));
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_rejected_and_reported_as_neither_file_nor_directory() {
        let test = TestDirectory::new();
        let target = test.0.join("target");
        fs::create_dir(&target).expect("create junction target");
        // Junctions need no symlink privilege, unlike `symlink_dir`.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(test.0.join("junction"))
            .arg(&target)
            .status()
            .expect("run mklink");
        assert!(status.success(), "mklink /J failed: {status}");

        let directory = test.open();
        let entry = stat_at_nofollow(&directory, "junction").expect("inspect junction");
        assert!(!entry.is_directory() && !entry.is_regular_file());
        assert!(open_directory_at(&directory, "junction").is_err());
        assert!(open_file_at(&directory, "junction").is_err());
        assert!(open_directory_at(&directory, "target").is_ok());
        assert!(open_directory_at(&directory, "target\\..\\junction").is_err());
    }
}
