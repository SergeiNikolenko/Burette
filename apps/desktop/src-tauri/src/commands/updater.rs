use ed25519_dalek::{Signature, Verifier, VerifyingKey};
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
    sha256_asset_name: String,
    sha256_browser_download_url: String,
    sha256_size: u64,
    manifest_asset_name: String,
    manifest_browser_download_url: String,
    manifest_size: u64,
    manifest_signature_asset_name: String,
    manifest_signature_browser_download_url: String,
    manifest_signature_size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateManifest {
    schema_version: u8,
    tag_name: String,
    version: String,
    asset_name: String,
    asset_url: String,
    asset_size: u64,
    asset_sha256: String,
    bundle_id: String,
    extension_id: String,
    minimum_system_version: String,
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
    let digest = updates_dir.join(safe_path_component(&request.sha256_asset_name));
    let manifest = updates_dir.join(safe_path_component(&request.manifest_asset_name));
    let manifest_signature =
        updates_dir.join(safe_path_component(&request.manifest_signature_asset_name));
    let temporary = updates_dir.join(format!(
        "{}.download",
        safe_path_component(&request.asset_name)
    ));
    let temporary_digest = updates_dir.join(format!(
        "{}.download",
        safe_path_component(&request.sha256_asset_name)
    ));
    let temporary_manifest = updates_dir.join(format!(
        "{}.download",
        safe_path_component(&request.manifest_asset_name)
    ));
    let temporary_manifest_signature = updates_dir.join(format!(
        "{}.download",
        safe_path_component(&request.manifest_signature_asset_name)
    ));
    remove_path_if_exists(&temporary)?;
    remove_path_if_exists(&temporary_digest)?;
    remove_path_if_exists(&temporary_manifest)?;
    remove_path_if_exists(&temporary_manifest_signature)?;
    remove_path_if_exists(&archive)?;
    remove_path_if_exists(&digest)?;
    remove_path_if_exists(&manifest)?;
    remove_path_if_exists(&manifest_signature)?;

    download_asset(package_version, &request.browser_download_url, &temporary)?;
    download_asset(
        package_version,
        &request.sha256_browser_download_url,
        &temporary_digest,
    )?;
    download_asset(
        package_version,
        &request.manifest_browser_download_url,
        &temporary_manifest,
    )?;
    download_asset(
        package_version,
        &request.manifest_signature_browser_download_url,
        &temporary_manifest_signature,
    )?;

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
    let downloaded_digest_size = fs::metadata(&temporary_digest)
        .map_err(|err| err.to_string())?
        .len();
    if downloaded_digest_size != request.sha256_size {
        remove_path_if_exists(&temporary)?;
        remove_path_if_exists(&temporary_digest)?;
        return Err(format!(
            "Downloaded update digest size mismatch: expected {} bytes, got {} bytes.",
            request.sha256_size, downloaded_digest_size
        ));
    }
    let downloaded_manifest_size = fs::metadata(&temporary_manifest)
        .map_err(|err| err.to_string())?
        .len();
    if downloaded_manifest_size != request.manifest_size {
        cleanup_downloads(&[
            &temporary,
            &temporary_digest,
            &temporary_manifest,
            &temporary_manifest_signature,
        ])?;
        return Err(format!(
            "Downloaded update manifest size mismatch: expected {} bytes, got {} bytes.",
            request.manifest_size, downloaded_manifest_size
        ));
    }
    let downloaded_signature_size = fs::metadata(&temporary_manifest_signature)
        .map_err(|err| err.to_string())?
        .len();
    if downloaded_signature_size != request.manifest_signature_size {
        cleanup_downloads(&[
            &temporary,
            &temporary_digest,
            &temporary_manifest,
            &temporary_manifest_signature,
        ])?;
        return Err(format!(
            "Downloaded update manifest signature size mismatch: expected {} bytes, got {} bytes.",
            request.manifest_signature_size, downloaded_signature_size
        ));
    }

    let manifest_bytes = fs::read(&temporary_manifest).map_err(|err| err.to_string())?;
    let manifest_signature_text =
        fs::read_to_string(&temporary_manifest_signature).map_err(|err| err.to_string())?;
    let manifest_payload = verify_update_manifest(&manifest_bytes, &manifest_signature_text)?;
    validate_update_manifest(&manifest_payload, request)?;

    let expected_sha256 = read_expected_sha256(&temporary_digest)?;
    if expected_sha256 != manifest_payload.asset_sha256 {
        cleanup_downloads(&[
            &temporary,
            &temporary_digest,
            &temporary_manifest,
            &temporary_manifest_signature,
        ])?;
        return Err("Release digest sidecar does not match the signed update manifest.".into());
    }
    let actual_sha256 = file_sha256(&temporary)?;
    if actual_sha256 != expected_sha256 {
        cleanup_downloads(&[
            &temporary,
            &temporary_digest,
            &temporary_manifest,
            &temporary_manifest_signature,
        ])?;
        return Err("Downloaded update archive SHA256 does not match release digest.".into());
    }

    fs::rename(&temporary, &archive).map_err(|err| err.to_string())?;
    fs::rename(&temporary_digest, &digest).map_err(|err| err.to_string())?;
    fs::rename(&temporary_manifest, &manifest).map_err(|err| err.to_string())?;
    fs::rename(&temporary_manifest_signature, &manifest_signature)
        .map_err(|err| err.to_string())?;
    Ok(archive)
}

fn download_asset(package_version: &str, url: &str, target: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/curl")
        .args(["--fail", "--location", "--silent", "--show-error"])
        .args([
            "--header",
            &format!("User-Agent: Burrete/{package_version}"),
        ])
        .arg("--output")
        .arg(target)
        .arg(url)
        .status()
        .map_err(|err| format!("Could not start curl: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("curl failed with status {status}."))
    }
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
    if !request
        .sha256_browser_download_url
        .starts_with(RELEASE_DOWNLOAD_PREFIX)
    {
        return Err("Only Burette GitHub release digest assets can be installed.".into());
    }
    if request.sha256_asset_name != format!("{}.sha256", request.asset_name) {
        return Err("Release digest asset must be named after the zip asset with .sha256.".into());
    }
    if !request
        .manifest_browser_download_url
        .starts_with(RELEASE_DOWNLOAD_PREFIX)
    {
        return Err("Only Burette GitHub release manifest assets can be installed.".into());
    }
    if request.manifest_asset_name != format!("{}.manifest.json", request.asset_name) {
        return Err(
            "Release manifest asset must be named after the zip asset with .manifest.json.".into(),
        );
    }
    if !request
        .manifest_signature_browser_download_url
        .starts_with(RELEASE_DOWNLOAD_PREFIX)
    {
        return Err(
            "Only Burette GitHub release manifest signature assets can be installed.".into(),
        );
    }
    if request.manifest_signature_asset_name != format!("{}.sig", request.manifest_asset_name) {
        return Err(
            "Release manifest signature asset must be named after the manifest asset with .sig."
                .into(),
        );
    }
    if request.size == 0 {
        return Err("Release asset reports zero bytes.".into());
    }
    if request.sha256_size == 0 || request.sha256_size > 4096 {
        return Err("Release digest asset size is invalid.".into());
    }
    if request.manifest_size == 0 || request.manifest_size > 16384 {
        return Err("Release manifest asset size is invalid.".into());
    }
    if request.manifest_signature_size == 0 || request.manifest_signature_size > 512 {
        return Err("Release manifest signature asset size is invalid.".into());
    }
    Ok(())
}

fn verify_update_manifest(
    manifest_bytes: &[u8],
    signature_text: &str,
) -> Result<UpdateManifest, String> {
    let public_key = option_env!("BURRETE_UPDATE_MANIFEST_PUBLIC_KEY_HEX").ok_or_else(|| {
        "This Burrete build does not contain an update manifest public key.".to_string()
    })?;
    verify_update_manifest_with_key(manifest_bytes, signature_text, public_key)
}

fn verify_update_manifest_with_key(
    manifest_bytes: &[u8],
    signature_text: &str,
    public_key_hex: &str,
) -> Result<UpdateManifest, String> {
    let public_key_bytes = hex_bytes(public_key_hex)?;
    let public_key: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| "Update manifest public key must be 32 bytes.".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "Update manifest public key is invalid.".to_string())?;

    let signature_bytes = hex_bytes(signature_text)?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "Update manifest signature must be 64 bytes.".to_string())?;
    verifying_key
        .verify(manifest_bytes, &signature)
        .map_err(|_| "Update manifest signature is invalid.".to_string())?;

    serde_json::from_slice(manifest_bytes)
        .map_err(|err| format!("Update manifest JSON is invalid: {err}"))
}

fn validate_update_manifest(
    manifest: &UpdateManifest,
    request: &UpdateInstallRequest,
) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("Update manifest schema version is unsupported.".into());
    }
    if manifest.tag_name != request.tag_name {
        return Err("Update manifest tag does not match the release request.".into());
    }
    if manifest.version != request.tag_name.trim_start_matches('v') {
        return Err("Update manifest version does not match the release tag.".into());
    }
    if manifest.asset_name != request.asset_name {
        return Err("Update manifest asset name does not match the release request.".into());
    }
    if manifest.asset_url != request.browser_download_url {
        return Err("Update manifest asset URL does not match the release request.".into());
    }
    if manifest.asset_size != request.size {
        return Err("Update manifest asset size does not match the release request.".into());
    }
    if manifest.bundle_id != APP_ID {
        return Err("Update manifest bundle id is invalid.".into());
    }
    if manifest.extension_id != EXTENSION_ID {
        return Err("Update manifest extension id is invalid.".into());
    }
    if manifest.minimum_system_version.trim().is_empty() {
        return Err("Update manifest minimum system version is missing.".into());
    }
    ensure_macos_version_at_least(&manifest.minimum_system_version)?;
    if !is_sha256_hex(&manifest.asset_sha256) {
        return Err("Update manifest archive SHA256 is invalid.".into());
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
    run_status(
        "/usr/sbin/spctl",
        &["--assess", "--type", "execute", path_str(app)?],
    )?;

    let current_signature = code_signature_descriptor(&current_app_bundle()?)?;
    let downloaded_signature = code_signature_descriptor(app)?;
    if downloaded_signature.identifier.as_deref() != Some(APP_ID) {
        return Err("Downloaded app signature identifier is invalid.".into());
    }
    let Some(current_team) = current_signature.team_identifier else {
        return Err(
            "Automatic installation requires the installed app to be Developer ID signed.".into(),
        );
    };
    if downloaded_signature.team_identifier.as_deref() != Some(current_team.as_str()) {
        return Err("Downloaded app TeamIdentifier does not match the installed app.".into());
    }
    if downloaded_signature.is_ad_hoc {
        return Err("Downloaded app is ad-hoc signed.".into());
    }
    validate_downloaded_extension_signature(app, &current_team)?;
    Ok(())
}

fn validate_downloaded_extension_signature(app: &Path, expected_team: &str) -> Result<(), String> {
    let extension = app
        .join("Contents")
        .join("PlugIns")
        .join("BurretePreview.appex");
    if !extension.is_dir() {
        return Err("Downloaded app is missing the Quick Look extension.".into());
    }
    let info_plist = extension.join("Contents").join("Info.plist");
    let bundle_id = read_plist_value(&info_plist, "CFBundleIdentifier")?;
    if bundle_id != EXTENSION_ID {
        return Err("Downloaded Quick Look extension bundle identifier is invalid.".into());
    }
    run_status(
        "/usr/bin/codesign",
        &["--verify", "--deep", "--strict", path_str(&extension)?],
    )?;
    let signature = code_signature_descriptor(&extension)?;
    if signature.identifier.as_deref() != Some(EXTENSION_ID) {
        return Err("Downloaded Quick Look extension signature identifier is invalid.".into());
    }
    if signature.team_identifier.as_deref() != Some(expected_team) || signature.is_ad_hoc {
        return Err("Downloaded Quick Look extension signature does not match the app.".into());
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

fn cleanup_downloads(paths: &[&Path]) -> Result<(), String> {
    for path in paths {
        remove_path_if_exists(path)?;
    }
    Ok(())
}

fn read_expected_sha256(path: &Path) -> Result<String, String> {
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let digest = text
        .split_whitespace()
        .next()
        .ok_or_else(|| "Release digest asset is empty.".to_string())?
        .to_ascii_lowercase();
    if !is_sha256_hex(&digest) {
        return Err("Release digest asset does not start with a SHA256 hex digest.".into());
    }
    Ok(digest)
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let output = Command::new("/usr/bin/shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .map_err(|err| format!("Could not start shasum: {err}"))?;
    if !output.status.success() {
        return Err(format!("shasum failed for {}.", path.display()));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let digest = text
        .split_whitespace()
        .next()
        .ok_or_else(|| format!("shasum did not report a digest for {}.", path.display()))?
        .to_ascii_lowercase();
    if !is_sha256_hex(&digest) {
        return Err(format!(
            "shasum reported an invalid digest for {}.",
            path.display()
        ));
    }
    Ok(digest)
}

fn ensure_macos_version_at_least(minimum: &str) -> Result<(), String> {
    let output = Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .map_err(|err| format!("Could not determine macOS version: {err}"))?;
    if !output.status.success() {
        return Err("Could not determine macOS version.".into());
    }
    let current = String::from_utf8_lossy(&output.stdout);
    if compare_versions(current.trim(), minimum) < 0 {
        return Err(format!(
            "This update requires macOS {minimum} or newer; this Mac is running {}.",
            current.trim()
        ));
    }
    Ok(())
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn hex_bytes(value: &str) -> Result<Vec<u8>, String> {
    let normalized: String = value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if normalized.len() % 2 != 0 {
        return Err("Hex value has odd length.".into());
    }
    let mut bytes = Vec::with_capacity(normalized.len() / 2);
    for index in (0..normalized.len()).step_by(2) {
        let byte = u8::from_str_radix(&normalized[index..index + 2], 16)
            .map_err(|_| "Hex value contains non-hex characters.".to_string())?;
        bytes.push(byte);
    }
    Ok(bytes)
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

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PUBLIC_KEY_HEX: &str =
        "83acdae4aa36bc1749f7abfb138bd44a06eeaa6076640a9a118a00200beed26c";
    const TEST_MANIFEST: &str = r#"{
  "schemaVersion": 1,
  "tagName": "v0.10.32",
  "version": "0.10.32",
  "assetName": "Burrete-0.10.32.zip",
  "assetUrl": "https://github.com/SergeiNikolenko/Burrete/releases/download/v0.10.32/Burrete-0.10.32.zip",
  "assetSize": 12345,
  "assetSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bundleId": "com.local.BurreteV10",
  "extensionId": "com.local.BurreteV10.Preview",
  "minimumSystemVersion": "12.0"
}
"#;
    const TEST_SIGNATURE_HEX: &str = "59ff3c912e73ec4dd31cb7135cfbde9e87a052093d54d52168c312422bef645440ca148a7ac113311142465bf731a84eee67f9cbeee703937700156bd04c2d06";

    fn install_request() -> UpdateInstallRequest {
        UpdateInstallRequest {
            tag_name: "v0.10.32".to_string(),
            asset_name: "Burrete-0.10.32.zip".to_string(),
            browser_download_url: "https://github.com/SergeiNikolenko/Burrete/releases/download/v0.10.32/Burrete-0.10.32.zip".to_string(),
            size: 12345,
            sha256_asset_name: "Burrete-0.10.32.zip.sha256".to_string(),
            sha256_browser_download_url: "https://github.com/SergeiNikolenko/Burrete/releases/download/v0.10.32/Burrete-0.10.32.zip.sha256".to_string(),
            sha256_size: 80,
            manifest_asset_name: "Burrete-0.10.32.zip.manifest.json".to_string(),
            manifest_browser_download_url: "https://github.com/SergeiNikolenko/Burrete/releases/download/v0.10.32/Burrete-0.10.32.zip.manifest.json".to_string(),
            manifest_size: TEST_MANIFEST.len() as u64,
            manifest_signature_asset_name: "Burrete-0.10.32.zip.manifest.json.sig".to_string(),
            manifest_signature_browser_download_url: "https://github.com/SergeiNikolenko/Burrete/releases/download/v0.10.32/Burrete-0.10.32.zip.manifest.json.sig".to_string(),
            manifest_signature_size: TEST_SIGNATURE_HEX.len() as u64 + 1,
        }
    }

    #[test]
    fn verifies_signed_update_manifest_and_request_binding() {
        let manifest = verify_update_manifest_with_key(
            TEST_MANIFEST.as_bytes(),
            TEST_SIGNATURE_HEX,
            TEST_PUBLIC_KEY_HEX,
        )
        .expect("signed test manifest should verify");

        validate_update_manifest(&manifest, &install_request())
            .expect("manifest should match request");
    }

    #[test]
    fn rejects_tampered_update_manifest() {
        let tampered = TEST_MANIFEST.replace("12345", "12346");
        let error = verify_update_manifest_with_key(
            tampered.as_bytes(),
            TEST_SIGNATURE_HEX,
            TEST_PUBLIC_KEY_HEX,
        )
        .expect_err("tampered manifest must fail signature verification");

        assert!(error.contains("signature is invalid"));
    }

    #[test]
    fn rejects_update_manifest_request_mismatch() {
        let manifest = verify_update_manifest_with_key(
            TEST_MANIFEST.as_bytes(),
            TEST_SIGNATURE_HEX,
            TEST_PUBLIC_KEY_HEX,
        )
        .expect("signed test manifest should verify");
        let mut request = install_request();
        request.asset_name = "Other.zip".to_string();

        let error = validate_update_manifest(&manifest, &request)
            .expect_err("manifest must be bound to the selected release asset");
        assert!(error.contains("asset name"));
    }
}
