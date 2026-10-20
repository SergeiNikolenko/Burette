//! Concurrent bounded pipe IO with a deadline and process-group cleanup.

use std::io::{self, Read, Write};
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub struct Limits {
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub deadline: Instant,
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        // Also close pipes inherited by descendants, including after leader exit.
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.0.id() as i32), libc::SIGKILL);
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

enum PipeResult {
    Input(io::Result<()>),
    Output(io::Result<Vec<u8>>),
    Errors(io::Result<Vec<u8>>),
}

fn read_bounded(pipe: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    pipe.take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::other("process output exceeded its byte limit"));
    }
    Ok(bytes)
}

/// Run a child without buffering unlimited output or blocking deadline checks
/// on stdin. No partial output is returned on IO failure, overflow or timeout.
pub fn run(command: &mut Command, input: &[u8], limits: Limits) -> io::Result<Output> {
    if Instant::now() >= limits.deadline {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "request deadline expired",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = ChildGuard(
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?,
    );
    let mut stdin = child.0.stdin.take().expect("piped stdin");
    let stdout = child.0.stdout.take().expect("piped stdout");
    let stderr = child.0.stderr.take().expect("piped stderr");
    std::thread::scope(|scope| {
        let mut child = child;
        let (sender, receiver) = mpsc::channel();
        let writer = sender.clone();
        std::thread::Builder::new().spawn_scoped(scope, move || {
            let _ = writer.send(PipeResult::Input(stdin.write_all(input)));
        })?;
        let reader = sender.clone();
        std::thread::Builder::new().spawn_scoped(scope, move || {
            let _ = reader.send(PipeResult::Output(read_bounded(
                stdout,
                limits.stdout_bytes,
            )));
        })?;
        std::thread::Builder::new().spawn_scoped(scope, move || {
            let _ = sender.send(PipeResult::Errors(read_bounded(
                stderr,
                limits.stderr_bytes,
            )));
        })?;

        // The guard must drop before scope joins workers, so killed descendants
        // cannot keep a blocked pipe reader/writer alive during error cleanup.
        let result = (|| {
            let mut output = None;
            let mut errors = None;
            let mut written = false;
            let mut status = None;
            loop {
                let remaining = limits.deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "request deadline expired",
                    ));
                }
                if status.is_none() {
                    status = child.0.try_wait()?;
                }
                if let (true, Some(status), Some(stdout), Some(stderr)) =
                    (written, status, &mut output, &mut errors)
                {
                    return Ok(Output {
                        status,
                        stdout: std::mem::take(stdout),
                        stderr: std::mem::take(stderr),
                    });
                }
                match receiver.recv_timeout(remaining.min(Duration::from_millis(10))) {
                    Ok(PipeResult::Input(result)) => {
                        result?;
                        written = true;
                    }
                    Ok(PipeResult::Output(result)) => output = Some(result?),
                    Ok(PipeResult::Errors(result)) => errors = Some(result?),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        if !(written && output.is_some() && errors.is_some()) {
                            return Err(io::Error::other("process pipe worker failed"));
                        }
                        std::thread::sleep(remaining.min(Duration::from_millis(10)));
                    }
                }
            }
        })();
        drop(child);
        result
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn limits(stdout_bytes: usize, stderr_bytes: usize) -> Limits {
        Limits {
            stdout_bytes,
            stderr_bytes,
            deadline: Instant::now() + Duration::from_secs(3),
        }
    }

    #[test]
    fn exact_limits_and_large_stdin_are_drained_concurrently() {
        let input = vec![b'x'; 200_000];
        let output = run(
            Command::new("/bin/sh").args(["-c", "printf err >&2; cat"]),
            &input,
            limits(input.len(), 3),
        )
        .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, input);
        assert_eq!(output.stderr, b"err");
    }

    #[test]
    fn stdout_and_stderr_overflow_fail_without_waiting_for_eof() {
        for script in ["printf 12345; sleep 20", "printf 12345 >&2; sleep 20"] {
            let start = Instant::now();
            let error = run(
                Command::new("/bin/sh").args(["-c", script]),
                b"",
                limits(4, 4),
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::Other);
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }

    #[test]
    fn deadline_kills_inherited_pipes_and_unblocks_stdin() {
        for script in ["sleep 20", "sleep 20 & exit 0"] {
            let start = Instant::now();
            let error = run(
                Command::new("/bin/sh").args(["-c", script]),
                &[b'x'; 200_000],
                Limits {
                    deadline: start + Duration::from_millis(100),
                    ..limits(4, 4)
                },
            )
            .unwrap_err();
            assert!(matches!(
                error.kind(),
                io::ErrorKind::TimedOut | io::ErrorKind::BrokenPipe
            ));
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }

    #[test]
    fn input_failure_and_nonzero_exit_are_distinct() {
        let output = run(
            Command::new("/bin/sh").args(["-c", "printf failure >&2; exit 7"]),
            b"",
            limits(0, 7),
        )
        .unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.stderr, b"failure");
        let start = Instant::now();
        let error = run(
            Command::new("/bin/sh").args(["-c", "exec 0<&-; sleep 20"]),
            &[b'x'; 200_000],
            limits(4, 4),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn actual_curl_chunked_overflow_is_bounded_independently_of_curl_version() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let start = Instant::now();
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == io::ErrorKind::WouldBlock
                            && start.elapsed() < Duration::from_secs(2) =>
                    {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("fixture connection failed: {error}"),
                }
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            socket
                .set_write_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let _ = socket.read(&mut [0; 4096]);
            let body = format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n40\r\n{}\r\n0\r\n\r\n", "x".repeat(64));
            let _ = socket.write_all(body.as_bytes());
        });
        let result = run(
            Command::new("/usr/bin/curl").args([
                "--disable",
                "--noproxy",
                "*",
                "--silent",
                "--show-error",
                "--max-filesize",
                "16",
                &url,
            ]),
            b"",
            limits(16, 4096),
        );
        server.join().unwrap();
        match result {
            Err(error) => assert_eq!(error.kind(), io::ErrorKind::Other),
            Ok(output) => {
                assert!(!output.status.success());
                assert!(output.stdout.len() <= 16);
            }
        }
    }
}
