use std::io::{self, Read, Write};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

// Drain both pipes while the child runs: a full stdout pipe must not prevent
// deadline enforcement. Continue draining oversized output without retaining it.
fn read_bounded(mut pipe: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    let mut oversized = false;
    loop {
        let count = pipe.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if bytes.len().saturating_add(count) > limit {
            oversized = true;
        } else if !oversized {
            bytes.extend_from_slice(&buffer[..count]);
        }
    }
    if oversized {
        Err(io::Error::other("conformer output exceeded its byte limit"))
    } else {
        Ok(bytes)
    }
}

pub(super) fn run(command: &mut Command, input: &[u8], timeout: Duration) -> io::Result<Output> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    std::thread::scope(|scope| {
        let writer = scope.spawn(move || stdin.write_all(input));
        let out = scope.spawn(move || read_bounded(stdout, 75 * 1024 * 1024));
        let err = scope.spawn(move || read_bounded(stderr, 1024 * 1024));
        let deadline = Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status))
                    if writer.is_finished() && out.is_finished() && err.is_finished() =>
                {
                    break Ok(status)
                }
                Err(error) => break Err(error),
                _ if Instant::now() >= deadline => {
                    break Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "conformer generation exceeded its deadline",
                    ))
                }
                _ => std::thread::sleep(Duration::from_millis(20)),
            }
        };
        if status.is_err() {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        let status = status?;
        writer
            .join()
            .map_err(|_| io::Error::other("conformer stdin worker failed"))??;
        Ok(Output {
            status,
            stdout: out
                .join()
                .map_err(|_| io::Error::other("conformer stdout worker failed"))??,
            stderr: err
                .join()
                .map_err(|_| io::Error::other("conformer stderr worker failed"))??,
        })
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn drains_output_before_child_exit() {
        let result = run(
            Command::new("/bin/sh").args(["-c", "head -c 200000 /dev/zero; cat"]),
            b"done",
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(result.status.success());
        assert_eq!(result.stdout.len(), 200004);
    }

    #[test]
    fn kills_process_group_at_deadline() {
        let start = Instant::now();
        let error = run(
            Command::new("/bin/sh").args(["-c", "sleep 20"]),
            b"",
            Duration::from_millis(100),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn rejects_oversized_output() {
        assert!(read_bounded(&b"12345"[..], 4).is_err());
        assert_eq!(read_bounded(&b"1234"[..], 4).unwrap(), b"1234");
    }
}
