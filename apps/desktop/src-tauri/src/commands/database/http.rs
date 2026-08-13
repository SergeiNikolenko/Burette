//! Every database provider reaches the network through this module.
//!
//! The webview CSP blocks external fetches and the grid iframe has no network at
//! all, so the only way out of Burette is a `/usr/bin/curl` subprocess - the same
//! pattern `fetch_remote_structure` uses for remote structures. Keeping it in one
//! place means the SSRF guard, the timeout and the response ceiling are applied to
//! every provider rather than remembered per provider.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::commands::documents::reject_private_fetch_target;

/// Providers answer with tables and small SDF files; anything larger is a sign the
/// query was too broad, and the grid would not enjoy it either.
pub(crate) const MAX_RESPONSE_BYTES: u64 = 48 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum RequestBody {
    /// No body: a plain GET.
    None,
    /// `multipart/form-data`, which is what ChemSpace expects.
    Multipart(Vec<(String, String)>),
}

#[derive(Debug)]
pub(crate) struct DatabaseRequest {
    pub(crate) url: String,
    pub(crate) body: RequestBody,
    /// Header lines that may be printed in diagnostics.
    pub(crate) headers: Vec<String>,
    /// Header lines carrying credentials. They are handed to curl over stdin so
    /// they never appear in the process table, where every local process can read
    /// them.
    pub(crate) secret_headers: Vec<String>,
    pub(crate) timeout_seconds: u32,
    pub(crate) max_bytes: u64,
}

impl DatabaseRequest {
    pub(crate) fn get(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            body: RequestBody::None,
            headers: Vec::new(),
            secret_headers: Vec::new(),
            timeout_seconds: 60,
            max_bytes: MAX_RESPONSE_BYTES,
        }
    }

    pub(crate) fn with_header(mut self, header: impl Into<String>) -> Self {
        self.headers.push(header.into());
        self
    }

    /// A header carrying a credential. It is handed to curl over stdin, never as
    /// an argument, because the argument list of a running process is readable by
    /// other processes.
    pub(crate) fn with_secret_header(mut self, header: impl Into<String>) -> Self {
        self.secret_headers.push(header.into());
        self
    }

    pub(crate) fn with_body(mut self, body: RequestBody) -> Self {
        self.body = body;
        self
    }

    pub(crate) fn with_timeout(mut self, seconds: u32) -> Self {
        self.timeout_seconds = seconds;
        self
    }

    pub(crate) fn with_max_bytes(mut self, max_bytes: u64) -> Self {
        self.max_bytes = max_bytes.min(MAX_RESPONSE_BYTES);
        self
    }
}

/// A redirect chain is the classic way around a URL allow-list, so the hop count
/// is bounded.
const MAX_REDIRECTS: usize = 3;

/// curl reports the redirect target through this marker on stderr, which keeps
/// stdout holding nothing but the response body.
const REDIRECT_MARKER: &str = "burette-redirect:";

/// Runs one request and returns the raw response body.
///
/// The URL is validated and resolved before curl starts: only http(s) is allowed,
/// and a host that resolves into a private or loopback range is refused. Redirects
/// are followed by this loop rather than by `--location` precisely so that every
/// hop goes through the same guard - curl's own `--proto-redir` only restricts the
/// scheme, so a public endpoint answering `302 http://169.254.169.254/` would
/// otherwise walk straight past the allow-list.
pub(crate) fn fetch(request: &DatabaseRequest) -> Result<Vec<u8>, String> {
    let origin = validate_request_url(&request.url)?;
    let mut target = origin.clone();
    for _ in 0..=MAX_REDIRECTS {
        // Only the originally requested host is trusted with the credentials and
        // the body; a redirect elsewhere is replayed as a bare GET, which is what
        // curl itself does for 301/302/303 and for `Authorization` across hosts.
        let trusted = target.host_str() == origin.host_str();
        let (body, redirect) = run_curl(request, &target, trusted)?;
        let Some(redirect) = redirect else {
            return Ok(body);
        };
        target = validate_request_url(&redirect)?;
    }
    Err("The database request was redirected too many times".to_string())
}

/// One hop. Returns the response body and, when the answer was a redirect, its
/// target - unvalidated, because validating it is the caller's loop.
fn run_curl(
    request: &DatabaseRequest,
    target: &url::Url,
    trusted: bool,
) -> Result<(Vec<u8>, Option<String>), String> {
    let max_filesize = request.max_bytes.to_string();
    let timeout = request.timeout_seconds.to_string();
    let mut command = Command::new("/usr/bin/curl");
    command.args([
        "--fail",
        "--proto",
        "=http,https",
        "--silent",
        "--show-error",
        "--max-time",
        &timeout,
        "--max-filesize",
        &max_filesize,
        "--user-agent",
        "Burette/1.0",
        "--write-out",
        &format!("%{{stderr}}\n{REDIRECT_MARKER}%{{redirect_url}}\n"),
    ]);
    for header in &request.headers {
        command.args(["--header", header]);
    }
    if trusted {
        match &request.body {
            RequestBody::None => {}
            RequestBody::Multipart(fields) => {
                for (key, value) in fields {
                    command.args(["--form", &format!("{key}={value}")]);
                }
            }
        }
    }
    let config = if trusted {
        curl_secret_config(&request.secret_headers)
    } else {
        None
    };
    if config.is_some() {
        command.args(["--config", "-"]);
    }
    command.arg(target.as_str());
    command.stdin(if config.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start curl: {error}"))?;
    if let Some(config) = config {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "curl did not accept its configuration".to_string())?;
        stdin
            .write_all(config.as_bytes())
            .map_err(|error| format!("Could not configure curl: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("curl failed: {error}"))?;
    let (message, redirect) = split_curl_stderr(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(if message.is_empty() {
            format!("The database request failed with status {}", output.status)
        } else {
            message
        });
    }
    if output.stdout.len() as u64 > request.max_bytes {
        return Err("The database answered with more data than Burette accepts".to_string());
    }
    Ok((output.stdout, redirect))
}

/// Separates curl's diagnostics from the redirect target `--write-out` appended.
fn split_curl_stderr(stderr: &str) -> (String, Option<String>) {
    let mut message = String::new();
    let mut redirect = None;
    for line in stderr.lines() {
        match line.strip_prefix(REDIRECT_MARKER) {
            Some(target) if !target.trim().is_empty() => redirect = Some(target.trim().to_string()),
            Some(_) => {}
            None => {
                message.push_str(line);
                message.push('\n');
            }
        }
    }
    (message.trim().to_string(), redirect)
}

pub(crate) fn fetch_text(request: &DatabaseRequest) -> Result<String, String> {
    let bytes = fetch(request)?;
    String::from_utf8(bytes).map_err(|_| "The database answered with invalid UTF-8".to_string())
}

pub(crate) fn validate_request_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url.trim()).map_err(|error| format!("Invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Database requests support only http and https URLs".to_string()),
    }
    reject_private_fetch_target(&parsed)?;
    Ok(parsed)
}

/// curl reads `--config -` as a key/value file; quoting a value means escaping
/// backslashes and double quotes. A header holding a newline would smuggle an
/// extra option into that file, so it is refused rather than escaped.
fn curl_secret_config(headers: &[String]) -> Option<String> {
    if headers.is_empty() {
        return None;
    }
    let mut config = String::new();
    for header in headers {
        if header.contains('\n') || header.contains('\r') {
            continue;
        }
        config.push_str("header = \"");
        for character in header.chars() {
            match character {
                '"' => config.push_str("\\\""),
                '\\' => config.push_str("\\\\"),
                _ => config.push(character),
            }
        }
        config.push_str("\"\n");
    }
    (!config.is_empty()).then_some(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_urls_reach_the_network() {
        assert!(validate_request_url("https://www.ebi.ac.uk/chembl/api/data/status.json").is_ok());
        assert_eq!(
            validate_request_url("file:///etc/passwd").unwrap_err(),
            "Database requests support only http and https URLs"
        );
        assert!(validate_request_url("ftp://example.com/data.csv").is_err());
        assert!(validate_request_url("not a url").is_err());
    }

    #[test]
    fn private_and_loopback_targets_are_refused() {
        for url in [
            "http://localhost:8080/query",
            "http://127.0.0.1/query",
            "http://10.0.0.5/query",
            "http://192.168.1.4/query",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/query",
            "http://0.0.0.0/query",
        ] {
            assert!(
                validate_request_url(url).is_err(),
                "{url} must not be reachable from a database provider"
            );
        }
    }

    #[test]
    fn credentials_are_quoted_for_the_curl_configuration_file() {
        let config = curl_secret_config(&["Authorization: Bearer a\"b\\c".to_string()])
            .expect("a secret header produces a configuration");
        assert_eq!(config, "header = \"Authorization: Bearer a\\\"b\\\\c\"\n");
        assert_eq!(curl_secret_config(&[]), None);
    }

    #[test]
    fn credentials_containing_line_breaks_are_dropped_rather_than_escaped() {
        assert_eq!(
            curl_secret_config(&["Authorization: Bearer a\nheader = \"X: y\"".to_string()]),
            None
        );
    }

    #[test]
    fn a_redirect_towards_a_private_service_is_refused_like_any_other_target() {
        // The follow loop hands every hop back to this guard, so the metadata
        // service is unreachable even when the first hop was a public host.
        let (message, redirect) =
            split_curl_stderr("\nburette-redirect:http://169.254.169.254/latest/meta-data/\n");
        assert!(message.is_empty());
        assert!(validate_request_url(&redirect.expect("a redirect target")).is_err());
    }

    #[test]
    fn curl_diagnostics_survive_the_redirect_marker() {
        let (message, redirect) =
            split_curl_stderr("curl: (22) The requested URL returned 404\nburette-redirect:\n");
        assert_eq!(message, "curl: (22) The requested URL returned 404");
        assert_eq!(redirect, None);
    }

    #[test]
    fn response_ceilings_never_exceed_the_module_limit() {
        let request = DatabaseRequest::get("https://example.com").with_max_bytes(u64::MAX);
        assert_eq!(request.max_bytes, MAX_RESPONSE_BYTES);
        let smaller = DatabaseRequest::get("https://example.com").with_max_bytes(1024);
        assert_eq!(smaller.max_bytes, 1024);
    }
}
