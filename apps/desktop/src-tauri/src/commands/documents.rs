use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
#[cfg(target_os = "macos")]
use std::ffi::CString;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::sync::mpsc;
use tauri::{Manager, Runtime};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_dialog::DialogExt;

use crate::preview::formats::{
    format_for_extension, structure_path_extension, supported_structure_extensions,
};
use crate::preview::runtime::{
    open_docking_document as open_docking_document_runtime, open_document, DockingDocumentRequest,
    OpenDocumentsResult, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XyzrenderControls,
};
use crate::preview::text_xyz::xyz_data_from_text;
use crate::preview::xyzrender::create_xyzrender_artifact;

const XYZRENDER_SHEET_MAX_STRUCTURE_FILE_SIZE: u64 = 75 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderRequest {
    path: String,
    preset: Option<String>,
    controls: Option<XyzrenderControls>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderResult {
    svg: String,
    preset: String,
    elapsed_ms: u128,
    log: String,
}

#[tauri::command]
pub(crate) fn pick_open_targets<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        return pick_open_targets_macos(&app);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let files = app
            .dialog()
            .file()
            .set_title("Open Structures")
            .blocking_pick_files()
            .unwrap_or_default();
        return Ok(files
            .into_iter()
            .filter_map(|path| path.into_path())
            .map(|path| path.to_string_lossy().to_string())
            .collect());
    }
}

#[tauri::command]
pub(crate) fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
    reload_options: Option<ViewerReloadOptions>,
) -> Result<OpenDocumentsResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        match expand_open_targets(PathBuf::from(&path)) {
            Ok(expanded) if expanded.is_empty() => {
                errors.push(format!("{path} does not contain supported structure files"));
            }
            Ok(expanded) => {
                for expanded_path in expanded {
                    match open_document(&app, expanded_path, &preferences, reload_options.as_ref())
                    {
                        Ok(document) => documents.push(document),
                        Err(error) => errors.push(error),
                    }
                }
            }
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenDocumentsResult { documents, errors })
}

#[tauri::command]
pub(crate) fn open_docking_document<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DockingDocumentRequest,
    preferences: ViewerPreferences,
) -> Result<ViewerDocument, String> {
    open_docking_document_runtime(&app, request, &preferences)
}

#[tauri::command]
pub(crate) fn render_xyzrender_sheet_item<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: XyzrenderSheetRenderRequest,
) -> Result<XyzrenderSheetRenderResult, String> {
    let input_path = PathBuf::from(&request.path)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", request.path))?;
    let metadata =
        fs::metadata(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", input_path.display()));
    }
    if metadata.len() > XYZRENDER_SHEET_MAX_STRUCTURE_FILE_SIZE {
        return Err(format!(
            "{} is too large for an xyzrender sheet item",
            input_path.display()
        ));
    }

    let extension = structure_path_extension(&input_path);
    let format = format_for_extension(&extension)?;
    if format.is_binary {
        return Err(format!(
            "{} is a binary format and cannot be added to an xyzrender sheet",
            input_path.display()
        ));
    }

    let data = fs::read(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))?;
    let label = input_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("structure");
    let converted_xyz = if matches!(extension.as_str(), "cub" | "cube") {
        None
    } else {
        xyz_data_from_text(&data, &extension, label)
    };
    let output_directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer")
        .join("sheet")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&output_directory).map_err(|err| err.to_string())?;
    let artifact = create_xyzrender_artifact(
        &input_path,
        &output_directory,
        request.preset.as_deref(),
        None,
        request.controls.as_ref(),
        converted_xyz.as_deref(),
    )?;
    let svg_path = output_directory.join(artifact.relative_path);
    let svg =
        fs::read_to_string(&svg_path).map_err(|err| format!("{}: {err}", svg_path.display()))?;
    Ok(XyzrenderSheetRenderResult {
        svg,
        preset: artifact.preset.to_string(),
        elapsed_ms: artifact.elapsed_ms,
        log: artifact.log,
    })
}

#[tauri::command]
pub(crate) fn sync_viewer_preferences(preferences: ViewerPreferences) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return sync_viewer_preferences_macos(&preferences);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = preferences;
        Ok(())
    }
}

fn expand_open_targets(path: PathBuf) -> Result<Vec<PathBuf>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata =
        fs::metadata(&canonical).map_err(|err| format!("{}: {err}", canonical.display()))?;
    if metadata.is_file() {
        return Ok(vec![canonical]);
    }
    if !metadata.is_dir() {
        return Err(format!(
            "{} is neither a file nor a directory",
            canonical.display()
        ));
    }

    let supported_extensions = supported_structure_extensions()?;
    let mut collected = BTreeSet::new();
    let mut visited_directories = HashSet::new();
    collect_supported_files(
        &canonical,
        &mut visited_directories,
        &supported_extensions,
        &mut collected,
    )?;
    Ok(collected.into_iter().collect())
}

fn collect_supported_files(
    directory: &Path,
    visited_directories: &mut HashSet<PathBuf>,
    supported_extensions: &BTreeSet<String>,
    collected: &mut BTreeSet<PathBuf>,
) -> Result<(), String> {
    let canonical_directory = directory
        .canonicalize()
        .map_err(|err| format!("{}: {err}", directory.display()))?;
    if !visited_directories.insert(canonical_directory.clone()) {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|err| format!("{}: {err}", directory.display()))? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            let Ok(target_metadata) = fs::metadata(&path) else {
                continue;
            };
            if target_metadata.is_dir() {
                let _ = collect_supported_files(
                    &path,
                    visited_directories,
                    supported_extensions,
                    collected,
                );
                continue;
            }
            if target_metadata.is_file()
                && looks_like_supported_structure_file(&path, supported_extensions)
            {
                collected.insert(path);
            }
            continue;
        }
        if metadata.is_dir() {
            let _ = collect_supported_files(
                &path,
                visited_directories,
                supported_extensions,
                collected,
            );
            continue;
        }
        if metadata.is_file() && looks_like_supported_structure_file(&path, supported_extensions) {
            collected.insert(path);
        }
    }
    Ok(())
}

fn looks_like_supported_structure_file(
    path: &std::path::Path,
    supported_extensions: &BTreeSet<String>,
) -> bool {
    let extension = structure_path_extension(path);
    supported_extensions.contains(&extension)
}

#[cfg(target_os = "macos")]
fn sync_viewer_preferences_macos(preferences: &ViewerPreferences) -> Result<(), String> {
    use cocoa::base::{id, NO, YES};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let defaults: id = msg_send![class!(NSUserDefaults), standardUserDefaults];
        set_defaults_string(defaults, "viewerTheme", &preferences.theme)?;
        set_defaults_string(
            defaults,
            "viewerCanvasBackground",
            &preferences.canvas_background,
        )?;
        set_defaults_string(
            defaults,
            "structureRendererMode",
            &preferences.renderer_mode,
        )?;
        set_defaults_string(defaults, "molstarStyle", &preferences.molstar_style)?;
        set_defaults_string(defaults, "xyzFastStyle", &preferences.xyz_fast_style)?;
        set_defaults_string(
            defaults,
            "themeLightAccent",
            &preferences.theme_light_accent,
        )?;
        set_defaults_string(
            defaults,
            "themeLightBackground",
            &preferences.theme_light_background,
        )?;
        set_defaults_string(
            defaults,
            "themeLightForeground",
            &preferences.theme_light_foreground,
        )?;
        set_defaults_string(
            defaults,
            "themeLightUiFont",
            &preferences.theme_light_ui_font,
        )?;
        set_defaults_string(
            defaults,
            "themeLightEditorFont",
            &preferences.theme_light_editor_font,
        )?;
        set_defaults_double(
            defaults,
            "themeLightTranslucent",
            preferences.theme_light_translucent,
        )?;
        set_defaults_double(
            defaults,
            "themeLightContrast",
            preferences.theme_light_contrast,
        )?;
        set_defaults_string(defaults, "themeDarkAccent", &preferences.theme_dark_accent)?;
        set_defaults_string(
            defaults,
            "themeDarkBackground",
            &preferences.theme_dark_background,
        )?;
        set_defaults_string(
            defaults,
            "themeDarkForeground",
            &preferences.theme_dark_foreground,
        )?;
        set_defaults_string(defaults, "themeDarkUiFont", &preferences.theme_dark_ui_font)?;
        set_defaults_string(
            defaults,
            "themeDarkEditorFont",
            &preferences.theme_dark_editor_font,
        )?;
        set_defaults_double(
            defaults,
            "themeDarkTranslucent",
            preferences.theme_dark_translucent,
        )?;
        set_defaults_double(
            defaults,
            "themeDarkContrast",
            preferences.theme_dark_contrast,
        )?;

        let transparent_key = autoreleased_nsstring("useTransparentPreviewBackground")?;
        let transparent_value = if preferences.resolved_transparent_background() {
            YES
        } else {
            NO
        };
        let _: () = msg_send![defaults, setBool: transparent_value forKey: transparent_key];
        let _: () = msg_send![defaults, synchronize];
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_defaults_double(defaults: cocoa::base::id, key: &str, value: f64) -> Result<(), String> {
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let key = autoreleased_nsstring(key)?;
        let _: () = msg_send![defaults, setDouble: value forKey: key];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_defaults_string(defaults: cocoa::base::id, key: &str, value: &str) -> Result<(), String> {
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let key = autoreleased_nsstring(key)?;
        let value = autoreleased_nsstring(value)?;
        let _: () = msg_send![defaults, setObject: value forKey: key];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn autoreleased_nsstring(value: &str) -> Result<cocoa::base::id, String> {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};

    let c_value = CString::new(value).map_err(|_| format!("invalid NSString value: {value}"))?;
    unsafe {
        let string: id = msg_send![class!(NSString), alloc];
        let string: id = msg_send![string, initWithUTF8String: c_value.as_ptr()];
        if string.is_null() {
            return Err("failed to allocate NSString".into());
        }
        let string: id = msg_send![string, autorelease];
        Ok(string)
    }
}

#[cfg(target_os = "macos")]
fn pick_open_targets_macos<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<String>, String> {
    use cocoa::appkit::{NSApp, NSModalResponse, NSOpenPanel, NSSavePanel};
    use cocoa::base::{id, nil, NO, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;
    use std::os::raw::c_char;

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || unsafe {
        let panel: id = NSOpenPanel::openPanel(nil);
        panel.setCanChooseFiles_(YES);
        panel.setCanChooseDirectories_(YES);
        panel.setAllowsMultipleSelection_(YES);
        panel.setCanCreateDirectories(NO);
        panel.setResolvesAliases_(YES);

        let title: id = msg_send![class!(NSString), alloc];
        let title: id =
            msg_send![title, initWithUTF8String: b"Open Structures\0".as_ptr().cast::<c_char>()];
        let _: () = msg_send![panel, setTitle: title];

        let response: NSModalResponse = panel.runModal();
        if response != NSModalResponse::NSModalResponseOk {
            let _ = sender.send(Ok(Vec::new()));
            return;
        }

        let urls: id = panel.URLs();
        let count: usize = msg_send![urls, count];
        let mut paths = Vec::with_capacity(count);
        for index in 0..count {
            let url: id = msg_send![urls, objectAtIndex: index];
            let path_value: id = msg_send![url, path];
            let utf8: *const c_char = msg_send![path_value, UTF8String];
            if !utf8.is_null() {
                paths.push(CStr::from_ptr(utf8).to_string_lossy().into_owned());
            }
        }
        let _: id = msg_send![title, autorelease];
        let _: id = msg_send![NSApp(), activateIgnoringOtherApps: YES];
        let _ = sender.send(Ok(paths));
    })
    .map_err(|err| err.to_string())?;

    receiver.recv().map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{expand_open_targets, looks_like_supported_structure_file};
    use crate::preview::formats::supported_structure_extensions;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[test]
    fn recognizes_supported_structure_files() {
        let supported_extensions =
            supported_structure_extensions().expect("supported extensions should load");
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mini.pdb"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mini.cif"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mini.sdf"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("caffeine.com"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("caffeine.psi4"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("ligand.mae.gz"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("system.cms"),
            &supported_extensions
        ));
        assert!(!looks_like_supported_structure_file(
            std::path::Path::new("mn-h2.log"),
            &supported_extensions
        ));
        assert!(!looks_like_supported_structure_file(
            std::path::Path::new("notes.txt"),
            &supported_extensions
        ));
    }

    #[test]
    fn expands_directories_into_supported_files() {
        let root =
            std::env::temp_dir().join(format!("burrete-open-targets-{}", std::process::id()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let pdb = root.join("mini.pdb");
        let cif = nested.join("mini.cif");
        let input = nested.join("caffeine.com");
        let log = root.join("mn-h2.log");
        let txt = nested.join("notes.txt");
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        fs::write(&cif, "data_test\n").unwrap();
        fs::write(&input, "%chk=test\n").unwrap();
        fs::write(&log, "SCF DONE\n").unwrap();
        fs::write(&txt, "ignore\n").unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(
            expanded,
            vec![
                canonical_root.join("mini.pdb"),
                canonical_root.join("nested").join("caffeine.com"),
                canonical_root.join("nested").join("mini.cif")
            ]
        );

        fs::remove_file(txt).unwrap();
        fs::remove_file(log).unwrap();
        fs::remove_file(cif).unwrap();
        fs::remove_file(input).unwrap();
        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn expands_directories_with_symlink_loops_once() {
        let root =
            std::env::temp_dir().join(format!("burrete-open-targets-loop-{}", std::process::id()));
        let nested = root.join("nested");
        let loop_link = nested.join("loop");
        let pdb = root.join("mini.pdb");
        fs::create_dir_all(&nested).unwrap();
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        symlink(&root, &loop_link).unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(expanded, vec![canonical_root.join("mini.pdb")]);

        fs::remove_file(loop_link).unwrap();
        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn skips_broken_symlinks_inside_directories() {
        let root = std::env::temp_dir().join(format!(
            "burrete-open-targets-broken-link-{}",
            std::process::id()
        ));
        let pdb = root.join("mini.pdb");
        let broken_link = root.join("broken.pdb");
        fs::create_dir_all(&root).unwrap();
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        symlink(root.join("missing.pdb"), &broken_link).unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(expanded, vec![canonical_root.join("mini.pdb")]);

        fs::remove_file(pdb).unwrap();
        fs::remove_file(broken_link).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn preserves_symlink_alias_paths_for_nested_files() {
        let root =
            std::env::temp_dir().join(format!("burrete-open-targets-alias-{}", std::process::id()));
        let real = root.join("real.pdb");
        let alias = root.join("alias.pdb");
        fs::create_dir_all(&root).unwrap();
        fs::write(&real, "HEADER TEST\n").unwrap();
        symlink(&real, &alias).unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(
            expanded,
            vec![
                canonical_root.join("alias.pdb"),
                canonical_root.join("real.pdb")
            ]
        );

        fs::remove_file(alias).unwrap();
        fs::remove_file(real).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
