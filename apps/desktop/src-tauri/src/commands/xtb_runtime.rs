use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{Manager, Runtime};

const CONFIG_FILE: &str = "config.json";
const PIXI_MANIFEST: &str = include_str!("../../../../../config/xtb/pixi.toml");
const PIXI_LOCK: &str = include_str!("../../../../../config/xtb/pixi.lock");
static MANAGED_INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const XTB_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const MANAGED_INSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const COMMAND_CAPTURE_BYTES: usize = 2 * 1024 * 1024;
const INACTIVE_RUNTIME_RETENTION: Duration = Duration::from_secs(48 * 60 * 60);
const XTB_CONDA_SPEC: &str = "xtb=6.7.*";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum XtbRuntimeSource {
    Selected,
    Managed,
    Conda,
    Pixi,
    Homebrew,
    Path,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct XtbRuntimeResolution {
    pub(crate) executable_path: PathBuf,
    pub(crate) source: XtbRuntimeSource,
    pub(crate) selected_executable_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct XtbRuntimeConfig {
    selected_executable_path: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ManagedXtbInstaller {
    Pixi(PathBuf),
    Conda(PathBuf),
}

impl ManagedXtbInstaller {
    fn name(&self) -> &'static str {
        match self {
            Self::Pixi(_) => "pixi",
            Self::Conda(_) => "conda",
        }
    }
}

pub(crate) fn resolve<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<XtbRuntimeResolution, String> {
    let root = runtime_root(app)?;
    resolve_from_root(&root)
}

pub(crate) fn selected<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Option<PathBuf>, String> {
    Ok(read_config(&runtime_root(app)?)?.selected_executable_path)
}

pub(crate) fn select<R: Runtime>(
    app: &tauri::AppHandle<R>,
    executable_path: Option<String>,
) -> Result<(), String> {
    let _guard = MANAGED_INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "The xTB runtime lock is unavailable.".to_string())?;
    let root = runtime_root(app)?;
    let selected = executable_path
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| !path.as_os_str().is_empty());
    if let Some(path) = selected.as_deref() {
        validate_xtb(path)?;
    }
    write_config(
        &root,
        &XtbRuntimeConfig {
            selected_executable_path: selected,
        },
    )?;
    Ok(())
}

pub(crate) fn install_managed<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<XtbRuntimeResolution, String> {
    let _guard = MANAGED_INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "The xTB installer lock is unavailable.".to_string())?;
    let root = runtime_root(app)?;
    cleanup_inactive_managed_runtimes(&root);
    let config_before = read_config(&root)?;
    let managed = root.join("current/.pixi/envs/default/bin/xtb");
    if validate_xtb(&managed).is_ok() {
        clear_selection_if_unchanged(&root, &config_before)?;
        return resolve_from_root(&root);
    }
    let installer = resolve_managed_installer().ok_or_else(|| {
        "Managed xTB installation requires Pixi or Conda. Install either package manager, or choose an existing xTB executable in Settings.".to_string()
    })?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create {}: {error}", root.display()))?;
    let staging = root.join(format!("staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging)
        .map_err(|error| format!("Could not create {}: {error}", staging.display()))?;
    let install_result = install_into_staging(&installer, &staging)
        .and_then(|_| promote_staged_runtime(&root, &staging));
    if install_result.is_err() {
        fs::remove_dir_all(&staging).ok();
    }
    install_result?;
    clear_selection_if_unchanged(&root, &config_before)?;
    resolve_from_root(&root)
}

pub(crate) fn managed_installer_name() -> Option<String> {
    resolve_managed_installer().map(|installer| installer.name().to_string())
}

fn clear_selection_if_unchanged(
    root: &Path,
    config_before: &XtbRuntimeConfig,
) -> Result<(), String> {
    if read_config(root)? == *config_before {
        write_config(root, &XtbRuntimeConfig::default())?;
    }
    Ok(())
}

fn cleanup_inactive_managed_runtimes(root: &Path) {
    let active = fs::canonicalize(root.join("current")).ok();
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("staging-") && !name.starts_with("legacy-") {
            continue;
        }
        let path = entry.path();
        if active.as_ref() == fs::canonicalize(&path).ok().as_ref() {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= INACTIVE_RUNTIME_RETENTION);
        if old_enough {
            fs::remove_dir_all(path).ok();
        }
    }
}

fn runtime_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("runtimes/xtb"))
        .map_err(|error| format!("Could not locate the Burrete app-data directory: {error}"))
}

fn resolve_from_root(root: &Path) -> Result<XtbRuntimeResolution, String> {
    let config = read_config(root)?;
    if let Some(selected) = config.selected_executable_path {
        validate_xtb(&selected).map_err(|error| {
            format!(
                "The selected xTB executable is unavailable: {error} Choose another executable in Settings or use automatic discovery."
            )
        })?;
        return Ok(XtbRuntimeResolution {
            executable_path: selected.clone(),
            source: XtbRuntimeSource::Selected,
            selected_executable_path: Some(selected),
        });
    }

    if let Some(resolution) = resolve_automatic_candidates(automatic_candidates(root))? {
        return Ok(resolution);
    }

    Err("xTB was not found. Choose an existing xTB executable in Settings or install a Burrete-managed copy.".into())
}

fn resolve_automatic_candidates(
    candidates: Vec<(PathBuf, XtbRuntimeSource)>,
) -> Result<Option<XtbRuntimeResolution>, String> {
    let mut rejected_candidates = Vec::new();
    for (path, source) in candidates {
        match validate_xtb(&path) {
            Ok(_) => {
                return Ok(Some(XtbRuntimeResolution {
                    executable_path: fs::canonicalize(&path).unwrap_or(path),
                    source,
                    selected_executable_path: None,
                }));
            }
            Err(error) if path.exists() => {
                rejected_candidates.push(format!("{}: {error}", path.display()));
            }
            Err(_) => {}
        }
    }

    if !rejected_candidates.is_empty() {
        return Err(format!(
            "Found xTB candidates but could not validate them: {}",
            rejected_candidates
                .into_iter()
                .take(6)
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }

    Ok(None)
}

fn automatic_candidates(root: &Path) -> Vec<(PathBuf, XtbRuntimeSource)> {
    let mut candidates = vec![(
        root.join("current/.pixi/envs/default/bin/xtb"),
        XtbRuntimeSource::Managed,
    )];
    if let Some(prefix) = std::env::var_os("CONDA_PREFIX") {
        candidates.push((
            PathBuf::from(prefix).join("bin/xtb"),
            XtbRuntimeSource::Conda,
        ));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for directory in ["miniconda3", "miniforge3", "mambaforge", "anaconda3"] {
            candidates.push((
                home.join(directory).join("bin/xtb"),
                XtbRuntimeSource::Conda,
            ));
        }
        candidates.extend(conda_environment_candidates(&home));
        candidates.extend(registered_conda_environment_candidates(&home));
        candidates.push((home.join(".pixi/bin/xtb"), XtbRuntimeSource::Pixi));
        candidates.push((home.join(".local/bin/xtb"), XtbRuntimeSource::Path));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .map(|directory| (directory.join("xtb"), XtbRuntimeSource::Path)),
        );
    }
    candidates.push((
        PathBuf::from("/opt/homebrew/bin/xtb"),
        XtbRuntimeSource::Homebrew,
    ));
    candidates.push((
        PathBuf::from("/usr/local/bin/xtb"),
        XtbRuntimeSource::Homebrew,
    ));
    let mut seen = HashSet::new();
    candidates.retain(|(path, _)| seen.insert(path.clone()));
    candidates
}

fn conda_environment_candidates(home: &Path) -> Vec<(PathBuf, XtbRuntimeSource)> {
    let mut candidates = Vec::new();
    let roots = [
        home.join("miniconda3").join("envs"),
        home.join("miniforge3").join("envs"),
        home.join("mambaforge").join("envs"),
        home.join("anaconda3").join("envs"),
        home.join(".conda").join("envs"),
    ];
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        candidates.extend(entries.flatten().filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| (entry.path().join("bin/xtb"), XtbRuntimeSource::Conda))
        }));
    }
    candidates
}

fn registered_conda_environment_candidates(home: &Path) -> Vec<(PathBuf, XtbRuntimeSource)> {
    const REGISTRY_MAX_BYTES: u64 = 256 * 1024;
    const REGISTRY_MAX_ENTRIES: usize = 256;
    let registry = home.join(".conda/environments.txt");
    let Ok(file) = fs::File::open(registry) else {
        return Vec::new();
    };
    let mut text = String::new();
    if file
        .take(REGISTRY_MAX_BYTES)
        .read_to_string(&mut text)
        .is_err()
    {
        return Vec::new();
    }
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(REGISTRY_MAX_ENTRIES)
        .map(PathBuf::from)
        .filter(|prefix| prefix.is_absolute())
        .map(|prefix| (prefix.join("bin/xtb"), XtbRuntimeSource::Conda))
        .collect()
}

fn resolve_pixi() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".pixi/bin/pixi"));
        candidates.push(home.join(".local/bin/pixi"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|directory| directory.join("pixi")));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/pixi"),
        PathBuf::from("/usr/local/bin/pixi"),
    ]);
    first_absolute_executable(candidates)
}

fn resolve_conda() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(conda_exe) = std::env::var_os("CONDA_EXE") {
        candidates.push(PathBuf::from(conda_exe));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for directory in ["miniconda3", "miniforge3", "mambaforge", "anaconda3"] {
            candidates.push(home.join(directory).join("bin/conda"));
            candidates.push(home.join(directory).join("bin/mamba"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            candidates.push(directory.join("conda"));
            candidates.push(directory.join("mamba"));
        }
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/conda"),
        PathBuf::from("/opt/homebrew/bin/mamba"),
        PathBuf::from("/usr/local/bin/conda"),
        PathBuf::from("/usr/local/bin/mamba"),
    ]);
    first_absolute_executable(candidates)
}

fn first_absolute_executable(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|path| path.is_absolute() && is_executable_file(path))
}

fn resolve_managed_installer() -> Option<ManagedXtbInstaller> {
    resolve_pixi()
        .map(ManagedXtbInstaller::Pixi)
        .or_else(|| resolve_conda().map(ManagedXtbInstaller::Conda))
}

fn install_into_staging(installer: &ManagedXtbInstaller, staging: &Path) -> Result<(), String> {
    match installer {
        ManagedXtbInstaller::Pixi(pixi) => install_with_pixi(pixi, staging),
        ManagedXtbInstaller::Conda(conda) => install_with_conda(conda, staging),
    }
}

fn install_with_pixi(pixi: &Path, staging: &Path) -> Result<(), String> {
    let manifest = staging.join("pixi.toml");
    fs::write(&manifest, PIXI_MANIFEST)
        .map_err(|error| format!("Could not write {}: {error}", manifest.display()))?;
    fs::write(staging.join("pixi.lock"), PIXI_LOCK)
        .map_err(|error| format!("Could not write the xTB Pixi lockfile: {error}"))?;
    let mut command = Command::new(pixi);
    command
        .args(["install", "--locked", "--manifest-path"])
        .arg(&manifest);
    let (status, stdout, stderr) = run_bounded_command(
        command,
        MANAGED_INSTALL_TIMEOUT,
        COMMAND_CAPTURE_BYTES,
        "Pixi",
    )?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        let stdout = String::from_utf8_lossy(&stdout);
        return Err(format!(
            "Managed xTB installation failed: {}",
            truncate_output(&format!("{stderr}\n{stdout}"), 1200)
        ));
    }
    let executable = staging.join(".pixi/envs/default/bin/xtb");
    validate_xtb(&executable).map_err(|error| {
        format!("Pixi completed, but the managed xTB runtime failed validation: {error}")
    })?;
    Ok(())
}

fn install_with_conda(conda: &Path, staging: &Path) -> Result<(), String> {
    let environment = staging.join(".pixi/envs/default");
    fs::create_dir_all(
        environment
            .parent()
            .ok_or_else(|| "The managed xTB environment has no parent directory.".to_string())?,
    )
    .map_err(|error| format!("Could not create the managed xTB environment directory: {error}"))?;
    let mut command = Command::new(conda);
    command
        .args([
            "create",
            "--yes",
            "--no-default-packages",
            "--override-channels",
        ])
        .args(["--channel", "conda-forge", "--prefix"])
        .arg(&environment)
        .arg(XTB_CONDA_SPEC);
    let (status, stdout, stderr) = run_bounded_command(
        command,
        MANAGED_INSTALL_TIMEOUT,
        COMMAND_CAPTURE_BYTES,
        "Conda",
    )?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        let stdout = String::from_utf8_lossy(&stdout);
        return Err(format!(
            "Managed xTB installation failed: {}",
            truncate_output(&format!("{stderr}\n{stdout}"), 1200)
        ));
    }
    let executable = environment.join("bin/xtb");
    validate_xtb(&executable).map_err(|error| {
        format!("Conda completed, but the managed xTB runtime failed validation: {error}")
    })?;
    Ok(())
}

fn promote_staged_runtime(root: &Path, staging: &Path) -> Result<(), String> {
    let current = root.join("current");
    let next = root.join("current.next");
    let target = staging
        .file_name()
        .ok_or_else(|| "The staged xTB runtime has no directory name.".to_string())?;
    fs::remove_file(&next).ok();
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, &next)
        .map_err(|error| format!("Could not prepare the managed xTB runtime pointer: {error}"))?;
    #[cfg(not(unix))]
    return Err("Managed xTB runtime promotion is supported on Unix platforms.".into());

    let mut legacy = None;
    if current.is_dir() && !current.is_symlink() {
        let legacy_path = root.join(format!("legacy-{}", uuid::Uuid::new_v4()));
        fs::rename(&current, &legacy_path)
            .map_err(|error| format!("Could not preserve the previous xTB runtime: {error}"))?;
        legacy = Some(legacy_path);
    }
    if let Err(error) = fs::rename(&next, &current) {
        if let Some(legacy) = legacy {
            fs::rename(legacy, &current).ok();
        }
        return Err(format!(
            "Could not activate the managed xTB runtime: {error}"
        ));
    }
    Ok(())
}

fn validate_xtb(path: &Path) -> Result<String, String> {
    validate_selected(path)?;
    let mut command = Command::new(path);
    command.arg("--version");
    let (status, stdout, stderr) =
        run_bounded_command(command, XTB_PROBE_TIMEOUT, 128 * 1024, "xTB")?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
    let version = text
        .lines()
        .map(str::trim)
        .find(|line| line.to_ascii_lowercase().contains("xtb version"))
        .filter(|_| status.success())
        .ok_or_else(|| {
            format!(
                "{} did not report a valid xTB version (status: {}). Output: {}",
                path.display(),
                status,
                truncate_output(&text, 1200)
            )
        })?;
    Ok(version.to_string())
}

fn run_bounded_command(
    mut command: Command,
    timeout: Duration,
    capture_limit: usize,
    label: &str,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {label}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Could not capture {label} stdout."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Could not capture {label} stderr."))?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, capture_limit));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, capture_limit));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                child.kill().ok();
                child.wait().ok();
                return Err(format!(
                    "{label} timed out after {} seconds.",
                    timeout.as_secs()
                ));
            }
            Err(error) => return Err(format!("Could not inspect {label}: {error}")),
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| format!("Could not collect {label} stdout."))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| format!("Could not collect {label} stderr."))??;
    Ok((status, stdout, stderr))
}

fn read_bounded(mut reader: impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Ok(captured);
        }
        let remaining = limit.saturating_sub(captured.len());
        captured.extend_from_slice(&buffer[..count.min(remaining)]);
    }
}

fn truncate_output(text: &str, maximum: usize) -> String {
    if text.len() <= maximum {
        return text.trim().to_string();
    }
    let mut end = maximum;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", text[..end].trim())
}

fn read_config(root: &Path) -> Result<XtbRuntimeConfig, String> {
    let path = root.join(CONFIG_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("Could not read {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(XtbRuntimeConfig::default())
        }
        Err(error) => Err(format!("Could not read {}: {error}", path.display())),
    }
}

fn write_config(root: &Path, config: &XtbRuntimeConfig) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Could not create {}: {error}", root.display()))?;
    let path = root.join(CONFIG_FILE);
    let temporary = root.join("config.json.tmp");
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(&temporary, format!("{text}\n"))
        .map_err(|error| format!("Could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not replace {}: {error}", path.display()))
}

fn validate_selected(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("the path must be absolute.".into());
    }
    if !is_executable_file(path) {
        return Err(format!("{} is not an executable file.", path.display()));
    }
    Ok(())
}

pub(crate) fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture_root() -> PathBuf {
        std::env::temp_dir().join(format!("burrete-xtb-runtime-{}", uuid::Uuid::new_v4()))
    }

    fn make_executable(path: &Path) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, "#!/bin/sh\necho 'xTB version 6.7.1'\n").expect("write executable");
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("set permissions");
    }

    fn make_fake_conda(path: &Path) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(
            path,
            r#"#!/bin/sh
set -eu
prefix=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--prefix' ]; then
    shift
    prefix="$1"
  fi
  shift
done
test -n "$prefix"
mkdir -p "$prefix/bin"
printf '%s\n' '#!/bin/sh' "echo 'xTB version 6.7.1'" > "$prefix/bin/xtb"
chmod +x "$prefix/bin/xtb"
"#,
        )
        .expect("write fake conda");
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("set permissions");
    }

    #[test]
    fn explicit_selection_has_priority() {
        let root = fixture_root();
        let selected = root.join("chosen/xtb");
        make_executable(&selected);
        write_config(
            &root,
            &XtbRuntimeConfig {
                selected_executable_path: Some(selected.clone()),
            },
        )
        .expect("write config");

        let resolution = resolve_from_root(&root).expect("resolve selected");
        assert_eq!(resolution.executable_path, selected);
        assert_eq!(resolution.source, XtbRuntimeSource::Selected);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn invalid_explicit_selection_fails_closed() {
        let root = fixture_root();
        let managed = root.join("current/.pixi/envs/default/bin/xtb");
        make_executable(&managed);
        write_config(
            &root,
            &XtbRuntimeConfig {
                selected_executable_path: Some(root.join("missing/xtb")),
            },
        )
        .expect("write config");

        let error = resolve_from_root(&root).expect_err("invalid selection must fail");
        assert!(error.contains("selected xTB executable is unavailable"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn managed_install_does_not_overwrite_a_newer_selection() {
        let root = fixture_root();
        let original = XtbRuntimeConfig::default();
        let newer = root.join("newer/xtb");
        write_config(
            &root,
            &XtbRuntimeConfig {
                selected_executable_path: Some(newer.clone()),
            },
        )
        .expect("write newer selection");

        clear_selection_if_unchanged(&root, &original).expect("compare selection");

        assert_eq!(
            read_config(&root)
                .expect("read selection")
                .selected_executable_path,
            Some(newer)
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn managed_runtime_precedes_automatic_discovery() {
        let root = fixture_root();
        let managed = root.join("current/.pixi/envs/default/bin/xtb");
        make_executable(&managed);

        let resolution = resolve_from_root(&root).expect("resolve managed");
        assert_eq!(
            resolution.executable_path,
            fs::canonicalize(managed).expect("canonical managed executable")
        );
        assert_eq!(resolution.source, XtbRuntimeSource::Managed);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn conda_fallback_installs_into_the_managed_runtime() {
        let root = fixture_root();
        let conda = root.join("miniconda3/bin/conda");
        let staging = root.join("staging");
        make_fake_conda(&conda);
        fs::create_dir_all(&staging).expect("create staging");

        install_with_conda(&conda, &staging).expect("install managed xTB with Conda");

        assert_eq!(
            validate_xtb(&staging.join(".pixi/envs/default/bin/xtb"))
                .expect("validate managed executable"),
            "xTB version 6.7.1"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn managed_installer_candidates_must_be_absolute() {
        let root = fixture_root();
        let absolute = root.join("bin/conda");
        let mut relative = PathBuf::new();
        let current = std::env::current_dir().expect("current directory");
        for _ in current
            .components()
            .filter(|component| matches!(component, std::path::Component::Normal(_)))
        {
            relative.push("..");
        }
        relative.push("bin/sh");
        make_executable(&absolute);
        assert!(
            is_executable_file(&relative),
            "the relative candidate must resolve to an executable"
        );

        assert_eq!(
            first_absolute_executable(vec![relative, absolute.clone()]),
            Some(absolute)
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn discovers_xtb_in_named_conda_environment() {
        let home = fixture_root();
        let executable = home.join("miniconda3/envs/chem/bin/xtb");
        make_executable(&executable);

        let candidates = conda_environment_candidates(&home);

        assert!(candidates.contains(&(executable, XtbRuntimeSource::Conda)));
        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn discovers_xtb_in_registered_conda_prefix() {
        let home = fixture_root();
        let prefix = fixture_root().join("external-conda");
        fs::create_dir_all(home.join(".conda")).expect("create conda registry parent");
        fs::write(
            home.join(".conda/environments.txt"),
            format!("{}\n", prefix.display()),
        )
        .expect("write conda registry");

        let candidates = registered_conda_environment_candidates(&home);

        assert_eq!(
            candidates,
            vec![(prefix.join("bin/xtb"), XtbRuntimeSource::Conda)]
        );
        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn reports_existing_candidates_that_fail_validation() {
        let root = fixture_root();
        let executable = root.join("current/.pixi/envs/default/bin/xtb");
        fs::create_dir_all(executable.parent().expect("parent")).expect("create parent");
        fs::write(&executable, "#!/bin/sh\necho broken >&2\nexit 1\n").expect("write executable");
        let mut permissions = fs::metadata(&executable).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).expect("set permissions");

        let error =
            resolve_automatic_candidates(vec![(executable.clone(), XtbRuntimeSource::Managed)])
                .expect_err("invalid candidate must be reported");

        assert!(error.contains("Found xTB candidates but could not validate them"));
        assert!(error.contains(&executable.display().to_string()));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn promoting_staged_runtime_replaces_current_atomically() {
        let root = fixture_root();
        let current = root.join("current/.pixi/envs/default/bin/xtb");
        let staging = root.join("staging/.pixi/envs/default/bin/xtb");
        make_executable(&current);
        make_executable(&staging);
        fs::write(&staging, "new runtime").expect("update staged executable");

        promote_staged_runtime(&root, &root.join("staging")).expect("promote staged runtime");

        assert_eq!(
            fs::read_to_string(current).expect("read current"),
            "new runtime"
        );
        assert!(fs::symlink_metadata(root.join("current"))
            .expect("current metadata")
            .file_type()
            .is_symlink());
        assert!(fs::read_dir(&root)
            .expect("runtime root")
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("legacy-")));
        fs::remove_dir_all(root).ok();
    }
}
