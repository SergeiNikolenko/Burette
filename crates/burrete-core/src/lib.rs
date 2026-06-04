use std::collections::BTreeSet;
use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;

const FORMAT_REGISTRY_JSON: &str = include_str!("../../../config/preview-formats.json");
static FORMAT_REGISTRY: OnceLock<Result<FormatRegistry, String>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormatInfo {
    pub molstar_format: String,
    pub is_binary: bool,
    pub external_only: bool,
    pub can_open_in_vesta: bool,
}

#[derive(Debug, Deserialize)]
struct FormatRegistry {
    formats: Vec<RegistryFormat>,
}

#[derive(Debug, Deserialize)]
struct RegistryFormat {
    extensions: Vec<String>,
    viewer: Option<RegistryViewer>,
    #[serde(default, rename = "canOpenInVesta")]
    can_open_in_vesta: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryViewer {
    molstar_format: String,
    binary: bool,
    #[serde(default)]
    external_only: bool,
}

fn format_registry() -> Result<&'static FormatRegistry, String> {
    match FORMAT_REGISTRY.get_or_init(|| {
        serde_json::from_str(FORMAT_REGISTRY_JSON)
            .map_err(|err| format!("Invalid preview format registry: {err}"))
    }) {
        Ok(registry) => Ok(registry),
        Err(error) => Err(error.clone()),
    }
}

pub fn format_for_extension(extension: &str) -> Result<FormatInfo, String> {
    let normalized = extension.trim().to_ascii_lowercase();
    if let Some(format) = molstar_format_for_extension(&normalized) {
        return Ok(format);
    }
    format_registry()?
        .formats
        .iter()
        .find(|format| format.extensions.iter().any(|value| value == &normalized))
        .and_then(|format| {
            format
                .viewer
                .as_ref()
                .map(|viewer| (viewer, format.can_open_in_vesta))
        })
        .map(|(viewer, can_open_in_vesta)| FormatInfo {
            molstar_format: viewer.molstar_format.clone(),
            is_binary: viewer.binary,
            external_only: viewer.external_only,
            can_open_in_vesta,
        })
        .ok_or_else(|| format!("Unsupported structure extension: {normalized}"))
}

fn molstar_format_for_extension(extension: &str) -> Option<FormatInfo> {
    match extension {
        "xtc" | "trr" | "dcd" | "nctraj" => Some(FormatInfo {
            molstar_format: extension.to_string(),
            is_binary: true,
            external_only: false,
            can_open_in_vesta: false,
        }),
        "lammpstrj" | "top" | "psf" | "prmtop" => Some(FormatInfo {
            molstar_format: extension.to_string(),
            is_binary: false,
            external_only: false,
            can_open_in_vesta: false,
        }),
        _ => None,
    }
}

pub fn structure_path_extension(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.ends_with(".mae.gz") {
        return "maegz".to_string();
    }
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn supported_structure_extensions() -> Result<BTreeSet<String>, String> {
    Ok(format_registry()?
        .formats
        .iter()
        .flat_map(|format| format.extensions.iter().cloned())
        .collect())
}

pub fn is_supported_extension(extension: &str) -> Result<bool, String> {
    let normalized = normalize_extension(extension);
    Ok(supported_structure_extensions()?.contains(normalized.as_str()))
}

pub fn quick_look_size_limit_for_extension(extension: &str) -> i64 {
    let mib: i64 = 1024 * 1024;
    match normalize_extension(extension).as_str() {
        "pdb" | "ent" | "pdbqt" | "pqr" => 35 * mib,
        "cif" | "mmcif" | "mcif" => 40 * mib,
        "bcif" => 50 * mib,
        "abi" | "com" | "csv" | "fdf" | "sdf" | "sd" | "mol" | "mol2" | "xyz" | "gro" | "smi"
        | "smiles" | "tsv" | "cub" | "cube" | "in" | "inp" | "nw" | "out" | "psi4" | "qcin"
        | "vasp" | "lammpstrj" | "top" | "psf" | "prmtop" => 25 * mib,
        "mae" | "maegz" | "cms" => 64 * mib,
        "xtc" | "trr" | "dcd" | "nctraj" => 75 * mib,
        _ => 20 * mib,
    }
}

pub fn normalize_renderer_mode(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "grid2d" | "grid" | "grid-2d" => "grid2d",
        "molstar" | "mol*" | "interactive" => "molstar",
        "xyzrender-external" | "external-xyzrender" | "xyzrender" => "xyzrender-external",
        _ => "auto",
    }
}

pub fn resolve_renderer(format: &FormatInfo, requested: &str) -> String {
    let normalized = normalize_renderer_mode(requested);
    if format.external_only {
        return if normalized == "molstar" {
            "molstar"
        } else {
            "xyzrender-external"
        }
        .to_string();
    }
    let is_xyz = format.molstar_format == "xyz" && !format.is_binary;
    let can_use_xyzrender = is_xyz || can_use_external_xyzrender(format);
    match normalized {
        "molstar" => "molstar".to_string(),
        "xyzrender-external" => if can_use_xyzrender {
            "xyzrender-external"
        } else {
            "molstar"
        }
        .to_string(),
        _ => if is_xyz {
            "xyzrender-external"
        } else {
            "molstar"
        }
        .to_string(),
    }
}

fn can_use_external_xyzrender(format: &FormatInfo) -> bool {
    !format.is_binary
        && matches!(
            format.molstar_format.as_str(),
            "sdf" | "pdb" | "pdbqt" | "mmcif" | "cifCore"
        )
}

fn normalize_extension(extension: &str) -> String {
    match extension.trim().to_ascii_lowercase().as_str() {
        "mae.gz" => "maegz".to_string(),
        value => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_common_structure_formats_to_molstar() {
        let pdb = format_for_extension("pdb").expect("pdb should be supported");
        assert_eq!(pdb.molstar_format, "pdb");
        assert!(!pdb.is_binary);
        assert!(!pdb.external_only);
        assert_eq!(resolve_renderer(&pdb, "auto"), "molstar");

        let cif = format_for_extension("mmcif").expect("mmcif should be supported");
        assert_eq!(cif.molstar_format, "mmcif");
    }

    #[test]
    fn keeps_xyzrender_as_default_for_xyz_files() {
        let xyz = format_for_extension("xyz").expect("xyz should be supported");
        assert_eq!(resolve_renderer(&xyz, "auto"), "xyzrender-external");
        assert_eq!(resolve_renderer(&xyz, "mol*"), "molstar");
        assert_eq!(
            resolve_renderer(&xyz, "external-xyzrender"),
            "xyzrender-external"
        );
    }

    #[test]
    fn allows_explicit_xyzrender_for_sdf_files() {
        let sdf = format_for_extension("sdf").expect("sdf should be supported");
        assert_eq!(resolve_renderer(&sdf, "auto"), "molstar");
        assert_eq!(resolve_renderer(&sdf, "mol*"), "molstar");
        assert_eq!(
            resolve_renderer(&sdf, "external-xyzrender"),
            "xyzrender-external"
        );
    }

    #[test]
    fn allows_explicit_xyzrender_for_pdb_and_cif_files() {
        let pdb = format_for_extension("pdb").expect("pdb should be supported");
        assert_eq!(resolve_renderer(&pdb, "auto"), "molstar");
        assert_eq!(
            resolve_renderer(&pdb, "external-xyzrender"),
            "xyzrender-external"
        );

        let cif = format_for_extension("cif").expect("cif should be supported");
        assert_eq!(resolve_renderer(&cif, "auto"), "molstar");
        assert_eq!(
            resolve_renderer(&cif, "external-xyzrender"),
            "xyzrender-external"
        );
    }

    #[test]
    fn forces_external_renderer_for_external_only_formats() {
        let cube = format_for_extension("cube").expect("cube should be supported");
        assert!(cube.external_only);
        assert_eq!(resolve_renderer(&cube, "auto"), "xyzrender-external");
        assert_eq!(resolve_renderer(&cube, "molstar"), "molstar");

        let cub = format_for_extension("cub").expect("cub should be supported");
        assert!(cub.external_only);
        assert_eq!(resolve_renderer(&cub, "auto"), "xyzrender-external");
    }

    #[test]
    fn supports_quantum_chemistry_input_extensions_via_xyzrender() {
        for extension in ["abi", "com", "fdf", "inp", "nw", "out", "psi4", "qcin"] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, "xyz");
            assert!(format.external_only, "{extension} should require xyzrender");
            assert_eq!(resolve_renderer(&format, "auto"), "xyzrender-external");
        }
    }

    #[test]
    fn supports_schrodinger_formats_via_xyzrender() {
        for extension in ["mae", "maegz", "cms"] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, "xyz");
            assert!(format.external_only, "{extension} should require xyzrender");
            assert_eq!(resolve_renderer(&format, "auto"), "xyzrender-external");
        }
        assert_eq!(
            structure_path_extension(Path::new("ligand.mae.gz")),
            "maegz"
        );
    }

    #[test]
    fn routes_md_trajectory_and_topology_extensions_to_molstar() {
        for extension in ["xtc", "trr", "dcd", "nctraj"] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, extension);
            assert!(format.is_binary, "{extension} should be binary");
            assert!(!format.external_only, "{extension} should be Mol* capable");
            assert_eq!(resolve_renderer(&format, "auto"), "molstar");
        }

        for extension in ["lammpstrj", "top", "psf", "prmtop"] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, extension);
            assert!(!format.is_binary, "{extension} should be text");
            assert!(!format.external_only, "{extension} should be Mol* capable");
            assert_eq!(resolve_renderer(&format, "auto"), "molstar");
        }
    }

    #[test]
    fn normalizes_renderer_mode_aliases() {
        assert_eq!(normalize_renderer_mode(" mol* "), "molstar");
        assert_eq!(normalize_renderer_mode("grid"), "grid2d");
        assert_eq!(normalize_renderer_mode("grid-2d"), "grid2d");
        assert_eq!(normalize_renderer_mode("fast-xyz"), "auto");
        assert_eq!(normalize_renderer_mode("xyzrender"), "xyzrender-external");
        assert_eq!(normalize_renderer_mode("unknown"), "auto");
    }

    #[test]
    fn lists_supported_structure_extensions_from_registry() {
        let supported = supported_structure_extensions().expect("supported extensions should load");
        for extension in ["pdb", "cif", "sdf", "xyz", "maegz"] {
            assert!(
                supported.contains(extension),
                "{extension} should be supported"
            );
        }
    }

    #[test]
    fn recognizes_supported_extensions_from_registry() {
        assert!(is_supported_extension("pdb").expect("registry should load"));
        assert!(is_supported_extension("MAE.GZ").expect("registry should load"));
        assert!(!is_supported_extension("txt").expect("registry should load"));
    }

    #[test]
    fn exposes_quick_look_size_limits() {
        let mib: i64 = 1024 * 1024;
        assert_eq!(quick_look_size_limit_for_extension("pdb"), 35 * mib);
        assert_eq!(quick_look_size_limit_for_extension("mmcif"), 40 * mib);
        assert_eq!(quick_look_size_limit_for_extension("bcif"), 50 * mib);
        assert_eq!(quick_look_size_limit_for_extension("sdf"), 25 * mib);
        assert_eq!(quick_look_size_limit_for_extension("mae.gz"), 64 * mib);
        assert_eq!(quick_look_size_limit_for_extension("xtc"), 75 * mib);
        assert_eq!(quick_look_size_limit_for_extension("txt"), 20 * mib);
    }

    #[test]
    fn rejects_unknown_extensions() {
        let error = format_for_extension("txt").expect_err("txt should not be supported");
        assert!(error.contains("Unsupported structure extension: txt"));
        let error = format_for_extension("log").expect_err("log should not be supported");
        assert!(error.contains("Unsupported structure extension: log"));
    }
}
