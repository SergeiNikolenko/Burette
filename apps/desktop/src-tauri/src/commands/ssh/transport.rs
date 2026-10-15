use sha2::{Digest, Sha256};
use std::{
    os::unix::fs::DirBuilderExt,
    sync::{Condvar, Mutex, OnceLock},
};

static CONNECTIONS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());
static CONTROL_DIRECTORY: OnceLock<Result<std::path::PathBuf, String>> = OnceLock::new();

// Bound active channels without holding a global lock during network IO.
pub(super) struct Connection;
impl Connection {
    pub(super) fn acquire() -> Result<Self, String> {
        let (count, ready) = &CONNECTIONS;
        let count = count
            .lock()
            .map_err(|_| "SSH request queue is unavailable")?;
        let mut count = ready
            .wait_while(count, |count| *count >= 3)
            .map_err(|_| "SSH request queue is unavailable")?;
        *count += 1;
        Ok(Self)
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        let (count, ready) = &CONNECTIONS;
        if let Ok(mut count) = count.lock() {
            *count -= 1;
            ready.notify_one();
        }
    }
}

pub(super) fn multiplex_options(host: &str) -> Result<[String; 3], String> {
    let directory = CONTROL_DIRECTORY.get_or_init(|| {
        // macOS's per-user temp path can exceed the Unix socket path limit.
        // A fresh exclusive 0700 directory prevents socket sharing with any
        // user-configured master, another app instance, or another local user.
        // Alias hash below also isolates distinct ProxyCommand/identity configs.
        // The whole socket path must stay under the 104-byte sun_path limit:
        // "/tmp/burette-ssh-" + 8 + "/" + 8 + "-" + %C (40) is 75 bytes, and
        // ssh appends a 17-byte temporary suffix while it binds the master.
        let path = std::path::Path::new("/tmp").join(format!(
            "burette-ssh-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..8]
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(|e| e.to_string())?;
        Ok(path)
    });
    let directory = directory.as_ref().map_err(Clone::clone)?;
    let alias = Sha256::digest(host.as_bytes())[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok([
        "-oControlMaster=auto".into(),
        "-oControlPersist=60".into(),
        format!("-oControlPath={}/{}-%C", directory.display(), alias),
    ])
}
