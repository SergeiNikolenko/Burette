use std::path::PathBuf;
use tauri::{Emitter, Runtime};
use url::Url;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LaunchMode {
    Normal,
    Register,
}

impl LaunchMode {
    pub(crate) fn current(argv: &[String]) -> Self {
        launch_mode_from_argv(argv)
            .or_else(|| {
                launch_mode_from_value(std::env::var("BURRETE_LAUNCH_MODE").ok().as_deref())
            })
            .unwrap_or(Self::Normal)
    }

    pub(crate) fn is_register(self) -> bool {
        self == Self::Register
    }
}

pub(crate) fn file_args_from_argv(argv: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
    let mut args = argv.into_iter().skip(1);
    let mut paths = Vec::new();
    while let Some(arg) = args.next() {
        if arg == "--burrete-launch-mode" {
            let _ = args.next();
            continue;
        }
        if arg.starts_with("--burrete-launch-mode=") {
            continue;
        }
        if let Some(path) = file_arg_to_path(&arg, cwd.as_ref())
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string())
        {
            paths.push(path);
        }
    }
    paths
}

fn file_arg_to_path(arg: &str, cwd: Option<&PathBuf>) -> Option<PathBuf> {
    if let Ok(url) = Url::parse(arg) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
    }

    let candidate = PathBuf::from(arg);
    Some(if candidate.is_absolute() {
        candidate
    } else {
        cwd?.join(candidate)
    })
}

fn launch_mode_from_argv(argv: &[String]) -> Option<LaunchMode> {
    let mut args = argv.iter().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--burrete-launch-mode=") {
            if let Some(mode) = launch_mode_from_value(Some(value)) {
                return Some(mode);
            }
            continue;
        }
        if arg == "--burrete-launch-mode" {
            if let Some(mode) = launch_mode_from_value(args.next().map(String::as_str)) {
                return Some(mode);
            }
        }
    }
    None
}

fn launch_mode_from_value(value: Option<&str>) -> Option<LaunchMode> {
    match value?.trim().to_ascii_lowercase().as_str() {
        "normal" => Some(LaunchMode::Normal),
        "register" => Some(LaunchMode::Register),
        _ => None,
    }
}

pub(crate) fn emit_open_documents<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if !paths.is_empty() {
        let _ = app.emit("open-documents", paths);
    }
}

#[cfg(test)]
mod tests {
    use super::{file_args_from_argv, LaunchMode};
    use std::fs;

    #[test]
    fn accepts_file_url_arguments() {
        let file = std::env::temp_dir().join(format!("burrete-startup-{}.pdb", std::process::id()));
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec![
            "burrete".to_string(),
            url::Url::from_file_path(&file).unwrap().to_string(),
        ];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
    }

    #[test]
    fn accepts_relative_path_arguments() {
        let dir = std::env::temp_dir().join(format!("burrete-startup-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("mini.pdb");
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec!["burrete".to_string(), "mini.pdb".to_string()];

        assert_eq!(
            file_args_from_argv(argv, Some(dir.clone())),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn accepts_directory_arguments() {
        let dir = std::env::temp_dir().join(format!("burrete-startup-dir-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        let argv = vec!["burrete".to_string(), dir.to_string_lossy().to_string()];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![dir.to_string_lossy().to_string()]
        );
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn ignores_launch_mode_arguments_when_collecting_files() {
        let dir = std::env::temp_dir().join(format!("burrete-startup-mode-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("mini.pdb");
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec![
            "burrete".to_string(),
            "--burrete-launch-mode=register".to_string(),
            file.to_string_lossy().to_string(),
            "--burrete-launch-mode".to_string(),
            "normal".to_string(),
        ];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn reads_launch_mode_from_cli() {
        let argv = vec![
            "burrete".to_string(),
            "--burrete-launch-mode=register".to_string(),
        ];

        assert_eq!(LaunchMode::current(&argv), LaunchMode::Register);
    }

    #[test]
    fn defaults_unknown_launch_mode_to_normal() {
        let argv = vec![
            "burrete".to_string(),
            "--burrete-launch-mode=unexpected".to_string(),
        ];

        assert_eq!(LaunchMode::current(&argv), LaunchMode::Normal);
    }
}
