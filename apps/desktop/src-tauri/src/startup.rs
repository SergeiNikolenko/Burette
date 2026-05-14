use std::path::PathBuf;
use tauri::{Emitter, Runtime};
use url::Url;

pub(crate) fn file_args_from_argv(argv: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
    argv.into_iter()
        .skip(1)
        .filter_map(|arg| {
            let path = file_arg_to_path(&arg, cwd.as_ref())?;
            path.is_file().then(|| path.to_string_lossy().to_string())
        })
        .collect()
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

pub(crate) fn emit_open_documents<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if !paths.is_empty() {
        let _ = app.emit("open-documents", paths);
    }
}

#[cfg(test)]
mod tests {
    use super::file_args_from_argv;
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
}
