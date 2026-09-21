//! Database passwords, kept in the login keychain.
//!
//! Everything else the shell remembers lives in localStorage, which is plain
//! text on disk and readable by anything that can read the profile. A database
//! password does not go there. The keychain is reached through `/usr/bin/security`
//! rather than a new binding, matching how the rest of the app shells out.
//!
//! The secret itself is written to the tool's stdin, never to its arguments: the
//! argument list of a running process is readable by other processes on macOS,
//! and a password in argv is a password in `ps`.

#[cfg(target_os = "macos")]
use std::io::Write;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};

pub(crate) const KEYCHAIN_SERVICE: &str = "Burette Database";
const MAX_ACCOUNT_CHARS: usize = 128;
const MAX_SECRET_CHARS: usize = 1024;

/// Account names do reach argv, so they are held to what a connection name can
/// reasonably be - no control characters, no option-looking leading dash.
pub(crate) fn validate_account(account: &str) -> Result<String, String> {
    let account = account.trim();
    if account.is_empty() {
        return Err("A saved connection needs a name".to_string());
    }
    if account.chars().count() > MAX_ACCOUNT_CHARS {
        return Err(format!(
            "A connection name is limited to {MAX_ACCOUNT_CHARS} characters"
        ));
    }
    if account.chars().any(char::is_control) {
        return Err("A connection name must not contain control characters".to_string());
    }
    if account.starts_with('-') {
        return Err("A connection name must not start with a dash".to_string());
    }
    Ok(account.to_string())
}

fn validate_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("The password is empty".to_string());
    }
    if secret.chars().count() > MAX_SECRET_CHARS {
        return Err(format!(
            "A password is limited to {MAX_SECRET_CHARS} characters"
        ));
    }
    if secret.contains('\n') || secret.contains('\r') {
        return Err("A password must not contain line breaks".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn store(account: &str, secret: &str) -> Result<(), String> {
    let account = validate_account(account)?;
    validate_secret(secret)?;
    let mut child = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-a",
            &account,
            "-s",
            KEYCHAIN_SERVICE,
            "-U",
            // Left without a value, -w reads the password from stdin - twice, as a
            // confirmation - which keeps it out of the argument list.
            "-w",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not reach the keychain: {error}"))?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "The keychain tool did not accept the password".to_string())?;
        stdin
            .write_all(format!("{secret}\n{secret}\n").as_bytes())
            .map_err(|error| format!("Could not write the password: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("The keychain tool failed: {error}"))?;
    if !output.status.success() {
        return Err(keychain_error(&output.stderr, "store the password"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn read(account: &str) -> Result<Option<String>, String> {
    let account = validate_account(account)?;
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-a",
            &account,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ])
        .output()
        .map_err(|error| format!("Could not reach the keychain: {error}"))?;
    if !output.status.success() {
        // A missing item is the normal state for a connection nobody saved a
        // password for, not a failure worth raising.
        return Ok(None);
    }
    let secret = String::from_utf8(output.stdout)
        .map_err(|_| "The stored password is not valid text".to_string())?;
    let secret = secret.trim_end_matches(['\n', '\r']).to_string();
    Ok((!secret.is_empty()).then_some(secret))
}

#[cfg(target_os = "macos")]
pub(crate) fn delete(account: &str) -> Result<bool, String> {
    let account = validate_account(account)?;
    let output = Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-a",
            &account,
            "-s",
            KEYCHAIN_SERVICE,
        ])
        .output()
        .map_err(|error| format!("Could not reach the keychain: {error}"))?;
    Ok(output.status.success())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn store(account: &str, secret: &str) -> Result<(), String> {
    validate_account(account)?;
    validate_secret(secret)?;
    Err("Saving database passwords needs the macOS keychain".to_string())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read(account: &str) -> Result<Option<String>, String> {
    validate_account(account)?;
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn delete(account: &str) -> Result<bool, String> {
    validate_account(account)?;
    Ok(false)
}

#[cfg(target_os = "macos")]
fn keychain_error(stderr: &[u8], what: &str) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        format!("Could not {what}")
    } else {
        format!("Could not {what}: {message}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_names_that_could_be_read_as_options_are_refused() {
        assert!(validate_account("-s").is_err());
        assert!(validate_account("").is_err());
        assert!(validate_account("   ").is_err());
        assert!(validate_account("name\nwith break").is_err());
        assert!(validate_account(&"n".repeat(MAX_ACCOUNT_CHARS + 1)).is_err());
        assert_eq!(validate_account("  research db  ").unwrap(), "research db");
    }

    #[test]
    fn passwords_that_would_confuse_the_stdin_handshake_are_refused() {
        assert!(validate_secret("").is_err());
        assert!(validate_secret("first\nsecond").is_err());
        assert!(validate_secret("first\rsecond").is_err());
        assert!(validate_secret(&"p".repeat(MAX_SECRET_CHARS + 1)).is_err());
        assert!(validate_secret("a real password").is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_password_survives_a_round_trip_through_the_keychain() {
        let account = format!("burette-test-{}", uuid::Uuid::new_v4());
        assert_eq!(read(&account).expect("read"), None);
        store(&account, "correct horse battery staple").expect("store");
        assert_eq!(
            read(&account).expect("read"),
            Some("correct horse battery staple".to_string())
        );
        store(&account, "rotated").expect("rotate");
        assert_eq!(read(&account).expect("read"), Some("rotated".to_string()));
        assert!(delete(&account).expect("delete"));
        assert_eq!(read(&account).expect("read"), None);
    }
}
