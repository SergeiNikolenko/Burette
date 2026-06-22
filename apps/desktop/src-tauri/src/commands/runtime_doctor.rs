use crate::commands::{conformer, descriptors, documents, xtb};
use crate::preview::xyzrender;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const DOCTOR_SCHEMA: &str = "burrete.external-runtime-doctor.v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalRuntimeDoctorReport {
    schema: &'static str,
    checks: Vec<ExternalRuntimeDoctorCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalRuntimeDoctorCheck {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    available: bool,
    source: Option<String>,
    executable_path: Option<String>,
    version: Option<String>,
    message: String,
    install_hint: Option<String>,
    details: Value,
}

#[tauri::command]
pub(crate) fn external_runtime_doctor() -> ExternalRuntimeDoctorReport {
    let descriptor_status = serde_json::to_value(descriptors::descriptor_runtime_status())
        .unwrap_or_else(|error| json!({ "message": error.to_string() }));
    let conformer_status = serde_json::to_value(conformer::conformer_status())
        .unwrap_or_else(|error| json!({ "message": error.to_string() }));
    let datamol_conformer_python_status =
        serde_json::to_value(documents::conformer_python_runtime_status("datamol"))
            .unwrap_or_else(|error| json!({ "message": error.to_string() }));
    let rdkit_conformer_python_status =
        serde_json::to_value(documents::conformer_python_runtime_status("rdkit"))
            .unwrap_or_else(|error| json!({ "message": error.to_string() }));
    let xtb_status = serde_json::to_value(xtb::xtb_status())
        .unwrap_or_else(|error| json!({ "message": error.to_string() }));
    let xyzrender_status = serde_json::to_value(xyzrender::xyzrender_runtime_status())
        .unwrap_or_else(|error| json!({ "message": error.to_string() }));

    ExternalRuntimeDoctorReport {
        schema: DOCTOR_SCHEMA,
        checks: vec![
            check_from_payload(
                "xyzrender",
                "xyzrender",
                "external-renderer",
                &xyzrender_status,
                "installed",
                "executablePath",
            ),
            check_from_payload(
                "descriptors-python",
                "Descriptor Python",
                "python-runtime",
                &descriptor_status,
                "available",
                "pythonPath",
            ),
            check_from_payload(
                "datamol-conformer-python",
                "Datamol conformer Python",
                "python-runtime",
                &datamol_conformer_python_status,
                "available",
                "executablePath",
            ),
            check_from_payload(
                "rdkit-conformer-python",
                "RDKit conformer Python",
                "python-runtime",
                &rdkit_conformer_python_status,
                "available",
                "executablePath",
            ),
            check_from_payload(
                "crest",
                "CREST",
                "conformer-tool",
                conformer_status.get("crest").unwrap_or(&Value::Null),
                "installed",
                "executable",
            ),
            check_from_payload(
                "prism",
                "PRISM Pruner",
                "conformer-tool",
                conformer_status.get("prism").unwrap_or(&Value::Null),
                "installed",
                "executable",
            ),
            check_from_payload(
                "xtb",
                "xTB",
                "semiempirical-tool",
                &xtb_status,
                "installed",
                "executablePath",
            ),
            schrodinger_check(),
        ],
    }
}

fn check_from_payload(
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    payload: &Value,
    availability_field: &str,
    path_field: &str,
) -> ExternalRuntimeDoctorCheck {
    let executable_path = payload
        .get(path_field)
        .and_then(Value::as_str)
        .map(str::to_string);
    let source = payload
        .get("source")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| executable_path.as_deref().map(source_for_path));
    let version = payload
        .get("version")
        .or_else(|| payload.get("rdkitVersion"))
        .or_else(|| payload.get("mordredVersion"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if payload.get(availability_field).and_then(Value::as_bool) == Some(true) {
                format!("{label} is available")
            } else {
                format!("{label} is unavailable")
            }
        });
    ExternalRuntimeDoctorCheck {
        id,
        label,
        kind,
        available: payload
            .get(availability_field)
            .and_then(Value::as_bool)
            .unwrap_or(false),
        source,
        executable_path,
        version,
        message,
        install_hint: payload
            .get("installHint")
            .and_then(Value::as_str)
            .map(str::to_string),
        details: payload.clone(),
    }
}

fn schrodinger_check() -> ExternalRuntimeDoctorCheck {
    let executable = schrodinger_candidates()
        .into_iter()
        .find(|path| path.is_file() && is_executable(path));
    let payload = match executable.as_deref() {
        Some(path) => json!({
            "installed": true,
            "executablePath": path.to_string_lossy(),
            "source": source_for_path(&path.to_string_lossy()),
            "message": "Schrodinger runtime is available"
        }),
        None => json!({
            "installed": false,
            "executablePath": Value::Null,
            "source": Value::Null,
            "message": "Schrodinger runtime was not found",
            "installHint": "Install Schrodinger or set SCHRODINGER to a suite directory that contains run."
        }),
    };
    check_from_payload(
        "schrodinger",
        "Schrodinger",
        "external-suite",
        &payload,
        "installed",
        "executablePath",
    )
}

fn schrodinger_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = std::env::var_os("SCHRODINGER") {
        candidates.push(PathBuf::from(root).join("run"));
    }
    candidates.push(PathBuf::from("/opt/schrodinger/suites2026-1/run"));
    candidates
}

fn source_for_path(path: &str) -> String {
    if path.contains("xyzrender-runtime") {
        "bundled".into()
    } else if path.contains(".local/bin") || path.contains(".local/share") {
        "user-local".into()
    } else if path.contains("/opt/")
        || path.contains("/usr/local/")
        || path.contains("/opt/homebrew/")
    {
        "system".into()
    } else {
        "resolved-path".into()
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.exists()
}

#[cfg(test)]
mod tests {
    use super::{check_from_payload, source_for_path};
    use serde_json::json;

    #[test]
    fn doctor_check_preserves_payload_details_and_source() {
        let payload = json!({
            "installed": true,
            "executablePath": "/opt/homebrew/bin/xtb",
            "version": "6.7.1",
            "installHint": "Install xTB",
            "message": "xTB is available"
        });

        let check = check_from_payload(
            "xtb",
            "xTB",
            "semiempirical-tool",
            &payload,
            "installed",
            "executablePath",
        );

        assert!(check.available);
        assert_eq!(check.source.as_deref(), Some("system"));
        assert_eq!(check.version.as_deref(), Some("6.7.1"));
        assert_eq!(check.details, payload);
    }

    #[test]
    fn source_for_path_classifies_common_runtime_locations() {
        assert_eq!(
            source_for_path(
                "/Applications/Burrete.app/Contents/Resources/xyzrender-runtime/bin/xyzrender"
            ),
            "bundled"
        );
        assert_eq!(
            source_for_path("/Users/me/.local/bin/xyzrender"),
            "user-local"
        );
        assert_eq!(source_for_path("/usr/local/bin/xtb"), "system");
    }
}
