use serde_json::json;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub(crate) struct XyzrenderArtifact {
    pub(crate) relative_path: &'static str,
    pub(crate) output_type: &'static str,
    pub(crate) preset: &'static str,
    pub(crate) config_argument: &'static str,
    pub(crate) surface_mode: Option<&'static str>,
    pub(crate) elapsed_ms: u128,
    pub(crate) log: String,
}

struct SurfacePlan {
    input_path: PathBuf,
    arguments: Vec<String>,
    mode: Option<&'static str>,
}

struct CubeInfo {
    path: PathBuf,
    key: String,
    role: CubeRole,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CubeRole {
    Mo,
    Density,
    Esp,
    NciSurface,
    NciColor,
    Other,
}

pub(crate) fn create_xyzrender_artifact(
    input_path: &Path,
    output_directory: &Path,
) -> Result<XyzrenderArtifact, String> {
    let output_path = output_directory.join("xyzrender.svg");
    let log_path = output_directory.join("xyzrender.log");
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&log_path);
    let started = Instant::now();
    let surface_plan = surface_plan(input_path);
    let mut command = Command::new(resolve_xyzrender_executable()?);
    command
        .arg(&surface_plan.input_path)
        .arg("-o")
        .arg(&output_path)
        .arg("--config")
        .arg("default");
    for argument in &surface_plan.arguments {
        command.arg(argument);
    }
    let output = command
        .output()
        .map_err(|err| format!("External xyzrender could not be started: {err}"))?;
    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    let _ = fs::write(&log_path, &log);
    if !output.status.success() {
        return Err(format!(
            "External xyzrender failed with exit status {}. {}",
            output.status.code().unwrap_or(-1),
            truncate_text(&log, 320)
        ));
    }
    let metadata = fs::metadata(&output_path).map_err(|_| {
        "External xyzrender finished but did not produce an SVG output file".to_string()
    })?;
    if metadata.len() == 0 {
        return Err("External xyzrender produced an empty SVG output file".into());
    }
    Ok(XyzrenderArtifact {
        relative_path: "xyzrender.svg",
        output_type: "svg",
        preset: "default",
        config_argument: "default",
        surface_mode: surface_plan.mode,
        elapsed_ms: started.elapsed().as_millis(),
        log,
    })
}

fn surface_plan(input_path: &Path) -> SurfacePlan {
    let Some(selected) = cube_info(input_path, true) else {
        return SurfacePlan {
            input_path: input_path.to_path_buf(),
            arguments: Vec::new(),
            mode: None,
        };
    };
    if selected.role == CubeRole::Mo {
        return SurfacePlan {
            input_path: input_path.to_path_buf(),
            arguments: vec!["--mo".into()],
            mode: Some("mo"),
        };
    }
    if let Some(plan) = esp_surface_plan(&selected, input_path) {
        return plan;
    }
    if let Some(plan) = nci_surface_plan(&selected, input_path) {
        return plan;
    }
    if selected.role == CubeRole::Density {
        return SurfacePlan {
            input_path: input_path.to_path_buf(),
            arguments: vec!["--dens".into()],
            mode: Some("density"),
        };
    }
    SurfacePlan {
        input_path: input_path.to_path_buf(),
        arguments: Vec::new(),
        mode: None,
    }
}

fn esp_surface_plan(selected: &CubeInfo, selected_path: &Path) -> Option<SurfacePlan> {
    match selected.role {
        CubeRole::Density => {
            let esp = matching_sibling(selected, &[CubeRole::Esp])?;
            Some(SurfacePlan {
                input_path: selected_path.to_path_buf(),
                arguments: vec![
                    "--esp".into(),
                    esp.path.to_string_lossy().into_owned(),
                    "--cbar".into(),
                ],
                mode: Some("esp"),
            })
        }
        CubeRole::Esp => {
            let density = matching_sibling(selected, &[CubeRole::Density])?;
            Some(SurfacePlan {
                input_path: density.path,
                arguments: vec![
                    "--esp".into(),
                    selected_path.to_string_lossy().into_owned(),
                    "--cbar".into(),
                ],
                mode: Some("esp"),
            })
        }
        _ => None,
    }
}

fn nci_surface_plan(selected: &CubeInfo, selected_path: &Path) -> Option<SurfacePlan> {
    match selected.role {
        CubeRole::Density | CubeRole::NciColor => {
            let surface = matching_sibling(selected, &[CubeRole::NciSurface])?;
            let mut arguments = vec![
                "--nci-surf".into(),
                surface.path.to_string_lossy().into_owned(),
            ];
            arguments.extend(nci_iso_arguments(&surface.path));
            Some(SurfacePlan {
                input_path: selected_path.to_path_buf(),
                arguments,
                mode: Some("nci"),
            })
        }
        CubeRole::NciSurface => {
            let field = matching_sibling(selected, &[CubeRole::Density, CubeRole::NciColor])?;
            let mut arguments = vec![
                "--nci-surf".into(),
                selected_path.to_string_lossy().into_owned(),
            ];
            arguments.extend(nci_iso_arguments(selected_path));
            Some(SurfacePlan {
                input_path: field.path,
                arguments,
                mode: Some("nci"),
            })
        }
        _ => None,
    }
}

fn matching_sibling(selected: &CubeInfo, roles: &[CubeRole]) -> Option<CubeInfo> {
    let directory = selected.path.parent()?;
    let mut candidates = fs::read_dir(directory)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path != &selected.path)
        .filter_map(|path| cube_info(&path, false))
        .filter(|info| info.key == selected.key && roles.contains(&info.role))
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| a.path.to_string_lossy().cmp(&b.path.to_string_lossy()));
    candidates.into_iter().next()
}

fn cube_info(path: &Path, read_header: bool) -> Option<CubeInfo> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    if extension != "cub" && extension != "cube" {
        return None;
    }
    let stem = path.file_stem()?.to_string_lossy().to_ascii_lowercase();
    let tokens = name_tokens(&stem);
    let header = if read_header {
        cube_header(path)
    } else {
        String::new()
    };
    Some(CubeInfo {
        path: path.to_path_buf(),
        key: cube_key(&tokens),
        role: cube_role(&tokens, &header),
    })
}

fn cube_role(tokens: &[String], header: &str) -> CubeRole {
    let contains = |value: &str| tokens.iter().any(|token| token == value);
    if header.contains("molecular orbital") || contains("homo") || contains("lumo") {
        return CubeRole::Mo;
    }
    if header.contains("electrostatic") || contains("esp") || contains("potential") {
        return CubeRole::Esp;
    }
    if header.contains("reduced density gradient")
        || contains("grad")
        || contains("gradient")
        || contains("rdg")
        || contains("dg")
        || contains("inter")
        || contains("intra")
    {
        return CubeRole::NciSurface;
    }
    if contains("sl2r") {
        return CubeRole::NciColor;
    }
    if header.contains("density") || contains("dens") || contains("density") || contains("rho") {
        return CubeRole::Density;
    }
    CubeRole::Other
}

fn cube_key(tokens: &[String]) -> String {
    let kept = tokens
        .iter()
        .filter(|token| {
            !matches!(
                token.as_str(),
                "cube"
                    | "cub"
                    | "homo"
                    | "lumo"
                    | "orbital"
                    | "mo"
                    | "dens"
                    | "density"
                    | "rho"
                    | "esp"
                    | "potential"
                    | "grad"
                    | "gradient"
                    | "rdg"
                    | "sl2r"
                    | "dg"
                    | "inter"
                    | "intra"
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    if kept.is_empty() {
        tokens.join("|")
    } else {
        kept.join("|")
    }
}

fn name_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn cube_header(path: &Path) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let mut buffer = [0_u8; 4096];
    let Ok(count) = file.read(&mut buffer) else {
        return String::new();
    };
    String::from_utf8_lossy(&buffer[..count]).to_ascii_lowercase()
}

fn nci_iso_arguments(path: &Path) -> Vec<String> {
    let name = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name.contains("dg_intra") || name.contains("dg-intra") {
        vec!["--iso".into(), "0.2".into()]
    } else if name.contains("dg_inter") || name.contains("dg-inter") {
        vec!["--iso".into(), "0.005".into()]
    } else {
        Vec::new()
    }
}

fn resolve_xyzrender_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/xyzrender"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join("xyzrender")));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/xyzrender"),
        PathBuf::from("/usr/local/bin/xyzrender"),
    ]);
    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("External xyzrender executable was not found. Install xyzrender in ~/.local/bin or make it available on PATH.".into())
}

pub(crate) fn xyzrender_preset_options() -> serde_json::Value {
    json!([
        { "value": "default", "label": "Default" },
        { "value": "flat", "label": "Flat" },
        { "value": "paton", "label": "Paton" },
        { "value": "pmol", "label": "PMol" },
        { "value": "skeletal", "label": "Skeletal" },
        { "value": "bubble", "label": "Bubble" },
        { "value": "tube", "label": "Tube" },
        { "value": "btube", "label": "BTube" },
        { "value": "mtube", "label": "MTube" },
        { "value": "wire", "label": "Wire" },
        { "value": "graph", "label": "Graph" },
        { "value": "custom", "label": "Custom JSON" }
    ])
}

fn truncate_text(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>()
        + "..."
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cube_molecular_orbital_enables_mo_surface() {
        let dir = temp_dir("mo");
        let path = write_cube(
            &dir,
            "caffeine_homo.cube",
            "Cube data generated by ORCA\nMolecular orbital 50 of operator 0\n",
        );
        let plan = surface_plan(&path);

        assert_eq!(plan.mode, Some("mo"));
        assert_eq!(plan.arguments, vec!["--mo".to_string()]);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn density_cube_with_esp_sibling_maps_esp_surface() {
        let dir = temp_dir("esp");
        let density = write_cube(
            &dir,
            "caffeine_dens.cube",
            "Cube data generated by ORCA\nTotal electron density\n",
        );
        let esp = write_cube(
            &dir,
            "caffeine_esp.cube",
            "Cube data generated by ORCA\nElectrostatic Potential\n",
        );
        let plan = surface_plan(&density);

        assert_eq!(plan.mode, Some("esp"));
        assert_eq!(plan.input_path, density);
        assert_eq!(
            plan.arguments,
            vec![
                "--esp".to_string(),
                esp.to_string_lossy().into_owned(),
                "--cbar".to_string()
            ]
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn nci_surface_sibling_maps_interaction_surface() {
        let dir = temp_dir("nci");
        let density = write_cube(&dir, "base-pair-dens.cube", "dens_cube\n3d plot, density\n");
        let gradient = write_cube(
            &dir,
            "base-pair-grad.cube",
            "grad_cube\n3d plot, reduced density gradient\n",
        );
        let plan = surface_plan(&density);

        assert_eq!(plan.mode, Some("nci"));
        assert_eq!(plan.input_path, density);
        assert_eq!(
            plan.arguments,
            vec![
                "--nci-surf".to_string(),
                gradient.to_string_lossy().into_owned()
            ]
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn density_cube_without_pair_enables_density_surface() {
        let dir = temp_dir("density");
        let density = write_cube(
            &dir,
            "caffeine_dens.cube",
            "Cube data generated by ORCA\nTotal electron density\n",
        );
        let plan = surface_plan(&density);

        assert_eq!(plan.mode, Some("density"));
        assert_eq!(plan.arguments, vec!["--dens".to_string()]);

        let _ = fs::remove_dir_all(dir);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("burrete-xyzrender-{name}-{stamp}"));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    fn write_cube(dir: &Path, name: &str, header: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(
            &path,
            format!("{header}   1   0.0   0.0   0.0\n   1   1.0   0.0   0.0\n   1   0.0   1.0   0.0\n   1   0.0   0.0   1.0\n   6   6.0   0.0   0.0   0.0\n0.0\n"),
        )
        .expect("cube fixture should be written");
        path
    }
}
