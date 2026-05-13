use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

const APP_ID: &str = "com.local.BurreteV10";
const EXTENSION_ID: &str = "com.local.BurreteV10.Preview";
const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/SergeiNikolenko/Burrete/releases/download/";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInstallRequest {
    tag_name: String,
    asset_name: String,
    browser_download_url: String,
    size: u64,
}

#[tauri::command]
pub(crate) async fn install_update(
    app: tauri::AppHandle,
    request: UpdateInstallRequest,
) -> Result<(), String> {
    let package_version = app.package_info().version.to_string();
    let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let app_bundle = current_app_bundle()?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive = download_update(&app_data_dir, &package_version, &request)?;
        let staged_app =
            unpack_and_validate_update(&app_data_dir, &archive, &package_version, &request)?;
        launch_installer(&app_data_dir, &staged_app, &app_bundle, &request.tag_name)
    })
    .await
    .map_err(|err| err.to_string())??;

    app.exit(0);
    Ok(())
}

fn download_update(
    app_data_dir: &Path,
    package_version: &str,
    request: &UpdateInstallRequest,
) -> Result<PathBuf, String> {
    validate_request(request)?;
    let updates_dir = update_dir(app_data_dir, &request.tag_name)?;
    let archive = updates_dir.join(safe_path_component(&request.asset_name));
    let temporary = updates_dir.join(format!(
        "{}.download",
        safe_path_component(&request.asset_name)
    ));
    remove_path_if_exists(&temporary)?;
    remove_path_if_exists(&archive)?;

    let status = Command::new("/usr/bin/curl")
        .args(["--fail", "--location", "--silent", "--show-error"])
        .args([
            "--header",
            &format!("User-Agent: Burrete/{package_version}"),
        ])
        .arg("--output")
        .arg(&temporary)
        .arg(&request.browser_download_url)
        .status()
        .map_err(|err| format!("Could not start curl: {err}"))?;
    if !status.success() {
        return Err(format!("curl failed with status {status}."));
    }

    let downloaded_size = fs::metadata(&temporary)
        .map_err(|err| err.to_string())?
        .len();
    if downloaded_size != request.size {
        remove_path_if_exists(&temporary)?;
        return Err(format!(
            "Downloaded update archive size mismatch: expected {} bytes, got {} bytes.",
            request.size, downloaded_size
        ));
    }

    fs::rename(&temporary, &archive).map_err(|err| err.to_string())?;
    Ok(archive)
}

fn unpack_and_validate_update(
    app_data_dir: &Path,
    archive: &Path,
    current_version: &str,
    request: &UpdateInstallRequest,
) -> Result<PathBuf, String> {
    let updates_dir = update_dir(app_data_dir, &request.tag_name)?;
    let staging_dir = updates_dir.join(format!("Install-{}", safe_path_component(&uuid())));
    fs::create_dir_all(&staging_dir).map_err(|err| err.to_string())?;

    run_status(
        "/usr/bin/ditto",
        &["-x", "-k", path_str(archive)?, path_str(&staging_dir)?],
    )?;

    let app = find_downloaded_app(&staging_dir)?;
    validate_downloaded_app(&app, current_version, &request.tag_name)?;
    Ok(app)
}

fn validate_request(request: &UpdateInstallRequest) -> Result<(), String> {
    if !request
        .browser_download_url
        .starts_with(RELEASE_DOWNLOAD_PREFIX)
    {
        return Err("Only Burette GitHub release assets can be installed.".into());
    }
    if !request.asset_name.to_lowercase().ends_with(".zip") {
        return Err("Automatic installation supports zipped Burette app archives only.".into());
    }
    if request.size == 0 {
        return Err("Release asset reports zero bytes.".into());
    }
    Ok(())
}

fn find_downloaded_app(directory: &Path) -> Result<PathBuf, String> {
    let mut stack = vec![directory.to_path_buf()];
    while let Some(path) = stack.pop() {
        for entry in fs::read_dir(&path).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if path.extension().is_some_and(|extension| extension == "app")
                && read_plist_value(&path.join("Contents/Info.plist"), "CFBundleIdentifier")
                    .as_deref()
                    == Ok(APP_ID)
            {
                return Ok(path);
            }
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    Err("The update archive does not contain Burrete.app.".into())
}

fn validate_downloaded_app(
    app: &Path,
    current_version: &str,
    release_tag: &str,
) -> Result<(), String> {
    let info_plist = app.join("Contents/Info.plist");
    let bundle_id = read_plist_value(&info_plist, "CFBundleIdentifier")?;
    if bundle_id != APP_ID {
        return Err("The archive does not contain com.local.BurreteV10.".into());
    }

    let downloaded_version = read_plist_value(&info_plist, "CFBundleShortVersionString")?;
    if compare_versions(&downloaded_version, current_version) <= 0 {
        return Err(format!(
            "Downloaded version {downloaded_version} is not newer than {current_version}."
        ));
    }
    let release_version = release_tag.trim_start_matches('v');
    if compare_versions(&downloaded_version, release_version) != 0 {
        return Err(format!(
            "Downloaded version {downloaded_version} does not match release {release_tag}."
        ));
    }

    let executable = app.join("Contents/MacOS/burrete");
    if !executable.is_file() {
        return Err("The downloaded app executable is missing.".into());
    }

    validate_downloaded_app_signature(app)
}

fn validate_downloaded_app_signature(app: &Path) -> Result<(), String> {
    run_status(
        "/usr/bin/codesign",
        &["--verify", "--deep", "--strict", path_str(app)?],
    )?;

    let current_signature = code_signature_descriptor(&current_app_bundle()?)?;
    let downloaded_signature = code_signature_descriptor(app)?;
    if downloaded_signature.identifier.as_deref() != Some(APP_ID) {
        return Err("Downloaded app signature identifier is invalid.".into());
    }
    if let Some(current_team) = current_signature.team_identifier {
        if downloaded_signature.team_identifier.as_deref() != Some(current_team.as_str()) {
            return Err("Downloaded app TeamIdentifier does not match the installed app.".into());
        }
        if downloaded_signature.is_ad_hoc {
            return Err(
                "Downloaded app is ad-hoc signed while installed app uses a developer signature."
                    .into(),
            );
        }
    }
    Ok(())
}

fn launch_installer(
    app_data_dir: &Path,
    staged_app: &Path,
    destination_app: &Path,
    release_tag: &str,
) -> Result<(), String> {
    let updates_dir = update_dir(app_data_dir, release_tag)?;
    let script = updates_dir.join(format!("install-{}.sh", safe_path_component(release_tag)));
    let log = updates_dir.join(format!("install-{}.log", safe_path_component(release_tag)));
    let body = installer_script(std::process::id(), staged_app, destination_app, &log)?;
    fs::write(&script, body).map_err(|err| err.to_string())?;
    let mut permissions = fs::metadata(&script)
        .map_err(|err| err.to_string())?
        .permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    fs::set_permissions(&script, permissions).map_err(|err| err.to_string())?;

    Command::new("/bin/bash")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Could not launch the updater helper: {err}"))?;
    Ok(())
}

fn installer_script(
    app_pid: u32,
    staged_app: &Path,
    destination_app: &Path,
    log: &Path,
) -> Result<String, String> {
    Ok(format!(
        r#"#!/bin/bash
set -euo pipefail

APP_PID={app_pid}
NEW_APP={new_app}
DEST_APP={destination_app}
APP_ID='{APP_ID}'
EXT_ID='{EXTENSION_ID}'
LOG_FILE={log}

mkdir -p "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1
echo "== Burrete updater $(date) =="
echo "new app: $NEW_APP"
echo "destination: $DEST_APP"

for _ in $(seq 1 80); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "error: Burrete did not quit in time"
  exit 1
fi

clean_detritus() {{
  local path="$1"
  [ -e "$path" ] || return 0
  /usr/bin/xattr -cr "$path" 2>/dev/null || true
  /usr/bin/dot_clean -m "$path" 2>/dev/null || true
  /usr/bin/find "$path" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
}}

PARENT_DIR="$(dirname "$DEST_APP")"
TMP_APP="${{DEST_APP}}.updating"
BACKUP_APP="${{DEST_APP}}.previous"
mkdir -p "$PARENT_DIR"
rm -rf "$TMP_APP"
/bin/cp -R "$NEW_APP" "$TMP_APP"
clean_detritus "$TMP_APP"

ACTUAL_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TMP_APP/Contents/Info.plist")"
if [ "$ACTUAL_ID" != "$APP_ID" ]; then
  echo "error: bundle id mismatch: $ACTUAL_ID"
  rm -rf "$TMP_APP"
  exit 1
fi

rm -rf "$BACKUP_APP"
if [ -d "$DEST_APP" ]; then
  /bin/mv "$DEST_APP" "$BACKUP_APP"
fi
if ! /bin/mv "$TMP_APP" "$DEST_APP"; then
  if [ -d "$BACKUP_APP" ]; then
    /bin/mv "$BACKUP_APP" "$DEST_APP"
  fi
  exit 1
fi
rm -rf "$BACKUP_APP"

APPEX="$DEST_APP/Contents/PlugIns/BurretePreview.appex"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f -R "$DEST_APP" || true
[ -d "$APPEX" ] && /usr/bin/pluginkit -a "$APPEX" 2>/dev/null || true
/usr/bin/pluginkit -e use -i "$EXT_ID" 2>/dev/null || true
/usr/bin/qlmanage -r >/dev/null 2>&1 || true
/usr/bin/qlmanage -r cache >/dev/null 2>&1 || true
/usr/bin/killall quicklookd >/dev/null 2>&1 || true
/usr/bin/open "$DEST_APP"
echo "update installed"
"#,
        new_app = shell_quote(path_str(staged_app)?),
        destination_app = shell_quote(path_str(destination_app)?),
        log = shell_quote(path_str(log)?),
    ))
}

fn current_app_bundle() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|err| err.to_string())?;
    let macos_dir = executable
        .parent()
        .ok_or_else(|| "Could not resolve app executable directory.".to_string())?;
    let contents_dir = macos_dir
        .parent()
        .ok_or_else(|| "Could not resolve app Contents directory.".to_string())?;
    let app = contents_dir
        .parent()
        .ok_or_else(|| "Could not resolve app bundle directory.".to_string())?;
    Ok(app.to_path_buf())
}

fn update_dir(app_data_dir: &Path, release_tag: &str) -> Result<PathBuf, String> {
    let directory = app_data_dir
        .join("Updates")
        .join(safe_path_component(release_tag));
    fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    Ok(directory)
}

fn read_plist_value(plist: &Path, key: &str) -> Result<String, String> {
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", &format!("Print :{key}")])
        .arg(plist)
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(format!("Could not read {key} from {}.", plist.display()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn code_signature_descriptor(app: &Path) -> Result<CodeSignatureDescriptor, String> {
    let output = Command::new("/usr/bin/codesign")
        .args(["-dv", "--verbose=4"])
        .arg(app)
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(format!("codesign failed for {}.", app.display()));
    }
    let text = String::from_utf8_lossy(&output.stderr);
    let mut identifier = None;
    let mut team_identifier = None;
    let mut is_ad_hoc = false;
    for line in text.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("Identifier=") {
            identifier = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("TeamIdentifier=") {
            if !value.is_empty() && value != "not set" {
                team_identifier = Some(value.to_string());
            }
        } else if line == "Signature=adhoc" || line.contains("(adhoc") {
            is_ad_hoc = true;
        }
    }
    Ok(CodeSignatureDescriptor {
        identifier,
        team_identifier,
        is_ad_hoc,
    })
}

struct CodeSignatureDescriptor {
    identifier: Option<String>,
    team_identifier: Option<String>,
    is_ad_hoc: bool,
}

fn run_status(executable: &str, arguments: &[&str]) -> Result<(), String> {
    let status = Command::new(executable)
        .args(arguments)
        .status()
        .map_err(|err| format!("Could not start {executable}: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{executable} exited with status {status}."))
    }
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            fs::remove_dir_all(path).map_err(|err| err.to_string())
        }
        Ok(_) => fs::remove_file(path).map_err(|err| err.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn path_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| format!("Path is not valid UTF-8: {}", path.display()))
}

fn safe_path_component(value: &str) -> String {
    let safe: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = safe.trim_matches(['.', '-']);
    if trimmed.is_empty() {
        "release".to_string()
    } else {
        trimmed.to_string()
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn compare_versions(left: &str, right: &str) -> i8 {
    let left_parts = version_parts(left);
    let right_parts = version_parts(right);
    let count = left_parts.len().max(right_parts.len());
    for index in 0..count {
        let left = left_parts.get(index).copied().unwrap_or(0);
        let right = right_parts.get(index).copied().unwrap_or(0);
        if left != right {
            return if left > right { 1 } else { -1 };
        }
    }
    0
}

fn version_parts(value: &str) -> Vec<u64> {
    value
        .trim()
        .trim_start_matches('v')
        .split(['-', '+'])
        .next()
        .unwrap_or(value)
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}
