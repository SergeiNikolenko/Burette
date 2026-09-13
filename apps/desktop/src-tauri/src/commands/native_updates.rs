//! Sparkle owns scheduling, its native UI, verification and bundle replacement.
//! NSApplication termination continues through macos.rs and the document guard.
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[cfg_attr(
    not(all(target_os = "macos", feature = "sparkle-updater")),
    allow(dead_code)
)]
#[serde(tag = "engine", rename_all = "camelCase")]
pub(crate) enum Availability {
    Legacy,
    Sparkle,
    Unavailable { reason: String },
}

#[derive(Deserialize)]
#[cfg_attr(
    not(all(target_os = "macos", feature = "sparkle-updater")),
    allow(dead_code)
)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Operation {
    Configure {
        #[serde(rename = "checkAutomatically")]
        check_automatically: bool,
        channel: Channel,
    },
    Check,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Channel {
    Stable,
    Beta,
}

pub(crate) fn initialize(app: &tauri::AppHandle) {
    #[cfg(all(target_os = "macos", feature = "sparkle-updater"))]
    let availability =
        initialize_sparkle(app).unwrap_or_else(|reason| Availability::Unavailable { reason });
    #[cfg(not(all(target_os = "macos", feature = "sparkle-updater")))]
    let availability = Availability::Legacy;
    app.manage(availability);
}

#[cfg(all(target_os = "macos", feature = "sparkle-updater"))]
fn initialize_sparkle(app: &tauri::AppHandle) -> Result<Availability, String> {
    use tauri_plugin_sparkle_updater::SparkleUpdaterExt;
    if app.config().identifier != "com.local.BuretteV10" {
        return Err("Updates are disabled for dev builds.".into());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundle = executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or("Updates require an installed application bundle.")?;
    if homebrew_manages(bundle) {
        return Err("Updates are managed by Homebrew. Run brew upgrade --cask burette.".into());
    }
    app.plugin(tauri_plugin_sparkle_updater::init())
        .map_err(|error| error.to_string())?;
    if app.sparkle_updater().is_none() {
        return Err("Updates require an installed application bundle.".into());
    }
    let bundle = bundle.to_path_buf();
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    // Restore beta selection before Sparkle's first scheduled check can run.
    let channel: Channel = std::fs::read(app_data.join("sparkle-channel.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Channel::Stable);
    app.sparkle_updater()
        .ok_or("The updater is unavailable.")?
        .set_allowed_channels(Some(match channel {
            Channel::Stable => vec![],
            Channel::Beta => vec!["beta".into()],
        }))
        .map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        if let Err(error) =
            super::agent_integration::refresh_bundled_codex_plugin(&bundle, &app_data)
        {
            eprintln!("Bundled plugin refresh failed: {error}");
        }
    });
    Ok(Availability::Sparkle)
}

#[cfg(all(target_os = "macos", feature = "sparkle-updater"))]
fn homebrew_manages(bundle: &std::path::Path) -> bool {
    let Ok(bundle) = bundle.canonicalize() else {
        return false;
    };
    if bundle
        .components()
        .any(|part| part.as_os_str() == "Caskroom")
    {
        return true;
    }
    ["/opt/homebrew", "/usr/local"].into_iter().any(|prefix| {
        std::fs::read_dir(std::path::Path::new(prefix).join("Caskroom/burette"))
            .into_iter()
            .flatten()
            .take(100)
            .filter_map(Result::ok)
            .any(|version| {
                version
                    .path()
                    .join("Burette.app")
                    .canonicalize()
                    .is_ok_and(|path| path == bundle)
            })
    })
}

#[tauri::command]
pub(crate) async fn native_update(
    app: tauri::AppHandle,
    operation: Operation,
) -> Result<Availability, String> {
    let availability = app.state::<Availability>().inner().clone();
    #[cfg(all(target_os = "macos", feature = "sparkle-updater"))]
    if matches!(availability, Availability::Sparkle) {
        use tauri_plugin_sparkle_updater::SparkleUpdaterExt;
        let updater = app.sparkle_updater().ok_or("The updater is unavailable.")?;
        match operation {
            Operation::Configure {
                check_automatically,
                channel,
            } => {
                let app_data = app
                    .path()
                    .app_data_dir()
                    .map_err(|error| error.to_string())?;
                std::fs::create_dir_all(&app_data).map_err(|error| error.to_string())?;
                std::fs::write(
                    app_data.join("sparkle-channel.json"),
                    serde_json::to_vec(&channel).map_err(|error| error.to_string())?,
                )
                .map_err(|error| error.to_string())?;
                let channels = match channel {
                    Channel::Stable => vec![],
                    Channel::Beta => vec!["beta".to_string()],
                };
                updater
                    .set_allowed_channels(Some(channels))
                    .map_err(|error| error.to_string())?;
                updater
                    .set_automatically_downloads_updates(check_automatically)
                    .map_err(|error| error.to_string())?;
                updater
                    .set_automatically_checks_for_updates(check_automatically)
                    .map_err(|error| error.to_string())?;
            }
            Operation::Check => updater
                .check_for_updates()
                .map_err(|error| error.to_string())?,
        }
    }
    #[cfg(not(all(target_os = "macos", feature = "sparkle-updater")))]
    let _ = operation;
    Ok(availability)
}
