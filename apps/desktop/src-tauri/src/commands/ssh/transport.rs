use std::sync::{Condvar, Mutex};

static CONNECTIONS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

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

// Native subprocess pipes must not be passed through an OpenSSH master socket:
// macOS can reject that descriptor handoff (mm_send_fd / EMSGSIZE) before the
// remote worker starts. Explicitly disable both creating and reusing a master,
// including one selected by the user's SSH config. Never replay a failed submit.
pub(super) const CONNECTION_OPTIONS: [&str; 3] = [
    "-oControlMaster=no",
    "-oControlPath=none",
    "-oControlPersist=no",
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn subprocess_transport_overrides_configured_multiplexing() {
        let output = Command::new("/usr/bin/ssh")
            .args(CONNECTION_OPTIONS)
            .args([
                "-G",
                "-F",
                "/dev/null",
                "-oControlMaster=auto",
                "-oControlPersist=60",
                "-oControlPath=/tmp/unused-burette-test-master",
                "example.invalid",
            ])
            .output()
            .expect("inspect OpenSSH effective configuration without connecting");
        assert!(output.status.success());
        let config = String::from_utf8(output.stdout).expect("OpenSSH configuration");
        let options = config
            .lines()
            .filter(|line| {
                line.starts_with("controlmaster ")
                    || line.starts_with("controlpersist ")
                    || line.starts_with("controlpath ")
            })
            .collect::<Vec<_>>();
        assert_eq!(options, ["controlmaster false", "controlpersist no"]);
    }
}
