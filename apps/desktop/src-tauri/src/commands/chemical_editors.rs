use crate::preview::runtime_utils::SimplifiedCanonicalize;
#[cfg(target_os = "macos")]
use plist::Value;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use tauri::{Manager, Runtime};

#[derive(Debug, Clone)]
struct EditorProfile {
    id: &'static str,
    name: &'static str,
    #[cfg_attr(windows, allow(dead_code))]
    bundle_ids: &'static [&'static str],
    app_names: &'static [&'static str],
    rank: u16,
    extensions: &'static [&'static str],
}

#[derive(Debug, Clone)]
struct InstalledEditor {
    id: String,
    name: String,
    bundle_id: Option<String>,
    app_path: PathBuf,
    document_extensions: Vec<String>,
    profile: Option<&'static EditorProfile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChemicalEditorTarget {
    id: String,
    name: String,
    bundle_id: Option<String>,
    app_path: String,
    icon_path: Option<String>,
    rank: u16,
    supported_extensions: Vec<String>,
    match_reason: String,
}

const EDITOR_PROFILES: &[EditorProfile] = &[
    EditorProfile {
        id: "maestro",
        name: "Maestro",
        bundle_ids: &["com.schrodinger.Maestro"],
        app_names: &["Maestro.app"],
        rank: 10,
        extensions: &[
            "mae", "mae.gz", "maegz", "cms", "sdf", "sd", "sdf.gz", "sdfgz", "mol", "mol2", "pdb",
            "pdb.gz", "ent", "ent.gz",
        ],
    },
    EditorProfile {
        id: "avogadro",
        name: "Avogadro",
        bundle_ids: &["cc.avogadro"],
        app_names: &["Avogadro2.app", "Avogadro.app"],
        rank: 20,
        extensions: &[
            "xyz", "mol", "sdf", "sd", "pdb", "ent", "mol2", "cube", "cub", "cif", "mcif",
        ],
    },
    EditorProfile {
        id: "chimerax",
        name: "ChimeraX",
        bundle_ids: &["edu.ucsf.cgl.ChimeraX"],
        app_names: &["ChimeraX.app", "ChimeraX-1.10.app"],
        rank: 30,
        extensions: &[
            "pdb", "pdbqt", "pqr", "cif", "mmcif", "bcif", "mol2", "sdf", "sd", "map", "ccp4",
            "mrc", "dcd", "xtc", "trr",
        ],
    },
    EditorProfile {
        id: "pymol",
        name: "PyMOL",
        bundle_ids: &["com.schrodinger.pymol"],
        app_names: &["PyMOL.app"],
        rank: 40,
        extensions: &[
            "pdb", "pdb.gz", "ent", "cif", "cif.gz", "mmcif", "mol2", "sdf", "sd", "pse", "pml",
        ],
    },
    EditorProfile {
        id: "pymol-rs",
        name: "PyMOL-RS",
        bundle_ids: &["me.yakovlev.pymol-rs"],
        app_names: &["PyMOL-RS.app"],
        rank: 44,
        extensions: &[
            "pdb", "ent", "cif", "mmcif", "mol2", "sdf", "sd", "pse", "pml",
        ],
    },
    EditorProfile {
        id: "pymolai",
        name: "PyMolAI",
        bundle_ids: &["com.pymolai.app"],
        app_names: &["PyMolAI.app"],
        rank: 45,
        extensions: &["pdb", "cif", "mmcif", "mol2", "sdf", "pse", "pml"],
    },
    EditorProfile {
        id: "datawarrior",
        name: "DataWarrior",
        bundle_ids: &["org.openmolecules.datawarrior"],
        app_names: &["DataWarrior.app"],
        rank: 50,
        extensions: &["sdf", "sd", "csv", "tsv", "txt", "dwar"],
    },
    EditorProfile {
        id: "vesta",
        name: "VESTA",
        bundle_ids: &["jp.riken.vesta", "jp.co.jp-minerals.VESTA"],
        app_names: &["VESTA.app"],
        rank: 55,
        extensions: &[
            "vesta", "cif", "mcif", "mol", "res", "ins", "xyz", "cube", "cub", "vasp", "xsf",
            "xtl", "fdf", "rho", "grd",
        ],
    },
    EditorProfile {
        id: "bioluminate",
        name: "BioLuminate",
        bundle_ids: &["com.schrodinger.BioLuminate"],
        app_names: &["Bioluminate.app", "BioLuminate.app"],
        rank: 60,
        extensions: &[
            "mae", "mae.gz", "maegz", "sdf", "sd", "sdf.gz", "sdfgz", "mol", "mol2", "pdb",
            "pdb.gz", "ent", "ent.gz",
        ],
    },
    EditorProfile {
        id: "materials-science",
        name: "Materials Science",
        bundle_ids: &["com.schrodinger.Materials Science"],
        app_names: &["Materials Science.app"],
        rank: 65,
        extensions: &[
            "mae", "mae.gz", "maegz", "sdf", "sd", "mol", "mol2", "pdb", "ent", "cif", "mcif",
            "cube", "cub", "vasp", "xsf",
        ],
    },
    EditorProfile {
        id: "molstar-webapp",
        name: "Mol*",
        bundle_ids: &[],
        app_names: &["Mol*.app"],
        rank: 90,
        extensions: &["pdb", "cif", "mmcif", "bcif", "mol2", "sdf", "sd"],
    },
];

const GENERIC_CHEMICAL_EXTENSIONS: &[&str] = &[
    "pdb", "pdbqt", "pqr", "ent", "cif", "mmcif", "mcif", "bcif", "sdf", "sd", "mol", "mol2",
    "xyz", "cube", "cub", "mae", "maegz", "cms", "gro", "xtc", "trr", "dcd", "pse", "pml",
];

#[cfg(target_os = "macos")]
const FINDER_APP_PATH: &str = "/System/Library/CoreServices/Finder.app";

// Discovery and icon conversion can spawn sips; neither may block AppKit.
#[tauri::command(async)]
pub(crate) fn list_chemical_editor_targets<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Vec<ChemicalEditorTarget>, String> {
    let extensions = active_extensions(&path);
    if extensions.is_empty() {
        return Ok(Vec::new());
    }
    Ok(discover_targets_for_extensions(
        &extensions,
        &app_icon_cache_dir(&app)?,
    ))
}

#[tauri::command(async)]
pub(crate) fn finder_icon_path<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    let file_manager = Some(PathBuf::from(FINDER_APP_PATH));
    #[cfg(not(target_os = "macos"))]
    let file_manager = desktop_entries::file_manager();
    Ok(file_manager
        .and_then(|path| app_icon_png_path(&path, &app_icon_cache_dir(&app).ok()?, "finder"))
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command(async)]
pub(crate) fn default_application_icon_path<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Option<String>, String> {
    let target_path = PathBuf::from(&path)
        .canonicalize_simplified()
        .map_err(|err| format!("{path}: {err}"))?;
    let Some(application_path) = default_application_path(&target_path) else {
        return Ok(None);
    };
    let cache_key = stable_editor_id("default", &application_path.to_string_lossy());
    Ok(
        app_icon_png_path(&application_path, &app_icon_cache_dir(&app)?, &cache_key)
            .map(|path| path.to_string_lossy().into_owned()),
    )
}

#[tauri::command]
pub(crate) fn open_in_chemical_editor<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    target_id: String,
) -> Result<(), String> {
    let target_path = PathBuf::from(&path)
        .canonicalize_simplified()
        .map_err(|err| format!("{path}: {err}"))?;
    let extensions = active_extensions(&path);
    if extensions.is_empty() {
        return Err("The active file does not have a supported extension".into());
    }
    let target = discover_targets_for_extensions(&extensions, &app_icon_cache_dir(&app)?)
        .into_iter()
        .find(|target| target.id == target_id)
        .ok_or_else(|| "The requested editor is not available for this file".to_string())?;
    let app_path = PathBuf::from(&target.app_path);
    if !app_path.exists() {
        return Err(format!("{} is no longer installed", target.name));
    }
    #[cfg(target_os = "macos")]
    return tauri_plugin_opener::open_path(target_path, Some(target.app_path))
        .map_err(|err| err.to_string());
    #[cfg(not(target_os = "macos"))]
    desktop_entries::launch(&app_path, &target_path)
}

fn discover_targets_for_extensions(
    active_extensions: &[String],
    icon_cache_dir: &Path,
) -> Vec<ChemicalEditorTarget> {
    let mut targets: Vec<ChemicalEditorTarget> = discover_installed_editors()
        .into_iter()
        .filter_map(|editor| target_for_editor(editor, active_extensions, icon_cache_dir))
        .collect();
    targets.sort_by(|left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.app_path.cmp(&right.app_path))
    });
    targets.dedup_by(|left, right| left.id == right.id);
    targets
}

#[cfg(not(target_os = "macos"))]
fn discover_installed_editors() -> Vec<InstalledEditor> {
    desktop_entries::installed_editors()
}

#[cfg(target_os = "macos")]
fn discover_installed_editors() -> Vec<InstalledEditor> {
    let mut candidates = Vec::new();
    for root in application_roots() {
        collect_apps(&root, 0, &mut candidates);
    }
    candidates
        .into_iter()
        .filter_map(|app_path| installed_editor_from_app(&app_path))
        .collect()
}

#[cfg(target_os = "macos")]
fn application_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    roots
}

#[cfg(target_os = "macos")]
fn collect_apps(root: &Path, depth: u8, candidates: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.ends_with(".app") {
            candidates.push(path);
        } else if depth == 0 && path.is_dir() {
            collect_apps(&path, depth + 1, candidates);
        }
    }
}

#[cfg(target_os = "macos")]
fn installed_editor_from_app(app_path: &Path) -> Option<InstalledEditor> {
    let info_path = app_path.join("Contents/Info.plist");
    let info = Value::from_file(&info_path).ok()?;
    let dictionary = info.as_dictionary()?;
    let bundle_id = dictionary
        .get("CFBundleIdentifier")
        .and_then(Value::as_string)
        .map(ToOwned::to_owned);
    let app_file_name = app_path.file_name()?.to_string_lossy().to_string();
    let profile = profile_for_app(bundle_id.as_deref(), &app_file_name);
    if is_burette_app_candidate(bundle_id.as_deref(), &app_file_name) {
        return None;
    }
    let name = dictionary
        .get("CFBundleDisplayName")
        .and_then(Value::as_string)
        .or_else(|| dictionary.get("CFBundleName").and_then(Value::as_string))
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            profile
                .map(|profile| profile.name.to_string())
                .unwrap_or_else(|| app_file_name.trim_end_matches(".app").to_string())
        });
    let document_extensions = dictionary
        .get("CFBundleDocumentTypes")
        .and_then(Value::as_array)
        .map(|types| document_type_extensions(types))
        .unwrap_or_default();
    if profile.is_none() && !has_generic_chemical_extension(&document_extensions) {
        return None;
    }
    let id = stable_editor_id(
        profile.map(|profile| profile.id).unwrap_or("generic"),
        &app_path.to_string_lossy(),
    );
    Some(InstalledEditor {
        id,
        name,
        bundle_id,
        app_path: app_path.to_path_buf(),
        document_extensions,
        profile,
    })
}

#[cfg(any(target_os = "macos", test))]
fn profile_for_app(bundle_id: Option<&str>, app_file_name: &str) -> Option<&'static EditorProfile> {
    EDITOR_PROFILES.iter().find(|profile| {
        bundle_id
            .map(|value| {
                profile
                    .bundle_ids
                    .iter()
                    .any(|candidate| candidate == &value)
            })
            .unwrap_or(false)
            || profile
                .app_names
                .iter()
                .any(|candidate| candidate == &app_file_name)
    })
}

#[cfg(target_os = "macos")]
fn document_type_extensions(types: &[Value]) -> Vec<String> {
    let mut extensions = BTreeSet::new();
    for item in types {
        let Some(dictionary) = item.as_dictionary() else {
            continue;
        };
        let Some(values) = dictionary
            .get("CFBundleTypeExtensions")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for value in values {
            if let Some(extension) = value.as_string().and_then(normalize_extension) {
                extensions.insert(extension);
            }
        }
    }
    extensions.into_iter().collect()
}

fn target_for_editor(
    editor: InstalledEditor,
    active_extensions: &[String],
    icon_cache_dir: &Path,
) -> Option<ChemicalEditorTarget> {
    let profile_extensions: BTreeSet<String> = editor
        .profile
        .map(|profile| {
            profile
                .extensions
                .iter()
                .filter_map(|extension| normalize_extension(extension))
                .collect()
        })
        .unwrap_or_default();
    let document_extensions: BTreeSet<String> = editor
        .document_extensions
        .iter()
        .filter_map(|extension| normalize_extension(extension))
        .filter(|extension| !is_wildcard_extension(extension))
        .filter(|extension| editor.profile.is_some() || is_generic_chemical_extension(extension))
        .collect();
    let mut matched: Vec<String> = active_extensions
        .iter()
        .filter(|extension| {
            profile_extensions.contains(*extension) || document_extensions.contains(*extension)
        })
        .cloned()
        .collect();
    matched.sort();
    matched.dedup();
    if matched.is_empty() {
        return None;
    }
    let reason = if matched
        .iter()
        .any(|extension| profile_extensions.contains(extension))
    {
        "Known chemical editor profile"
    } else {
        "Declared document type"
    };
    let icon_path = app_icon_png_path(&editor.app_path, icon_cache_dir, &editor.id)
        .map(|path| path.to_string_lossy().to_string());
    Some(ChemicalEditorTarget {
        id: editor.id,
        name: editor.name,
        bundle_id: editor.bundle_id,
        app_path: editor.app_path.to_string_lossy().to_string(),
        icon_path,
        rank: editor.profile.map(|profile| profile.rank).unwrap_or(200),
        supported_extensions: matched,
        match_reason: reason.to_string(),
    })
}

fn active_extensions(path: &str) -> Vec<String> {
    let lower = path.replace('\\', "/").to_lowercase();
    let file_name = lower.rsplit('/').next().unwrap_or(lower.as_str());
    let mut extensions = Vec::new();
    for compound in ["mae.gz", "pdb.gz", "sdf.gz", "ent.gz", "cif.gz"] {
        if file_name.ends_with(&format!(".{compound}")) {
            extensions.push(compound.to_string());
        }
    }
    if let Some(extension) = file_name
        .rsplit_once('.')
        .and_then(|(_, extension)| normalize_extension(extension))
    {
        extensions.push(extension);
    }
    extensions.sort();
    extensions.dedup();
    extensions
}

fn normalize_extension(extension: &str) -> Option<String> {
    let value = extension.trim().trim_start_matches('.').to_lowercase();
    if value.is_empty() {
        return None;
    }
    Some(value)
}

fn is_wildcard_extension(extension: &str) -> bool {
    extension == "*" || extension == "****" || extension.contains('?')
}

#[cfg_attr(windows, allow(dead_code))]
fn has_generic_chemical_extension(extensions: &[String]) -> bool {
    extensions
        .iter()
        .any(|extension| is_generic_chemical_extension(extension))
}

fn is_generic_chemical_extension(extension: &str) -> bool {
    GENERIC_CHEMICAL_EXTENSIONS
        .iter()
        .any(|candidate| candidate == &extension)
}

#[cfg(any(target_os = "macos", test))]
fn is_burette_app_candidate(bundle_id: Option<&str>, app_file_name: &str) -> bool {
    bundle_id
        .map(|value| value.starts_with("com.local.Burette"))
        .unwrap_or(false)
        || app_file_name == "Burette.app"
}

fn stable_editor_id(profile_id: &str, app_path: &str) -> String {
    let mut hash: u64 = 1469598103934665603;
    for byte in app_path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{profile_id}-{hash:016x}")
}

fn app_icon_cache_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("app-icons"))
}

#[cfg(not(target_os = "macos"))]
fn app_icon_png_path(app_path: &Path, cache_dir: &Path, editor_id: &str) -> Option<PathBuf> {
    desktop_entries::icon_path(app_path, cache_dir, editor_id)
}

#[cfg(target_os = "macos")]
fn app_icon_png_path(app_path: &Path, cache_dir: &Path, editor_id: &str) -> Option<PathBuf> {
    let info_path = app_path.join("Contents/Info.plist");
    let info = Value::from_file(&info_path).ok()?;
    let dictionary = info.as_dictionary()?;
    let icon_name = dictionary
        .get("CFBundleIconFile")
        .and_then(Value::as_string)?;
    let icon_file = if icon_name.ends_with(".icns") {
        icon_name.to_string()
    } else {
        format!("{icon_name}.icns")
    };
    let icon_path = app_path.join("Contents/Resources").join(icon_file);
    if !icon_path.exists() {
        return None;
    }
    std::fs::create_dir_all(cache_dir).ok()?;
    let output_path = cache_dir.join(format!("{editor_id}.png"));
    if output_path.exists() {
        return Some(output_path);
    }
    let status = Command::new("/usr/bin/sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(&icon_path)
        .arg("--out")
        .arg(&output_path)
        .status()
        .ok()?;
    if status.success() && output_path.exists() {
        Some(output_path)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn default_application_path(path: &Path) -> Option<PathBuf> {
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSAutoreleasePool;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::{c_char, CString};

    let path = CString::new(path.to_string_lossy().as_bytes()).ok()?;
    unsafe {
        let _pool = NSAutoreleasePool::new(nil);
        let path_string: id = msg_send![class!(NSString), stringWithUTF8String: path.as_ptr()];
        if path_string.is_null() {
            return None;
        }
        let file_url: id = msg_send![class!(NSURL), fileURLWithPath: path_string];
        if file_url.is_null() {
            return None;
        }
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let application_url: id = msg_send![workspace, URLForApplicationToOpenURL: file_url];
        if application_url.is_null() {
            return None;
        }
        let application_path: id = msg_send![application_url, path];
        if application_path.is_null() {
            return None;
        }
        let utf8: *const c_char = msg_send![application_path, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(PathBuf::from(
            std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned(),
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn default_application_path(path: &Path) -> Option<PathBuf> {
    desktop_entries::default_application(path)
}

/// Application names carry vendor prefixes and versions ("UCSF ChimeraX",
/// "Avogadro2"), so the longest profile name contained in the name wins.
#[cfg(not(target_os = "macos"))]
fn profile_for_name(name: &str) -> Option<&'static EditorProfile> {
    let name = normalized_name(name);
    EDITOR_PROFILES
        .iter()
        .flat_map(|profile| {
            profile
                .app_names
                .iter()
                .map(|app_name| app_name.trim_end_matches(".app"))
                .chain([profile.name])
                .map(move |app_name| (profile, normalized_name(app_name)))
        })
        .filter(|(_, app_name)| app_name.len() >= 4 && name.contains(app_name))
        .max_by_key(|(_, app_name)| app_name.len())
        .map(|(profile, _)| profile)
}

#[cfg(not(target_os = "macos"))]
fn normalized_name(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

/// Linux applications come from freedesktop desktop entries, read through GIO
/// so `Exec` field codes, `TryExec` and the user's default handlers follow the
/// same rules as the file manager.
#[cfg(target_os = "linux")]
mod desktop_entries {
    use super::{
        has_generic_chemical_extension, profile_for_name, stable_editor_id, EditorProfile,
        InstalledEditor, EDITOR_PROFILES,
    };
    use gtk::gio::{self, prelude::*};
    use std::path::{Path, PathBuf};

    /// MIME types that desktop entries declare for formats Burette also opens.
    const CHEMICAL_MIME_EXTENSIONS: &[(&str, &[&str])] = &[
        ("chemical/x-pdb", &["pdb", "ent"]),
        ("chemical/x-cif", &["cif"]),
        ("chemical/x-mmcif", &["mmcif", "mcif"]),
        ("chemical/x-mdl-sdfile", &["sdf", "sd"]),
        ("chemical/x-mdl-molfile", &["mol"]),
        ("chemical/x-mol2", &["mol2"]),
        ("chemical/x-xyz", &["xyz"]),
        ("chemical/x-gaussian-cube", &["cube", "cub"]),
    ];
    const ICON_SIZES: &[&str] = &["256x256", "128x128", "96x96", "64x64", "48x48"];

    pub(super) fn installed_editors() -> Vec<InstalledEditor> {
        gio::AppInfo::all()
            .into_iter()
            .filter_map(|info| info.downcast::<gio::DesktopAppInfo>().ok())
            .filter_map(|info| editor(&info))
            .collect()
    }

    fn editor(info: &gio::DesktopAppInfo) -> Option<InstalledEditor> {
        let desktop_file = info.filename()?;
        let name = info.name().to_string();
        if name == "Burette" {
            return None;
        }
        let desktop_id = info.id().map(|id| id.to_string());
        let profile = desktop_id
            .as_deref()
            .and_then(profile_for_desktop_id)
            .or_else(|| profile_for_name(&name));
        let document_extensions: Vec<String> = info
            .supported_types()
            .iter()
            .filter_map(|mime| {
                CHEMICAL_MIME_EXTENSIONS
                    .iter()
                    .find(|(candidate, _)| *candidate == mime.as_str())
            })
            .flat_map(|(_, extensions)| extensions.iter().map(|extension| extension.to_string()))
            .collect();
        if profile.is_none() && !has_generic_chemical_extension(&document_extensions) {
            return None;
        }
        Some(InstalledEditor {
            id: stable_editor_id(
                profile.map(|profile| profile.id).unwrap_or("generic"),
                &desktop_file.to_string_lossy(),
            ),
            name,
            bundle_id: desktop_id,
            app_path: desktop_file,
            document_extensions,
            profile,
        })
    }

    /// Flatpak and vendor packages name their desktop entries after the same
    /// reverse-DNS identifiers the macOS bundles use.
    fn profile_for_desktop_id(desktop_id: &str) -> Option<&'static EditorProfile> {
        let desktop_id = desktop_id.strip_suffix(".desktop").unwrap_or(desktop_id);
        EDITOR_PROFILES.iter().find(|profile| {
            profile
                .bundle_ids
                .iter()
                .any(|bundle_id| bundle_id.eq_ignore_ascii_case(desktop_id))
        })
    }

    pub(super) fn launch(desktop_file: &Path, target: &Path) -> Result<(), String> {
        let info = gio::DesktopAppInfo::from_filename(desktop_file)
            .ok_or_else(|| format!("{} is not a desktop entry", desktop_file.display()))?;
        info.launch(
            &[gio::File::for_path(target)],
            None::<&gio::AppLaunchContext>,
        )
        .map_err(|error| error.to_string())
    }

    pub(super) fn default_application(path: &Path) -> Option<PathBuf> {
        let (content_type, _) = gio::content_type_guess(Some(path), &[]);
        default_for_type(&content_type)
    }

    pub(super) fn file_manager() -> Option<PathBuf> {
        default_for_type("inode/directory")
    }

    fn default_for_type(content_type: &str) -> Option<PathBuf> {
        gio::AppInfo::default_for_type(content_type, false)?
            .downcast::<gio::DesktopAppInfo>()
            .ok()?
            .filename()
    }

    /// Copies the entry's icon into the cache, the only place outside the
    /// bundle the webview may load images from.
    pub(super) fn icon_path(desktop_file: &Path, cache_dir: &Path, id: &str) -> Option<PathBuf> {
        let icon = gio::DesktopAppInfo::from_filename(desktop_file)?.string("Icon")?;
        let source = icon_file(icon.as_str())?;
        let extension = source.extension()?.to_str()?;
        std::fs::create_dir_all(cache_dir).ok()?;
        let output = cache_dir.join(format!("{id}.{extension}"));
        if !output.exists() {
            std::fs::copy(&source, &output).ok()?;
        }
        Some(output)
    }

    fn icon_file(icon: &str) -> Option<PathBuf> {
        let path = Path::new(icon);
        if path.is_absolute() {
            return path.is_file().then(|| path.to_path_buf());
        }
        let mut roots = vec![gtk::glib::user_data_dir()];
        roots.extend(gtk::glib::system_data_dirs());
        for root in &roots {
            let theme = root.join("icons/hicolor");
            let candidates = ICON_SIZES
                .iter()
                .map(|size| theme.join(size).join("apps").join(format!("{icon}.png")))
                .chain([theme.join(format!("scalable/apps/{icon}.svg"))]);
            if let Some(found) = candidates.into_iter().find(|candidate| candidate.is_file()) {
                return Some(found);
            }
        }
        ["png", "svg"]
            .iter()
            .map(|extension| PathBuf::from(format!("/usr/share/pixmaps/{icon}.{extension}")))
            .find(|candidate| candidate.is_file())
    }

    #[cfg(test)]
    mod tests {
        use super::{profile_for_desktop_id, profile_for_name};

        #[test]
        fn desktop_entry_names_match_editor_profiles() {
            let id = |name| profile_for_name(name).map(|profile| profile.id);
            assert_eq!(id("UCSF ChimeraX"), Some("chimerax"));
            assert_eq!(id("Avogadro2"), Some("avogadro"));
            assert_eq!(id("PyMOL-RS"), Some("pymol-rs"));
            assert_eq!(id("PyMOL"), Some("pymol"));
            // Mol*'s three-letter name would match Molden, MolView and others.
            assert_eq!(id("Molden"), None);
            assert_eq!(
                profile_for_desktop_id("org.openmolecules.datawarrior.desktop")
                    .map(|profile| profile.id),
                Some("datawarrior")
            );
        }
    }
}
/// Windows has no registry of chemistry viewers to ask, so known editors are
/// found by their install folders under Program Files and the per-user
/// Programs folder, one vendor level deep ("Schrodinger\PyMOL2").
#[cfg(windows)]
mod desktop_entries {
    use super::{profile_for_name, stable_editor_id, InstalledEditor};
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn install_roots() -> Vec<PathBuf> {
        let mut roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
            .into_iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .collect();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Programs"));
        }
        roots.sort();
        roots.dedup();
        roots
    }

    fn child_dirs(root: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(root)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                    .map(|entry| entry.path())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub(super) fn installed_editors() -> Vec<InstalledEditor> {
        let mut editors = Vec::new();
        for root in install_roots() {
            for folder in child_dirs(&root) {
                if let Some(editor) = editor_in(&folder) {
                    editors.push(editor);
                    continue;
                }
                editors.extend(
                    child_dirs(&folder)
                        .iter()
                        .filter_map(|inner| editor_in(inner)),
                );
            }
        }
        editors
    }

    /// An install folder named after an editor profile, holding an executable
    /// named after the same profile, directly or in `bin`.
    fn editor_in(folder: &Path) -> Option<InstalledEditor> {
        let profile = profile_for_name(folder.file_name()?.to_str()?)?;
        let executable = [folder.to_path_buf(), folder.join("bin")]
            .iter()
            .flat_map(|directory| std::fs::read_dir(directory).into_iter().flatten().flatten())
            .map(|entry| entry.path())
            .find(|path| {
                path.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
                    && path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .and_then(profile_for_name)
                        .is_some_and(|found| found.id == profile.id)
            })?;
        Some(InstalledEditor {
            id: stable_editor_id(profile.id, &executable.to_string_lossy()),
            name: profile.name.to_string(),
            bundle_id: None,
            app_path: executable,
            document_extensions: Vec::new(),
            profile: Some(profile),
        })
    }

    pub(super) fn launch(executable: &Path, target: &Path) -> Result<(), String> {
        Command::new(executable)
            .arg(target)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    /// The executable the shell runs for "Open" on the file's extension.
    pub(super) fn default_application(path: &Path) -> Option<PathBuf> {
        use windows_sys::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_NONE, ASSOCSTR_EXECUTABLE};
        let extension = format!(".{}", path.extension()?.to_str()?);
        let extension: Vec<u16> = extension.encode_utf16().chain([0]).collect();
        let verb: Vec<u16> = "open".encode_utf16().chain([0]).collect();
        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        // SAFETY: both inputs are NUL-terminated UTF-16 strings and `length`
        // holds the capacity of `buffer` in characters.
        let result = unsafe {
            AssocQueryStringW(
                ASSOCF_NONE,
                ASSOCSTR_EXECUTABLE,
                extension.as_ptr(),
                verb.as_ptr(),
                buffer.as_mut_ptr(),
                &mut length,
            )
        };
        if result != 0 || length == 0 {
            return None;
        }
        let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize - 1]));
        path.is_file().then_some(path)
    }

    pub(super) fn file_manager() -> Option<PathBuf> {
        let explorer = PathBuf::from(std::env::var_os("SystemRoot")?).join("explorer.exe");
        explorer.is_file().then_some(explorer)
    }

    /// Executable icons need a GDI round trip to become PNG; the menu falls
    /// back to its generic glyph.
    pub(super) fn icon_path(_executable: &Path, _cache_dir: &Path, _id: &str) -> Option<PathBuf> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_extensions_include_compound_suffixes() {
        assert_eq!(
            active_extensions("/tmp/ligand.mae.gz"),
            vec!["gz", "mae.gz"]
        );
        assert_eq!(active_extensions("/tmp/receptor.PDB"), vec!["pdb"]);
    }

    #[test]
    fn wildcard_extensions_are_not_generic_matches() {
        assert!(is_wildcard_extension("*"));
        assert!(is_wildcard_extension("****"));
        assert!(is_wildcard_extension("?ed"));
        assert!(!is_wildcard_extension("pdb"));
    }

    #[test]
    fn known_profile_matches_by_bundle_id_or_app_name() {
        assert_eq!(
            profile_for_app(Some("com.schrodinger.Maestro"), "Other.app")
                .unwrap()
                .id,
            "maestro"
        );
        assert_eq!(profile_for_app(None, "VESTA.app").unwrap().id, "vesta");
        assert!(profile_for_app(Some("com.example.Other"), "Other.app").is_none());
    }

    #[test]
    fn generic_candidates_require_explicit_chemical_extensions() {
        assert!(has_generic_chemical_extension(&[
            "pdb".into(),
            "txt".into()
        ]));
        assert!(!has_generic_chemical_extension(&[
            "csv".into(),
            "txt".into()
        ]));
        assert!(!has_generic_chemical_extension(&["*".into()]));
    }

    #[test]
    fn burette_app_is_not_an_external_editor_candidate() {
        assert!(is_burette_app_candidate(
            Some("com.local.BuretteV10"),
            "Burette.app"
        ));
        assert!(is_burette_app_candidate(
            Some("com.local.BuretteV10.Dev.chat13ba"),
            "Burette.app"
        ));
        assert!(is_burette_app_candidate(
            Some("com.local.BuretteV10"),
            "Burette.app"
        ));
        assert!(!is_burette_app_candidate(
            Some("com.schrodinger.Maestro"),
            "Maestro.app"
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_icon_is_converted_to_webview_compatible_png() {
        let cache_dir =
            std::env::temp_dir().join(format!("burette-finder-icon-test-{}", std::process::id()));
        let icon_path = app_icon_png_path(Path::new(FINDER_APP_PATH), &cache_dir, "finder")
            .expect("Finder icon should convert to PNG");
        let bytes = std::fs::read(&icon_path).expect("Finder PNG should be readable");

        assert_eq!(
            icon_path.extension().and_then(|value| value.to_str()),
            Some("png")
        );
        assert_eq!(bytes.get(..8), Some(b"\x89PNG\r\n\x1a\n".as_slice()));

        let _ = std::fs::remove_dir_all(cache_dir);
    }
}
