use std::{
    io::{Read, Write},
    path::PathBuf,
};

use burrete_compute_metal::MetalTanimotoRuntime;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::preview::grid_store::GridAlignmentSourceRow;

use super::{
    alignment_workflow::{execute_snapshot_alignment_with_run_id, GridAlignmentRequest},
    semiempirical_workflow::{
        execute_snapshot_semiempirical_with_run_id, GridSemiempiricalRequest,
    },
};

const MAX_SOURCE_BYTES: usize = 12 * 1024 * 1024;
const HELPER_SHA256_PLACEHOLDER: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevComputeRequest {
    operation: DevComputeOperation,
    source: DevComputeSource,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DevComputeOperation {
    SemiempiricalRm1,
    AlignPoses,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevComputeSource {
    title: String,
    extension: String,
    text: String,
}

pub(crate) fn run() -> Result<(), String> {
    let runtime_root = parse_runtime_root()?;
    let request = read_request()?;
    let rows = source_rows(&request.source)?;
    let runtime = MetalTanimotoRuntime::load(&runtime_root, HELPER_SHA256_PLACEHOLDER)
        .map_err(|error| format!("native Metal dev backend is unavailable: {error}"))?;
    let run_id = Uuid::new_v4();
    let source_indexes = (0..rows.len()).collect::<Vec<_>>();
    let result = match request.operation {
        DevComputeOperation::SemiempiricalRm1 => serde_json::to_value(
            execute_snapshot_semiempirical_with_run_id(
                Some(&runtime),
                None,
                rows,
                &GridSemiempiricalRequest {
                    document_id: "browser-dev-inline".into(),
                    source_indexes,
                    method: "RM1".into(),
                },
                run_id,
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?,
        DevComputeOperation::AlignPoses => serde_json::to_value(
            execute_snapshot_alignment_with_run_id(
                &runtime,
                None,
                rows,
                &GridAlignmentRequest {
                    document_id: "browser-dev-inline".into(),
                    source_indexes,
                    max_memory_bytes: None,
                },
                run_id,
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?,
    };
    write_response(result)
}

fn parse_runtime_root() -> Result<PathBuf, String> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--runtime-root")) {
        return Err("usage: burrete-compute-dev-backend --runtime-root <directory>".into());
    }
    let root = args
        .next()
        .map(PathBuf::from)
        .ok_or("native Metal dev runtime root is missing")?;
    if args.next().is_some() || !root.is_dir() {
        return Err("native Metal dev runtime root is invalid".into());
    }
    Ok(root)
}

fn read_request() -> Result<DevComputeRequest, String> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((MAX_SOURCE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read native compute request: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err("native compute request is empty or exceeds 12 MiB".into());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid native compute request: {error}"))
}

fn source_rows(source: &DevComputeSource) -> Result<Vec<GridAlignmentSourceRow>, String> {
    if source.text.is_empty() || source.text.len() > MAX_SOURCE_BYTES {
        return Err("native compute source is empty or exceeds 12 MiB".into());
    }
    let extension = source
        .extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    let records = match extension.as_str() {
        "mol" => vec![source.text.trim_end().to_string()],
        "sdf" | "sd" => source
            .text
            .split("$$$$")
            .enumerate()
            .map(|(index, record)| {
                let record = if index == 0 {
                    record
                } else {
                    record
                        .strip_prefix("\r\n")
                        .or_else(|| record.strip_prefix('\n'))
                        .or_else(|| record.strip_prefix('\r'))
                        .unwrap_or(record)
                };
                record.trim_end()
            })
            .filter(|record| !record.trim().is_empty())
            .map(str::to_string)
            .collect(),
        _ => return Err("native browser compute accepts 3D MOL or SDF sources".into()),
    };
    if records.is_empty() || records.len() > 256 {
        return Err("native browser compute accepts between 1 and 256 structures".into());
    }
    records
        .into_iter()
        .enumerate()
        .map(|(index, molblock)| {
            let name = molblock
                .lines()
                .next()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(source.title.trim())
                .to_string();
            let molecule_content_sha256 = Sha256::digest(molblock.as_bytes())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            Ok(GridAlignmentSourceRow {
                row_id: i64::try_from(index + 1).map_err(|_| "source row index overflow")?,
                source_index: index as u64,
                molecule_content_sha256,
                name,
                molblock: Some(molblock),
            })
        })
        .collect()
}

fn write_response(result: Value) -> Result<(), String> {
    let response = json!({
        "provider": "nativeMetalDevBridge",
        "result": result,
    });
    let bytes = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    std::io::stdout()
        .write_all(&bytes)
        .map_err(|error| format!("cannot write native compute response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WATER: &str = "water\n  Burrete\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    0.9572    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.2390    0.9270    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  1  3  1  0  0  0  0\nM  END\n";

    #[test]
    fn splits_bounded_sdf_ensemble_into_stable_rows() {
        let source = DevComputeSource {
            title: "water.sdf".into(),
            extension: "sdf".into(),
            text: format!("{WATER}$$$$\n{WATER}$$$$\n"),
        };
        let rows = source_rows(&source).expect("source rows");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].source_index, 0);
        assert_eq!(rows[1].source_index, 1);
        assert_eq!(rows[0].name, "water");
        assert_eq!(rows[0].molecule_content_sha256.len(), 64);
        for row in rows {
            super::super::alignment_workflow::parse_molfile(
                row.molblock.as_deref().expect("molblock"),
            )
            .expect("parsed molfile");
        }
    }

    #[test]
    fn rejects_non_coordinate_sources() {
        let source = DevComputeSource {
            title: "water.smi".into(),
            extension: "smi".into(),
            text: "O water".into(),
        };
        assert!(source_rows(&source).is_err());
    }
}
