#[cfg(target_os = "macos")]
use core_foundation::base::{Boolean, OSStatus, TCFType};
#[cfg(target_os = "macos")]
use core_foundation::string::{CFString, CFStringRef};
#[cfg(target_os = "macos")]
use core_foundation::url::{CFURLRef, CFURL};
#[cfg(target_os = "macos")]
use plist::Value;
#[cfg(target_os = "macos")]
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::collections::BTreeSet;
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
const APP_ID: &str = "com.local.BuretteV10";
#[cfg(target_os = "macos")]
const LEGACY_APP_ID: &str = "com.local.BurreteV10";
#[cfg(target_os = "macos")]
const K_LS_ROLES_ALL: u32 = u32::MAX;
#[cfg(target_os = "macos")]
const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

#[cfg(target_os = "macos")]
#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn LSRegisterURL(in_url: CFURLRef, in_update: Boolean) -> OSStatus;
    fn LSSetDefaultRoleHandlerForContentType(
        in_content_type: CFStringRef,
        in_role: u32,
        in_handler_bundle_id: CFStringRef,
    ) -> OSStatus;
    fn LSCopyDefaultRoleHandlerForContentType(
        in_content_type: CFStringRef,
        in_role: u32,
    ) -> CFStringRef;
}

#[cfg(target_os = "macos")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickLookResetReport {
    ok: bool,
    stale_registrations_removed: CommandReport,
    launch_services_registered: CommandReport,
    default_handlers_registered: CommandReport,
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
pub(crate) async fn reset_quick_look() -> Result<QuickLookResetReport, String> {
    // `lsregister -dump` takes seconds; keep the blocking work off the main thread.
    tauri::async_runtime::spawn_blocking(reset_quick_look_blocking)
        .await
        .map_err(|err| err.to_string())?
}

#[cfg(target_os = "macos")]
fn reset_quick_look_blocking() -> Result<QuickLookResetReport, String> {
    let app_bundle = current_app_bundle()?;
    let app_bundle_id =
        bundle_id(&app_bundle).unwrap_or_else(|| "com.local.BuretteV10".to_string());
    let preview_extension = app_bundle
        .join("Contents")
        .join("PlugIns")
        .join("BurettePreview.appex");
    let preview_extension_id =
        bundle_id(&preview_extension).unwrap_or_else(|| "com.local.BuretteV10.Preview".to_string());

    // Deleted or trashed builds stay in Launch Services and can keep claiming
    // shared UTIs; Quick Look then fails with "Extension ... not found".
    let stale_registrations_removed = unregister_stale_owned_bundles(&app_bundle);
    let launch_services_registered = run_command(
        LSREGISTER,
        vec![
            "-f".into(),
            "-R".into(),
            app_bundle.to_string_lossy().to_string(),
        ],
        false,
    );
    let default_handlers_registered =
        register_default_document_handlers(&app_bundle, &app_bundle_id, true);
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
    let ok = stale_registrations_removed.success
        && launch_services_registered.success
        && default_handlers_registered.success
        && extension_registered.success
        && extension_enabled.success
        && qlmanage_reset.success
        && qlmanage_cache_reset.success
        && quicklookd_killed.success;
    Ok(QuickLookResetReport {
        ok,
        stale_registrations_removed,
        launch_services_registered,
        default_handlers_registered,
        extension_registered,
        extension_enabled,
        qlmanage_reset,
        qlmanage_cache_reset,
        quicklookd_killed,
    })
}

#[cfg(target_os = "macos")]
fn register_default_document_handlers(
    app_bundle: &Path,
    app_bundle_id: &str,
    replace_existing: bool,
) -> CommandReport {
    let command = "CoreServices.LSSetDefaultRoleHandlerForContentType";
    let content_types = match document_content_types(app_bundle) {
        Ok(content_types) => content_types,
        Err(message) => {
            return CommandReport {
                command,
                success: false,
                status: None,
                message,
            };
        }
    };
    if content_types.is_empty() {
        return CommandReport {
            command,
            success: false,
            status: None,
            message: "No LSItemContentTypes found in app bundle.".to_string(),
        };
    }

    let app_url = match CFURL::from_path(app_bundle, true) {
        Some(app_url) => app_url,
        None => {
            return CommandReport {
                command,
                success: false,
                status: None,
                message: format!(
                    "Could not create app bundle URL for {}.",
                    app_bundle.display()
                ),
            };
        }
    };
    let app_bundle_id_value = app_bundle_id.to_string();
    let app_bundle_id = CFString::new(&app_bundle_id_value);
    let register_status = unsafe { LSRegisterURL(app_url.as_concrete_TypeRef(), true as Boolean) };
    let mut failures = Vec::new();
    let mut registered = 0;
    let mut preserved = 0;
    for content_type in &content_types {
        let content_type_ref = CFString::new(content_type);
        let current = unsafe {
            let current = LSCopyDefaultRoleHandlerForContentType(
                content_type_ref.as_concrete_TypeRef(),
                K_LS_ROLES_ALL,
            );
            if current.is_null() {
                None
            } else {
                Some(CFString::wrap_under_create_rule(current).to_string())
            }
        };
        if !should_replace_default_handler(
            current.as_deref(),
            &app_bundle_id_value,
            replace_existing,
        ) {
            preserved += 1;
            continue;
        }
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                content_type_ref.as_concrete_TypeRef(),
                K_LS_ROLES_ALL,
                app_bundle_id.as_concrete_TypeRef(),
            )
        };
        if status != 0 {
            failures.push(format!("{content_type}: {status}"));
        } else {
            registered += 1;
        }
    }

    let success = register_status == 0 && failures.is_empty();
    let status = if register_status != 0 {
        Some(register_status)
    } else {
        failures
            .first()
            .and_then(|failure| failure.rsplit_once(": "))
            .and_then(|(_, status)| status.parse::<i32>().ok())
    };
    let message = if success {
        format!(
            "registered {registered} default document handlers; preserved {preserved} explicit handlers"
        )
    } else {
        let mut message = format!("LSRegisterURL status: {register_status}");
        if !failures.is_empty() {
            message.push_str("; handler failures: ");
            message.push_str(&failures.join(", "));
        }
        message
    };
    CommandReport {
        command,
        success,
        status,
        message,
    }
}

#[cfg(target_os = "macos")]
fn should_replace_default_handler(
    current: Option<&str>,
    app_bundle_id: &str,
    replace_existing: bool,
) -> bool {
    match current {
        Some(handler) if handler == app_bundle_id => false,
        Some(LEGACY_APP_ID) => true,
        Some(_) => replace_existing,
        None => true,
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn maintain_launch_services_on_startup() -> Result<(), String> {
    let app_bundle = current_app_bundle()?;
    let app_bundle_id = bundle_id(&app_bundle)
        .ok_or_else(|| format!("Could not read bundle id from {}.", app_bundle.display()))?;
    if app_bundle_id != APP_ID {
        return Ok(());
    }

    // Default handlers require a deliberate Settings action. Launching an app
    // must not trigger one Finder confirmation per previously unclaimed format.
    cleanup_owned_update_bundles(&app_bundle)
}

#[cfg(target_os = "macos")]
fn cleanup_owned_update_bundles(current_app: &Path) -> Result<(), String> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Ok(());
    };
    let application_support = home.join("Library").join("Application Support");
    for root in [
        application_support.join(APP_ID).join("Updates"),
        application_support.join(LEGACY_APP_ID).join("Updates"),
    ] {
        for bundle in app_bundles_below(&root)? {
            if bundle == current_app {
                continue;
            }
            let _ = run_command(
                LSREGISTER,
                vec!["-u".into(), bundle.to_string_lossy().to_string()],
                false,
            );
            fs::remove_dir_all(&bundle)
                .map_err(|err| format!("Could not remove {}: {err}", bundle.display()))?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn unregister_stale_owned_bundles(current_app: &Path) -> CommandReport {
    let command = "lsregister -u (stale Burette bundles)";
    let dump = match Command::new(LSREGISTER).arg("-dump").output() {
        Ok(output) if output.status.success() => output.stdout,
        Ok(output) => {
            return CommandReport {
                command,
                success: false,
                status: output.status.code(),
                message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            };
        }
        Err(err) => {
            return CommandReport {
                command,
                success: false,
                status: None,
                message: err.to_string(),
            };
        }
    };
    let trash = std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".Trash"));
    let stale = stale_owned_bundles(
        &String::from_utf8_lossy(&dump),
        current_app,
        trash.as_deref(),
        |path| path.exists(),
    );
    let failures: Vec<String> = stale
        .iter()
        .filter_map(|bundle| {
            let report = run_command(
                LSREGISTER,
                vec!["-u".into(), bundle.to_string_lossy().to_string()],
                false,
            );
            (!report.success).then(|| format!("{}: {}", bundle.display(), report.message))
        })
        .collect();
    CommandReport {
        command,
        success: failures.is_empty(),
        status: None,
        message: if failures.is_empty() {
            format!("unregistered {} stale Burette bundles", stale.len())
        } else {
            failures.join("; ")
        },
    }
}

/// Lists registered Burette app bundles, including dev flavors, whose bundle
/// no longer exists or sits in the Trash. Extension records map to their
/// containing app because unregistering the app drops its plug-ins too.
#[cfg(target_os = "macos")]
fn stale_owned_bundles(
    dump: &str,
    current_app: &Path,
    trash: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> BTreeSet<PathBuf> {
    let mut stale = BTreeSet::new();
    let mut path: Option<&str> = None;
    for line in dump.lines() {
        if line.starts_with("----") {
            path = None;
        } else if let Some(value) = line.strip_prefix("path:") {
            let value = value.trim();
            path = Some(value.rsplit_once(" (0x").map_or(value, |(path, _)| path));
        } else if let Some(identifier) = line.strip_prefix("identifier:") {
            let identifier = identifier.trim();
            if !(identifier.starts_with(APP_ID) || identifier.starts_with(LEGACY_APP_ID)) {
                continue;
            }
            let Some(bundle) = path.and_then(containing_app_bundle) else {
                continue;
            };
            let trashed = trash.is_some_and(|trash| bundle.starts_with(trash));
            if bundle != current_app && (trashed || !exists(&bundle)) {
                stale.insert(bundle);
            }
        }
    }
    stale
}

#[cfg(target_os = "macos")]
fn containing_app_bundle(path: &str) -> Option<PathBuf> {
    let end = path.find(".app/").map(|index| index + ".app".len());
    match end {
        Some(end) => Some(PathBuf::from(&path[..end])),
        None if path.ends_with(".app") => Some(PathBuf::from(path)),
        None => None,
    }
}

#[cfg(target_os = "macos")]
fn app_bundles_below(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut bundles = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|err| format!("Could not read {}: {err}", directory.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|err| err.to_string())?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }
            if path.extension().is_some_and(|extension| extension == "app") {
                bundles.push(path);
            } else {
                directories.push(path);
            }
        }
    }
    Ok(bundles)
}

#[cfg(target_os = "macos")]
fn document_content_types(app_bundle: &Path) -> Result<BTreeSet<String>, String> {
    let plist = app_bundle.join("Contents").join("Info.plist");
    let info = Value::from_file(&plist)
        .map_err(|err| format!("Could not read {}: {err}", plist.display()))?;
    let dictionary = info
        .as_dictionary()
        .ok_or_else(|| format!("{} is not a dictionary.", plist.display()))?;
    let document_types = dictionary
        .get("CFBundleDocumentTypes")
        .and_then(Value::as_array)
        .ok_or_else(|| "CFBundleDocumentTypes is missing or not an array.".to_string())?;
    let mut content_types = BTreeSet::new();
    for document_type in document_types {
        let Some(document_type) = document_type.as_dictionary() else {
            continue;
        };
        let Some(values) = document_type
            .get("LSItemContentTypes")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for value in values {
            if let Some(content_type) = value.as_string() {
                content_types.insert(content_type.to_string());
            }
        }
    }
    Ok(content_types)
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
fn bundle_id(bundle: &Path) -> Option<String> {
    let plist = bundle.join("Contents").join("Info.plist");
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        app_bundles_below, should_replace_default_handler, stale_owned_bundles, APP_ID,
        LEGACY_APP_ID,
    };
    use std::collections::BTreeSet;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::{Path, PathBuf};

    #[test]
    fn reset_prunes_missing_and_trashed_burette_bundles_only() {
        let dump = "\
--------------------------------------------------------------------------------
path:                       /Applications/Burette.app (0x10)
identifier:                 com.local.BuretteV10
--------------------------------------------------------------------------------
path:                       /tmp/review/build/Burette-pose.app/Contents/PlugIns/BurettePreview.appex (0x11)
identifier:                 com.local.BuretteV10.Dev.pose.Preview
--------------------------------------------------------------------------------
path:                       /tmp/review/build/Burette-pose.app (0x12)
identifier:                 com.local.BuretteV10.Dev.pose
--------------------------------------------------------------------------------
path:                       /Users/me/.Trash/Burette-old.app (0x13)
identifier:                 com.local.BuretteV10.Dev.old
--------------------------------------------------------------------------------
path:                       /Users/me/.Trash/Other.app (0x14)
identifier:                 org.example.Other
--------------------------------------------------------------------------------
path:                       /gone/Burrete.app (0x15)
identifier:                 com.local.BurreteV10
--------------------------------------------------------------------------------
path:                       /gone/Unrelated.app (0x16)
identifier:                 org.example.Unrelated
--------------------------------------------------------------------------------
path:                       /gone/Current.app (0x17)
identifier:                 com.local.BuretteV10
";
        let existing = [
            "/Applications/Burette.app",
            "/Users/me/.Trash/Burette-old.app",
        ];
        let stale = stale_owned_bundles(
            dump,
            Path::new("/gone/Current.app"),
            Some(Path::new("/Users/me/.Trash")),
            |path| existing.iter().any(|existing| path == Path::new(existing)),
        );

        let expected: BTreeSet<PathBuf> = [
            "/Users/me/.Trash/Burette-old.app",
            "/gone/Burrete.app",
            "/tmp/review/build/Burette-pose.app",
        ]
        .into_iter()
        .map(PathBuf::from)
        .collect();
        assert_eq!(stale, expected);
    }

    #[test]
    fn startup_claims_missing_and_legacy_handlers_but_preserves_user_choices() {
        assert!(should_replace_default_handler(None, APP_ID, false));
        assert!(should_replace_default_handler(
            Some(LEGACY_APP_ID),
            APP_ID,
            false
        ));
        assert!(!should_replace_default_handler(Some(APP_ID), APP_ID, false));
        assert!(!should_replace_default_handler(
            Some("org.example.OtherViewer"),
            APP_ID,
            false
        ));
        assert!(should_replace_default_handler(
            Some("org.example.OtherViewer"),
            APP_ID,
            true
        ));
    }

    #[test]
    fn owned_update_scan_finds_apps_without_following_symlinks() {
        let root =
            std::env::temp_dir().join(format!("burette-update-scan-{}", uuid::Uuid::new_v4()));
        let updates = root.join("Updates");
        let staged = updates.join("v2.0.4").join("Burette.app");
        let outside = root.join("outside").join("Other.app");
        fs::create_dir_all(&staged).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(root.join("outside"), updates.join("outside-link")).unwrap();

        assert_eq!(app_bundles_below(&updates).unwrap(), vec![staged.clone()]);

        fs::remove_file(updates.join("outside-link")).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn reset_quick_look() -> Result<(), String> {
    Err("Quick Look reset is only available on macOS".into())
}
