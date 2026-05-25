use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Runtime;

use super::formats::{format_for_extension, resolve_renderer};
use super::runtime_grid::{create_grid_runtime, grid_requires_preview};
use super::runtime_utils::{file_title, stable_id};
use super::runtime_viewer::create_runtime;

const MAX_STRUCTURE_FILE_SIZE: u64 = 75 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerPreferences {
    pub(crate) theme: String,
    pub(crate) canvas_background: String,
    pub(crate) renderer_mode: String,
    pub(crate) molstar_style: String,
    pub(crate) xyz_fast_style: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerReloadOptions {
    pub(crate) xyzrender_orientation_ref: Option<String>,
    pub(crate) xyzrender_preset: Option<String>,
    pub(crate) xyzrender_controls: Option<XyzrenderControls>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderControls {
    pub(crate) transparent_background: Option<bool>,
    pub(crate) canvas_size: Option<f64>,
    pub(crate) atom_scale: Option<f64>,
    pub(crate) bond_width: Option<f64>,
    pub(crate) atom_stroke_width: Option<f64>,
    pub(crate) mol_color: Option<String>,
    pub(crate) gradients: Option<bool>,
    pub(crate) fog: Option<bool>,
    pub(crate) fog_strength: Option<f64>,
    pub(crate) show_vdw: Option<bool>,
    pub(crate) vdw_opacity: Option<f64>,
    pub(crate) vdw_scale: Option<f64>,
    pub(crate) hide_bonds: Option<bool>,
    pub(crate) show_cell: Option<bool>,
    pub(crate) show_ghosts: Option<bool>,
    pub(crate) show_axes: Option<bool>,
    pub(crate) cell_width: Option<f64>,
    pub(crate) supercell: Option<[i32; 3]>,
    pub(crate) custom_config_path: Option<String>,
    pub(crate) extra_arguments: Option<String>,
}

impl ViewerPreferences {
    pub(crate) fn theme_for_runtime(&self) -> &str {
        match self.theme.as_str() {
            "dark" | "light" | "auto" => self.theme.as_str(),
            _ => "auto",
        }
    }

    pub(crate) fn resolved_molstar_style(&self) -> &str {
        if self.molstar_style == "default" {
            "default"
        } else {
            "illustrative"
        }
    }

    pub(crate) fn canvas_background_for_runtime(&self) -> &str {
        match self.canvas_background.as_str() {
            "auto" | "black" | "graphite" | "white" | "transparent" => {
                self.canvas_background.as_str()
            }
            _ => "auto",
        }
    }

    pub(crate) fn resolved_transparent_background(&self) -> bool {
        self.canvas_background_for_runtime() == "transparent"
    }
}

#[cfg(test)]
mod viewer_preferences_tests {
    use super::ViewerPreferences;

    fn preferences(theme: &str, canvas_background: &str) -> ViewerPreferences {
        ViewerPreferences {
            theme: theme.to_string(),
            canvas_background: canvas_background.to_string(),
            renderer_mode: "auto".to_string(),
            molstar_style: "illustrative".to_string(),
            xyz_fast_style: "default".to_string(),
        }
    }

    #[test]
    fn preserves_auto_theme_for_runtime() {
        assert_eq!(preferences("auto", "auto").theme_for_runtime(), "auto");
        assert_eq!(preferences("light", "auto").theme_for_runtime(), "light");
        assert_eq!(preferences("weird", "auto").theme_for_runtime(), "auto");
    }

    #[test]
    fn preserves_auto_canvas_background_for_runtime() {
        assert_eq!(
            preferences("auto", "auto").canvas_background_for_runtime(),
            "auto"
        );
        assert_eq!(
            preferences("auto", "white").canvas_background_for_runtime(),
            "white"
        );
        assert_eq!(
            preferences("auto", "broken").canvas_background_for_runtime(),
            "auto"
        );
    }

    #[test]
    fn transparent_background_only_when_explicit() {
        assert!(preferences("auto", "transparent").resolved_transparent_background());
        assert!(!preferences("auto", "auto").resolved_transparent_background());
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenDocumentsResult {
    pub(crate) documents: Vec<ViewerDocument>,
    pub(crate) errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerDocument {
    id: String,
    path: String,
    title: String,
    extension: String,
    renderer: String,
    runtime_path: String,
    byte_count: u64,
}

pub(crate) fn open_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: PathBuf,
    preferences: &ViewerPreferences,
    reload_options: Option<&ViewerReloadOptions>,
) -> Result<ViewerDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata = fs::metadata(&canonical).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", canonical.display()));
    }
    if metadata.len() > MAX_STRUCTURE_FILE_SIZE {
        return Err(format!(
            "{} is larger than the 75 MB preview limit",
            canonical.display()
        ));
    }
    let data = fs::read(&canonical).map_err(|err| err.to_string())?;
    if data.is_empty() {
        return Err(format!("{} is empty", canonical.display()));
    }

    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let document_id = stable_id(&canonical);
    if let Some(runtime_path) =
        create_grid_runtime(app, &document_id, &canonical, &extension, &data, preferences)?
    {
        return Ok(ViewerDocument {
            id: document_id.clone(),
            path: canonical.to_string_lossy().to_string(),
            title: file_title(&canonical),
            extension,
            renderer: "grid2d".to_string(),
            runtime_path: runtime_path.to_string_lossy().to_string(),
            byte_count: metadata.len(),
        });
    }
    if grid_requires_preview(&extension) {
        return Err(format!(
            "{} does not contain supported molecule grid records",
            canonical.display()
        ));
    }

    let format = format_for_extension(&extension)?;
    let renderer = resolve_renderer(&format, &preferences.renderer_mode);
    let runtime = create_runtime(
        app,
        &canonical,
        &extension,
        &format,
        &renderer,
        &data,
        preferences,
        reload_options,
    )?;
    Ok(ViewerDocument {
        id: document_id,
        path: canonical.to_string_lossy().to_string(),
        title: file_title(&canonical),
        extension,
        renderer: runtime.renderer,
        runtime_path: runtime.path.to_string_lossy().to_string(),
        byte_count: metadata.len(),
    })
}

#[cfg(test)]
mod document_open_tests {
    use super::{open_document, ViewerPreferences};
    use crate::commands::documents::open_documents;
    use std::collections::BTreeMap;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn viewer_preferences() -> ViewerPreferences {
        ViewerPreferences {
            theme: "auto".to_string(),
            canvas_background: "auto".to_string(),
            renderer_mode: "auto".to_string(),
            molstar_style: "illustrative".to_string(),
            xyz_fast_style: "ball-stick".to_string(),
        }
    }

    fn repo_root() -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .unwrap_or(&manifest_dir)
            .to_path_buf()
    }

    fn fixture_path(relative: &str) -> PathBuf {
        repo_root()
            .join("tests")
            .join("fixtures")
            .join("BurettePreviewSamples")
            .join(relative)
    }

    fn prepend_fake_xyzrender_environment() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("burrete-open-document-{}", uuid::Uuid::new_v4()));
        let bin_dir = root.join(".local").join("bin");
        fs::create_dir_all(&bin_dir).expect("fake xyzrender bin dir should be created");
        let executable = bin_dir.join("xyzrender");
        fs::write(
            &executable,
            concat!(
                "#!/bin/sh\n",
                "out=\"\"\n",
                "while [ \"$#\" -gt 0 ]; do\n",
                "  if [ \"$1\" = \"-o\" ]; then\n",
                "    out=\"$2\"\n",
                "    shift 2\n",
                "    continue\n",
                "  fi\n",
                "  shift\n",
                "done\n",
                "printf '%s\\n' '<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>' > \"$out\"\n"
            ),
        )
        .expect("fake xyzrender should be written");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&executable)
                .expect("fake xyzrender metadata should be readable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions)
                .expect("fake xyzrender should be executable");
        }
        root
    }

    fn with_fake_xyzrender<T>(run: impl FnOnce() -> T) -> T {
        let _lock = ENV_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env lock should not be poisoned");
        let fake_home = prepend_fake_xyzrender_environment();
        let old_home = std::env::var_os("HOME");
        let old_path = std::env::var_os("PATH");
        let mut joined_path = vec![fake_home.join(".local").join("bin")];
        if let Some(path) = &old_path {
            joined_path.extend(std::env::split_paths(path));
        }
        let joined_path =
            std::env::join_paths(joined_path).expect("fake xyzrender path should be valid");

        std::env::set_var("HOME", &fake_home);
        std::env::set_var("PATH", &joined_path);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));

        match old_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match old_path {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }
        let _ = fs::remove_dir_all(fake_home);

        match result {
            Ok(value) => value,
            Err(payload) => std::panic::resume_unwind(payload),
        }
    }

    fn create_temp_file(extension: &str, data: &[u8]) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("burrete-runtime-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temp test directory should be created");
        let path = directory.join(format!("probe.{extension}"));
        fs::write(&path, data).expect("temp test file should be written");
        path
    }

    fn remove_runtime_artifacts(runtime_path: &str) {
        if let Some(runtime_dir) = Path::new(runtime_path).parent() {
            let _ = fs::remove_dir_all(runtime_dir);
            if let Some(viewer_dir) = runtime_dir.parent() {
                let _ = fs::remove_dir_all(viewer_dir.join("assets").join("rdkit"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("molstar.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("molstar.css"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("viewer-runtime.css"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("viewer-shell.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("burette-agent.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("viewer.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("xyz-fast.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("grid-viewer.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("grid.css"));
            }
        }
    }

    fn expected_real_renderer(path: &Path) -> &'static str {
        match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
            "abi" | "com" | "cub" | "cube" | "fdf" | "in" | "inp" | "nw" | "out" | "psi4"
            | "qcin" | "vasp" => "xyzrender-external",
            "cif" | "mol2" | "pdb" => "molstar",
            "sdf" => {
                if path.file_name().and_then(|value| value.to_str()) == Some("multi_mol.sdf") {
                    "grid2d"
                } else {
                    "molstar"
                }
            }
            "xyz" => "xyzrender-external",
            other => panic!("unexpected supported real example extension: {other}"),
        }
    }

    #[test]
    fn opens_supported_formats_with_expected_renderers() {
        with_fake_xyzrender(|| {
            let app = tauri::test::mock_app();
            let preferences = viewer_preferences();
            let mut opened = Vec::new();
            let mut created_files = Vec::new();

            let cube = create_temp_file("cube", b"dummy cube");
            let com = create_temp_file("com", b"dummy input");
            created_files.push(cube.clone());
            created_files.push(com.clone());

            let cases = vec![
                (fixture_path("xyz/single.xyz"), "xyzrender-external"),
                (fixture_path("1HTB.pdb"), "molstar"),
                (fixture_path("sdf/single.sdf"), "molstar"),
                (fixture_path("sdf/multi.sdf"), "grid2d"),
                (cube, "xyzrender-external"),
                (com, "xyzrender-external"),
            ];

            for (path, expected_renderer) in cases {
                let document = open_document(&app.handle(), path.clone(), &preferences, None)
                    .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
                assert_eq!(document.renderer, expected_renderer, "{}", path.display());
                assert!(
                    Path::new(&document.runtime_path).is_file(),
                    "{} should create a runtime HTML file",
                    path.display()
                );
                opened.push(document.runtime_path);
            }

            for runtime_path in opened {
                remove_runtime_artifacts(&runtime_path);
            }
            for path in created_files {
                if let Some(parent) = path.parent() {
                    let _ = fs::remove_dir_all(parent);
                }
            }
        });
    }

    #[test]
    fn opens_real_example_corpus_when_configured() {
        let Some(root) = std::env::var_os("BURRETE_REAL_EXAMPLES_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let inputs = root.join("inputs");
        let structures = root.join("structures");
        assert!(inputs.is_dir(), "{} should exist", inputs.display());
        assert!(structures.is_dir(), "{} should exist", structures.display());

        with_fake_xyzrender(|| {
            let app = tauri::test::mock_app();
            let result = open_documents(
                app.handle().clone(),
                vec![
                    inputs.to_string_lossy().to_string(),
                    structures.to_string_lossy().to_string(),
                ],
                viewer_preferences(),
                None,
            )
            .expect("real example corpus should open");

            assert!(
                result.errors.is_empty(),
                "unexpected open errors: {}",
                result.errors.join("; ")
            );
            assert_eq!(result.documents.len(), 52);

            let documents_by_name: BTreeMap<String, (&str, &str)> = result
                .documents
                .iter()
                .map(|document| {
                    (
                        Path::new(&document.path)
                            .file_name()
                            .expect("real example file should have a name")
                            .to_string_lossy()
                            .to_string(),
                        (document.renderer.as_str(), document.runtime_path.as_str()),
                    )
                })
                .collect();

            for expected_absent in [
                "caffeine_charges.txt",
                "ethanol_dip.json",
                "ethanol_forces_efield.json",
                "mn-h2.log",
                "sn2.gif",
                "sn2_label.txt",
            ] {
                assert!(
                    !documents_by_name.contains_key(expected_absent),
                    "{expected_absent} should stay excluded from structure opening"
                );
            }

            for document in &result.documents {
                let path = Path::new(&document.path);
                assert_eq!(
                    document.renderer,
                    expected_real_renderer(path),
                    "{}",
                    path.display()
                );
                assert!(
                    Path::new(&document.runtime_path).is_file(),
                    "{} should create a runtime HTML file",
                    path.display()
                );
            }

            for document in &result.documents {
                remove_runtime_artifacts(&document.runtime_path);
            }
        });
    }
}
