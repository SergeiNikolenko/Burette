#[cfg(target_os = "macos")]
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickLookResetReport {
    ok: bool,
    launch_services_registered: CommandReport,
    extension_registered: CommandReport,
    extension_enabled: CommandReport,
    qlmanage_reset: CommandReport,
    qlmanage_cache_reset: CommandReport,
    quicklookd_killed: CommandReport,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandReport {
    command: &'static str,
    success: bool,
    status: Option<i32>,
    message: String,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn reset_quick_look() -> Result<QuickLookResetReport, String> {
    let app_bundle = current_app_bundle()?;
    let preview_extension = app_bundle
        .join("Contents")
        .join("PlugIns")
        .join("BurretePreview.appex");
    let preview_extension_id = preview_extension_bundle_id(&preview_extension)
        .unwrap_or_else(|| "com.local.BurreteV10.Preview".to_string());

    let launch_services_registered = run_command(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        vec!["-f".into(), "-R".into(), app_bundle.to_string_lossy().to_string()],
        false,
    );
    let extension_registered = run_command(
        "/usr/bin/pluginkit",
        vec!["-a".into(), preview_extension.to_string_lossy().to_string()],
        false,
    );
    let extension_enabled = run_command(
        "/usr/bin/pluginkit",
        vec!["-e".into(), "use".into(), "-i".into(), preview_extension_id],
        false,
    );
    let qlmanage_reset = run_command("/usr/bin/qlmanage", vec!["-r".into()], false);
    let qlmanage_cache_reset = run_command(
        "/usr/bin/qlmanage",
        vec!["-r".into(), "cache".into()],
        false,
    );
    let quicklookd_killed = run_command("/usr/bin/killall", vec!["quicklookd".into()], true);
    let ok = launch_services_registered.success
        && extension_registered.success
        && extension_enabled.success
        && qlmanage_reset.success
        && qlmanage_cache_reset.success
        && quicklookd_killed.success;
    Ok(QuickLookResetReport {
        ok,
        launch_services_registered,
        extension_registered,
        extension_enabled,
        qlmanage_reset,
        qlmanage_cache_reset,
        quicklookd_killed,
    })
}

#[cfg(target_os = "macos")]
fn run_command(
    command: &'static str,
    args: Vec<String>,
    missing_process_is_success: bool,
) -> CommandReport {
    match Command::new(command).args(&args).output() {
        Ok(output) => {
            let status = output.status.code();
            let mut message = String::new();
            message.push_str(&String::from_utf8_lossy(&output.stdout));
            message.push_str(&String::from_utf8_lossy(&output.stderr));
            let success = output.status.success()
                || (missing_process_is_success
                    && status == Some(1)
                    && message.contains("No matching processes"));
            CommandReport {
                command,
                success,
                status,
                message: message.trim().to_string(),
            }
        }
        Err(err) => CommandReport {
            command,
            success: false,
            status: None,
            message: err.to_string(),
        },
    }
}

#[cfg(target_os = "macos")]
fn current_app_bundle() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|err| err.to_string())?;
    let macos_dir = executable
        .parent()
        .ok_or_else(|| "Could not resolve app executable directory.".to_string())?;
    let contents_dir = macos_dir
        .parent()
        .ok_or_else(|| "Could not resolve app Contents directory.".to_string())?;
    contents_dir
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve app bundle directory.".to_string())
}

#[cfg(target_os = "macos")]
fn preview_extension_bundle_id(preview_extension: &Path) -> Option<String> {
    let plist = preview_extension.join("Contents").join("Info.plist");
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier"])
        .arg(plist)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn reset_quick_look() -> Result<(), String> {
    Err("Quick Look reset is only available on macOS".into())
}
