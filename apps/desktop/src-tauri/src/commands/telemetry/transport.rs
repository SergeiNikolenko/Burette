use std::io::{Read, Write};
use std::process::{Command, Stdio};

/// Credentials are sent on stdin, never as command-line arguments. Do not
/// follow redirects: they could forward the installation credential elsewhere.
pub(super) fn send(url: &str, payload: &serde_json::Value) -> Result<String, String> {
    let failed = || "Statistics service is unavailable. Please try again when online.".to_string();
    let mut child = Command::new("/usr/bin/curl")
        .args([
            "--disable",
            "--silent",
            "--fail",
            "--proto",
            "=https",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            "--max-redirs",
            "0",
            "--header",
            "Content-Type: application/json",
            "--user-agent",
            "Burette-Statistics/1",
            "--data-binary",
            "@-",
            url,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| failed())?;
    let result = (|| {
        let bytes = serde_json::to_vec(payload).map_err(|_| failed())?;
        child
            .stdin
            .take()
            .ok_or_else(failed)?
            .write_all(&bytes)
            .map_err(|_| failed())?;
        let mut output = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(failed)?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut output)
            .map_err(|_| failed())?;
        if output.len() > 2 * 1024 * 1024 {
            return Err(failed());
        }
        if !child.wait().map_err(|_| failed())?.success() {
            return Err(failed());
        }
        let value: serde_json::Value = serde_json::from_slice(&output).map_err(|_| failed())?;
        // A redirect or HTML error page must never acknowledge erasure.
        if url.ends_with("/erase") && value.get("erased") != Some(&serde_json::Value::Bool(true)) {
            return Err(failed());
        }
        if url.ends_with("/events")
            && value.get("result").and_then(|v| v.as_str()) != Some("accepted")
        {
            return Err(failed());
        }
        String::from_utf8(output).map_err(|_| failed())
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}
