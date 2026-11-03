//! A deliberately small ZIP reader for Avogadro plugin source archives.
//!
//! Only what GitHub source archives contain is accepted: stored or deflated
//! regular files and directories below one top-level folder. Encryption, ZIP64,
//! symbolic links, absolute or parent paths, duplicates (case-insensitively) and
//! oversized expansion are refused before anything is written.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) const MAX_ENTRIES: usize = 4096;
pub(crate) const MAX_EXPANDED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_NAME_BYTES: usize = 512;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Entry {
    /// Path below the archive's top-level folder; empty for that folder itself.
    pub(crate) path: String,
    pub(crate) directory: bool,
    method: u16,
    crc32: u32,
    compressed: u64,
    expanded: u64,
    data_offset: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Summary {
    pub(crate) files: usize,
    pub(crate) expanded_bytes: u64,
}

fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}
fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

const INVALID: &str = "The plugin archive is not a supported source archive";

fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_NAME_BYTES
        && !path.contains('\\')
        && !path.contains(':')
        && !path.chars().any(char::is_control)
        && path.split('/').count() <= 32
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Reads and validates the central directory. Nothing is decompressed yet.
pub(crate) fn entries(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let search_from = bytes.len().saturating_sub(22 + 65_535);
    let eocd = (search_from..bytes.len().saturating_sub(21))
        .rev()
        .find(|&offset| u32_at(bytes, offset) == Some(0x0605_4b50))
        .ok_or(INVALID)?;
    let (disk, cd_disk) = (u16_at(bytes, eocd + 4), u16_at(bytes, eocd + 6));
    let (on_disk, total) = (u16_at(bytes, eocd + 8), u16_at(bytes, eocd + 10));
    let (cd_size, cd_offset) = (u32_at(bytes, eocd + 12), u32_at(bytes, eocd + 16));
    let (Some(0), Some(0), Some(on_disk), Some(total), Some(cd_size), Some(cd_offset)) =
        (disk, cd_disk, on_disk, total, cd_size, cd_offset)
    else {
        return Err(INVALID.into());
    };
    if on_disk != total || usize::from(total) > MAX_ENTRIES || cd_offset == u32::MAX {
        return Err(INVALID.into());
    }
    let cd_end = (cd_offset as usize)
        .checked_add(cd_size as usize)
        .filter(|&end| end <= eocd)
        .ok_or(INVALID)?;
    let mut cursor = cd_offset as usize;
    let mut prefix: Option<String> = None;
    let mut seen = HashSet::new();
    let mut expanded_total = 0_u64;
    let mut result = Vec::with_capacity(usize::from(total));
    for _ in 0..total {
        if u32_at(bytes, cursor) != Some(0x0201_4b50) {
            return Err(INVALID.into());
        }
        let made_by = u16_at(bytes, cursor + 4).ok_or(INVALID)?;
        let flags = u16_at(bytes, cursor + 8).ok_or(INVALID)?;
        let method = u16_at(bytes, cursor + 10).ok_or(INVALID)?;
        let crc32 = u32_at(bytes, cursor + 16).ok_or(INVALID)?;
        let compressed = u32_at(bytes, cursor + 20).ok_or(INVALID)?;
        let expanded = u32_at(bytes, cursor + 24).ok_or(INVALID)?;
        let name_len = usize::from(u16_at(bytes, cursor + 28).ok_or(INVALID)?);
        let extra_len = usize::from(u16_at(bytes, cursor + 30).ok_or(INVALID)?);
        let comment_len = usize::from(u16_at(bytes, cursor + 32).ok_or(INVALID)?);
        let external = u32_at(bytes, cursor + 38).ok_or(INVALID)?;
        let local = u32_at(bytes, cursor + 42).ok_or(INVALID)?;
        let name = bytes
            .get(cursor + 46..cursor + 46 + name_len)
            .and_then(|name| std::str::from_utf8(name).ok())
            .ok_or(INVALID)?;
        cursor += 46 + name_len + extra_len + comment_len;
        if cursor > cd_end
            || flags & 0x0001 != 0
            || !matches!(method, 0 | 8)
            || [compressed, expanded, local].contains(&u32::MAX)
            || u64::from(expanded) > MAX_ENTRY_BYTES
        {
            return Err(INVALID.into());
        }
        let unix_mode = if made_by >> 8 == 3 { external >> 16 } else { 0 };
        if unix_mode & 0o170_000 == 0o120_000 {
            return Err("The plugin archive contains a symbolic link".into());
        }
        let directory = name.ends_with('/');
        let trimmed = name.trim_end_matches('/');
        let (top, rest) = trimmed.split_once('/').unwrap_or((trimmed, ""));
        if !safe_relative(trimmed) || prefix.get_or_insert_with(|| top.to_string()) != top {
            return Err("The plugin archive has an unexpected layout".into());
        }
        if rest.is_empty() && !directory {
            return Err("The plugin archive has an unexpected layout".into());
        }
        if !seen.insert(rest.to_lowercase()) {
            return Err("The plugin archive contains duplicate paths".into());
        }
        expanded_total += u64::from(expanded);
        if expanded_total > MAX_EXPANDED_BYTES {
            return Err("The plugin archive expands beyond the accepted size".into());
        }
        let local = local as usize;
        if u32_at(bytes, local) != Some(0x0403_4b50) {
            return Err(INVALID.into());
        }
        let local_name = usize::from(u16_at(bytes, local + 26).ok_or(INVALID)?);
        let local_extra = usize::from(u16_at(bytes, local + 28).ok_or(INVALID)?);
        let data_offset = local + 30 + local_name + local_extra;
        if data_offset
            .checked_add(compressed as usize)
            .is_none_or(|end| end > cd_offset as usize)
        {
            return Err(INVALID.into());
        }
        result.push(Entry {
            path: rest.to_string(),
            directory,
            method,
            crc32,
            compressed: u64::from(compressed),
            expanded: u64::from(expanded),
            data_offset,
        });
    }
    Ok(result)
}

/// Writes every entry below `target`, which must be a fresh empty directory.
/// Files are private and never executable.
pub(crate) fn extract(bytes: &[u8], target: &Path, cancel: &AtomicBool) -> Result<Summary, String> {
    let entries = entries(bytes)?;
    let mut summary = Summary {
        files: 0,
        expanded_bytes: 0,
    };
    for entry in &entries {
        if cancel.load(Ordering::Relaxed) {
            return Err(super::CANCELLED.into());
        }
        if entry.path.is_empty() {
            continue;
        }
        let destination = target.join(&entry.path);
        if entry.directory {
            create_private_dir(&destination)?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            create_private_dir(parent)?;
        }
        let data = &bytes[entry.data_offset..entry.data_offset + entry.compressed as usize];
        let mut output = Vec::with_capacity(entry.expanded as usize);
        let read = if entry.method == 0 {
            output.extend_from_slice(data);
            Ok(data.len())
        } else {
            flate2::read::DeflateDecoder::new(data)
                .take(entry.expanded + 1)
                .read_to_end(&mut output)
        };
        let mut crc = flate2::Crc::new();
        crc.update(&output);
        if read.is_err() || output.len() as u64 != entry.expanded || crc.sum() != entry.crc32 {
            return Err("The plugin archive is damaged".into());
        }
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        options
            .open(&destination)
            .and_then(|mut file| file.write_all(&output))
            .map_err(|error| format!("The plugin could not be written: {error}"))?;
        summary.files += 1;
        summary.expanded_bytes += entry.expanded;
    }
    Ok(summary)
}

pub(crate) fn create_private_dir(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder
        .create(path)
        .map_err(|error| format!("The plugin folder could not be created: {error}"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Builds a stored-only archive; enough to exercise layout validation.
    pub(crate) fn zip(files: &[(&str, &[u8], u32)]) -> Vec<u8> {
        let (mut body, mut directory) = (Vec::new(), Vec::new());
        for (name, data, mode) in files {
            let mut crc = flate2::Crc::new();
            crc.update(data);
            let offset = body.len() as u32;
            body.extend_from_slice(&0x0403_4b50_u32.to_le_bytes());
            body.extend_from_slice(&[20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            body.extend_from_slice(&crc.sum().to_le_bytes());
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(&(name.len() as u16).to_le_bytes());
            body.extend_from_slice(&[0, 0]);
            body.extend_from_slice(name.as_bytes());
            body.extend_from_slice(data);
            directory.extend_from_slice(&0x0201_4b50_u32.to_le_bytes());
            directory.extend_from_slice(&[20, 3, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            directory.extend_from_slice(&crc.sum().to_le_bytes());
            directory.extend_from_slice(&(data.len() as u32).to_le_bytes());
            directory.extend_from_slice(&(data.len() as u32).to_le_bytes());
            directory.extend_from_slice(&(name.len() as u16).to_le_bytes());
            directory.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);
            directory.extend_from_slice(&(mode << 16).to_le_bytes());
            directory.extend_from_slice(&offset.to_le_bytes());
            directory.extend_from_slice(name.as_bytes());
        }
        let (cd_offset, cd_size, count) = (
            body.len() as u32,
            directory.len() as u32,
            files.len() as u16,
        );
        body.extend_from_slice(&directory);
        body.extend_from_slice(&0x0605_4b50_u32.to_le_bytes());
        body.extend_from_slice(&[0, 0, 0, 0]);
        body.extend_from_slice(&count.to_le_bytes());
        body.extend_from_slice(&count.to_le_bytes());
        body.extend_from_slice(&cd_size.to_le_bytes());
        body.extend_from_slice(&cd_offset.to_le_bytes());
        body.extend_from_slice(&[0, 0]);
        body
    }

    #[test]
    fn real_github_archive_lists_the_package_below_its_top_folder() {
        let bytes =
            include_bytes!("../../../../../../tests/fixtures/avogadro/avogadro-rdkit-82498e3a.zip");
        let entries = entries(bytes).unwrap();
        assert_eq!(entries.len(), 18);
        assert!(entries
            .iter()
            .any(|entry| entry.path == "pyproject.toml" && !entry.directory));
        assert!(entries
            .iter()
            .any(|entry| entry.path == "src/avogadro_rdkit/command.py"));
        let target = std::env::temp_dir().join(format!("burette-zip-{}", uuid::Uuid::new_v4()));
        create_private_dir(&target).unwrap();
        let summary = extract(bytes, &target, &AtomicBool::new(false)).unwrap();
        assert_eq!(
            summary,
            Summary {
                files: 14,
                expanded_bytes: 22_375
            }
        );
        assert!(fs::read_to_string(target.join("LICENSE"))
            .unwrap()
            .contains("BSD"));
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn unsafe_layouts_are_refused_before_writing() {
        let file = 0o100_644;
        for files in [
            vec![("pkg/../escape.py", b"x".as_slice(), file)],
            vec![("/abs/file.py", b"x".as_slice(), file)],
            vec![
                ("pkg/a.py", b"x".as_slice(), file),
                ("other/b.py", b"x".as_slice(), file),
            ],
            vec![
                ("pkg/A.py", b"x".as_slice(), file),
                ("pkg/a.py", b"y".as_slice(), file),
            ],
            vec![("pkg/link", b"/etc/passwd".as_slice(), 0o120_777)],
            vec![("pkg\\win.py", b"x".as_slice(), file)],
            vec![("loose.py", b"x".as_slice(), file)],
        ] {
            assert!(entries(&zip(&files)).is_err(), "{files:?}");
        }
        assert!(entries(b"not a zip").is_err());
        let ok = zip(&[("pkg/", b"", 0o40_755), ("pkg/a.py", b"x", file)]);
        assert_eq!(entries(&ok).unwrap().len(), 2);
        let mut damaged = ok.clone();
        let position = damaged
            .windows(1)
            .rposition(|window| window == b"x")
            .unwrap();
        damaged[position] = b'y';
        let target = std::env::temp_dir().join(format!("burette-zip-{}", uuid::Uuid::new_v4()));
        create_private_dir(&target).unwrap();
        assert_eq!(
            extract(&damaged, &target, &AtomicBool::new(false)).unwrap_err(),
            "The plugin archive is damaged"
        );
        fs::remove_dir_all(target).unwrap();
    }
}
