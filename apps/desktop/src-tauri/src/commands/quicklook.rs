#[cfg(target_os = "macos")]
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickLookResetReport {
    ok: bool,
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
    let qlmanage_reset = run_command("/usr/bin/qlmanage", &["-r"], false);
    let qlmanage_cache_reset = run_command("/usr/bin/qlmanage", &["-r", "cache"], false);
    let quicklookd_killed = run_command("/usr/bin/killall", &["quicklookd"], true);
    let ok = qlmanage_reset.success && qlmanage_cache_reset.success && quicklookd_killed.success;
    Ok(QuickLookResetReport {
        ok,
        qlmanage_reset,
        qlmanage_cache_reset,
        quicklookd_killed,
    })
}

#[cfg(target_os = "macos")]
fn run_command(
    command: &'static str,
    args: &[&str],
    missing_process_is_success: bool,
) -> CommandReport {
    match Command::new(command).args(args).output() {
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

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn reset_quick_look() -> Result<(), String> {
    Err("Quick Look reset is only available on macOS".into())
}
