use plist::Value;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Manager, Runtime};

#[derive(Debug, Clone)]
struct EditorProfile {
    id: &'static str,
    name: &'static str,
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

const FINDER_APP_PATH: &str = "/System/Library/CoreServices/Finder.app";

#[tauri::command]
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

#[tauri::command]
pub(crate) fn finder_icon_path<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<String>, String> {
    Ok(app_icon_png_path(
        Path::new(FINDER_APP_PATH),
        &app_icon_cache_dir(&app)?,
        "finder",
    )
    .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub(crate) fn default_application_icon_path<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Option<String>, String> {
    let target_path = PathBuf::from(&path)
        .canonicalize()
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
        .canonicalize()
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
    tauri_plugin_opener::open_path(target_path, Some(target.app_path))
        .map_err(|err| err.to_string())
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

fn application_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    roots
}

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
fn default_application_path(_path: &Path) -> Option<PathBuf> {
    None
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
