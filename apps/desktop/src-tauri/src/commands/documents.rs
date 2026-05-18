use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::mpsc;
use tauri::Runtime;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_dialog::DialogExt;

use crate::preview::runtime::{
    open_document, OpenDocumentsResult, ViewerPreferences, ViewerReloadOptions,
};

#[tauri::command]
pub(crate) fn pick_open_targets<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<String>, String> {
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
        return Ok(files.into_iter().filter_map(|path| path.into_path()).map(|path| path.to_string_lossy().to_string()).collect());
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
                    match open_document(&app, expanded_path, &preferences, reload_options.as_ref()) {
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

fn expand_open_targets(path: PathBuf) -> Result<Vec<PathBuf>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata = fs::metadata(&canonical).map_err(|err| format!("{}: {err}", canonical.display()))?;
    if metadata.is_file() {
        return Ok(vec![canonical]);
    }
    if !metadata.is_dir() {
        return Err(format!("{} is neither a file nor a directory", canonical.display()));
    }

    let mut collected = BTreeSet::new();
    collect_supported_files(&canonical, &mut collected)?;
    Ok(collected.into_iter().collect())
}

fn collect_supported_files(directory: &PathBuf, collected: &mut BTreeSet<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|err| format!("{}: {err}", directory.display()))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|err| format!("{}: {err}", path.display()))?;
        if metadata.is_dir() {
            collect_supported_files(&path, collected)?;
            continue;
        }
        if metadata.is_file() && looks_like_supported_structure_file(&path) {
            collected.insert(path);
        }
    }
    Ok(())
}

fn looks_like_supported_structure_file(path: &std::path::Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(
        extension.as_str(),
        "bcif"
            | "cif"
            | "cms"
            | "csv"
            | "cub"
            | "cube"
            | "dcd"
            | "ent"
            | "gro"
            | "in"
            | "lammpstrj"
            | "log"
            | "mae"
            | "maegz"
            | "mcif"
            | "mmcif"
            | "mol"
            | "mol2"
            | "nctraj"
            | "out"
            | "pdb"
            | "pdbqt"
            | "pqr"
            | "prmtop"
            | "psf"
            | "sd"
            | "sdf"
            | "smi"
            | "smiles"
            | "top"
            | "trr"
            | "tsv"
            | "vasp"
            | "xtc"
            | "xyz"
    )
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
        let title: id = msg_send![title, initWithUTF8String: b"Open Structures\0".as_ptr().cast::<c_char>()];
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

    receiver
        .recv()
        .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{expand_open_targets, looks_like_supported_structure_file};
    use std::fs;

    #[test]
    fn recognizes_supported_structure_files() {
        assert!(looks_like_supported_structure_file(std::path::Path::new("mini.pdb")));
        assert!(looks_like_supported_structure_file(std::path::Path::new("mini.cif")));
        assert!(looks_like_supported_structure_file(std::path::Path::new("mini.sdf")));
        assert!(!looks_like_supported_structure_file(std::path::Path::new("notes.txt")));
    }

    #[test]
    fn expands_directories_into_supported_files() {
        let root = std::env::temp_dir().join(format!("burrete-open-targets-{}", std::process::id()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let pdb = root.join("mini.pdb");
        let cif = nested.join("mini.cif");
        let txt = nested.join("notes.txt");
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        fs::write(&cif, "data_test\n").unwrap();
        fs::write(&txt, "ignore\n").unwrap();

        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(expanded, vec![pdb.canonicalize().unwrap(), cif.canonicalize().unwrap()]);

        fs::remove_file(txt).unwrap();
        fs::remove_file(expanded[1].clone()).unwrap();
        fs::remove_file(expanded[0].clone()).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
