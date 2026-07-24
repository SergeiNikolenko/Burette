use std::{
    io::{Read, Write},
    path::PathBuf,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use burrete_compute_core::{
    decode_native_mmff_parameters, ConformerEnginePackBuilder, ExtractedConformerParameters,
    Fingerprint2048, FINGERPRINT_BYTES,
};
use burrete_compute_metal::{MetalTanimotoKnnExecution, MetalTanimotoRuntime};
use burrete_compute_protocol::{
    AllGridScope, Backend, BackendPolicy, ComputeJobSchemaVersion, ConformerInitialization,
    ConformerResourceLimits, ConformerV1Parameters, ConformerV1SubmitRequest, ConformerVariant,
    ExecutionPolicy, GridScope, GridSourceReference, MmffVariant, SchedulingPolicy,
    WorkflowTemplateId,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::preview::grid_store::GridAlignmentSourceRow;

use super::{
    alignment_workflow::{execute_snapshot_alignment_with_run_id, GridAlignmentRequest},
    chemical_space::{
        cluster_chemical_space_from_fingerprints,
        execute_chemical_space_from_fingerprints_with_knn, ChemicalSpaceClusterRequest,
        ChemicalSpaceRequest,
    },
    conformer_executor::execute_conformer_distance_geometry_with_service,
    conformer_plan::ConformerMoleculeIdentity,
    conformer_stereo_executor::execute_conformer_stereo_validation,
    molfile_coordinates::parse_molfile_positions,
    semiempirical_workflow::{
        execute_snapshot_semiempirical_with_run_id, GridSemiempiricalRequest,
    },
};

const MAX_SOURCE_BYTES: usize = 12 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const HELPER_SHA256_PLACEHOLDER: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevComputeRequest {
    operation: DevComputeOperation,
    source: DevComputeSource,
    conformer: Option<DevConformerRequest>,
    chemical_space: Option<DevChemicalSpaceRequest>,
    chemical_space_cluster: Option<DevChemicalSpaceClusterRequest>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DevComputeOperation {
    Generate3d,
    GenerateEnsemble,
    OptimizeGeometry,
    SemiempiricalRm1,
    AlignPoses,
    ChemicalSpace,
    ChemicalSpaceCluster,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevComputeSource {
    title: String,
    extension: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevConformerRequest {
    variant: ConformerVariant,
    mmff_variant: MmffVariant,
    records: Vec<DevConformerRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevConformerRecord {
    template: Option<String>,
    conformer_base64: String,
    mmff_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevChemicalSpaceRequest {
    options: ChemicalSpaceRequest,
    records: Vec<DevChemicalSpaceRecord>,
    knn_cache: Option<DevChemicalSpaceKnnCache>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevChemicalSpaceClusterRequest {
    options: ChemicalSpaceClusterRequest,
    records: Vec<DevChemicalSpaceRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevChemicalSpaceRecord {
    source_record_id: u64,
    fingerprint_base64: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevChemicalSpaceKnnCache {
    neighbors_per_vertex: usize,
    source_indices_base64: String,
    similarities_base64: String,
}

pub(crate) fn run() -> Result<(), String> {
    let runtime_root = parse_runtime_root()?;
    let request = read_request()?;
    let runtime = MetalTanimotoRuntime::load(&runtime_root, HELPER_SHA256_PLACEHOLDER)
        .map_err(|error| format!("native Metal dev backend is unavailable: {error}"))?;
    let run_id = Uuid::new_v4();
    let result = match request.operation {
        DevComputeOperation::Generate3d
        | DevComputeOperation::GenerateEnsemble
        | DevComputeOperation::OptimizeGeometry => execute_conformer(
            &runtime,
            &request.source,
            request
                .conformer
                .as_ref()
                .ok_or("native Metal conformer request is missing extracted parameters")?,
            request.operation,
            run_id,
        )?,
        DevComputeOperation::SemiempiricalRm1 => serde_json::to_value(
            execute_snapshot_semiempirical_with_run_id(
                Some(&runtime),
                None,
                source_rows(&request.source)?,
                &GridSemiempiricalRequest {
                    document_id: "browser-dev-inline".into(),
                    source_indexes: source_indexes(&request.source)?,
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
                source_rows(&request.source)?,
                &GridAlignmentRequest {
                    document_id: "browser-dev-inline".into(),
                    source_indexes: source_indexes(&request.source)?,
                    max_memory_bytes: None,
                },
                run_id,
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?,
        DevComputeOperation::ChemicalSpace => execute_chemical_space(
            &runtime,
            request
                .chemical_space
                .as_ref()
                .ok_or("native Metal chemical-space request is missing fingerprints")?,
        )?,
        DevComputeOperation::ChemicalSpaceCluster => execute_chemical_space_cluster(
            &runtime,
            request
                .chemical_space_cluster
                .as_ref()
                .ok_or("native Metal chemical-space cluster request is missing fingerprints")?,
        )?,
    };
    write_response(result)
}

fn execute_chemical_space(
    runtime: &MetalTanimotoRuntime,
    input: &DevChemicalSpaceRequest,
) -> Result<Value, String> {
    if input.records.len() < 2 || input.records.len() > 20_000 {
        return Err(
            "native Metal chemical-space request accepts between 2 and 20000 records".into(),
        );
    }
    let mut fingerprints = Vec::with_capacity(input.records.len());
    let mut source_record_ids = Vec::with_capacity(input.records.len());
    let mut failed_records = 0usize;
    for record in &input.records {
        match (&record.fingerprint_base64, &record.error) {
            (Some(encoded), None) => {
                let bytes = STANDARD
                    .decode(encoded)
                    .map_err(|_| "native chemical-space fingerprint is not valid base64")?;
                let bytes: [u8; FINGERPRINT_BYTES] = bytes.try_into().map_err(|_| {
                    format!(
                        "native chemical-space fingerprint must contain {FINGERPRINT_BYTES} bytes"
                    )
                })?;
                fingerprints.push(Fingerprint2048::from_le_bytes(bytes));
                source_record_ids.push(record.source_record_id);
            }
            (None, Some(_)) => failed_records += 1,
            _ => {
                return Err(
                    "native chemical-space record must contain either a fingerprint or an error"
                        .into(),
                )
            }
        }
    }
    let cached_knn = input
        .knn_cache
        .as_ref()
        .map(|cache| decode_knn_cache(cache, fingerprints.len()))
        .transpose()?;
    let execution = execute_chemical_space_from_fingerprints_with_knn(
        &fingerprints,
        &source_record_ids,
        failed_records,
        runtime,
        input.options,
        cached_knn.as_ref(),
    )
    .map_err(|error| error.to_string())?;
    Ok(json!({
        "embedding": execution.result,
        "knnCache": encode_knn_cache(&execution.knn),
    }))
}

fn execute_chemical_space_cluster(
    runtime: &MetalTanimotoRuntime,
    input: &DevChemicalSpaceClusterRequest,
) -> Result<Value, String> {
    if input.records.len() < 2 || input.records.len() > 20_000 {
        return Err(
            "native Metal chemical-space clustering accepts between 2 and 20000 records".into(),
        );
    }
    let mut fingerprints = Vec::with_capacity(input.records.len());
    let mut source_record_ids = Vec::with_capacity(input.records.len());
    for record in &input.records {
        match (&record.fingerprint_base64, &record.error) {
            (Some(encoded), None) => {
                let bytes = STANDARD.decode(encoded).map_err(|_| {
                    "native chemical-space cluster fingerprint is not valid base64"
                })?;
                let bytes: [u8; FINGERPRINT_BYTES] = bytes.try_into().map_err(|_| {
                    format!(
                        "native chemical-space cluster fingerprint must contain {FINGERPRINT_BYTES} bytes"
                    )
                })?;
                fingerprints.push(Fingerprint2048::from_le_bytes(bytes));
                source_record_ids.push(record.source_record_id);
            }
            (None, Some(_)) => {}
            _ => {
                return Err(
                    "native chemical-space cluster record must contain either a fingerprint or an error"
                        .into(),
                )
            }
        }
    }
    serde_json::to_value(
        cluster_chemical_space_from_fingerprints(
            &fingerprints,
            &source_record_ids,
            runtime,
            input.options,
        )
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn encode_knn_cache(knn: &MetalTanimotoKnnExecution) -> DevChemicalSpaceKnnCache {
    let mut source_indices = Vec::with_capacity(knn.source_indices.len() * 4);
    for value in &knn.source_indices {
        source_indices.extend_from_slice(&value.to_le_bytes());
    }
    let mut similarities = Vec::with_capacity(knn.similarities.len() * 4);
    for value in &knn.similarities {
        similarities.extend_from_slice(&value.to_le_bytes());
    }
    DevChemicalSpaceKnnCache {
        neighbors_per_vertex: knn.neighbors_per_vertex,
        source_indices_base64: STANDARD.encode(source_indices),
        similarities_base64: STANDARD.encode(similarities),
    }
}

fn decode_knn_cache(
    cache: &DevChemicalSpaceKnnCache,
    record_count: usize,
) -> Result<MetalTanimotoKnnExecution, String> {
    let expected_values = record_count
        .checked_mul(cache.neighbors_per_vertex)
        .ok_or("native chemical-space neighbor cache size overflowed")?;
    let source_indices = STANDARD
        .decode(&cache.source_indices_base64)
        .map_err(|_| "native chemical-space neighbor indexes are not valid base64")?;
    let similarities = STANDARD
        .decode(&cache.similarities_base64)
        .map_err(|_| "native chemical-space neighbor similarities are not valid base64")?;
    if source_indices.len() != expected_values * 4 || similarities.len() != expected_values * 4 {
        return Err("native chemical-space neighbor cache has an invalid shape".into());
    }
    Ok(MetalTanimotoKnnExecution {
        source_indices: source_indices
            .chunks_exact(4)
            .map(|bytes| u32::from_le_bytes(bytes.try_into().expect("four-byte chunk")))
            .collect(),
        similarities: similarities
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().expect("four-byte chunk")))
            .collect(),
        neighbors_per_vertex: cache.neighbors_per_vertex,
        gpu_time_ms: 0,
    })
}

fn source_indexes(source: &DevComputeSource) -> Result<Vec<usize>, String> {
    Ok((0..source_rows(source)?.len()).collect())
}

fn execute_conformer(
    runtime: &MetalTanimotoRuntime,
    source: &DevComputeSource,
    input: &DevConformerRequest,
    operation: DevComputeOperation,
    run_id: Uuid,
) -> Result<Value, String> {
    if input.records.is_empty() || input.records.len() > 256 {
        return Err("native Metal conformer request accepts between 1 and 256 records".into());
    }
    let initialization = if matches!(operation, DevComputeOperation::OptimizeGeometry) {
        ConformerInitialization::InputGeometry
    } else {
        ConformerInitialization::Generated
    };
    let conformers_per_molecule = if matches!(operation, DevComputeOperation::GenerateEnsemble) {
        16
    } else {
        1
    };
    let request = ConformerV1SubmitRequest {
        schema_version: ComputeJobSchemaVersion::V1,
        workflow_template: WorkflowTemplateId::ConformerV1,
        source: GridSourceReference {
            document_id: "browser-dev-inline".into(),
            scope: GridScope::All(AllGridScope::default()),
        },
        parameters: ConformerV1Parameters {
            variant: input.variant,
            initialization,
            mmff_variant: input.mmff_variant,
            conformers_per_molecule,
            max_attempts_per_conformer: 32,
        },
        execution_policy: ExecutionPolicy {
            backend_policy: BackendPolicy::GpuRequired,
            scheduling_policy: SchedulingPolicy::Throughput,
        },
        limits: ConformerResourceLimits {
            max_memory_bytes: 4 * 1_024 * 1_024 * 1_024,
            max_dispatch_ms: 250,
            max_conformers_per_batch: 2_048,
        },
    }
    .normalized()
    .map_err(|error| error.to_string())?;
    let mut builder = ConformerEnginePackBuilder::new(input.variant, 512 * 1024 * 1024);
    let mut identities = Vec::with_capacity(input.records.len());
    let mut mmff_parameters = Vec::with_capacity(input.records.len());
    let mut input_positions = Vec::with_capacity(input.records.len());
    for (index, record) in input.records.iter().enumerate() {
        let conformer_bytes = decode_base64("BCEX", &record.conformer_base64)?;
        let mmff_bytes = decode_base64("BMFX", &record.mmff_base64)?;
        let extracted =
            ExtractedConformerParameters::decode(&conformer_bytes, input.variant, 64 * 1024 * 1024)
                .map_err(|error| format!("invalid native conformer parameters: {error}"))?;
        builder
            .append_valid(extracted)
            .map_err(|error| error.to_string())?;
        let mmff = decode_native_mmff_parameters(&mmff_bytes, 64 * 1024 * 1024)
            .map_err(|error| format!("invalid native MMFF parameters: {error}"))?;
        let identity_bytes = record
            .template
            .as_deref()
            .unwrap_or(source.text.as_str())
            .as_bytes();
        identities.push(ConformerMoleculeIdentity {
            source_record_id: (index + 1) as u64,
            molecule_content_sha256: hex_sha256(identity_bytes),
        });
        input_positions.push(
            if initialization == ConformerInitialization::InputGeometry {
                Some(parse_molfile_positions(record.template.as_deref().ok_or(
                    "Metal geometry optimization requires MOL or SDF coordinates",
                )?)?)
            } else {
                None
            },
        );
        mmff_parameters.push(Some(mmff));
    }
    let arrays = builder
        .finish(input.records.len() as u64)
        .map_err(|error| error.to_string())?;
    let distance = execute_conformer_distance_geometry_with_service(
        run_id,
        &request,
        arrays,
        &identities,
        &mmff_parameters,
        &input_positions,
        Backend::NativeMetal,
        Backend::NativeMetal,
        Some(runtime),
        None,
    )
    .map_err(|error| error.to_string())?;
    let stereo = execute_conformer_stereo_validation(
        &distance,
        Backend::NativeMetal,
        Some(runtime),
        request.limits.max_memory_bytes,
    )
    .map_err(|error| error.to_string())?;
    let text = conformer_sdf(
        &distance,
        &stereo.failure_flags,
        &input.records,
        input.variant,
    )?;
    let title = format!(
        "{}-{}-metal.sdf",
        source
            .title
            .trim_end_matches(&format!(".{}", source.extension)),
        if initialization == ConformerInitialization::InputGeometry {
            "optimized"
        } else {
            "conformers"
        }
    );
    Ok(json!({
        "title": title,
        "extension": "sdf",
        "text": text,
        "method": format!("{} + {} · Metal GPU", input.variant.wire_id(), input.mmff_variant.wire_id()),
        "conformerCount": distance.conformer_molecule_indices.len(),
        "passedCount": stereo.failure_flags.iter().filter(|flags| **flags == 0).count(),
        "backend": "nativeMetal",
        "gpuTimeMs": distance.gpu_time_ms.unwrap_or(0).saturating_add(stereo.gpu_time_ms.unwrap_or(0)),
        "device": runtime.device_identity().name,
    }))
}

fn decode_base64(label: &str, value: &str) -> Result<Vec<u8>, String> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| format!("native {label} payload is not valid base64"))?;
    if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
        return Err(format!("native {label} payload is empty or too large"));
    }
    Ok(bytes)
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn conformer_sdf(
    distance: &super::conformer_executor::ConformerDistanceComputation,
    stereo_flags: &[u32],
    records: &[DevConformerRecord],
    variant: ConformerVariant,
) -> Result<String, String> {
    let mut output = String::new();
    for (conformer, molecule_index) in distance
        .conformer_molecule_indices
        .iter()
        .copied()
        .enumerate()
    {
        let molecule_index = molecule_index as usize;
        let atom_start = distance.conformer_atom_starts[conformer] as usize;
        let atom_end = distance.conformer_atom_starts[conformer + 1] as usize;
        let positions = &distance.positions[atom_start..atom_end];
        let molecule = distance
            .distance_engine
            .molecule(molecule_index as u64)
            .map_err(|error| error.to_string())?
            .ok_or("native conformer output references an invalid molecule")?;
        let molblock = match records
            .get(molecule_index)
            .and_then(|record| record.template.as_deref())
        {
            Some(template) => molblock_with_positions(template, positions)?,
            None => synthetic_molblock(molecule.atomic_numbers, positions)?,
        };
        output.push_str(molblock.trim_end());
        output.push_str(&format!(
            "\n>  <BURRETE_COMPUTE_BACKEND>\nMetal GPU\n\n>  <BURRETE_CONFORMER_VARIANT>\n{}\n\n>  <BURRETE_MMFF_ENERGY_KCAL_MOL>\n{:.8}\n\n>  <BURRETE_STEREO_STATUS>\n{}\n\n$$$$\n",
            variant.wire_id(),
            distance.mmff_energies[conformer],
            if stereo_flags[conformer] == 0 { "passed" } else { "failed" },
        ));
    }
    Ok(output)
}

fn molblock_with_positions(template: &str, positions: &[[f32; 3]]) -> Result<String, String> {
    let mut lines = template
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if let Some(counts) = lines.iter().position(|line| line.contains("V2000")) {
        let atom_count = lines[counts]
            .get(..3)
            .ok_or("V2000 counts line is truncated")?
            .trim()
            .parse::<usize>()
            .map_err(|_| "V2000 atom count is invalid")?;
        if atom_count != positions.len() || counts + atom_count >= lines.len() {
            return Err("V2000 template atom count differs from Metal output".into());
        }
        for (offset, position) in positions.iter().enumerate() {
            let line = &lines[counts + 1 + offset];
            let tail = line.get(30..).unwrap_or("");
            lines[counts + 1 + offset] = format!(
                "{:>10.4}{:>10.4}{:>10.4}{tail}",
                position[0], position[1], position[2]
            );
        }
        return Ok(lines.join("\n"));
    }
    let atom_lines = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            line.trim_start().starts_with("M  V30") && {
                let tokens = line.split_whitespace().collect::<Vec<_>>();
                tokens.len() >= 7
                    && tokens[2].parse::<usize>().is_ok()
                    && tokens[3].chars().next().is_some_and(char::is_alphabetic)
            }
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if atom_lines.len() != positions.len() {
        return Err("V3000 template atom count differs from Metal output".into());
    }
    for (&line_index, position) in atom_lines.iter().zip(positions) {
        let tokens = lines[line_index].split_whitespace().collect::<Vec<_>>();
        let suffix = tokens
            .get(7..)
            .map(|items| items.join(" "))
            .unwrap_or_default();
        lines[line_index] = format!(
            "M  V30 {} {} {:.6} {:.6} {:.6} {}",
            tokens[2], tokens[3], position[0], position[1], position[2], suffix
        )
        .trim_end()
        .to_string();
    }
    Ok(lines.join("\n"))
}

fn synthetic_molblock(atomic_numbers: &[u16], positions: &[[f32; 3]]) -> Result<String, String> {
    if atomic_numbers.len() != positions.len() || atomic_numbers.len() > 999 {
        return Err("SMILES Metal output cannot be represented as V2000".into());
    }
    let mut output = format!(
        "Burrete Metal conformer\n  Burrete\n\n{:>3}{:>3}  0  0  0  0            999 V2000\n",
        atomic_numbers.len(),
        0
    );
    for (&atomic_number, position) in atomic_numbers.iter().zip(positions) {
        output.push_str(&format!(
            "{:>10.4}{:>10.4}{:>10.4} {:<3} 0  0  0  0  0  0  0  0  0  0  0  0\n",
            position[0],
            position[1],
            position[2],
            element_symbol(atomic_number)?
        ));
    }
    output.push_str("M  END");
    Ok(output)
}

fn element_symbol(atomic_number: u16) -> Result<&'static str, String> {
    const SYMBOLS: [&str; 54] = [
        "", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S",
        "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga",
        "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd",
        "Ag", "Cd", "In", "Sn", "Sb", "Te", "I",
    ];
    SYMBOLS
        .get(atomic_number as usize)
        .copied()
        .filter(|symbol| !symbol.is_empty())
        .ok_or_else(|| format!("atomic number {atomic_number} is not supported by dev SDF output"))
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
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read native compute request: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES {
        return Err("native compute request is empty or exceeds 32 MiB".into());
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

    #[test]
    fn round_trips_bounded_chemical_space_knn_cache() {
        let knn = MetalTanimotoKnnExecution {
            source_indices: vec![1, 2, 0, 2, 0, 1],
            similarities: vec![0.75, 0.5, 0.75, 0.25, 0.5, 0.25],
            neighbors_per_vertex: 2,
            gpu_time_ms: 17,
        };
        let encoded = encode_knn_cache(&knn);
        let decoded = decode_knn_cache(&encoded, 3).expect("decoded neighbor cache");
        assert_eq!(decoded.source_indices, knn.source_indices);
        assert_eq!(decoded.similarities, knn.similarities);
        assert_eq!(decoded.neighbors_per_vertex, knn.neighbors_per_vertex);
        assert_eq!(decoded.gpu_time_ms, 0);
    }

    #[test]
    fn writes_metal_coordinates_without_changing_v2000_topology() {
        let positions = [[1.25, -2.5, 3.75], [4.0, 5.5, -6.25], [-7.0, 8.0, 9.0]];
        let output = molblock_with_positions(WATER, &positions).expect("updated molblock");

        assert!(output.contains("    1.2500   -2.5000    3.7500 O"));
        assert!(output.contains("    4.0000    5.5000   -6.2500 H"));
        assert!(output.contains("   -7.0000    8.0000    9.0000 H"));
        assert!(output.contains("  1  2  1  0  0  0  0"));
        assert!(output.contains("  1  3  1  0  0  0  0"));
    }
}
