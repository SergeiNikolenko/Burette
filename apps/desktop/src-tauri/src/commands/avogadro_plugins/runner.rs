//! Preparing and running installed Avogadro packages, as Avogadro itself does:
//! `pixi install` in the package folder creates its environment, and a command
//! is the package's console script run with the feature identifier, molecule
//! JSON on stdin and the result JSON on stdout.
//!
//! Both steps execute code from the package. They are reached only from an
//! explicit user action in the desktop shell; the browser shell has no route.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use burette_core::bounded_process::{run_cancellable, Limits};

use super::store::{describe_receipt, package_dir, read_receipt, InstalledPlugin};
use super::CANCELLED;

pub(crate) const NO_PIXI: &str = "pixi is not installed";
const NO_WORKSPACE: &str = "The plugin declares no pixi environment";
const PREPARE_SECONDS: u64 = 30 * 60;
const RUN_SECONDS: u64 = 30 * 60;
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_RESULT_BYTES: usize = 32 * 1024 * 1024;
const MAX_OPTION_BYTES: u64 = 64 * 1024;

fn environment_bin(dir: &Path) -> PathBuf {
    dir.join(".pixi").join("envs").join("default").join("bin")
}

fn interrupted(error: std::io::Error, what: &str) -> String {
    match error.kind() {
        std::io::ErrorKind::Interrupted => CANCELLED.to_string(),
        std::io::ErrorKind::TimedOut => format!("{what} timed out"),
        _ => format!("{what} failed: {error}"),
    }
}

fn tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let lines: Vec<_> = text.lines().rev().take(8).collect();
    lines.into_iter().rev().collect::<Vec<_>>().join("\n")
}

/// Creates the package's pixi environment. `pixi` is the resolved executable.
pub(crate) fn prepare(
    root: &Path,
    name: &str,
    pixi: Option<PathBuf>,
    cancel: &AtomicBool,
) -> Result<InstalledPlugin, String> {
    let receipt = read_receipt(root, name).ok_or("This plugin is not installed")?;
    let dir = package_dir(root, &receipt);
    let pyproject = std::fs::read_to_string(dir.join("pyproject.toml"))
        .map_err(|_| NO_WORKSPACE.to_string())?;
    if !dir.join("pixi.toml").is_file()
        && !pyproject
            .lines()
            .any(|line| line.trim().starts_with("[tool.pixi"))
    {
        return Err(NO_WORKSPACE.into());
    }
    let pixi = pixi.ok_or(NO_PIXI)?;
    let mut command = Command::new(pixi);
    command
        .arg("install")
        .current_dir(&dir)
        .env("NO_COLOR", "1");
    let output = run_cancellable(
        &mut command,
        b"",
        Limits {
            stdout_bytes: 8 * 1024 * 1024,
            stderr_bytes: 8 * 1024 * 1024,
            deadline: Instant::now() + Duration::from_secs(PREPARE_SECONDS),
        },
        cancel,
    )
    .map_err(|error| interrupted(error, "Preparing the plugin"))?;
    if !output.status.success() {
        return Err(format!("pixi install failed:\n{}", tail(&output.stderr)));
    }
    describe_receipt(root, receipt)
        .filter(|plugin| plugin.prepared)
        .ok_or_else(|| "pixi install did not create the plugin environment".to_string())
}

pub(crate) fn valid_script(script: &str) -> bool {
    script.strip_prefix("avogadro-").is_some_and(|rest| {
        !rest.is_empty()
            && rest.len() <= 64
            && rest.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte)
            })
    })
}

pub(crate) fn valid_identifier(identifier: &str) -> bool {
    (1..=64).contains(&identifier.len())
        && identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

/// Runs one command and returns its standard output.
pub(crate) fn run(
    root: &Path,
    name: &str,
    script: &str,
    identifier: &str,
    input: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    if !valid_script(script) || !valid_identifier(identifier) || input.len() > MAX_INPUT_BYTES {
        return Err("Invalid plugin command".into());
    }
    let receipt = read_receipt(root, name).ok_or("This plugin is not installed")?;
    let dir = package_dir(root, &receipt);
    let bin = environment_bin(&dir);
    let executable = bin.join(script);
    let resolved = executable
        .canonicalize()
        .map_err(|_| "Set up this plugin before running its commands".to_string())?;
    let environment = dir
        .join(".pixi")
        .canonicalize()
        .map_err(|_| "Set up this plugin before running its commands".to_string())?;
    if !resolved.starts_with(&environment) || !resolved.is_file() {
        return Err("Invalid plugin command".into());
    }
    let mut command = Command::new(&executable);
    command
        .args([identifier, "--lang", "en"])
        .current_dir(&dir)
        .env(
            "PATH",
            format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", bin.display()),
        )
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME");
    let output = run_cancellable(
        &mut command,
        input.as_bytes(),
        Limits {
            stdout_bytes: MAX_RESULT_BYTES,
            stderr_bytes: 256 * 1024,
            deadline: Instant::now() + Duration::from_secs(RUN_SECONDS),
        },
        cancel,
    )
    .map_err(|error| interrupted(error, "The command"))?;
    if !output.status.success() {
        return Err(format!("The command failed:\n{}", tail(&output.stderr)));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "The command answered with text that is not UTF-8".to_string())
}

/// Reads a `user-options` JSON file the package declares, below its folder.
pub(crate) fn read_options(root: &Path, name: &str, relative: &str) -> Result<String, String> {
    let invalid = || "Invalid plugin options file".to_string();
    if !relative.ends_with(".json")
        || relative.len() > 256
        || relative.starts_with('/')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(invalid());
    }
    let receipt = read_receipt(root, name).ok_or("This plugin is not installed")?;
    let dir = package_dir(root, &receipt)
        .canonicalize()
        .map_err(|_| invalid())?;
    let path = dir.join(relative).canonicalize().map_err(|_| invalid())?;
    let metadata = std::fs::metadata(&path).map_err(|_| invalid())?;
    if !path.starts_with(&dir) || !metadata.is_file() || metadata.len() > MAX_OPTION_BYTES {
        return Err(invalid());
    }
    std::fs::read_to_string(path).map_err(|_| invalid())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::avogadro_plugins::index::{entry, SAVED_INDEX};
    use crate::commands::avogadro_plugins::store::install;
    use std::os::unix::fs::PermissionsExt;

    const RDKIT: &[u8] =
        include_bytes!("../../../../../../tests/fixtures/avogadro/avogadro-rdkit-82498e3a.zip");

    fn installed_rdkit() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("burette-avogadro-runner-{}", uuid::Uuid::new_v4()));
        install(
            &root,
            &entry(SAVED_INDEX, "avogadro-rdkit").unwrap(),
            RDKIT,
            &AtomicBool::new(false),
        )
        .unwrap();
        root
    }

    /// Stands in for the environment `pixi install` creates: a console script.
    fn fake_environment(root: &Path, script: &str, body: &str) {
        let receipt = read_receipt(root, "avogadro-rdkit").unwrap();
        let bin = environment_bin(&package_dir(root, &receipt));
        std::fs::create_dir_all(&bin).unwrap();
        let path = bin.join(script);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn commands_receive_the_identifier_and_stdin_and_return_stdout() {
        let root = installed_rdkit();
        assert!(run(
            &root,
            "avogadro-rdkit",
            "avogadro-rdkit",
            "uff",
            "{}",
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .contains("Set up"));
        fake_environment(
            &root,
            "avogadro-rdkit",
            r#"read input; printf '{"feature":"%s","lang":"%s","input":%s}' "$1" "$3" "$input""#,
        );
        assert_eq!(
            run(
                &root,
                "avogadro-rdkit",
                "avogadro-rdkit",
                "uff",
                "{\"sdf\":\"x\"}\n",
                &AtomicBool::new(false)
            )
            .unwrap(),
            r#"{"feature":"uff","lang":"en","input":{"sdf":"x"}}"#
        );
        fake_environment(
            &root,
            "avogadro-rdkit",
            "echo 'Traceback: boom' >&2; exit 3",
        );
        assert!(run(
            &root,
            "avogadro-rdkit",
            "avogadro-rdkit",
            "uff",
            "{}",
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .ends_with("Traceback: boom"));
        assert_eq!(
            run(
                &root,
                "avogadro-rdkit",
                "avogadro-rdkit",
                "uff",
                "{}",
                &AtomicBool::new(true)
            )
            .unwrap_err(),
            CANCELLED
        );
        for (script, identifier) in [
            ("python3", "uff"),
            ("avogadro-../../x", "uff"),
            ("avogadro-rdkit", "--debug x"),
        ] {
            assert_eq!(
                run(
                    &root,
                    "avogadro-rdkit",
                    script,
                    identifier,
                    "{}",
                    &AtomicBool::new(false)
                )
                .unwrap_err(),
                "Invalid plugin command"
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepare_requires_pixi_and_a_declared_environment() {
        let root = installed_rdkit();
        assert_eq!(
            prepare(&root, "avogadro-rdkit", None, &AtomicBool::new(false)).unwrap_err(),
            NO_PIXI
        );
        let fake_pixi = root.join("fake-pixi");
        std::fs::write(&fake_pixi, "#!/bin/sh\nmkdir -p .pixi/envs/default/bin\n").unwrap();
        std::fs::set_permissions(&fake_pixi, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(
            prepare(
                &root,
                "avogadro-rdkit",
                Some(fake_pixi),
                &AtomicBool::new(false)
            )
            .unwrap()
            .prepared
        );
        assert_eq!(
            prepare(&root, "missing", None, &AtomicBool::new(false)).unwrap_err(),
            "This plugin is not installed"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn option_files_stay_inside_the_package() {
        let root = installed_rdkit();
        assert!(
            read_options(&root, "avogadro-rdkit", "customization/etkdg_options.json")
                .unwrap()
                .contains("\"conformers\"")
        );
        for path in [
            "../installed.json",
            "/etc/hosts.json",
            "customization/../../x.json",
            "pyproject.toml",
        ] {
            assert!(
                read_options(&root, "avogadro-rdkit", path).is_err(),
                "{path}"
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
