use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::Deserialize;

const FORMAT_REGISTRY_JSON: &str = include_str!("../../../../../config/preview-formats.json");
static FORMAT_REGISTRY: OnceLock<Result<FormatRegistry, String>> = OnceLock::new();

#[derive(Clone, Debug)]
pub(crate) struct FormatInfo {
    pub(crate) molstar_format: String,
    pub(crate) is_binary: bool,
    pub(crate) external_only: bool,
    pub(crate) can_open_in_vesta: bool,
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

pub(crate) fn format_for_extension(extension: &str) -> Result<FormatInfo, String> {
    let normalized = extension.trim().to_ascii_lowercase();
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

pub(crate) fn supported_structure_extensions() -> Result<BTreeSet<String>, String> {
    Ok(format_registry()?
        .formats
        .iter()
        .flat_map(|format| format.extensions.iter().cloned())
        .collect())
}

pub(crate) fn normalize_renderer_mode(raw: &str) -> &str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "xyz-fast" | "fast-xyz" | "xyzfast" => "xyz-fast",
        "molstar" | "mol*" | "interactive" => "molstar",
        "xyzrender-external" | "external-xyzrender" | "xyzrender" => "xyzrender-external",
        _ => "auto",
    }
}

pub(crate) fn resolve_renderer(format: &FormatInfo, requested: &str) -> String {
    if format.external_only {
        return "xyzrender-external".to_string();
    }
    let is_xyz = format.molstar_format == "xyz" && !format.is_binary;
    match normalize_renderer_mode(requested) {
        "molstar" => "molstar".to_string(),
        "xyz-fast" => if is_xyz { "xyz-fast" } else { "molstar" }.to_string(),
        "xyzrender-external" => if is_xyz {
            "xyzrender-external"
        } else {
            "molstar"
        }
        .to_string(),
        _ => if is_xyz { "xyzrender-external" } else { "molstar" }.to_string(),
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
        assert_eq!(resolve_renderer(&cif, "xyz-fast"), "molstar");
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
    fn forces_external_renderer_for_external_only_formats() {
        let cube = format_for_extension("cube").expect("cube should be supported");
        assert!(cube.external_only);
        assert_eq!(resolve_renderer(&cube, "molstar"), "xyzrender-external");
        assert_eq!(resolve_renderer(&cube, "xyz-fast"), "xyzrender-external");
    }

    #[test]
    fn supports_quantum_chemistry_input_extensions_via_xyzrender() {
        for extension in ["abi", "com", "fdf", "inp", "nw", "psi4", "qcin"] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, "xyz");
            assert!(format.external_only, "{extension} should require xyzrender");
            assert_eq!(resolve_renderer(&format, "auto"), "xyzrender-external");
        }
    }

    #[test]
    fn rejects_unknown_extensions() {
        let error = format_for_extension("txt").expect_err("txt should not be supported");
        assert!(error.contains("Unsupported structure extension: txt"));
        let error = format_for_extension("log").expect_err("log should not be supported");
        assert!(error.contains("Unsupported structure extension: log"));
    }
}
