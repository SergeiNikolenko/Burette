use super::{run_conditional, Request, MAX_BYTES};
use serde::Deserialize;
use std::{
    collections::HashMap,
    fs::{self, Metadata},
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

#[derive(Clone)]
struct Entry {
    fingerprint: String,
    path: PathBuf,
    local: (u64, u64, i64, i64, i64, i64),
}
static ENTRIES: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
struct Header {
    fingerprint: String,
    unchanged: bool,
}

fn local_version(metadata: &Metadata) -> (u64, u64, i64, i64, i64, i64) {
    (
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    )
}
fn intact(entry: &Entry) -> bool {
    fs::symlink_metadata(&entry.path)
        .is_ok_and(|metadata| metadata.is_file() && local_version(&metadata) == entry.local)
}
fn decode(bytes: &[u8]) -> Result<(Header, &[u8]), String> {
    let end = bytes
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or("Invalid SSH preview header")?;
    if end > 1024 {
        return Err("Invalid SSH preview header".into());
    }
    let header: Header = serde_json::from_slice(&bytes[..end]).map_err(|e| e.to_string())?;
    let data = &bytes[end + 1..];
    if header.fingerprint.is_empty()
        || header.fingerprint.len() > 256
        || data.len() as u64 > MAX_BYTES
        || (header.unchanged && !data.is_empty())
    {
        return Err("Invalid SSH preview response".into());
    }
    Ok((header, data))
}

pub(super) fn preview(cache: &Path, request: &Request) -> Result<String, String> {
    let key = serde_json::json!([cache, request.host, request.root, request.path]).to_string();
    let prior = ENTRIES
        .lock()
        .map_err(|_| "SSH preview cache unavailable")?
        .get(&key)
        .filter(|entry| intact(entry))
        .cloned();
    let response = run_conditional(
        request,
        "preview",
        prior.as_ref().map(|entry| entry.fingerprint.as_str()),
    )?;
    let (header, data) = decode(&response)?;
    // Only admission and file writes are serialized. Up to three remote
    // downloads run in parallel, while the 256-file/512-MiB limit stays atomic.
    let mut entries = ENTRIES
        .lock()
        .map_err(|_| "SSH preview cache unavailable")?;
    if header.unchanged {
        return prior
            .filter(|entry| entry.fingerprint == header.fingerprint && intact(entry))
            .map(|entry| entry.path.to_string_lossy().into_owned())
            .ok_or_else(|| "Local preview cache changed. Open the file again.".into());
    }
    if let Some(entry) = entries
        .get(&key)
        .filter(|entry| entry.fingerprint == header.fingerprint && intact(entry))
    {
        return Ok(entry.path.to_string_lossy().into_owned());
    }
    let path = store(cache, &request.path, data)?;
    let local = local_version(&fs::metadata(&path).map_err(|e| e.to_string())?);
    // Old versions remain on disk because a viewer may still have them open.
    // The map never grows beyond the disk cache's maximum entry count.
    if entries.len() >= 256 {
        entries.retain(|_, entry| intact(entry));
    }
    entries.insert(
        key,
        Entry {
            fingerprint: header.fingerprint,
            path: path.clone(),
            local,
        },
    );
    Ok(path.to_string_lossy().into_owned())
}

fn store(cache: &Path, remote_path: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = Path::new(remote_path).file_name().ok_or("Choose a file")?;
    let mut count = 0;
    let mut total = 0_u64;
    if let Ok(directories) = fs::read_dir(cache) {
        for directory in directories.take(257).flatten() {
            count += 1;
            if let Ok(files) = fs::read_dir(directory.path()) {
                for file in files.take(2).flatten() {
                    total = total.saturating_add(
                        file.metadata().map(|metadata| metadata.len()).unwrap_or(0),
                    );
                }
            }
        }
    }
    if count >= 256 || total.saturating_add(bytes.len() as u64) > 512 * 1024 * 1024 {
        return Err(
            "SSH preview cache is full. Clear Preview cache in Settings → Maintenance.".into(),
        );
    }
    let directory = cache.join(uuid::Uuid::new_v4().to_string());
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&directory)
        .map_err(|e| e.to_string())?;
    let path = directory.join(name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conditional_response_preserves_binary_bytes_and_rejects_invalid_hits() {
        let (header, bytes) =
            decode(b"{\"fingerprint\":\"1:2:3:4:5\",\"unchanged\":false}\n\0\nstructure").unwrap();
        assert!(!header.unchanged);
        assert_eq!(bytes, b"\0\nstructure");
        assert!(decode(b"{\"fingerprint\":\"1\",\"unchanged\":true}\nextra").is_err());
        assert!(decode(b"{\"fingerprint\":\"\",\"unchanged\":true}\n").is_err());
    }
    #[test]
    fn stored_versions_remain_immutable_and_count_towards_capacity() {
        let cache =
            std::env::temp_dir().join(format!("burette-preview-test-{}", uuid::Uuid::new_v4()));
        let first = store(&cache, "nested/molecule.sdf", b"first").unwrap();
        let entry = Entry {
            fingerprint: "remote".into(),
            path: first.clone(),
            local: local_version(&fs::metadata(&first).unwrap()),
        };
        let second = store(&cache, "nested/molecule.sdf", b"new").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"first");
        assert!(intact(&entry));
        fs::write(&first, b"changed").unwrap();
        assert!(!intact(&entry));
        for _ in 2..256 {
            store(&cache, "file.pdb", b"").unwrap();
        }
        assert!(store(&cache, "file.pdb", b"").is_err());
        fs::remove_dir_all(&cache).unwrap();
        for _ in 0..8 {
            let path = store(&cache, "sparse.sdf", b"").unwrap();
            fs::OpenOptions::new()
                .write(true)
                .open(path)
                .unwrap()
                .set_len(MAX_BYTES)
                .unwrap();
        }
        assert!(store(&cache, "file.pdb", b"x").is_err());
        fs::remove_dir_all(cache).unwrap();
    }
}
