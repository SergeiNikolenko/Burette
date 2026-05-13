//! Standalone `burrete` shell launcher.
//!
//! The installed command is a symlink to the app binary. Normal bundle launches
//! still enter the Tauri app; calls through `/usr/local/bin/burrete` enter this
//! CLI path and ask macOS to open Burrete with an optional structure file or
//! workspace folder.

use crate::open_target;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const EXIT_SUCCESS: u8 = 0;
const EXIT_USAGE: u8 = 2;
const EXIT_RUNTIME: u8 = 3;

pub const INSTALL_TARGET: &str = "/usr/local/bin/burrete";

pub const USAGE: &str = "\
Usage: burrete [PATH]

Open a molecular structure file or folder in the Burrete desktop app.

Arguments:
  PATH              Supported structure file or directory to open. If omitted,
                    Burrete launches with no target.

Options:
  -h, --help        Print this help and exit.
  -V, --version     Print version and exit.

Environment:
  BURRETE_APP_PATH  Override the path to the Burrete app bundle (macOS) or
                    binary. Useful for development builds.
";

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, PartialEq, Eq)]
enum ParsedArgs {
    Help,
    Version,
    Open { path: Option<PathBuf> },
}

#[derive(Debug, PartialEq, Eq)]
enum ParseError {
    UnknownFlag(String),
    TooManyArgs,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownFlag(flag) => write!(f, "unknown option: {flag}"),
            Self::TooManyArgs => write!(f, "expected at most one path argument"),
        }
    }
}

fn parse_args(argv: &[OsString]) -> Result<ParsedArgs, ParseError> {
    let mut positional: Option<PathBuf> = None;
    for arg in argv.iter().skip(1) {
        if let Some(flag) = arg.to_str() {
            match flag {
                "--help" | "-h" => return Ok(ParsedArgs::Help),
                "--version" | "-V" => return Ok(ParsedArgs::Version),
                _ if flag.starts_with('-') => return Err(ParseError::UnknownFlag(flag.into())),
                _ => {}
            }
        }

        if positional.is_some() {
            return Err(ParseError::TooManyArgs);
        }
        positional = Some(PathBuf::from(arg));
    }
    Ok(ParsedArgs::Open { path: positional })
}

fn resolve_input_path(input: &Path, cwd: &Path) -> PathBuf {
    if input.is_absolute() {
        input.to_path_buf()
    } else {
        cwd.join(input)
    }
}

pub trait Launcher {
    fn launch(&self, target: Option<&Path>) -> Result<(), LaunchError>;
}

#[derive(Debug)]
pub enum LaunchError {
    AppNotFound(String),
    Io(std::io::Error),
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AppNotFound(msg) => write!(f, "{msg}"),
            Self::Io(err) => write!(f, "could not launch Burrete: {err}"),
        }
    }
}

impl From<std::io::Error> for LaunchError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

pub struct SystemLauncher;

impl Launcher for SystemLauncher {
    fn launch(&self, target: Option<&Path>) -> Result<(), LaunchError> {
        launch_system(target)
    }
}

#[cfg(target_os = "macos")]
fn launch_system(target: Option<&Path>) -> Result<(), LaunchError> {
    use std::process::Command;

    let mut cmd = if let Some(override_path) = std::env::var_os("BURRETE_APP_PATH") {
        let mut command = Command::new("open");
        command.arg("-a").arg(override_path);
        command
    } else {
        let mut command = Command::new("open");
        command.arg("-a").arg("Burrete");
        command
    };

    if let Some(path) = target {
        cmd.arg(path);
    }

    let status = cmd.status()?;
    if !status.success() {
        return Err(LaunchError::AppNotFound(
            "Burrete is not installed. Install it or set BURRETE_APP_PATH.".into(),
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn launch_system(target: Option<&Path>) -> Result<(), LaunchError> {
    use std::process::Command;

    let program = std::env::var_os("BURRETE_APP_PATH").unwrap_or_else(|| "burrete".into());
    let mut cmd = Command::new(&program);
    if let Some(path) = target {
        cmd.arg(path);
    }

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(LaunchError::AppNotFound(format!(
                "could not find the Burrete binary ({}). Install Burrete or set BURRETE_APP_PATH.",
                program.to_string_lossy()
            )))
        }
        Err(err) => Err(err.into()),
    }
}

pub fn run<L: Launcher>(argv: Vec<OsString>, cwd: &Path, launcher: &L) -> ExitCode {
    match parse_args(&argv) {
        Ok(ParsedArgs::Help) => {
            println!("{USAGE}");
            ExitCode::from(EXIT_SUCCESS)
        }
        Ok(ParsedArgs::Version) => {
            println!("burrete {VERSION}");
            ExitCode::from(EXIT_SUCCESS)
        }
        Ok(ParsedArgs::Open { path }) => run_open(path, cwd, launcher),
        Err(err) => {
            fail_usage(err);
            ExitCode::from(EXIT_USAGE)
        }
    }
}

fn run_open<L: Launcher>(path: Option<PathBuf>, cwd: &Path, launcher: &L) -> ExitCode {
    let target = match path {
        None => None,
        Some(input) => {
            let resolved = resolve_input_path(&input, cwd);
            let targets = open_target::resolve_open_targets(&resolved);
            match targets.into_iter().next() {
                Some(target) => Some(target),
                None => {
                    fail_runtime(&format!(
                        "{} is not a supported Burrete file or folder",
                        resolved.display()
                    ));
                    return ExitCode::from(EXIT_RUNTIME);
                }
            }
        }
    };

    if let Err(err) = launcher.launch(target.as_deref()) {
        fail_runtime(&err);
        return ExitCode::from(EXIT_RUNTIME);
    }

    ExitCode::from(EXIT_SUCCESS)
}

fn fail_usage(err: ParseError) {
    eprintln!("burrete: {err}");
    eprintln!();
    eprint!("{USAGE}");
}

fn fail_runtime(err: &dyn std::fmt::Display) {
    eprintln!("burrete: {err}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;

    struct FakeLauncher {
        calls: RefCell<Vec<Option<PathBuf>>>,
        fail: Option<LaunchError>,
    }

    impl FakeLauncher {
        fn new() -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                fail: None,
            }
        }

        fn failing(err: LaunchError) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                fail: Some(err),
            }
        }
    }

    impl Launcher for FakeLauncher {
        fn launch(&self, target: Option<&Path>) -> Result<(), LaunchError> {
            self.calls
                .borrow_mut()
                .push(target.map(|path| path.to_path_buf()));
            match &self.fail {
                Some(LaunchError::AppNotFound(msg)) => Err(LaunchError::AppNotFound(msg.clone())),
                Some(LaunchError::Io(err)) => Err(LaunchError::Io(std::io::Error::new(
                    err.kind(),
                    err.to_string(),
                ))),
                None => Ok(()),
            }
        }
    }

    fn argv(parts: &[&str]) -> Vec<OsString> {
        parts.iter().map(OsString::from).collect()
    }

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "burrete-cli-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    #[test]
    fn parse_help_and_version_flags() {
        assert_eq!(
            parse_args(&argv(&["burrete", "--help"])).unwrap(),
            ParsedArgs::Help
        );
        assert_eq!(
            parse_args(&argv(&["burrete", "-V"])).unwrap(),
            ParsedArgs::Version
        );
    }

    #[test]
    fn parse_rejects_multiple_paths_and_unknown_flags() {
        assert!(matches!(
            parse_args(&argv(&["burrete", "a", "b"])),
            Err(ParseError::TooManyArgs)
        ));
        assert!(matches!(
            parse_args(&argv(&["burrete", "--bogus"])),
            Err(ParseError::UnknownFlag(_))
        ));
    }

    #[test]
    fn run_no_args_launches_with_none() {
        let cwd = temp_workspace("empty");
        let launcher = FakeLauncher::new();
        let code = run(argv(&["burrete"]), &cwd, &launcher);

        assert_eq!(format!("{code:?}"), format!("{:?}", ExitCode::SUCCESS));
        assert_eq!(launcher.calls.borrow().as_slice(), &[None]);
        fs::remove_dir_all(cwd).ok();
    }

    #[test]
    fn run_directory_target_passes_canonical_workspace() {
        let cwd = temp_workspace("directory");
        let workspace = cwd.join("workspace");
        fs::create_dir(&workspace).expect("create workspace");
        let launcher = FakeLauncher::new();

        let code = run(argv(&["burrete", "workspace"]), &cwd, &launcher);

        assert_eq!(format!("{code:?}"), format!("{:?}", ExitCode::SUCCESS));
        assert_eq!(
            launcher.calls.borrow()[0].as_ref().unwrap(),
            &workspace.canonicalize().unwrap()
        );
        fs::remove_dir_all(cwd).ok();
    }

    #[test]
    fn run_structure_file_target_passes_canonical_file() {
        let cwd = temp_workspace("file");
        let file = cwd.join("mini.pdb");
        fs::write(&file, b"HEADER\n").expect("write pdb");
        let launcher = FakeLauncher::new();

        let code = run(argv(&["burrete", "mini.pdb"]), &cwd, &launcher);

        assert_eq!(format!("{code:?}"), format!("{:?}", ExitCode::SUCCESS));
        assert_eq!(
            launcher.calls.borrow()[0].as_ref().unwrap(),
            &file.canonicalize().unwrap()
        );
        fs::remove_dir_all(cwd).ok();
    }

    #[test]
    fn run_unsupported_file_is_runtime_error_without_launch() {
        let cwd = temp_workspace("unsupported");
        fs::write(cwd.join("notes.txt"), b"ignore").expect("write txt");
        let launcher = FakeLauncher::new();

        let code = run(argv(&["burrete", "notes.txt"]), &cwd, &launcher);

        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_RUNTIME))
        );
        assert!(launcher.calls.borrow().is_empty());
        fs::remove_dir_all(cwd).ok();
    }

    #[test]
    fn run_propagates_launcher_failure_as_runtime_error() {
        let cwd = temp_workspace("failure");
        let launcher = FakeLauncher::failing(LaunchError::AppNotFound("nope".into()));

        let code = run(argv(&["burrete"]), &cwd, &launcher);

        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_RUNTIME))
        );
        fs::remove_dir_all(cwd).ok();
    }
}
