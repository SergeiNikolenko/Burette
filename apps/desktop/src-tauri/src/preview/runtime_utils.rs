use std::collections::{hash_map::DefaultHasher, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

const MAX_STALE_RUNTIME_DIRS: usize = 24;
const RUNTIME_PRUNE_MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const RUNTIME_PRUNE_INTERVAL: Duration = Duration::from_secs(5 * 60);
const RUNTIME_LEASE: &str = ".runtime-owner";

struct RuntimeOwner {
    name: String,
    // An OS lock survives a long-lived cold tab and is released on process exit,
    // including a crash. A PID alone would protect stale data after PID reuse.
    _lock: fs::File,
}

/// Retain runtime files for the process lifetime, including cold tabs and view
/// history. Closing a grid may still explicitly delete its own runtime. Age or
/// size-based maintenance must never evict files the current process can reload.
pub(crate) fn create_runtime_dir(base: &Path, runtime: &Path) -> Result<(), String> {
    static OWNERS: OnceLock<Mutex<HashMap<PathBuf, RuntimeOwner>>> = OnceLock::new();
    let mut owners = OWNERS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|error| error.to_string())?;
    if owners
        .get(base)
        .is_none_or(|owner| !base.join(".leases").join(&owner.name).is_file())
    {
        let lease_dir = base.join(".leases");
        fs::create_dir_all(&lease_dir).map_err(|error| error.to_string())?;
        let name = uuid::Uuid::new_v4().to_string();
        let pending = lease_dir.join(format!(".{name}"));
        let lock = fs::File::create_new(&pending).map_err(|error| error.to_string())?;
        lock.lock().map_err(|error| error.to_string())?;
        // Publish only after locking: a concurrent maintenance process must not
        // unlink a newly-created, not-yet-locked owner file.
        fs::rename(pending, lease_dir.join(&name)).map_err(|error| error.to_string())?;
        owners.insert(base.to_path_buf(), RuntimeOwner { name, _lock: lock });
    }
    fs::create_dir_all(runtime).map_err(|error| error.to_string())?;
    fs::write(runtime.join(RUNTIME_LEASE), &owners[base].name).map_err(|error| error.to_string())
}

#[derive(Default)]
struct RuntimeMaintenance {
    running: bool,
    finished: Option<Instant>,
}

impl RuntimeMaintenance {
    fn begin(&mut self, now: Instant) -> bool {
        if self.running
            || self.finished.is_some_and(|finished| {
                now.saturating_duration_since(finished) < RUNTIME_PRUNE_INTERVAL
            })
        {
            return false;
        }
        self.running = true;
        true
    }
}

pub(crate) fn asset_url(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("http://asset.localhost/{}", percent_encode_path(path))
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("asset://localhost/{}", percent_encode_path(path))
    }
}

fn percent_encode_path(path: &Path) -> String {
    path.to_string_lossy()
        .as_bytes()
        .iter()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

// Test-only since the grid parsers went single-pass: splitting a whole source into
// an owned Vec<String> is exactly the shape that made ingest quadratic, so no
// production path should reach for it again.
#[cfg(test)]
pub(crate) fn normalized_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_string)
        .collect()
}

pub(crate) fn decode_text(data: &[u8]) -> String {
    String::from_utf8_lossy(data).into_owned()
}

pub(crate) fn clipped(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let keep = limit.saturating_sub(3);
    value.chars().take(keep).collect::<String>() + "..."
}

pub(crate) fn file_title(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("structure")
        .to_string()
}

pub(crate) fn stable_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

pub(crate) fn prune_runtime_dirs(base: &Path) {
    static MAINTENANCE: OnceLock<Mutex<HashMap<PathBuf, RuntimeMaintenance>>> = OnceLock::new();
    let maintenance = MAINTENANCE.get_or_init(Mutex::default);
    let Ok(mut states) = maintenance.lock() else {
        return;
    };
    if !states
        .entry(base.to_path_buf())
        .or_default()
        .begin(Instant::now())
    {
        return;
    }
    drop(states);
    let base = base.to_path_buf();
    let worker_base = base.clone();
    let spawned = std::thread::Builder::new()
        .name("preview-cache-maintenance".into())
        .spawn(move || {
            prune_runtime_dirs_at(&worker_base, SystemTime::now());
            if let Ok(mut states) = maintenance.lock() {
                let state = states.entry(worker_base).or_default();
                state.running = false;
                state.finished = Some(Instant::now());
            }
        });
    if spawned.is_err() {
        if let Ok(mut states) = maintenance.lock() {
            states.entry(base).or_default().running = false;
        }
    }
}

fn runtime_has_live_owner(base: &Path, runtime: &Path) -> bool {
    let owner = match fs::File::open(runtime.join(RUNTIME_LEASE)).and_then(|file| {
        let mut owner = String::new();
        file.take(64).read_to_string(&mut owner)?;
        Ok(owner)
    }) {
        Ok(owner) => owner,
        Err(error) => return error.kind() != std::io::ErrorKind::NotFound,
    };
    // Never treat an arbitrary relative/absolute path as a lease capability.
    if uuid::Uuid::parse_str(&owner).is_err() {
        return true;
    }
    let lease = match fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(base.join(".leases").join(owner))
    {
        Ok(lease) => lease,
        Err(error) => return error.kind() != std::io::ErrorKind::NotFound,
    };
    // An inaccessible lock is conservatively live. The temporary acquired lock
    // is released with this handle if the owning process has already exited.
    lease.try_lock().is_err()
}

fn prune_runtime_dirs_at(base: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    let mut runtimes: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| uuid::Uuid::parse_str(name).is_ok())
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            if now.duration_since(modified).ok()? < RUNTIME_PRUNE_MIN_AGE
                || runtime_has_live_owner(base, &entry.path())
            {
                return None;
            }
            Some((entry.path(), modified))
        })
        .collect();
    runtimes.sort_by_key(|(_, modified)| *modified);
    let overflow = runtimes.len().saturating_sub(MAX_STALE_RUNTIME_DIRS);
    for (path, _) in runtimes.into_iter().take(overflow) {
        let _ = fs::remove_dir_all(path);
    }
    // Owner files are tiny but should not accumulate across app launches.
    if let Ok(leases) = fs::read_dir(base.join(".leases")) {
        for entry in leases.filter_map(Result::ok) {
            if entry
                .file_name()
                .to_str()
                .is_none_or(|name| uuid::Uuid::parse_str(name).is_err())
            {
                continue;
            }
            if let Ok(lease) = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(entry.path())
            {
                if lease.try_lock().is_ok() {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
}

pub(crate) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::{
        asset_url, clipped, create_runtime_dir, escape_html, normalized_lines,
        prune_runtime_dirs_at, runtime_has_live_owner, stable_id, RuntimeMaintenance,
        MAX_STALE_RUNTIME_DIRS, RUNTIME_LEASE, RUNTIME_PRUNE_INTERVAL,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant, SystemTime};

    #[test]
    fn maintenance_is_coalesced_across_a_thousand_opens_and_slow_workers() {
        let now = Instant::now();
        let mut state = RuntimeMaintenance::default();
        assert!(state.begin(now));
        for _ in 0..1000 {
            assert!(!state.begin(now));
        }
        assert!(!state.begin(now + RUNTIME_PRUNE_INTERVAL * 2));
        state.running = false;
        state.finished = Some(now);
        assert!(!state.begin(now + RUNTIME_PRUNE_INTERVAL - Duration::from_millis(1)));
        assert!(state.begin(now + RUNTIME_PRUNE_INTERVAL));
    }

    #[test]
    fn old_live_runtime_and_shared_caches_survive_maintenance() {
        let base =
            std::env::temp_dir().join(format!("burette-runtime-lease-{}", uuid::Uuid::new_v4()));
        let live = base.join(uuid::Uuid::new_v4().to_string());
        create_runtime_dir(&base, &live).unwrap();
        fs::write(live.join("index.html"), "reloadable cold tab").unwrap();
        fs::create_dir(base.join("assets")).unwrap();
        fs::create_dir(base.join("xyzrender-cache")).unwrap();
        let stale: Vec<_> = (0..32)
            .map(|_| {
                let path = base.join(uuid::Uuid::new_v4().to_string());
                fs::create_dir(&path).unwrap();
                path
            })
            .collect();

        assert!(runtime_has_live_owner(&base, &live));
        prune_runtime_dirs_at(&base, SystemTime::now() + Duration::from_secs(48 * 60 * 60));
        assert_eq!(
            stale.iter().filter(|path| path.is_dir()).count(),
            MAX_STALE_RUNTIME_DIRS
        );
        assert_eq!(
            fs::read_to_string(live.join("index.html")).unwrap(),
            "reloadable cold tab"
        );
        assert!(base.join("assets").is_dir());
        assert!(base.join("xyzrender-cache").is_dir());
        assert!(runtime_has_live_owner(&base, &live));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn recreates_owner_after_explicit_cache_clear() {
        let base =
            std::env::temp_dir().join(format!("burette-runtime-reset-{}", uuid::Uuid::new_v4()));
        let first = base.join(uuid::Uuid::new_v4().to_string());
        create_runtime_dir(&base, &first).unwrap();
        let original = fs::read_to_string(first.join(RUNTIME_LEASE)).unwrap();
        fs::remove_dir_all(&base).unwrap();
        let next = base.join(uuid::Uuid::new_v4().to_string());
        create_runtime_dir(&base, &next).unwrap();
        assert_ne!(
            fs::read_to_string(next.join(RUNTIME_LEASE)).unwrap(),
            original
        );
        assert!(runtime_has_live_owner(&base, &next));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn released_owner_lock_no_longer_protects_runtime() {
        let base =
            std::env::temp_dir().join(format!("burette-runtime-released-{}", uuid::Uuid::new_v4()));
        let runtime = base.join(uuid::Uuid::new_v4().to_string());
        let name = uuid::Uuid::new_v4().to_string();
        fs::create_dir_all(base.join(".leases")).unwrap();
        fs::create_dir(&runtime).unwrap();
        fs::write(runtime.join(RUNTIME_LEASE), &name).unwrap();
        let owner = fs::File::create_new(base.join(".leases").join(&name)).unwrap();
        owner.lock().unwrap();
        assert!(runtime_has_live_owner(&base, &runtime));
        drop(owner);
        assert!(!runtime_has_live_owner(&base, &runtime));
        prune_runtime_dirs_at(&base, SystemTime::now());
        assert!(!base.join(".leases").join(name).exists());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn asset_url_percent_encodes_unsafe_path_bytes() {
        let url = asset_url(Path::new("/tmp/Burette Preview/a+b #1.pdb"));

        #[cfg(target_os = "windows")]
        assert!(url.starts_with("http://asset.localhost/"));
        #[cfg(not(target_os = "windows"))]
        assert!(url.starts_with("asset://localhost/"));

        assert!(url.contains("%2Ftmp%2FBurette%20Preview%2Fa%2Bb%20%231.pdb"));
    }

    #[test]
    fn text_helpers_normalize_clip_escape_and_stabilize_ids() {
        assert_eq!(normalized_lines("a\r\nb\rc\n"), ["a", "b", "c", ""]);
        assert_eq!(clipped("abcdef", 6), "abcdef");
        assert_eq!(clipped("abcdef", 5), "ab...");
        assert_eq!(
            escape_html(r#"<tag name="a&b">"#),
            "&lt;tag name=&quot;a&amp;b&quot;&gt;"
        );

        let left = stable_id(Path::new("/tmp/mini.pdb"));
        let right = stable_id(Path::new("/tmp/mini.pdb"));
        let other = stable_id(Path::new("/tmp/other.pdb"));
        assert_eq!(left, right);
        assert_ne!(left, other);
    }

    #[test]
    fn keeps_fresh_runtime_dirs_during_large_batches() {
        let base =
            std::env::temp_dir().join(format!("burette-runtime-prune-{}", uuid::Uuid::new_v4()));
        let assets = base.join("assets");
        fs::create_dir_all(&assets).expect("assets dir should be created");

        let mut created = Vec::new();
        for _ in 0..52 {
            let runtime = base.join(uuid::Uuid::new_v4().to_string());
            fs::create_dir_all(&runtime).expect("runtime dir should be created");
            created.push(runtime);
        }

        prune_runtime_dirs_at(&base, SystemTime::now());

        for runtime in &created {
            assert!(
                runtime.is_dir(),
                "{} should not be pruned while still fresh",
                runtime.display()
            );
        }

        let _ = fs::remove_dir_all(PathBuf::from(&base));
    }
}
