use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

use super::update_progress;

const APP_ID: &str = "com.local.BuretteV10";
const EXTENSION_ID: &str = "com.local.BuretteV10.Preview";
const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/SergeiNikolenko/Burette/releases/download/";
const DOWNLOAD_PROGRESS_START: f64 = 0.04;
const DOWNLOAD_PROGRESS_END: f64 = 0.34;
const DOWNLOAD_PROGRESS_POLL_INTERVAL: Duration = Duration::from_millis(500);
static UPDATE_INSTALL_ACTIVE: AtomicBool = AtomicBool::new(false);

struct UpdateInstallLease;

impl UpdateInstallLease {
    fn acquire() -> Result<Self, String> {
        UPDATE_INSTALL_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "Another update installation is already in progress.".to_string())
    }
}

impl Drop for UpdateInstallLease {
    fn drop(&mut self) {
        UPDATE_INSTALL_ACTIVE.store(false, Ordering::Release);
    }
}

struct InstallerProcessGuard {
    child: Option<Child>,
}

impl InstallerProcessGuard {
    fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    fn abort(mut self) -> Result<(), String> {
        self.child
            .take()
            .map_or(Ok(()), |mut child| terminate_installer_helper(&mut child))
    }

    fn commit(mut self) {
        self.child.take();
    }
}

impl Drop for InstallerProcessGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = terminate_installer_helper(&mut child);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInstallRequest {
    tag_name: String,
    asset_name: String,
    browser_download_url: String,
    size: u64,
    sha256_asset_name: Option<String>,
    sha256_browser_download_url: Option<String>,
    sha256_size: Option<u64>,
    manifest_asset_name: Option<String>,
    manifest_browser_download_url: Option<String>,
    manifest_size: Option<u64>,
    manifest_signature_asset_name: Option<String>,
    manifest_signature_browser_download_url: Option<String>,
    manifest_signature_size: Option<u64>,
    allow_same_version: Option<bool>,
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

async fn continue_after_exit_confirmation<P, Continue, ContinueFuture, Stop>(
    decision: Result<Option<P>, String>,
    on_stop: Stop,
    proceed: Continue,
) -> Result<bool, String>
where
    Continue: FnOnce(P) -> ContinueFuture,
    ContinueFuture: Future<Output = Result<bool, String>>,
    Stop: FnOnce(),
{
    match decision {
        Ok(Some(permit)) => proceed(permit).await,
        Ok(None) => {
            on_stop();
            Ok(false)
        }
        Err(error) => {
            on_stop();
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn install_update(
    app: tauri::AppHandle,
    request: UpdateInstallRequest,
) -> Result<bool, String> {
    let _install_lease = UpdateInstallLease::acquire()?;
    let package_version = app.package_info().version.to_string();
    let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let app_bundle = current_app_bundle()?;
    let progress_app = app.clone();
    let download_app_data_dir = app_data_dir.clone();
    let release_tag = request.tag_name.clone();

    update_progress::show(&app, "Preparing update...", Some(0.04));
    let staged_result = tauri::async_runtime::spawn_blocking(move || {
        let archive = download_update(
            &progress_app,
            &download_app_data_dir,
            &package_version,
            &request,
        )?;
        let staged_app = unpack_and_validate_update(
            &progress_app,
            &download_app_data_dir,
            &archive,
            &package_version,
            &request,
        )?;
        Ok::<PathBuf, String>(staged_app)
    })
    .await;

    let staged_app = match staged_result {
        Ok(Ok(staged_app)) => staged_app,
        Ok(Err(error)) => {
            update_progress::close(&app);
            return Err(error);
        }
        Err(error) => {
            update_progress::close(&app);
            return Err(error.to_string());
        }
    };

    update_progress::show(&app, "Ready to restart...", Some(0.92));
    let mut interaction_pause = match crate::menu::ExitTransition::acquire(&app) {
        Ok(pause) => pause,
        Err(error) => {
            update_progress::close(&app);
            return Err(error);
        }
    };
    let confirmation = crate::menu::confirm_exit(
        &app,
        crate::menu::ExitIntent::RestartForUpdate,
        &mut interaction_pause,
    )
    .await;
    let stop_app = app.clone();
    continue_after_exit_confirmation(
        confirmation,
        move || update_progress::close(&stop_app),
        move |permit| async move {
            let validated_permit = match crate::menu::validate_exit_permit(&app, permit).await {
                Ok(Some(validated)) => validated,
                Ok(None) => {
                    update_progress::close(&app);
                    return Ok(false);
                }
                Err(error) => {
                    update_progress::close(&app);
                    return Err(error);
                }
            };

            update_progress::show(&app, "Preparing installer...", Some(0.96));
            let launch_result = tauri::async_runtime::spawn_blocking(move || {
                launch_installer(&app_data_dir, &staged_app, &app_bundle, &release_tag)
            })
            .await;

            match launch_result {
                Ok(Ok(helper)) => {
                    if let Err(error) = crate::menu::authorize_exit(&app, validated_permit) {
                        return finish_failed_exit_authorization(&app, helper, error);
                    }
                    helper.commit();
                    interaction_pause.keep_paused();
                    update_progress::show(&app, "Restarting Burette...", Some(1.0));
                    app.exit(0);
                    Ok(true)
                }
                Ok(Err(error)) => finish_failed_installer_launch(&app, error),
                Err(error) => finish_failed_installer_launch(&app, error.to_string()),
            }
        },
    )
    .await
}

fn finish_failed_installer_launch(
    app: &tauri::AppHandle,
    launch_error: String,
) -> Result<bool, String> {
    update_progress::close(app);
    Err(launch_error)
}

fn finish_failed_exit_authorization(
    app: &tauri::AppHandle,
    helper: InstallerProcessGuard,
    authorization_error: String,
) -> Result<bool, String> {
    let helper_cleanup = helper.abort();
    update_progress::close(app);
    match helper_cleanup {
        Ok(()) => Err(authorization_error),
        Err(cleanup_error) => Err(format!(
            "{authorization_error} Updater helper cleanup also failed: {cleanup_error}"
        )),
    }
}

fn terminate_installer_helper(helper: &mut Child) -> Result<(), String> {
    if helper
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
    {
        if let Err(kill_error) = helper.kill() {
            if helper
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Err(format!("Could not stop the updater helper: {kill_error}"));
            }
        }
    }
    helper
        .wait()
        .map(|_| ())
        .map_err(|error| format!("Could not reap the updater helper: {error}"))
}

fn download_update(
    app: &tauri::AppHandle,
    app_data_dir: &Path,
    package_version: &str,
    request: &UpdateInstallRequest,
) -> Result<PathBuf, String> {
    validate_request(request)?;
    let use_manifest = should_verify_manifest(request);
    let updates_dir = update_dir(app_data_dir, &request.tag_name)?;
    let archive = updates_dir.join(safe_path_component(&request.asset_name));
    let temporary = updates_dir.join(format!(
        "{}.download",
        safe_path_component(&request.asset_name)
    ));
    remove_path_if_exists(&temporary)?;
    remove_path_if_exists(&archive)?;

    let title = download_title(&request.tag_name);
    update_progress::show_with_detail(
        app,
        title.clone(),
        format_download_detail(0, request.size, 0.0),
        Some(DOWNLOAD_PROGRESS_START),
    );
    download_asset_with_progress(
        app,
        package_version,
        &title,
        &request.browser_download_url,
        &temporary,
        request.size,
    )?;
    update_progress::show(app, "Checking downloaded update...", Some(0.34));

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
    if request_has_digest_assets(request) {
        let digest_name = request
            .sha256_asset_name
            .as_deref()
            .expect("digest mode requires sha256 asset name");
        let digest_url = request
            .sha256_browser_download_url
            .as_deref()
            .expect("digest mode requires sha256 download url");
        let digest_size = request
            .sha256_size
            .expect("digest mode requires sha256 size");

        let digest = updates_dir.join(safe_path_component(digest_name));
        let temporary_digest =
            updates_dir.join(format!("{}.download", safe_path_component(digest_name)));
        remove_path_if_exists(&temporary_digest)?;
        remove_path_if_exists(&digest)?;

        update_progress::show(app, "Downloading update metadata...", None);
        download_asset(package_version, digest_url, &temporary_digest)?;

        update_progress::show(app, "Verifying update metadata...", Some(0.50));
        let downloaded_digest_size = fs::metadata(&temporary_digest)
            .map_err(|err| err.to_string())?
            .len();
        if downloaded_digest_size != digest_size {
            remove_path_if_exists(&temporary)?;
            remove_path_if_exists(&temporary_digest)?;
            return Err(format!(
                "Downloaded update digest size mismatch: expected {} bytes, got {} bytes.",
                digest_size, downloaded_digest_size
            ));
        }
        let expected_sha256 = read_expected_sha256(&temporary_digest)?;

        if use_manifest {
            let manifest_name = request
                .manifest_asset_name
                .as_deref()
                .expect("manifest mode requires manifest asset name");
            let manifest_url = request
                .manifest_browser_download_url
                .as_deref()
                .expect("manifest mode requires manifest download url");
            let manifest_size = request
                .manifest_size
                .expect("manifest mode requires manifest size");
            let signature_name = request
                .manifest_signature_asset_name
                .as_deref()
                .expect("manifest mode requires signature asset name");
            let signature_url = request
                .manifest_signature_browser_download_url
                .as_deref()
                .expect("manifest mode requires signature download url");
            let signature_size = request
                .manifest_signature_size
                .expect("manifest mode requires signature size");
            let manifest = updates_dir.join(safe_path_component(manifest_name));
            let manifest_signature = updates_dir.join(safe_path_component(signature_name));
            let temporary_manifest =
                updates_dir.join(format!("{}.download", safe_path_component(manifest_name)));
            let temporary_manifest_signature =
                updates_dir.join(format!("{}.download", safe_path_component(signature_name)));
            remove_path_if_exists(&temporary_manifest)?;
            remove_path_if_exists(&temporary_manifest_signature)?;
            remove_path_if_exists(&manifest)?;
            remove_path_if_exists(&manifest_signature)?;
            download_asset(package_version, manifest_url, &temporary_manifest)?;
            download_asset(
                package_version,
                signature_url,
                &temporary_manifest_signature,
            )?;
            let downloaded_manifest_size = fs::metadata(&temporary_manifest)
                .map_err(|err| err.to_string())?
                .len();
            if downloaded_manifest_size != manifest_size {
                cleanup_downloads(&[
                    &temporary,
                    &temporary_digest,
                    &temporary_manifest,
                    &temporary_manifest_signature,
                ])?;
                return Err(format!(
                    "Downloaded update manifest size mismatch: expected {} bytes, got {} bytes.",
                    manifest_size, downloaded_manifest_size
                ));
            }
            let downloaded_signature_size = fs::metadata(&temporary_manifest_signature)
                .map_err(|err| err.to_string())?
                .len();
            if downloaded_signature_size != signature_size {
                cleanup_downloads(&[
                    &temporary,
                    &temporary_digest,
                    &temporary_manifest,
                    &temporary_manifest_signature,
                ])?;
                return Err(format!(
                    "Downloaded update manifest signature size mismatch: expected {} bytes, got {} bytes.",
                    signature_size, downloaded_signature_size
                ));
            }
            let manifest_bytes = fs::read(&temporary_manifest).map_err(|err| err.to_string())?;
            let manifest_signature_text =
                fs::read_to_string(&temporary_manifest_signature).map_err(|err| err.to_string())?;
            let manifest_payload =
                verify_update_manifest(&manifest_bytes, &manifest_signature_text)?;
            validate_update_manifest(&manifest_payload, request)?;
            if expected_sha256 != manifest_payload.asset_sha256 {
                cleanup_downloads(&[
                    &temporary,
                    &temporary_digest,
                    &temporary_manifest,
                    &temporary_manifest_signature,
                ])?;
                return Err(
                    "Release digest sidecar does not match the signed update manifest.".into(),
                );
            }
            fs::rename(&temporary_manifest, &manifest).map_err(|err| err.to_string())?;
            fs::rename(&temporary_manifest_signature, &manifest_signature)
                .map_err(|err| err.to_string())?;
        }
        let actual_sha256 = file_sha256(&temporary)?;
        if actual_sha256 != expected_sha256 {
            cleanup_downloads(&[&temporary, &temporary_digest])?;
            return Err("Downloaded update archive SHA256 does not match release digest.".into());
        }

        fs::rename(&temporary_digest, &digest).map_err(|err| err.to_string())?;
    }

    fs::rename(&temporary, &archive).map_err(|err| err.to_string())?;
    update_progress::show(app, "Download complete...", Some(0.58));
    Ok(archive)
}

fn download_asset(package_version: &str, url: &str, target: &Path) -> Result<(), String> {
    let status = curl_download_command(package_version, url, target)
        .status()
        .map_err(|err| format!("Could not start curl: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("curl failed with status {status}."))
    }
}

fn download_asset_with_progress(
    app: &tauri::AppHandle,
    package_version: &str,
    title: &str,
    url: &str,
    target: &Path,
    total_size: u64,
) -> Result<(), String> {
    let mut child = curl_download_command(package_version, url, target)
        .spawn()
        .map_err(|err| format!("Could not start curl: {err}"))?;
    let started_at = Instant::now();

    loop {
        match child
            .try_wait()
            .map_err(|err| format!("Could not check curl status: {err}"))?
        {
            Some(status) => {
                show_download_progress(app, title, target, total_size, started_at);
                if status.success() {
                    return Ok(());
                }
                return Err(format!("curl failed with status {status}."));
            }
            None => {
                thread::sleep(DOWNLOAD_PROGRESS_POLL_INTERVAL);
                show_download_progress(app, title, target, total_size, started_at);
            }
        }
    }
}

fn curl_download_command(package_version: &str, url: &str, target: &Path) -> Command {
    let mut command = Command::new("/usr/bin/curl");
    command
        .args(["--fail", "--location", "--silent", "--show-error"])
        .args([
            "--connect-timeout",
            "20",
            "--speed-limit",
            "1024",
            "--speed-time",
            "60",
            "--retry",
            "2",
            "--retry-delay",
            "1",
            "--retry-all-errors",
        ])
        .arg("--header")
        .arg(format!("User-Agent: Burette/{package_version}"))
        .arg("--output")
        .arg(target)
        .arg(url);
    command
}

fn show_download_progress(
    app: &tauri::AppHandle,
    title: &str,
    target: &Path,
    total_size: u64,
    started_at: Instant,
) {
    let downloaded = fs::metadata(target)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        .min(total_size);
    let elapsed = started_at.elapsed();
    let speed = if downloaded == 0 {
        0.0
    } else {
        downloaded as f64 / elapsed.as_secs_f64().max(0.001)
    };

    update_progress::show_with_detail(
        app,
        title,
        format_download_detail(downloaded, total_size, speed),
        Some(download_progress_value(downloaded, total_size)),
    );
}

fn download_progress_value(downloaded: u64, total_size: u64) -> f64 {
    let fraction = if total_size == 0 {
        0.0
    } else {
        (downloaded as f64 / total_size as f64).clamp(0.0, 1.0)
    };
    DOWNLOAD_PROGRESS_START + (DOWNLOAD_PROGRESS_END - DOWNLOAD_PROGRESS_START) * fraction
}

fn download_title(tag_name: &str) -> String {
    format!(
        "Downloading Burette {}",
        tag_name.strip_prefix('v').unwrap_or(tag_name)
    )
}

fn format_download_detail(downloaded: u64, total_size: u64, bytes_per_second: f64) -> String {
    format!(
        "{} of {} · {}",
        format_download_size(downloaded.min(total_size)),
        format_download_size(total_size),
        format_download_speed(bytes_per_second)
    )
}

fn format_download_size(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;

    let size = bytes as f64;
    if size < KIB {
        format!("{size:.0} B")
    } else if size < MIB {
        format_download_unit(size / KIB, "KiB")
    } else if size < GIB {
        format_download_unit(size / MIB, "MiB")
    } else {
        format_download_unit(size / GIB, "GiB")
    }
}

fn format_download_speed(bytes_per_second: f64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;

    let speed = bytes_per_second.max(0.0);
    if speed < KIB {
        format!("{speed:.0} B/s")
    } else if speed < MIB {
        format_download_unit(speed / KIB, "KiB/s")
    } else if speed < GIB {
        format_download_unit(speed / MIB, "MiB/s")
    } else {
        format_download_unit(speed / GIB, "GiB/s")
    }
}

fn format_download_unit(value: f64, unit: &str) -> String {
    if value >= 10.0 {
        format!("{value:.0} {unit}")
    } else {
        format!("{value:.1} {unit}")
    }
}

fn unpack_and_validate_update(
    app: &tauri::AppHandle,
    app_data_dir: &Path,
    archive: &Path,
    current_version: &str,
    request: &UpdateInstallRequest,
) -> Result<PathBuf, String> {
    let updates_dir = update_dir(app_data_dir, &request.tag_name)?;
    let staging_dir = updates_dir.join(format!("Install-{}", safe_path_component(&uuid())));
    fs::create_dir_all(&staging_dir).map_err(|err| err.to_string())?;

    update_progress::show(app, "Extracting update...", Some(0.64));
    run_status(
        "/usr/bin/ditto",
        &["-x", "-k", path_str(archive)?, path_str(&staging_dir)?],
    )?;

    update_progress::show(app, "Validating update...", Some(0.78));
    let app = find_downloaded_app(&staging_dir)?;
    validate_downloaded_app(
        &app,
        current_version,
        &request.tag_name,
        request.allow_same_version.unwrap_or(false),
    )?;
    Ok(app)
}

fn validate_request(request: &UpdateInstallRequest) -> Result<(), String> {
    let has_digest = request_has_digest_assets(request);
    let has_partial_digest = has_partial_digest_assets(request);
    let has_manifest = request_has_manifest_assets(request);
    let has_partial_manifest = has_partial_manifest_assets(request);
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
    if has_partial_digest || has_partial_manifest {
        return Err(
            "Release integrity sidecars must be provided as a complete digest set and optional complete manifest set.".into(),
        );
    }
    if has_manifest && !has_digest {
        return Err("Release manifest sidecars require a release digest sidecar.".into());
    }
    if has_digest {
        let sha256_url = request
            .sha256_browser_download_url
            .as_deref()
            .expect("integrity validation requires sha256 url");
        let sha256_name = request
            .sha256_asset_name
            .as_deref()
            .expect("integrity validation requires sha256 asset name");
        let sha256_size = request
            .sha256_size
            .expect("integrity validation requires sha256 size");
        if !sha256_url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
            return Err("Only Burette GitHub release digest assets can be installed.".into());
        }
        if sha256_name != format!("{}.sha256", request.asset_name) {
            return Err(
                "Release digest asset must be named after the zip asset with .sha256.".into(),
            );
        }
        if sha256_size == 0 || sha256_size > 4096 {
            return Err("Release digest asset size is invalid.".into());
        }
    }
    if has_manifest {
        let manifest_url = request
            .manifest_browser_download_url
            .as_deref()
            .expect("integrity validation requires manifest url");
        let manifest_name = request
            .manifest_asset_name
            .as_deref()
            .expect("integrity validation requires manifest asset name");
        let manifest_size = request
            .manifest_size
            .expect("integrity validation requires manifest size");
        let signature_url = request
            .manifest_signature_browser_download_url
            .as_deref()
            .expect("integrity validation requires signature url");
        let signature_name = request
            .manifest_signature_asset_name
            .as_deref()
            .expect("integrity validation requires signature asset name");
        let signature_size = request
            .manifest_signature_size
            .expect("integrity validation requires signature size");

        if !manifest_url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
            return Err("Only Burette GitHub release manifest assets can be installed.".into());
        }
        if manifest_name != format!("{}.manifest.json", request.asset_name) {
            return Err(
                "Release manifest asset must be named after the zip asset with .manifest.json."
                    .into(),
            );
        }
        if !signature_url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
            return Err(
                "Only Burette GitHub release manifest signature assets can be installed.".into(),
            );
        }
        if signature_name != format!("{}.sig", manifest_name) {
            return Err(
                "Release manifest signature asset must be named after the manifest asset with .sig."
                    .into(),
            );
        }
        if manifest_size == 0 || manifest_size > 16384 {
            return Err("Release manifest asset size is invalid.".into());
        }
        if signature_size == 0 || signature_size > 512 {
            return Err("Release manifest signature asset size is invalid.".into());
        }
    }
    Ok(())
}

fn request_has_digest_assets(request: &UpdateInstallRequest) -> bool {
    [
        request.sha256_asset_name.is_some(),
        request.sha256_browser_download_url.is_some(),
        request.sha256_size.is_some(),
    ]
    .into_iter()
    .all(std::convert::identity)
}

fn has_partial_digest_assets(request: &UpdateInstallRequest) -> bool {
    let fields = [
        request.sha256_asset_name.is_some(),
        request.sha256_browser_download_url.is_some(),
        request.sha256_size.is_some(),
    ];
    fields.into_iter().any(std::convert::identity)
        && !fields.into_iter().all(std::convert::identity)
}

fn request_has_manifest_assets(request: &UpdateInstallRequest) -> bool {
    [
        request.manifest_asset_name.is_some(),
        request.manifest_browser_download_url.is_some(),
        request.manifest_size.is_some(),
        request.manifest_signature_asset_name.is_some(),
        request.manifest_signature_browser_download_url.is_some(),
        request.manifest_signature_size.is_some(),
    ]
    .into_iter()
    .all(std::convert::identity)
}

fn has_partial_manifest_assets(request: &UpdateInstallRequest) -> bool {
    let fields = [
        request.manifest_asset_name.is_some(),
        request.manifest_browser_download_url.is_some(),
        request.manifest_size.is_some(),
        request.manifest_signature_asset_name.is_some(),
        request.manifest_signature_browser_download_url.is_some(),
        request.manifest_signature_size.is_some(),
    ];
    fields.into_iter().any(std::convert::identity)
        && !fields.into_iter().all(std::convert::identity)
}

fn should_verify_manifest(request: &UpdateInstallRequest) -> bool {
    request_has_digest_assets(request)
        && request_has_manifest_assets(request)
        && manifest_public_key().is_some()
}

fn manifest_public_key() -> Option<&'static str> {
    option_env!("BURETTE_UPDATE_MANIFEST_PUBLIC_KEY_HEX").and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn verify_update_manifest(
    manifest_bytes: &[u8],
    signature_text: &str,
) -> Result<UpdateManifest, String> {
    let public_key = manifest_public_key().ok_or_else(|| {
        "This Burette build does not contain an update manifest public key.".to_string()
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
    Err("The update archive does not contain Burette.app.".into())
}

fn validate_downloaded_app(
    app: &Path,
    current_version: &str,
    release_tag: &str,
    allow_same_version: bool,
) -> Result<(), String> {
    let info_plist = app.join("Contents/Info.plist");
    let bundle_id = read_plist_value(&info_plist, "CFBundleIdentifier")?;
    if bundle_id != APP_ID {
        return Err("The archive does not contain com.local.BuretteV10.".into());
    }

    let downloaded_version = read_plist_value(&info_plist, "CFBundleShortVersionString")?;
    let current_comparison = compare_versions(&downloaded_version, current_version);
    if current_comparison < 0 || (current_comparison == 0 && !allow_same_version) {
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

    let executable = app.join("Contents/MacOS/burette");
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
    let mode = validate_downloaded_app_descriptor(&current_signature, &downloaded_signature)?;
    if matches!(mode, DownloadSignatureMode::DeveloperId { .. }) {
        run_status(
            "/usr/sbin/spctl",
            &["--assess", "--type", "execute", path_str(app)?],
        )?;
    }
    validate_downloaded_extension_signature(app, &downloaded_signature, mode)?;
    Ok(())
}

fn validate_downloaded_extension_signature(
    app: &Path,
    downloaded_app_signature: &CodeSignatureDescriptor,
    mode: DownloadSignatureMode,
) -> Result<(), String> {
    let extension = app
        .join("Contents")
        .join("PlugIns")
        .join("BurettePreview.appex");
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
    match mode {
        DownloadSignatureMode::AdHoc => {
            if signature.is_ad_hoc != downloaded_app_signature.is_ad_hoc
                || signature.team_identifier != downloaded_app_signature.team_identifier
            {
                return Err(
                    "Downloaded Quick Look extension signature does not match the app.".into(),
                );
            }
        }
        DownloadSignatureMode::DeveloperId { team_identifier } => {
            if signature.team_identifier.as_deref() != Some(team_identifier.as_str())
                || signature.is_ad_hoc
            {
                return Err(
                    "Downloaded Quick Look extension signature does not match the app.".into(),
                );
            }
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DownloadSignatureMode {
    AdHoc,
    DeveloperId { team_identifier: String },
}

fn validate_downloaded_app_descriptor(
    current_signature: &CodeSignatureDescriptor,
    downloaded_signature: &CodeSignatureDescriptor,
) -> Result<DownloadSignatureMode, String> {
    if downloaded_signature.identifier.as_deref() != Some(APP_ID) {
        return Err("Downloaded app signature identifier is invalid.".into());
    }
    if let Some(current_team) = current_signature.team_identifier.as_deref() {
        if downloaded_signature.team_identifier.as_deref() != Some(current_team) {
            return Err("Downloaded app TeamIdentifier does not match the installed app.".into());
        }
        if downloaded_signature.is_ad_hoc {
            return Err("Downloaded app is ad-hoc signed.".into());
        }
        return Ok(DownloadSignatureMode::DeveloperId {
            team_identifier: current_team.to_string(),
        });
    }
    if let Some(downloaded_team) = downloaded_signature.team_identifier.as_deref() {
        if downloaded_signature.is_ad_hoc {
            return Err("Downloaded app is ad-hoc signed.".into());
        }
        Ok(DownloadSignatureMode::DeveloperId {
            team_identifier: downloaded_team.to_string(),
        })
    } else {
        Ok(DownloadSignatureMode::AdHoc)
    }
}

fn launch_installer(
    app_data_dir: &Path,
    staged_app: &Path,
    destination_app: &Path,
    release_tag: &str,
) -> Result<InstallerProcessGuard, String> {
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
        .map(InstallerProcessGuard::new)
        .map_err(|err| format!("Could not launch the updater helper: {err}"))
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
echo "== Burette updater $(date) =="
echo "new app: $NEW_APP"
echo "destination: $DEST_APP"

for _ in $(seq 1 80); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "error: Burette did not quit in time"
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

APPEX="$DEST_APP/Contents/PlugIns/BurettePreview.appex"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f -R "$DEST_APP" || true
if [ -x /usr/bin/swift ]; then
  BURETTE_APP_PATH="$DEST_APP" BURETTE_APP_ID="$APP_ID" /usr/bin/swift - <<'SWIFT' >/dev/null 2>&1 || true
import CoreServices
import Foundation

let appPath = ProcessInfo.processInfo.environment["BURETTE_APP_PATH"] ?? ""
let bundleID = (ProcessInfo.processInfo.environment["BURETTE_APP_ID"] ?? "com.local.BuretteV10") as CFString
let appURL = URL(fileURLWithPath: appPath)
LSRegisterURL(appURL as CFURL, true)
let bundle = Bundle(url: appURL)
let documentTypes = bundle?.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]] ?? []
let contentTypes = Set(documentTypes.flatMap {{ $0["LSItemContentTypes"] as? [String] ?? [] }})
for contentType in contentTypes {{
    LSSetDefaultRoleHandlerForContentType(contentType as CFString, .viewer, bundleID)
}}
SWIFT
fi
[ -d "$APPEX" ] && /usr/bin/pluginkit -a "$APPEX" 2>/dev/null || true
/usr/bin/pluginkit -e use -i "$EXT_ID" 2>/dev/null || true
/usr/bin/qlmanage -r >/dev/null 2>&1 || true
/usr/bin/qlmanage -r cache >/dev/null 2>&1 || true
/usr/bin/killall quicklookd >/dev/null 2>&1 || true
/usr/bin/killall Finder >/dev/null 2>&1 || true
sync_burette_codex_plugin() {{
  local plugin_src="$DEST_APP/Contents/Resources/plugins/burette-agent"
  if [ ! -f "$plugin_src/.codex-plugin/plugin.json" ]; then
    echo "codex plugin sync skipped: bundled plugin not found"
    return 0
  fi
  if [ -z "${{HOME:-}}" ]; then
    echo "codex plugin sync skipped: HOME is not set"
    return 0
  fi
  local plugin_installer="$plugin_src/scripts/install-local.mjs"
  local javascript_bin
  javascript_bin="$(PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v node || PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v bun || true)"
  if [ -f "$plugin_installer" ] && [ -n "$javascript_bin" ]; then
    if BURETTE_APP_BUNDLE="$DEST_APP" PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" "$javascript_bin" "$plugin_installer"; then
      echo "codex plugin synced with bundled installer"
      return 0
    fi
    echo "warning: bundled Codex plugin installer failed; using cache fallback"
  fi
  local python_bin
  python_bin="$(PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v python3 || true)"
  if [ -z "$python_bin" ]; then
    echo "codex plugin sync skipped: python3 was not found"
    return 0
  fi
  BURETTE_PLUGIN_SRC="$plugin_src" BURETTE_DEST_APP="$DEST_APP" PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" "$python_bin" <<'PY' || echo "warning: Codex plugin sync failed"
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

plugin_src = Path(os.environ["BURETTE_PLUGIN_SRC"])
dest_app = os.environ["BURETTE_DEST_APP"]
home = Path(os.environ["HOME"])
marketplace_path = home / ".agents" / "plugins" / "marketplace.json"
plugin_symlink = home / ".agents" / "plugins" / "burette"
plugin_source_root = home / ".codex" / "plugins" / "burette"
plugin_cache_root = home / ".codex" / "plugins" / "cache"
codex_config = home / ".codex" / "config.toml"

manifest = json.loads((plugin_src / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
plugin_version = str(manifest.get("version") or "").strip()
if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.+-]*", plugin_version):
    raise RuntimeError("bundled Codex plugin manifest has an invalid version")

def marketplace_name():
    if marketplace_path.exists():
        try:
            data = json.loads(marketplace_path.read_text(encoding="utf-8"))
            name = str(data.get("name") or "").strip()
            if name:
                return name
        except Exception:
            pass
    return "burette"

marketplace = marketplace_name()
install_root = plugin_cache_root / marketplace / "burette" / plugin_version
source_temporary = plugin_source_root.with_name(f"{{plugin_source_root.name}}.updating")
source_backup = plugin_source_root.with_name(f"{{plugin_source_root.name}}.previous")

shutil.rmtree(source_temporary, ignore_errors=True)
shutil.rmtree(source_backup, ignore_errors=True)
source_temporary.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(plugin_src, source_temporary, ignore=shutil.ignore_patterns("node_modules"))

if not (source_temporary / "mcp" / "lib" / "server-bundle.mjs").is_file():
    shutil.rmtree(source_temporary, ignore_errors=True)
    print("codex plugin sync skipped: bundled MCP server is unavailable")
    raise SystemExit(0)

(source_temporary / ".burette-agent-install.json").write_text(
    json.dumps(
        {{
            "appBundle": dest_app,
            "installedAt": datetime.now(timezone.utc).isoformat(),
            "version": plugin_version,
        }},
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)

if plugin_source_root.exists():
    plugin_source_root.rename(source_backup)
try:
    source_temporary.rename(plugin_source_root)
except Exception:
    if source_backup.exists():
        source_backup.rename(plugin_source_root)
    raise
shutil.rmtree(source_backup, ignore_errors=True)

plugin_symlink.parent.mkdir(parents=True, exist_ok=True)
if plugin_symlink.is_symlink() or plugin_symlink.is_file():
    plugin_symlink.unlink()
if not plugin_symlink.exists():
    plugin_symlink.symlink_to(plugin_source_root)

marketplace_path.parent.mkdir(parents=True, exist_ok=True)
marketplace_data = {{"name": marketplace, "interface": {{"displayName": "Burette" if marketplace == "burette" else marketplace}}, "plugins": []}}
if marketplace_path.exists():
    try:
        marketplace_data = json.loads(marketplace_path.read_text(encoding="utf-8"))
    except Exception:
        pass
marketplace_data["name"] = marketplace
marketplace_data["interface"] = marketplace_data.get("interface") or {{"displayName": "Burette" if marketplace == "burette" else marketplace}}
plugins = [plugin for plugin in marketplace_data.get("plugins", []) if plugin.get("name") != "burette"]
plugins.append(
    {{
        "name": "burette",
        "source": {{"source": "local", "path": "./.codex/plugins/burette"}},
        "policy": {{"installation": "AVAILABLE", "authentication": "ON_INSTALL", "products": ["CODEX"]}},
        "category": "Education & Research",
    }}
)
marketplace_data["plugins"] = plugins
marketplace_path.write_text(json.dumps(marketplace_data, indent=2) + "\n", encoding="utf-8")

temporary = install_root.with_name(f"{{install_root.name}}.updating")
backup = install_root.with_name(f"{{install_root.name}}.previous")
shutil.rmtree(temporary, ignore_errors=True)
shutil.rmtree(backup, ignore_errors=True)
temporary.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(plugin_source_root, temporary, symlinks=True)
if install_root.exists():
    install_root.rename(backup)
try:
    temporary.rename(install_root)
except Exception:
    if backup.exists():
        backup.rename(install_root)
    raise
shutil.rmtree(backup, ignore_errors=True)

codex_config.parent.mkdir(parents=True, exist_ok=True)
existing = codex_config.read_text(encoding="utf-8") if codex_config.exists() else ""
cleaned = re.sub(r'\n?\[plugins\."burette@[^"]+"\]\n(?:[^\n\[]*\n)*', "\n", existing)
cleaned = re.sub(r"\n{{3,}}", "\n\n", cleaned).rstrip()
plugin_block = f'[plugins."burette@{{marketplace}}"]\nenabled = true\n'
if f'[plugins."burette@{{marketplace}}"]' not in cleaned:
    cleaned = f"{{cleaned}}\n\n{{plugin_block}}" if cleaned else plugin_block
codex_config.write_text(cleaned.rstrip() + "\n", encoding="utf-8")

print(f"codex plugin synced with cache fallback: {{install_root}}")
PY
}}
sync_burette_codex_plugin
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
    if !normalized.len().is_multiple_of(2) {
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
    let left_version = parse_version(left);
    let right_version = parse_version(right);
    let count = left_version.core.len().max(right_version.core.len());
    for index in 0..count {
        let left = left_version.core.get(index).copied().unwrap_or(0);
        let right = right_version.core.get(index).copied().unwrap_or(0);
        if left != right {
            return if left > right { 1 } else { -1 };
        }
    }
    compare_prerelease(&left_version.prerelease, &right_version.prerelease)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedVersion {
    core: Vec<u64>,
    prerelease: Vec<PrereleaseIdentifier>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PrereleaseIdentifier {
    Numeric(u64),
    Text(String),
}

fn parse_version(value: &str) -> ParsedVersion {
    let trimmed = value
        .trim()
        .strip_prefix(['v', 'V'])
        .unwrap_or(value.trim());
    let release = trimmed
        .split_once('+')
        .map(|(prefix, _)| prefix)
        .unwrap_or(trimmed);
    let (core, prerelease) = match release.split_once('-') {
        Some((core, prerelease)) => (core, prerelease),
        None => (release, ""),
    };
    ParsedVersion {
        core: core
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect(),
        prerelease: if prerelease.is_empty() {
            Vec::new()
        } else {
            prerelease
                .split('.')
                .filter(|part| !part.is_empty())
                .map(|part| match part.parse::<u64>() {
                    Ok(value) => PrereleaseIdentifier::Numeric(value),
                    Err(_) => PrereleaseIdentifier::Text(part.to_string()),
                })
                .collect()
        },
    }
}

fn compare_prerelease(left: &[PrereleaseIdentifier], right: &[PrereleaseIdentifier]) -> i8 {
    if left.is_empty() && right.is_empty() {
        return 0;
    }
    if left.is_empty() {
        return 1;
    }
    if right.is_empty() {
        return -1;
    }

    let count = left.len().max(right.len());
    for index in 0..count {
        let Some(left_identifier) = left.get(index) else {
            return -1;
        };
        let Some(right_identifier) = right.get(index) else {
            return 1;
        };
        match (left_identifier, right_identifier) {
            (
                PrereleaseIdentifier::Numeric(left_value),
                PrereleaseIdentifier::Numeric(right_value),
            ) => {
                if left_value != right_value {
                    return if left_value > right_value { 1 } else { -1 };
                }
            }
            (PrereleaseIdentifier::Numeric(_), PrereleaseIdentifier::Text(_)) => return -1,
            (PrereleaseIdentifier::Text(_), PrereleaseIdentifier::Numeric(_)) => return 1,
            (PrereleaseIdentifier::Text(left_value), PrereleaseIdentifier::Text(right_value)) => {
                if left_value != right_value {
                    return if left_value > right_value { 1 } else { -1 };
                }
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const TEST_PUBLIC_KEY_HEX: &str =
        "9c5fe2e84e83317228f7792b06428614f83ecdc3531e9a1949b48d1914822065";
    const TEST_MANIFEST: &str = r#"{
  "schemaVersion": 1,
  "tagName": "v0.10.32",
  "version": "0.10.32",
  "assetName": "Burette-0.10.32.zip",
  "assetUrl": "https://github.com/SergeiNikolenko/Burette/releases/download/v0.10.32/Burette-0.10.32.zip",
  "assetSize": 12345,
  "assetSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bundleId": "com.local.BuretteV10",
  "extensionId": "com.local.BuretteV10.Preview",
  "minimumSystemVersion": "12.0"
}
"#;
    const TEST_SIGNATURE_HEX: &str = "e9f4d47940c0006b3f02dc1d6a6b4b29349796870f798c8c3db4ff511bc9342c0f23bf1c9a11401e3293dbc1572b1220cc1664b3b186eaf8cce2172d350b5307";

    fn install_request() -> UpdateInstallRequest {
        UpdateInstallRequest {
            tag_name: "v0.10.32".to_string(),
            asset_name: "Burette-0.10.32.zip".to_string(),
            browser_download_url: "https://github.com/SergeiNikolenko/Burette/releases/download/v0.10.32/Burette-0.10.32.zip".to_string(),
            size: 12345,
            sha256_asset_name: Some("Burette-0.10.32.zip.sha256".to_string()),
            sha256_browser_download_url: Some("https://github.com/SergeiNikolenko/Burette/releases/download/v0.10.32/Burette-0.10.32.zip.sha256".to_string()),
            sha256_size: Some(80),
            manifest_asset_name: Some("Burette-0.10.32.zip.manifest.json".to_string()),
            manifest_browser_download_url: Some("https://github.com/SergeiNikolenko/Burette/releases/download/v0.10.32/Burette-0.10.32.zip.manifest.json".to_string()),
            manifest_size: Some(TEST_MANIFEST.len() as u64),
            manifest_signature_asset_name: Some("Burette-0.10.32.zip.manifest.json.sig".to_string()),
            manifest_signature_browser_download_url: Some("https://github.com/SergeiNikolenko/Burette/releases/download/v0.10.32/Burette-0.10.32.zip.manifest.json.sig".to_string()),
            manifest_signature_size: Some(TEST_SIGNATURE_HEX.len() as u64 + 1),
            allow_same_version: None,
        }
    }

    #[test]
    fn accepts_legacy_zip_only_requests() {
        let mut request = install_request();
        request.sha256_asset_name = None;
        request.sha256_browser_download_url = None;
        request.sha256_size = None;
        request.manifest_asset_name = None;
        request.manifest_browser_download_url = None;
        request.manifest_size = None;
        request.manifest_signature_asset_name = None;
        request.manifest_signature_browser_download_url = None;
        request.manifest_signature_size = None;

        validate_request(&request).expect("legacy zip-only request should remain supported");
        assert!(!should_verify_manifest(&request));
    }

    #[test]
    fn accepts_digest_only_requests() {
        let mut request = install_request();
        request.manifest_asset_name = None;
        request.manifest_browser_download_url = None;
        request.manifest_size = None;
        request.manifest_signature_asset_name = None;
        request.manifest_signature_browser_download_url = None;
        request.manifest_signature_size = None;

        validate_request(&request).expect("sha256-only request should be supported");
        assert!(!should_verify_manifest(&request));
        assert!(request_has_digest_assets(&request));
    }

    #[test]
    fn compare_versions_orders_prereleases_before_stable() {
        assert_eq!(compare_versions("1.0.0-alpha", "1.0.0"), -1);
        assert_eq!(compare_versions("1.0.0", "1.0.0-alpha"), 1);
    }

    #[test]
    fn compare_versions_orders_prerelease_identifiers() {
        assert_eq!(compare_versions("v0.10.35-beta.2", "0.10.35-beta.1"), 1);
        assert_eq!(compare_versions("0.10.35-beta.1", "0.10.35-beta.2"), -1);
    }

    #[test]
    fn compare_versions_ignores_build_metadata() {
        assert_eq!(compare_versions("0.10.35+build.7", "v0.10.35"), 0);
    }

    #[test]
    fn compare_versions_accepts_uppercase_v_prefix() {
        assert_eq!(compare_versions("V1.0.0", "1.0.0"), 0);
        assert_eq!(compare_versions("V1.0.1", "1.0.0"), 1);
    }

    #[test]
    fn download_title_drops_the_tag_prefix() {
        assert_eq!(download_title("v1.0.32"), "Downloading Burette 1.0.32");
        assert_eq!(download_title("1.0.32"), "Downloading Burette 1.0.32");
    }

    #[test]
    fn download_progress_value_maps_archive_fraction_to_update_stage() {
        assert_eq!(download_progress_value(0, 100), DOWNLOAD_PROGRESS_START);
        assert_eq!(download_progress_value(100, 100), DOWNLOAD_PROGRESS_END);
        assert_eq!(
            download_progress_value(50, 100),
            DOWNLOAD_PROGRESS_START + (DOWNLOAD_PROGRESS_END - DOWNLOAD_PROGRESS_START) * 0.5
        );
    }

    #[test]
    fn format_download_detail_includes_transferred_size_and_speed() {
        assert_eq!(
            format_download_detail(16_855_040, 203_428_538, 64_204.8),
            "16 MiB of 194 MiB · 63 KiB/s"
        );
        assert_eq!(
            format_download_detail(2_621_440, 203_428_538, 1_310_720.0),
            "2.5 MiB of 194 MiB · 1.2 MiB/s"
        );
        assert_eq!(
            format_download_detail(250_000_000, 203_428_538, 0.0),
            "194 MiB of 194 MiB · 0 B/s"
        );
    }

    #[test]
    fn rejects_partial_integrity_sidecars() {
        let mut request = install_request();
        request.manifest_signature_asset_name = None;

        let error = validate_request(&request).expect_err("partial sidecars must be rejected");
        assert!(error.contains("complete digest set"));
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

    #[test]
    fn ad_hoc_install_accepts_ad_hoc_downloads() {
        let current = CodeSignatureDescriptor {
            identifier: Some(APP_ID.to_string()),
            team_identifier: None,
            is_ad_hoc: true,
        };
        let downloaded = CodeSignatureDescriptor {
            identifier: Some(APP_ID.to_string()),
            team_identifier: None,
            is_ad_hoc: true,
        };

        assert_eq!(
            validate_downloaded_app_descriptor(&current, &downloaded)
                .expect("ad-hoc update should be allowed"),
            DownloadSignatureMode::AdHoc
        );
    }

    #[test]
    fn ad_hoc_install_accepts_developer_signed_downloads() {
        let current = CodeSignatureDescriptor {
            identifier: Some(APP_ID.to_string()),
            team_identifier: None,
            is_ad_hoc: true,
        };
        let downloaded = CodeSignatureDescriptor {
            identifier: Some(APP_ID.to_string()),
            team_identifier: Some("TEAM123".to_string()),
            is_ad_hoc: false,
        };

        assert_eq!(
            validate_downloaded_app_descriptor(&current, &downloaded)
                .expect("developer-signed update should be allowed"),
            DownloadSignatureMode::DeveloperId {
                team_identifier: "TEAM123".to_string(),
            }
        );
    }

    #[test]
    fn developer_signed_install_still_requires_same_team() {
        let current = CodeSignatureDescriptor {
            identifier: Some(APP_ID.to_string()),
            team_identifier: Some("TEAM123".to_string()),
            is_ad_hoc: false,
        };
        let downloaded = CodeSignatureDescriptor {
            identifier: Some(APP_ID.to_string()),
            team_identifier: Some("OTHER999".to_string()),
            is_ad_hoc: false,
        };

        let error = validate_downloaded_app_descriptor(&current, &downloaded)
            .expect_err("mismatched team must still be rejected");
        assert!(error.contains("TeamIdentifier"));
    }

    #[test]
    fn update_exit_confirmation_gates_installer_continuation() {
        tauri::async_runtime::block_on(async {
            let stopped = Cell::new(0);
            let proceeded = Cell::new(0);
            let cancelled = continue_after_exit_confirmation(
                Ok(None::<u8>),
                || stopped.set(stopped.get() + 1),
                |_: u8| async {
                    proceeded.set(proceeded.get() + 1);
                    Ok(true)
                },
            )
            .await;
            assert_eq!(cancelled, Ok(false));
            assert_eq!(stopped.get(), 1);
            assert_eq!(proceeded.get(), 0);

            stopped.set(0);
            let blocked = continue_after_exit_confirmation(
                Err::<Option<u8>, _>("blocked".to_string()),
                || stopped.set(stopped.get() + 1),
                |_: u8| async {
                    proceeded.set(proceeded.get() + 1);
                    Ok(true)
                },
            )
            .await;
            assert_eq!(blocked, Err("blocked".to_string()));
            assert_eq!(stopped.get(), 1);
            assert_eq!(proceeded.get(), 0);

            stopped.set(0);
            let received_permit = Cell::new(0);
            let proceeded_ref = &proceeded;
            let received_permit_ref = &received_permit;
            let continued = continue_after_exit_confirmation(
                Ok(Some(7_u8)),
                || stopped.set(stopped.get() + 1),
                |permit| async move {
                    proceeded_ref.set(proceeded_ref.get() + 1);
                    received_permit_ref.set(permit);
                    Ok(true)
                },
            )
            .await;
            assert_eq!(continued, Ok(true));
            assert_eq!(stopped.get(), 0);
            assert_eq!(proceeded.get(), 1);
            assert_eq!(received_permit.get(), 7);
        });
    }

    #[test]
    fn terminates_and_reaps_a_running_installer_helper() {
        let mut child = Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep helper");

        terminate_installer_helper(&mut child).expect("terminate helper");
        assert!(child.try_wait().expect("query helper").is_some());
    }

    #[test]
    fn accepts_an_installer_helper_that_already_exited() {
        let mut child = Command::new("/usr/bin/true")
            .spawn()
            .expect("spawn completed helper");
        child.wait().expect("wait for completed helper");

        terminate_installer_helper(&mut child).expect("reap completed helper");
    }
}
