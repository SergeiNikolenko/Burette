use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const FORMAT_REGISTRY_JSON: &str = include_str!("../../../config/preview-formats.json");
static FORMAT_REGISTRY: OnceLock<Result<FormatRegistry, String>> = OnceLock::new();

pub const PREVIEW_CONTRACT_SCHEMA_VERSION: u32 = 1;
pub const PREVIEW_TRACE_FILE: &str = "preview-trace.jsonl";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewLifecycleState {
    Created,
    Completed,
    Failed,
}

impl PreviewLifecycleState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn can_transition_from(self, previous: Option<Self>) -> bool {
        matches!(
            (previous, self),
            (None, Self::Created) | (Some(Self::Created), Self::Completed | Self::Failed)
        )
    }
}

#[derive(Debug, Default)]
pub struct PreviewLifecycle {
    state: Option<PreviewLifecycleState>,
}

impl PreviewLifecycle {
    pub fn state(&self) -> Option<PreviewLifecycleState> {
        self.state
    }

    pub fn transition(&mut self, next: PreviewLifecycleState) -> Result<(), &'static str> {
        if next.can_transition_from(self.state) {
            self.state = Some(next);
            Ok(())
        } else {
            Err("invalid preview lifecycle transition")
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewSubsystem {
    Desktop,
    QuickLook,
}

impl PreviewSubsystem {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::QuickLook => "quicklook",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PreviewTracePayload<'a> {
    pub timestamp_ms: u128,
    pub document_id: &'a str,
    pub state: PreviewLifecycleState,
    pub subsystem: PreviewSubsystem,
    pub source_extension: Option<&'a str>,
    pub renderer: Option<&'a str>,
    pub runtime_path: Option<&'a str>,
    pub elapsed_ms: Option<u128>,
    pub error_code: Option<&'a str>,
    pub message: Option<&'a str>,
}

pub fn preview_trace_payload(event: PreviewTracePayload<'_>) -> Value {
    let mut payload = json!({
        "schemaVersion": PREVIEW_CONTRACT_SCHEMA_VERSION,
        "timestampMs": event.timestamp_ms,
        "documentId": event.document_id,
        "state": event.state.as_str(),
        "subsystem": event.subsystem.as_str()
    });
    let Some(object) = payload.as_object_mut() else {
        return payload;
    };
    if let Some(source_extension) = event.source_extension {
        object.insert("sourceExtension".into(), json!(source_extension));
    }
    if let Some(renderer) = event.renderer {
        object.insert("renderer".into(), json!(renderer));
    }
    if let Some(runtime_path) = event.runtime_path {
        object.insert("runtimePath".into(), json!(runtime_path));
    }
    if let Some(elapsed_ms) = event.elapsed_ms {
        object.insert("elapsedMs".into(), json!(elapsed_ms));
    }
    if let Some(error_code) = event.error_code {
        object.insert("errorCode".into(), json!(error_code));
    }
    if let Some(message) = event.message {
        object.insert("message".into(), json!(message.replace(['\n', '\r'], " ")));
    }
    payload
}

#[derive(Clone, Copy, Debug)]
pub struct PreviewRuntimeManifest<'a> {
    pub created_at_ms: u128,
    pub complete: bool,
    pub document_id: &'a str,
    pub source_extension: &'a str,
    pub renderer: &'a str,
    pub byte_count: usize,
    pub preview_byte_count: usize,
    pub asset_profile: Option<&'a str>,
    pub host: Option<&'a str>,
}

pub fn preview_runtime_manifest(input: PreviewRuntimeManifest<'_>) -> Value {
    let mut payload = json!({
        "schemaVersion": PREVIEW_CONTRACT_SCHEMA_VERSION,
        "createdAtMs": input.created_at_ms,
        "complete": input.complete,
        "documentId": input.document_id,
        "sourceExtension": input.source_extension,
        "renderer": input.renderer,
        "byteCount": input.byte_count,
        "previewByteCount": input.preview_byte_count
    });
    let Some(object) = payload.as_object_mut() else {
        return payload;
    };
    if let Some(asset_profile) = input.asset_profile {
        object.insert("assetProfile".into(), json!(asset_profile));
    }
    if let Some(host) = input.host {
        object.insert("host".into(), json!(host));
    }
    payload
}

pub fn preview_error_code_for_message(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("unsupported structure") {
        "BRT-PREVIEW-UNSUPPORTED"
    } else if lower.contains("larger than") || lower.contains("too large") {
        "BRT-PREVIEW-FILE-TOO-LARGE"
    } else if lower.contains(" empty") || lower.ends_with(" is empty") {
        "BRT-PREVIEW-EMPTY-FILE"
    } else if lower.contains("grid records") {
        "BRT-PREVIEW-GRID-NO-RECORDS"
    } else if lower.contains("xyzrender") {
        "BRT-PREVIEW-XYZRENDER"
    } else {
        "BRT-PREVIEW-RUNTIME-ERROR"
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormatInfo {
    pub molstar_format: String,
    pub is_binary: bool,
    pub external_only: bool,
    pub can_open_in_vesta: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewStrategy {
    Direct,
    Convert,
    External,
    Grid,
    Trajectory,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPrimary {
    pub role: String,
    pub format: String,
    pub binary: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewConverter {
    pub id: String,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStagedEntry {
    pub role: String,
    pub format: String,
    pub representation: String,
    pub required_for_ready: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFallback {
    pub renderer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub converter: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct PreviewCapabilities {
    pub can_open_in_vesta: bool,
    pub can_switch_renderer: bool,
    pub has_trajectory_controls: bool,
    pub has_grid_search: bool,
    pub has_staged_entries: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPlan {
    pub source_extension: String,
    pub strategy: PreviewStrategy,
    pub renderer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<PreviewPrimary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub converter: Option<PreviewConverter>,
    pub staged: Vec<PreviewStagedEntry>,
    pub fallbacks: Vec<PreviewFallback>,
    pub capabilities: PreviewCapabilities,
}

#[derive(Debug, Deserialize)]
struct FormatRegistry {
    formats: Vec<RegistryFormat>,
}

#[derive(Debug, Deserialize)]
struct RegistryFormat {
    #[cfg(test)]
    id: String,
    extensions: Vec<String>,
    viewer: Option<RegistryViewer>,
    preview: Option<RegistryPreview>,
    #[serde(rename = "quickLook")]
    quick_look: Option<RegistryQuickLook>,
    #[serde(default, rename = "canOpenInVesta")]
    can_open_in_vesta: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPreview {
    strategy: PreviewStrategy,
    renderer: String,
    primary: Option<PreviewPrimary>,
    converter: Option<PreviewConverter>,
    formats: Option<RegistryPreviewFormats>,
    #[serde(default)]
    staged: Vec<PreviewStagedEntry>,
    #[serde(default)]
    fallbacks: Vec<PreviewFallback>,
    #[serde(default)]
    capabilities: PreviewCapabilities,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPreviewFormats {
    #[serde(default)]
    coordinates_binary: Vec<String>,
    #[serde(default)]
    coordinates_text: Vec<String>,
    #[serde(default)]
    topology_text: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryViewer {
    molstar_format: String,
    binary: bool,
    #[serde(default)]
    external_only: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryQuickLook {
    #[serde(rename = "sizeLimitMiB")]
    size_limit_mib: Option<i64>,
    #[serde(default)]
    #[serde(rename = "extensionSizeLimitMiB")]
    extension_size_limit_mib: BTreeMap<String, i64>,
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
    if let Some(format) = trajectory_format_from_registry(&normalized)?.map(|format| format.info) {
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

pub fn preview_plan_for_extension(
    extension: &str,
    requested_renderer: &str,
) -> Result<PreviewPlan, String> {
    let normalized = normalize_extension(extension);
    let requested = normalize_renderer_mode(requested_renderer);

    if matches!(normalized.as_str(), "csv" | "tsv" | "smi" | "smiles")
        || requested == "grid2d" && matches!(normalized.as_str(), "sdf" | "sd")
    {
        return Ok(grid_preview_plan(&normalized));
    }

    if let Some(format) = registry_format_for_extension(&normalized)? {
        if let Some(preview) = format.preview.as_ref() {
            return preview_plan_from_registry(&normalized, preview, format, requested);
        }
    }

    let format = format_for_extension(&normalized)?;
    if format.external_only {
        return Ok(PreviewPlan {
            source_extension: normalized.clone(),
            strategy: PreviewStrategy::External,
            renderer: resolve_renderer(&format, requested),
            primary: Some(PreviewPrimary {
                role: "external-artifact".to_string(),
                format: format.molstar_format,
                binary: format.is_binary,
            }),
            converter: None,
            staged: Vec::new(),
            fallbacks: vec![PreviewFallback {
                renderer: "molstar".to_string(),
                converter: Some("text-coordinates-to-pdb".to_string()),
            }],
            capabilities: PreviewCapabilities {
                can_open_in_vesta: format.can_open_in_vesta,
                can_switch_renderer: true,
                ..PreviewCapabilities::default()
            },
        });
    }

    let renderer = resolve_renderer(&format, requested);
    let can_switch_renderer = can_use_external_xyzrender(&format)
        || format.molstar_format == "xyz" && !format.is_binary
        || matches!(normalized.as_str(), "sdf" | "sd");
    Ok(PreviewPlan {
        source_extension: normalized.clone(),
        strategy: PreviewStrategy::Direct,
        renderer,
        primary: Some(PreviewPrimary {
            role: "structure".to_string(),
            format: format.molstar_format,
            binary: format.is_binary,
        }),
        converter: None,
        staged: Vec::new(),
        fallbacks: direct_fallbacks(&normalized),
        capabilities: PreviewCapabilities {
            can_open_in_vesta: format.can_open_in_vesta,
            can_switch_renderer,
            has_grid_search: matches!(normalized.as_str(), "sdf" | "sd"),
            ..PreviewCapabilities::default()
        },
    })
}

fn registry_format_for_extension(
    extension: &str,
) -> Result<Option<&'static RegistryFormat>, String> {
    Ok(format_registry()?
        .formats
        .iter()
        .find(|format| format.extensions.iter().any(|value| value == extension)))
}

fn preview_plan_from_registry(
    extension: &str,
    preview: &RegistryPreview,
    format: &RegistryFormat,
    requested: &str,
) -> Result<PreviewPlan, String> {
    match &preview.strategy {
        PreviewStrategy::Grid => Ok(grid_preview_plan(extension)),
        PreviewStrategy::Trajectory => {
            let trajectory = trajectory_format_from_registry(extension)?.ok_or_else(|| {
                format!("Trajectory preview formats do not declare extension: {extension}")
            })?;
            Ok(PreviewPlan {
                source_extension: extension.to_string(),
                strategy: PreviewStrategy::Trajectory,
                renderer: preview.renderer.clone(),
                primary: Some(preview.primary.clone().unwrap_or(PreviewPrimary {
                    role: trajectory.role.to_string(),
                    format: trajectory.info.molstar_format,
                    binary: trajectory.info.is_binary,
                })),
                converter: preview.converter.clone(),
                staged: preview.staged.clone(),
                fallbacks: preview.fallbacks.clone(),
                capabilities: PreviewCapabilities {
                    can_open_in_vesta: format.can_open_in_vesta,
                    has_trajectory_controls: trajectory.has_trajectory_controls
                        && preview.capabilities.has_trajectory_controls,
                    ..preview.capabilities.clone()
                },
            })
        }
        PreviewStrategy::External => {
            let format_info = format_for_extension(extension)?;
            Ok(PreviewPlan {
                source_extension: extension.to_string(),
                strategy: PreviewStrategy::External,
                renderer: if requested == "molstar" {
                    "molstar".to_string()
                } else {
                    preview.renderer.clone()
                },
                primary: Some(preview.primary.clone().unwrap_or(PreviewPrimary {
                    role: "external-artifact".to_string(),
                    format: format_info.molstar_format,
                    binary: format_info.is_binary,
                })),
                converter: preview.converter.clone(),
                staged: preview.staged.clone(),
                fallbacks: preview.fallbacks.clone(),
                capabilities: PreviewCapabilities {
                    can_open_in_vesta: format.can_open_in_vesta,
                    ..preview.capabilities.clone()
                },
            })
        }
        PreviewStrategy::Convert => Ok(PreviewPlan {
            source_extension: extension.to_string(),
            strategy: PreviewStrategy::Convert,
            renderer: if requested == "xyzrender-external"
                && preview
                    .fallbacks
                    .iter()
                    .any(|fallback| fallback.renderer == "xyzrender-external")
            {
                "xyzrender-external".to_string()
            } else {
                preview.renderer.clone()
            },
            primary: preview.primary.clone(),
            converter: preview.converter.clone(),
            staged: preview.staged.clone(),
            fallbacks: preview.fallbacks.clone(),
            capabilities: PreviewCapabilities {
                can_open_in_vesta: format.can_open_in_vesta,
                ..preview.capabilities.clone()
            },
        }),
        PreviewStrategy::Custom => Ok(PreviewPlan {
            source_extension: extension.to_string(),
            strategy: PreviewStrategy::Custom,
            renderer: preview.renderer.clone(),
            primary: preview.primary.clone(),
            converter: preview.converter.clone(),
            staged: preview.staged.clone(),
            fallbacks: preview.fallbacks.clone(),
            capabilities: PreviewCapabilities {
                can_open_in_vesta: format.can_open_in_vesta,
                ..preview.capabilities.clone()
            },
        }),
        PreviewStrategy::Direct => {
            let format_info = format_for_extension(extension)?;
            Ok(PreviewPlan {
                source_extension: extension.to_string(),
                strategy: PreviewStrategy::Direct,
                renderer: resolve_renderer(&format_info, requested),
                primary: Some(preview.primary.clone().unwrap_or(PreviewPrimary {
                    role: "structure".to_string(),
                    format: format_info.molstar_format,
                    binary: format_info.is_binary,
                })),
                converter: preview.converter.clone(),
                staged: preview.staged.clone(),
                fallbacks: preview.fallbacks.clone(),
                capabilities: PreviewCapabilities {
                    can_open_in_vesta: format.can_open_in_vesta,
                    ..preview.capabilities.clone()
                },
            })
        }
    }
}

#[derive(Debug)]
struct TrajectoryFormat {
    info: FormatInfo,
    role: &'static str,
    has_trajectory_controls: bool,
}

fn trajectory_format_from_registry(extension: &str) -> Result<Option<TrajectoryFormat>, String> {
    let Some(format) = registry_format_for_extension(extension)? else {
        return Ok(None);
    };
    let Some(preview) = format.preview.as_ref() else {
        return Ok(None);
    };
    if preview.strategy != PreviewStrategy::Trajectory {
        return Ok(None);
    }
    let Some(formats) = preview.formats.as_ref() else {
        return Ok(None);
    };

    if preview_format_values_contain(&formats.coordinates_binary, extension) {
        return Ok(Some(TrajectoryFormat {
            info: FormatInfo {
                molstar_format: extension.to_string(),
                is_binary: true,
                external_only: false,
                can_open_in_vesta: format.can_open_in_vesta,
            },
            role: "trajectory-coordinates",
            has_trajectory_controls: true,
        }));
    }

    if preview_format_values_contain(&formats.coordinates_text, extension) {
        return Ok(Some(TrajectoryFormat {
            info: FormatInfo {
                molstar_format: extension.to_string(),
                is_binary: false,
                external_only: false,
                can_open_in_vesta: format.can_open_in_vesta,
            },
            role: "trajectory-coordinates",
            has_trajectory_controls: true,
        }));
    }

    if preview_format_values_contain(&formats.topology_text, extension) {
        return Ok(Some(TrajectoryFormat {
            info: FormatInfo {
                molstar_format: extension.to_string(),
                is_binary: false,
                external_only: false,
                can_open_in_vesta: format.can_open_in_vesta,
            },
            role: "trajectory-topology",
            has_trajectory_controls: false,
        }));
    }

    Ok(None)
}

fn preview_format_values_contain(values: &[String], extension: &str) -> bool {
    values.iter().any(|value| value == extension)
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
    let normalized = normalize_extension(extension);
    match quick_look_size_limit_mib_from_registry(&normalized) {
        Some(size_limit_mib) => size_limit_mib * mib,
        None => 20 * mib,
    }
}

fn quick_look_size_limit_mib_from_registry(extension: &str) -> Option<i64> {
    let format = registry_format_for_extension(extension).ok().flatten()?;
    let quick_look = format.quick_look.as_ref()?;
    quick_look
        .extension_size_limit_mib
        .get(extension)
        .copied()
        .or(quick_look.size_limit_mib)
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

fn grid_preview_plan(extension: &str) -> PreviewPlan {
    let format = match extension {
        "smi" | "smiles" => "smiles",
        "sdf" | "sd" => "sdf",
        value => value,
    };
    PreviewPlan {
        source_extension: extension.to_string(),
        strategy: PreviewStrategy::Grid,
        renderer: "grid2d".to_string(),
        primary: Some(PreviewPrimary {
            role: "grid-records".to_string(),
            format: format.to_string(),
            binary: false,
        }),
        converter: None,
        staged: Vec::new(),
        fallbacks: if matches!(extension, "sdf" | "sd") {
            vec![PreviewFallback {
                renderer: "molstar".to_string(),
                converter: None,
            }]
        } else {
            Vec::new()
        },
        capabilities: PreviewCapabilities {
            has_grid_search: true,
            can_switch_renderer: matches!(extension, "sdf" | "sd"),
            ..PreviewCapabilities::default()
        },
    }
}

fn direct_fallbacks(extension: &str) -> Vec<PreviewFallback> {
    if matches!(
        extension,
        "pdb" | "ent" | "pdbqt" | "pqr" | "cif" | "mmcif" | "mcif" | "sdf" | "sd" | "xyz"
    ) {
        vec![PreviewFallback {
            renderer: "xyzrender-external".to_string(),
            converter: None,
        }]
    } else {
        Vec::new()
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
        for extension in [
            "abi", "com", "fdf", "inp", "log", "nw", "out", "psi4", "qcin",
        ] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, "xyz");
            assert!(format.external_only, "{extension} should require xyzrender");
            assert_eq!(resolve_renderer(&format, "auto"), "xyzrender-external");
        }
    }

    #[test]
    fn keeps_legacy_schrodinger_format_info_but_plans_conversion() {
        for extension in ["mae", "maegz", "cms"] {
            let format = format_for_extension(extension)
                .unwrap_or_else(|_| panic!("{extension} should be supported"));
            assert_eq!(format.molstar_format, "xyz");
            assert!(
                format.external_only,
                "{extension} should keep legacy external-only format info until callers migrate to PreviewPlan"
            );

            let plan = preview_plan_for_extension(extension, "auto")
                .unwrap_or_else(|_| panic!("{extension} preview plan should resolve"));
            assert_eq!(plan.strategy, PreviewStrategy::Convert);
            assert_eq!(plan.renderer, "molstar");
            assert_eq!(
                plan.converter
                    .as_ref()
                    .map(|converter| converter.id.as_str()),
                Some("maestro-to-pdb")
            );
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
    fn registry_declares_trajectory_format_roles() {
        for (extension, expected_binary, expected_role, expected_controls) in [
            ("xtc", true, "trajectory-coordinates", true),
            ("lammpstrj", false, "trajectory-coordinates", true),
            ("prmtop", false, "trajectory-topology", false),
        ] {
            let trajectory = trajectory_format_from_registry(extension)
                .expect("registry should load")
                .unwrap_or_else(|| panic!("{extension} should declare trajectory format metadata"));
            assert_eq!(trajectory.info.molstar_format, extension);
            assert_eq!(trajectory.info.is_binary, expected_binary);
            assert_eq!(trajectory.role, expected_role);
            assert_eq!(trajectory.has_trajectory_controls, expected_controls);
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
        assert_eq!(quick_look_size_limit_for_extension("trr"), 75 * mib);
        assert_eq!(quick_look_size_limit_for_extension("top"), 25 * mib);
        assert_eq!(quick_look_size_limit_for_extension("txt"), 20 * mib);
    }

    #[test]
    fn preview_lifecycle_allows_only_terminal_transitions_after_created() {
        assert!(PreviewLifecycleState::Created.can_transition_from(None));
        assert!(PreviewLifecycleState::Completed
            .can_transition_from(Some(PreviewLifecycleState::Created)));
        assert!(
            PreviewLifecycleState::Failed.can_transition_from(Some(PreviewLifecycleState::Created))
        );
        assert!(!PreviewLifecycleState::Completed.can_transition_from(None));
        assert!(!PreviewLifecycleState::Failed.can_transition_from(None));
        assert!(!PreviewLifecycleState::Created
            .can_transition_from(Some(PreviewLifecycleState::Created)));
        assert!(!PreviewLifecycleState::Failed
            .can_transition_from(Some(PreviewLifecycleState::Completed)));
    }

    #[test]
    fn preview_lifecycle_tracks_current_state() {
        let mut lifecycle = PreviewLifecycle::default();
        assert_eq!(lifecycle.state(), None);
        lifecycle
            .transition(PreviewLifecycleState::Created)
            .expect("created should start lifecycle");
        assert_eq!(lifecycle.state(), Some(PreviewLifecycleState::Created));
        lifecycle
            .transition(PreviewLifecycleState::Completed)
            .expect("completed should be terminal after created");
        assert_eq!(lifecycle.state(), Some(PreviewLifecycleState::Completed));
        assert!(lifecycle.transition(PreviewLifecycleState::Failed).is_err());
    }

    #[test]
    fn preview_trace_payload_uses_stable_contract_shape() {
        let payload = preview_trace_payload(PreviewTracePayload {
            timestamp_ms: 123,
            document_id: "doc-1",
            state: PreviewLifecycleState::Completed,
            subsystem: PreviewSubsystem::Desktop,
            source_extension: Some("pdb"),
            renderer: Some("molstar"),
            runtime_path: Some("/tmp/runtime/index.html"),
            elapsed_ms: Some(42),
            error_code: None,
            message: Some("ready\nnow"),
        });

        assert_eq!(payload["schemaVersion"], PREVIEW_CONTRACT_SCHEMA_VERSION);
        assert_eq!(payload["state"], "completed");
        assert_eq!(payload["subsystem"], "desktop");
        assert_eq!(payload["sourceExtension"], "pdb");
        assert_eq!(payload["renderer"], "molstar");
        assert_eq!(payload["message"], "ready now");
    }

    #[test]
    fn preview_runtime_manifest_uses_stable_contract_shape() {
        let manifest = preview_runtime_manifest(PreviewRuntimeManifest {
            created_at_ms: 456,
            complete: true,
            document_id: "doc-1",
            source_extension: "sdf",
            renderer: "grid2d",
            byte_count: 1024,
            preview_byte_count: 0,
            asset_profile: Some("desktop-grid"),
            host: None,
        });

        assert_eq!(manifest["schemaVersion"], PREVIEW_CONTRACT_SCHEMA_VERSION);
        assert_eq!(manifest["complete"], true);
        assert_eq!(manifest["renderer"], "grid2d");
        assert_eq!(manifest["assetProfile"], "desktop-grid");
        assert!(manifest.get("host").is_none());
    }

    #[test]
    fn preview_error_codes_are_stable() {
        assert_eq!(
            preview_error_code_for_message("sample.pdb is larger than the preview limit"),
            "BRT-PREVIEW-FILE-TOO-LARGE"
        );
        assert_eq!(
            preview_error_code_for_message(
                "sample.sdf does not contain supported molecule grid records"
            ),
            "BRT-PREVIEW-GRID-NO-RECORDS"
        );
        assert_eq!(
            preview_error_code_for_message("xyzrender executable failed"),
            "BRT-PREVIEW-XYZRENDER"
        );
    }

    #[test]
    fn registry_declares_quick_look_size_limits() {
        let registry = format_registry().expect("registry should load");
        for format in &registry.formats {
            let quick_look = format
                .quick_look
                .as_ref()
                .unwrap_or_else(|| panic!("{} should declare quickLook", format.id));
            assert!(
                quick_look.size_limit_mib.unwrap_or_default() > 0,
                "{} should declare a positive default quickLook.sizeLimitMiB",
                format.id
            );
            for (extension, size_limit_mib) in &quick_look.extension_size_limit_mib {
                assert!(
                    format.extensions.contains(extension),
                    "{} quickLook override should reference a declared extension",
                    extension
                );
                assert!(
                    *size_limit_mib > 0,
                    "{} quickLook override should be positive",
                    extension
                );
            }
        }
    }

    #[test]
    fn resolves_preview_plan_contract_matrix() {
        let pdb = preview_plan_for_extension("pdb", "auto").expect("pdb plan should resolve");
        assert_eq!(pdb.strategy, PreviewStrategy::Direct);
        assert_eq!(pdb.renderer, "molstar");
        assert_eq!(pdb.primary.as_ref().unwrap().format, "pdb");
        assert!(!pdb.primary.as_ref().unwrap().binary);
        assert!(pdb
            .fallbacks
            .iter()
            .any(|fallback| fallback.renderer == "xyzrender-external"));

        let bcif = preview_plan_for_extension("bcif", "auto").expect("bcif plan should resolve");
        assert_eq!(bcif.strategy, PreviewStrategy::Direct);
        assert_eq!(bcif.renderer, "molstar");
        assert_eq!(bcif.primary.as_ref().unwrap().format, "mmcif");
        assert!(bcif.primary.as_ref().unwrap().binary);

        let mol2 = preview_plan_for_extension("mol2", "auto").expect("mol2 plan should resolve");
        assert_eq!(mol2.strategy, PreviewStrategy::Direct);
        assert_eq!(mol2.renderer, "molstar");
        assert_eq!(mol2.primary.as_ref().unwrap().format, "mol2");

        let cif = preview_plan_for_extension("cif", "auto").expect("cif plan should resolve");
        assert_eq!(cif.strategy, PreviewStrategy::Direct);
        assert!(cif.capabilities.can_open_in_vesta);

        let xyz = preview_plan_for_extension("xyz", "auto").expect("xyz plan should resolve");
        assert_eq!(xyz.strategy, PreviewStrategy::Direct);
        assert_eq!(xyz.renderer, "xyzrender-external");
        assert_eq!(xyz.primary.as_ref().unwrap().format, "xyz");
        assert!(xyz
            .fallbacks
            .iter()
            .any(|fallback| fallback.renderer == "molstar"));

        let sdf_grid =
            preview_plan_for_extension("sdf", "grid2d").expect("sdf grid plan should resolve");
        assert_eq!(sdf_grid.strategy, PreviewStrategy::Grid);
        assert_eq!(sdf_grid.renderer, "grid2d");
        assert_eq!(sdf_grid.primary.as_ref().unwrap().role, "grid-records");
        assert!(sdf_grid.capabilities.can_switch_renderer);

        let sdf_direct =
            preview_plan_for_extension("sdf", "auto").expect("sdf direct plan should resolve");
        assert_eq!(sdf_direct.strategy, PreviewStrategy::Direct);
        assert_eq!(sdf_direct.renderer, "molstar");
        assert_eq!(sdf_direct.primary.as_ref().unwrap().format, "sdf");
        assert!(sdf_direct.capabilities.has_grid_search);
        assert!(sdf_direct.capabilities.can_switch_renderer);

        let explicit_sdf_external = preview_plan_for_extension("sdf", "xyzrender-external")
            .expect("explicit sdf external plan should resolve");
        assert_eq!(explicit_sdf_external.strategy, PreviewStrategy::Direct);
        assert_eq!(explicit_sdf_external.renderer, "xyzrender-external");

        let smiles =
            preview_plan_for_extension("smiles", "auto").expect("smiles grid plan should resolve");
        assert_eq!(smiles.strategy, PreviewStrategy::Grid);
        assert_eq!(smiles.primary.as_ref().unwrap().format, "smiles");
        assert!(!smiles.capabilities.can_switch_renderer);

        let cube = preview_plan_for_extension("cube", "auto").expect("cube plan should resolve");
        assert_eq!(cube.strategy, PreviewStrategy::External);
        assert_eq!(cube.renderer, "xyzrender-external");
        assert_eq!(
            cube.fallbacks
                .iter()
                .find(|fallback| fallback.renderer == "molstar")
                .and_then(|fallback| fallback.converter.as_deref()),
            Some("text-coordinates-to-pdb")
        );

        let xtc = preview_plan_for_extension("xtc", "auto").expect("xtc plan should resolve");
        assert_eq!(xtc.strategy, PreviewStrategy::Trajectory);
        assert_eq!(xtc.renderer, "molstar");
        assert_eq!(xtc.primary.as_ref().unwrap().role, "trajectory-coordinates");
        assert!(xtc.primary.as_ref().unwrap().binary);
        assert!(xtc.capabilities.has_trajectory_controls);

        let graphml =
            preview_plan_for_extension("graphml", "auto").expect("graphml plan should resolve");
        assert_eq!(graphml.strategy, PreviewStrategy::Custom);
        assert_eq!(graphml.renderer, "fep-graphml");
        assert!(graphml.primary.is_none());

        let cms = preview_plan_for_extension("cms", "auto").expect("cms plan should resolve");
        assert_eq!(cms.strategy, PreviewStrategy::Convert);
        assert_eq!(cms.renderer, "molstar");
        assert_eq!(
            cms.converter
                .as_ref()
                .map(|converter| converter.id.as_str()),
            Some("maestro-to-pdb")
        );
        assert_eq!(cms.primary.as_ref().unwrap().format, "pdb");
        assert_eq!(cms.staged[0].role, "solvent");
        assert_eq!(cms.staged[0].representation, "solvent-lines");
        assert!(cms.staged[0].required_for_ready);
        assert!(cms.capabilities.has_staged_entries);
        assert!(cms
            .fallbacks
            .iter()
            .any(|fallback| fallback.renderer == "xyzrender-external"));

        let explicit_cms_external = preview_plan_for_extension("cms", "xyzrender-external")
            .expect("explicit cms external plan should resolve");
        assert_eq!(explicit_cms_external.strategy, PreviewStrategy::Convert);
        assert_eq!(explicit_cms_external.renderer, "xyzrender-external");
    }

    #[test]
    fn registry_declares_preview_strategies_for_non_direct_groups() {
        let cases = [
            ("smiles", PreviewStrategy::Grid),
            ("csv", PreviewStrategy::Grid),
            ("tsv", PreviewStrategy::Grid),
            ("cube", PreviewStrategy::External),
            ("xtc", PreviewStrategy::Trajectory),
            ("cms", PreviewStrategy::Convert),
            ("graphml", PreviewStrategy::Custom),
        ];

        for (extension, expected_strategy) in cases {
            let format = registry_format_for_extension(extension)
                .expect("registry should load")
                .unwrap_or_else(|| panic!("{extension} should be declared"));
            let preview = format
                .preview
                .as_ref()
                .unwrap_or_else(|| panic!("{extension} should declare preview strategy"));
            assert_eq!(preview.strategy, expected_strategy, "{extension}");
        }
    }

    #[test]
    fn registry_declares_preview_strategies_for_stable_direct_groups() {
        for extension in [
            "pdb", "cif", "mmcif", "bcif", "sdf", "mol", "mol2", "xyz", "gro",
        ] {
            let format = registry_format_for_extension(extension)
                .expect("registry should load")
                .unwrap_or_else(|| panic!("{extension} should be declared"));
            let preview = format
                .preview
                .as_ref()
                .unwrap_or_else(|| panic!("{extension} should declare preview strategy"));
            assert_eq!(preview.strategy, PreviewStrategy::Direct, "{extension}");
        }
    }

    #[test]
    fn rejects_unknown_extensions() {
        let error = format_for_extension("txt").expect_err("txt should not be supported");
        assert!(error.contains("Unsupported structure extension: txt"));
        let error = format_for_extension("dat").expect_err("dat should not be supported");
        assert!(error.contains("Unsupported structure extension: dat"));
    }
}
