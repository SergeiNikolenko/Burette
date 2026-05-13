#[derive(Clone)]
pub(crate) struct FormatInfo {
    pub(crate) molstar_format: &'static str,
    pub(crate) is_binary: bool,
    pub(crate) external_only: bool,
}

pub(crate) fn format_for_extension(extension: &str) -> Result<FormatInfo, String> {
    let format = match extension {
        "pdb" | "ent" | "pdbqt" | "pqr" => FormatInfo {
            molstar_format: "pdb",
            is_binary: false,
            external_only: false,
        },
        "cif" | "mcif" | "mmcif" => FormatInfo {
            molstar_format: "mmcif",
            is_binary: false,
            external_only: false,
        },
        "bcif" => FormatInfo {
            molstar_format: "mmcif",
            is_binary: true,
            external_only: false,
        },
        "sdf" | "sd" => FormatInfo {
            molstar_format: "sdf",
            is_binary: false,
            external_only: false,
        },
        "mol" => FormatInfo {
            molstar_format: "mol",
            is_binary: false,
            external_only: false,
        },
        "mol2" => FormatInfo {
            molstar_format: "mol2",
            is_binary: false,
            external_only: false,
        },
        "xyz" => FormatInfo {
            molstar_format: "xyz",
            is_binary: false,
            external_only: false,
        },
        "gro" => FormatInfo {
            molstar_format: "gro",
            is_binary: false,
            external_only: false,
        },
        "cub" | "cube" | "in" | "log" | "out" | "vasp" => FormatInfo {
            molstar_format: "xyz",
            is_binary: false,
            external_only: true,
        },
        other => return Err(format!("Unsupported structure extension: {other}")),
    };
    Ok(format)
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
        "xyz-fast" => {
            if is_xyz {
                "xyz-fast"
            } else {
                "molstar"
            }
        }
        .to_string(),
        "xyzrender-external" => {
            if is_xyz {
                "xyzrender-external"
            } else {
                "molstar"
            }
        }
        .to_string(),
        _ => {
            if is_xyz {
                "xyz-fast"
            } else {
                "molstar"
            }
        }
        .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_structure_extensions_to_molstar_formats() {
        assert_eq!(format_for_extension("pdb").unwrap().molstar_format, "pdb");
        assert_eq!(
            format_for_extension("mmcif").unwrap().molstar_format,
            "mmcif"
        );
        assert!(format_for_extension("bcif").unwrap().is_binary);
        assert_eq!(format_for_extension("sdf").unwrap().molstar_format, "sdf");
        assert!(format_for_extension("txt").is_err());
    }

    #[test]
    fn chooses_fast_xyz_only_for_text_xyz_formats() {
        let xyz = format_for_extension("xyz").unwrap();
        let pdb = format_for_extension("pdb").unwrap();

        assert_eq!(resolve_renderer(&xyz, "auto"), "xyz-fast");
        assert_eq!(resolve_renderer(&xyz, "xyzrender"), "xyzrender-external");
        assert_eq!(resolve_renderer(&pdb, "xyz-fast"), "molstar");
        assert_eq!(resolve_renderer(&pdb, "auto"), "molstar");
    }

    #[test]
    fn forces_external_renderer_for_external_only_formats() {
        let cube = format_for_extension("cube").unwrap();

        assert_eq!(resolve_renderer(&cube, "molstar"), "xyzrender-external");
        assert_eq!(resolve_renderer(&cube, "auto"), "xyzrender-external");
    }
}
