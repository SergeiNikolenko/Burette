use std::path::Path;

use burrete_compute_core::{align_and_score, AlignmentAtom, AlignmentMode, AtomMapping};
use burrete_compute_metal::{AlignmentPairDescriptor, MetalAlignmentBatch, MetalTanimotoRuntime};
use burrete_compute_protocol::{
    AlignmentModeV1, AlignmentV1Parameters, AlignmentV1SubmitRequest, AnalysisResourceLimits,
    BackendPolicy, ComputeJobSchemaVersion, ExecutionPolicy, GridScope, GridSourceReference,
    SchedulingPolicy, SelectedGridScope, WorkflowTemplateId,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::preview::{
    grid_analysis::{
        apply_alignment_analysis_run, GridAlignmentAnalysisApplyInput, GridAlignmentAssignmentInput,
    },
    grid_database::open_grid_database,
    grid_identity,
    grid_store::{alignment_source_rows_by_indices, GridAlignmentSourceRow},
};

use super::error::{ComputeCoordinatorError, ComputeResult};

const MAX_ALIGNMENT_POSES: usize = 256;
const MAX_ALIGNMENT_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_MAX_MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const SHAPE_ALPHA: f32 = 2.417_987_8;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GridAlignmentRequest {
    pub(crate) document_id: String,
    pub(crate) source_indexes: Vec<usize>,
    pub(crate) max_memory_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAlignmentScore {
    pub(crate) source_index: u64,
    pub(crate) name: String,
    pub(crate) is_reference: bool,
    pub(crate) rmsd: f32,
    pub(crate) shape_tanimoto: f32,
    pub(crate) electrostatic_carbo: Option<f32>,
    pub(crate) combined_similarity: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAlignmentResult {
    pub(crate) run_id: Uuid,
    pub(crate) artifact_id: Option<Uuid>,
    pub(crate) artifact_manifest_sha256: Option<String>,
    pub(crate) title: String,
    pub(crate) aligned_sdf: String,
    pub(crate) scores: Vec<GridAlignmentScore>,
    pub(crate) gpu_time_ms: u64,
    pub(crate) backend: &'static str,
    pub(crate) mapping: &'static str,
    pub(crate) charge_model: String,
    pub(crate) grid_applied: bool,
    pub(crate) grid_warning: Option<String>,
    #[serde(skip_serializing)]
    pub(crate) transforms: Vec<[f32; 16]>,
}

pub(crate) fn durable_alignment_request(
    request: &GridAlignmentRequest,
) -> ComputeResult<AlignmentV1SubmitRequest> {
    let source_indexes = normalized_indexes(&request.source_indexes)?
        .into_iter()
        .map(|index| index as u64)
        .collect();
    AlignmentV1SubmitRequest {
        schema_version: ComputeJobSchemaVersion::V1,
        workflow_template: WorkflowTemplateId::AlignmentV1,
        source: GridSourceReference {
            document_id: request.document_id.clone(),
            scope: GridScope::Selected(SelectedGridScope { source_indexes }),
        },
        parameters: AlignmentV1Parameters {
            mode: AlignmentModeV1::MappedHorn,
        },
        execution_policy: ExecutionPolicy {
            backend_policy: BackendPolicy::GpuRequired,
            scheduling_policy: SchedulingPolicy::Interactive,
        },
        limits: AnalysisResourceLimits {
            max_memory_bytes: request.max_memory_bytes.unwrap_or(DEFAULT_MAX_MEMORY_BYTES),
            max_dispatch_ms: 250,
        },
    }
    .normalized()
    .map_err(ComputeCoordinatorError::from)
}

#[derive(Clone, Debug)]
pub(super) struct ParsedMolfile {
    pub(super) atoms: Vec<AlignmentAtom>,
    pub(super) symbols: Vec<String>,
    formal_charges: Vec<i32>,
    bonds: Vec<ParsedBond>,
    lines: Vec<String>,
    layout: MolfileLayout,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ParsedBond {
    left: usize,
    right: usize,
    order: u8,
}

#[derive(Clone, Debug)]
enum MolfileLayout {
    V2000 { atom_start: usize },
    V3000 { atom_lines: Vec<usize> },
}

#[cfg(test)]
fn execute_grid_alignment(
    runtime: &MetalTanimotoRuntime,
    database_path: &Path,
    request: &GridAlignmentRequest,
) -> ComputeResult<GridAlignmentResult> {
    execute_grid_alignment_with_run_id(runtime, database_path, request, Uuid::new_v4())
}

#[cfg(test)]
fn execute_grid_alignment_with_run_id(
    runtime: &MetalTanimotoRuntime,
    database_path: &Path,
    request: &GridAlignmentRequest,
    run_id: Uuid,
) -> ComputeResult<GridAlignmentResult> {
    let indexes = normalized_indexes(&request.source_indexes)?;
    let rows = alignment_source_rows_by_indices(database_path, &indexes)
        .map_err(ComputeCoordinatorError::Validation)?;
    if rows.len() != indexes.len() {
        return Err(ComputeCoordinatorError::Validation(
            "One or more selected Grid rows no longer exist".into(),
        ));
    }
    let parsed = rows
        .iter()
        .map(parse_row)
        .collect::<ComputeResult<Vec<_>>>()?;
    execute_alignment_rows(
        runtime,
        request,
        run_id,
        rows,
        parsed,
        "molfileFormalCharge".into(),
    )
}

pub(crate) fn execute_snapshot_alignment_with_run_id(
    runtime: &MetalTanimotoRuntime,
    rows: Vec<GridAlignmentSourceRow>,
    request: &GridAlignmentRequest,
    run_id: Uuid,
) -> ComputeResult<GridAlignmentResult> {
    let indexes = normalized_indexes(&request.source_indexes)?;
    if rows.len() != indexes.len()
        || rows
            .iter()
            .zip(indexes)
            .any(|(row, index)| row.source_index != index as u64)
    {
        return Err(ComputeCoordinatorError::Protocol(
            "Frozen alignment records differ from the normalized selected scope".into(),
        ));
    }
    let parsed = rows
        .iter()
        .map(parse_row)
        .collect::<ComputeResult<Vec<_>>>()?;
    execute_alignment_rows(
        runtime,
        request,
        run_id,
        rows,
        parsed,
        "molfileFormalCharge".into(),
    )
}

fn execute_alignment_rows(
    runtime: &MetalTanimotoRuntime,
    request: &GridAlignmentRequest,
    run_id: Uuid,
    rows: Vec<GridAlignmentSourceRow>,
    parsed: Vec<ParsedMolfile>,
    charge_model: String,
) -> ComputeResult<GridAlignmentResult> {
    let reference = &parsed[0];
    let mut probe_atoms = Vec::new();
    let mut reference_atoms = Vec::new();
    let mut mappings = Vec::new();
    let mut pair_mappings = Vec::new();
    let mut descriptors = Vec::new();
    for probe in parsed.iter().skip(1) {
        let pair_mapping = infer_atom_mapping(probe, reference)?;
        let probe_start = probe_atoms.len() as u64;
        let reference_start = reference_atoms.len() as u64;
        let mapping_start = mappings.len() as u64;
        probe_atoms.extend_from_slice(&probe.atoms);
        reference_atoms.extend_from_slice(&reference.atoms);
        mappings.extend_from_slice(&pair_mapping);
        descriptors.push(AlignmentPairDescriptor {
            probe_atom_start: probe_start,
            probe_atom_count: probe.atoms.len() as u64,
            reference_atom_start: reference_start,
            reference_atom_count: reference.atoms.len() as u64,
            mapping_start,
            mapping_count: pair_mapping.len() as u64,
            mode: AlignmentMode::MappedHorn,
        });
        pair_mappings.push(pair_mapping);
    }
    let max_memory_bytes = request.max_memory_bytes.unwrap_or(DEFAULT_MAX_MEMORY_BYTES);
    let execution = runtime
        .align_and_score_profiled(
            MetalAlignmentBatch {
                probe_atoms: &probe_atoms,
                reference_atoms: &reference_atoms,
                mappings: &mappings,
                pairs: &descriptors,
            },
            max_memory_bytes,
        )
        .map_err(|error| ComputeCoordinatorError::Unavailable(error.to_string()))?;

    let reference_has_charge = reference
        .atoms
        .iter()
        .any(|atom| atom.partial_charge.abs() > f32::EPSILON);
    let mut scores = vec![GridAlignmentScore {
        source_index: rows[0].source_index,
        name: rows[0].name.clone(),
        is_reference: true,
        rmsd: 0.0,
        shape_tanimoto: 1.0,
        electrostatic_carbo: reference_has_charge.then_some(1.0),
        combined_similarity: 1.0,
    }];
    let mut transforms = vec![rigid_transform_matrix(
        burrete_compute_core::RigidTransform::IDENTITY,
    )];
    let mut sdf_records = vec![sdf_record(
        &parsed[0],
        None,
        &scores[0],
        runtime.device_identity().name.as_str(),
    )?];
    for (pair_index, metal) in execution.pairs.iter().enumerate() {
        let probe = &parsed[pair_index + 1];
        validate_cpu_parity(probe, reference, &pair_mappings[pair_index], metal)?;
        let score = GridAlignmentScore {
            source_index: rows[pair_index + 1].source_index,
            name: rows[pair_index + 1].name.clone(),
            is_reference: false,
            rmsd: metal.scores.rmsd.unwrap_or_default(),
            shape_tanimoto: metal.scores.shape_tanimoto,
            electrostatic_carbo: metal
                .scores
                .electrostatic_available
                .then_some(metal.scores.electrostatic_carbo),
            combined_similarity: metal.scores.combined_similarity,
        };
        sdf_records.push(sdf_record(
            probe,
            Some(metal.transform),
            &score,
            runtime.device_identity().name.as_str(),
        )?);
        transforms.push(rigid_transform_matrix(metal.transform));
        scores.push(score);
    }
    let aligned_sdf = format!("{}\n", sdf_records.join("\n"));
    if aligned_sdf.len() > MAX_ALIGNMENT_OUTPUT_BYTES {
        return Err(ComputeCoordinatorError::Validation(format!(
            "Aligned SDF exceeds the {} MiB output limit",
            MAX_ALIGNMENT_OUTPUT_BYTES / 1024 / 1024
        )));
    }
    Ok(GridAlignmentResult {
        run_id,
        artifact_id: None,
        artifact_manifest_sha256: None,
        title: format!("aligned-{}-poses.sdf", rows.len()),
        aligned_sdf,
        scores,
        gpu_time_ms: execution.gpu_time_ms,
        backend: "nativeMetal",
        mapping: "deterministicElementBondGraph",
        charge_model,
        grid_applied: false,
        grid_warning: None,
        transforms,
    })
}

pub(crate) fn apply_grid_alignment_result(
    database_path: &Path,
    result: &GridAlignmentResult,
    runtime: &MetalTanimotoRuntime,
    artifact_id: Uuid,
    artifact_manifest_sha256: &str,
) -> ComputeResult<()> {
    let indexes = result
        .scores
        .iter()
        .map(|score| usize::try_from(score.source_index))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            ComputeCoordinatorError::Validation("Alignment source index exceeds usize".into())
        })?;
    let rows = alignment_source_rows_by_indices(database_path, &indexes)
        .map_err(ComputeCoordinatorError::Validation)?;
    if rows.len() != result.scores.len() {
        return Err(ComputeCoordinatorError::Validation(
            "One or more aligned Grid rows no longer exist".into(),
        ));
    }
    apply_grid_scores(
        database_path,
        result.run_id,
        &rows,
        &result.scores,
        runtime,
        result.gpu_time_ms,
        &result.charge_model,
        artifact_id,
        artifact_manifest_sha256,
    )
}

fn rigid_transform_matrix(transform: burrete_compute_core::RigidTransform) -> [f32; 16] {
    [
        transform.rotation[0][0],
        transform.rotation[0][1],
        transform.rotation[0][2],
        0.0,
        transform.rotation[1][0],
        transform.rotation[1][1],
        transform.rotation[1][2],
        0.0,
        transform.rotation[2][0],
        transform.rotation[2][1],
        transform.rotation[2][2],
        0.0,
        transform.translation[0],
        transform.translation[1],
        transform.translation[2],
        1.0,
    ]
}

fn normalized_indexes(indexes: &[usize]) -> ComputeResult<Vec<usize>> {
    let mut normalized = indexes.to_vec();
    normalized.sort_unstable();
    normalized.dedup();
    if normalized.len() < 2 || normalized.len() > MAX_ALIGNMENT_POSES {
        return Err(ComputeCoordinatorError::Validation(format!(
            "Pose alignment requires 2..={MAX_ALIGNMENT_POSES} selected rows"
        )));
    }
    Ok(normalized)
}

fn infer_atom_mapping(
    probe: &ParsedMolfile,
    reference: &ParsedMolfile,
) -> ComputeResult<Vec<AtomMapping>> {
    if probe.atoms.len() != reference.atoms.len() || probe.bonds.len() != reference.bonds.len() {
        return Err(ComputeCoordinatorError::Validation(
            "Pose alignment requires molecules with the same explicit atom and bond graph".into(),
        ));
    }
    let atom_count = probe.atoms.len();
    let probe_graph = bond_matrix(atom_count, &probe.bonds)?;
    let reference_graph = bond_matrix(atom_count, &reference.bonds)?;
    let mut candidates = Vec::with_capacity(atom_count);
    for probe_atom in 0..atom_count {
        let signature = atom_signature(probe, &probe_graph, probe_atom);
        let matches = (0..atom_count)
            .filter(|&reference_atom| {
                atom_signature(reference, &reference_graph, reference_atom) == signature
            })
            .collect::<Vec<_>>();
        if matches.is_empty() {
            return Err(ComputeCoordinatorError::Validation(
                "Pose alignment could not match the element and bond environments".into(),
            ));
        }
        candidates.push(matches);
    }
    let mut search_order = (0..atom_count).collect::<Vec<_>>();
    search_order.sort_by_key(|&atom| {
        (
            candidates[atom].len(),
            usize::MAX - degree(&probe_graph, atom),
            atom,
        )
    });
    let mut assigned = vec![None; atom_count];
    let mut used = vec![false; atom_count];
    if !assign_graph_mapping(
        0,
        &search_order,
        &candidates,
        &probe_graph,
        &reference_graph,
        &mut assigned,
        &mut used,
    ) {
        return Err(ComputeCoordinatorError::Validation(
            "Pose alignment requires an exact element and bond-graph match".into(),
        ));
    }
    assigned
        .into_iter()
        .enumerate()
        .map(|(probe_atom, reference_atom)| {
            Ok(AtomMapping {
                probe_atom: u32::try_from(probe_atom).map_err(|_| {
                    ComputeCoordinatorError::Validation("Alignment atom index exceeds u32".into())
                })?,
                reference_atom: u32::try_from(reference_atom.expect("complete graph mapping"))
                    .map_err(|_| {
                        ComputeCoordinatorError::Validation(
                            "Alignment atom index exceeds u32".into(),
                        )
                    })?,
                weight: 1.0,
            })
        })
        .collect()
}

fn bond_matrix(atom_count: usize, bonds: &[ParsedBond]) -> ComputeResult<Vec<u8>> {
    let mut matrix = vec![0; atom_count * atom_count];
    for bond in bonds {
        if bond.left >= atom_count || bond.right >= atom_count || bond.left == bond.right {
            return Err(ComputeCoordinatorError::Validation(
                "Molfile bond index is out of range".into(),
            ));
        }
        let forward = bond.left * atom_count + bond.right;
        let reverse = bond.right * atom_count + bond.left;
        if matrix[forward] != 0 {
            return Err(ComputeCoordinatorError::Validation(
                "Molfile contains a duplicate bond".into(),
            ));
        }
        matrix[forward] = bond.order;
        matrix[reverse] = bond.order;
    }
    Ok(matrix)
}

fn degree(graph: &[u8], atom: usize) -> usize {
    let atom_count = graph.len().isqrt();
    graph[atom * atom_count..(atom + 1) * atom_count]
        .iter()
        .filter(|&&order| order != 0)
        .count()
}

fn atom_signature(
    molecule: &ParsedMolfile,
    graph: &[u8],
    atom: usize,
) -> (String, i32, Vec<(String, u8)>) {
    let atom_count = molecule.atoms.len();
    let mut neighbors = (0..atom_count)
        .filter_map(|neighbor| {
            let order = graph[atom * atom_count + neighbor];
            (order != 0).then(|| (molecule.symbols[neighbor].clone(), order))
        })
        .collect::<Vec<_>>();
    neighbors.sort();
    (
        molecule.symbols[atom].clone(),
        molecule.formal_charges[atom],
        neighbors,
    )
}

fn assign_graph_mapping(
    depth: usize,
    search_order: &[usize],
    candidates: &[Vec<usize>],
    probe_graph: &[u8],
    reference_graph: &[u8],
    assigned: &mut [Option<usize>],
    used: &mut [bool],
) -> bool {
    if depth == search_order.len() {
        return true;
    }
    let atom_count = assigned.len();
    let probe_atom = search_order[depth];
    for &reference_atom in &candidates[probe_atom] {
        if used[reference_atom] {
            continue;
        }
        let consistent = assigned
            .iter()
            .enumerate()
            .all(|(other_probe, other_reference)| {
                other_reference.is_none_or(|other_reference| {
                    probe_graph[probe_atom * atom_count + other_probe]
                        == reference_graph[reference_atom * atom_count + other_reference]
                })
            });
        if !consistent {
            continue;
        }
        assigned[probe_atom] = Some(reference_atom);
        used[reference_atom] = true;
        if assign_graph_mapping(
            depth + 1,
            search_order,
            candidates,
            probe_graph,
            reference_graph,
            assigned,
            used,
        ) {
            return true;
        }
        assigned[probe_atom] = None;
        used[reference_atom] = false;
    }
    false
}

fn parse_row(row: &GridAlignmentSourceRow) -> ComputeResult<ParsedMolfile> {
    let molblock = row.molblock.as_deref().ok_or_else(|| {
        ComputeCoordinatorError::Validation(format!("{} has no molfile coordinates", row.name))
    })?;
    parse_molfile(molblock)
        .map_err(|message| ComputeCoordinatorError::Validation(format!("{}: {message}", row.name)))
}

pub(super) fn parse_molfile(text: &str) -> Result<ParsedMolfile, String> {
    let lines = text.lines().map(str::to_owned).collect::<Vec<_>>();
    if lines.len() < 4 {
        return Err("molfile is truncated".into());
    }
    if lines[3].contains("V3000") {
        parse_v3000(lines)
    } else {
        parse_v2000(lines)
    }
}

fn parse_v2000(lines: Vec<String>) -> Result<ParsedMolfile, String> {
    let count = fixed_field(&lines[3], 0, 3)
        .trim()
        .parse::<usize>()
        .map_err(|_| "invalid V2000 atom count")?;
    if count == 0 || lines.len() < 4 + count {
        return Err("V2000 atom block is empty or truncated".into());
    }
    let bond_count = fixed_field(&lines[3], 3, 6)
        .trim()
        .parse::<usize>()
        .map_err(|_| "invalid V2000 bond count")?;
    if lines.len() < 4 + count + bond_count {
        return Err("V2000 bond block is truncated".into());
    }
    let mut atoms = Vec::with_capacity(count);
    let mut symbols = Vec::with_capacity(count);
    for line in &lines[4..4 + count] {
        let position = [
            parse_fixed_f32(line, 0, 10)?,
            parse_fixed_f32(line, 10, 20)?,
            parse_fixed_f32(line, 20, 30)?,
            0.0,
        ];
        let symbol = fixed_field(line, 31, 34).trim().to_string();
        let charge_code = fixed_field(line, 36, 39).trim().parse::<i32>().unwrap_or(0);
        atoms.push(alignment_atom(
            position,
            &symbol,
            v2000_charge(charge_code),
        )?);
        symbols.push(symbol);
    }
    let mut bonds = Vec::with_capacity(bond_count);
    for line in &lines[4 + count..4 + count + bond_count] {
        let left = parse_v2000_atom_index(line, 0, 3, count)?;
        let right = parse_v2000_atom_index(line, 3, 6, count)?;
        let order = fixed_field(line, 6, 9)
            .trim()
            .parse::<u8>()
            .map_err(|_| "invalid V2000 bond order")?;
        if left == right || order == 0 {
            return Err("invalid V2000 bond record".into());
        }
        bonds.push(ParsedBond { left, right, order });
    }
    apply_v2000_charges(&lines, &mut atoms)?;
    let formal_charges = atoms
        .iter()
        .map(|atom| atom.partial_charge.round() as i32)
        .collect();
    Ok(ParsedMolfile {
        atoms,
        symbols,
        formal_charges,
        bonds,
        lines,
        layout: MolfileLayout::V2000 { atom_start: 4 },
    })
}

fn parse_v3000(lines: Vec<String>) -> Result<ParsedMolfile, String> {
    let begin = lines
        .iter()
        .position(|line| line.trim() == "M  V30 BEGIN ATOM")
        .ok_or("V3000 atom block is missing")?;
    let end = lines
        .iter()
        .skip(begin + 1)
        .position(|line| line.trim() == "M  V30 END ATOM")
        .map(|offset| begin + 1 + offset)
        .ok_or("V3000 atom block is truncated")?;
    let atom_lines = (begin + 1..end).collect::<Vec<_>>();
    if atom_lines.is_empty() {
        return Err("V3000 atom block is empty".into());
    }
    let mut atoms = Vec::with_capacity(atom_lines.len());
    let mut symbols = Vec::with_capacity(atom_lines.len());
    let mut formal_charges = Vec::with_capacity(atom_lines.len());
    let mut atom_ids = std::collections::BTreeMap::new();
    for &line_index in &atom_lines {
        let tokens = lines[line_index].split_whitespace().collect::<Vec<_>>();
        if tokens.len() < 8 || tokens[0] != "M" || tokens[1] != "V30" {
            return Err("invalid V3000 atom record".into());
        }
        let atom_id = tokens[2]
            .parse::<usize>()
            .map_err(|_| "invalid V3000 atom index")?;
        if atom_ids.insert(atom_id, atoms.len()).is_some() {
            return Err("duplicate V3000 atom index".into());
        }
        let symbol = tokens[3].to_string();
        let position = [
            tokens[4]
                .parse::<f32>()
                .map_err(|_| "invalid V3000 x coordinate")?,
            tokens[5]
                .parse::<f32>()
                .map_err(|_| "invalid V3000 y coordinate")?,
            tokens[6]
                .parse::<f32>()
                .map_err(|_| "invalid V3000 z coordinate")?,
            0.0,
        ];
        let charge = tokens
            .iter()
            .find_map(|token| token.strip_prefix("CHG="))
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        atoms.push(alignment_atom(position, &symbol, charge)?);
        symbols.push(symbol);
        formal_charges.push(charge);
    }
    let bond_begin = lines
        .iter()
        .position(|line| line.trim() == "M  V30 BEGIN BOND");
    let mut bonds = Vec::new();
    if let Some(bond_begin) = bond_begin {
        let bond_end = lines
            .iter()
            .skip(bond_begin + 1)
            .position(|line| line.trim() == "M  V30 END BOND")
            .map(|offset| bond_begin + 1 + offset)
            .ok_or("V3000 bond block is truncated")?;
        for line in &lines[bond_begin + 1..bond_end] {
            let tokens = line.split_whitespace().collect::<Vec<_>>();
            if tokens.len() < 6 || tokens[0] != "M" || tokens[1] != "V30" {
                return Err("invalid V3000 bond record".into());
            }
            let order = tokens[3]
                .parse::<u8>()
                .map_err(|_| "invalid V3000 bond order")?;
            let left_id = tokens[4]
                .parse::<usize>()
                .map_err(|_| "invalid V3000 bond atom")?;
            let right_id = tokens[5]
                .parse::<usize>()
                .map_err(|_| "invalid V3000 bond atom")?;
            let left = *atom_ids
                .get(&left_id)
                .ok_or("V3000 bond atom is out of range")?;
            let right = *atom_ids
                .get(&right_id)
                .ok_or("V3000 bond atom is out of range")?;
            if left == right || order == 0 {
                return Err("invalid V3000 bond record".into());
            }
            bonds.push(ParsedBond { left, right, order });
        }
    }
    Ok(ParsedMolfile {
        atoms,
        symbols,
        formal_charges,
        bonds,
        lines,
        layout: MolfileLayout::V3000 { atom_lines },
    })
}

fn alignment_atom(position: [f32; 4], symbol: &str, charge: i32) -> Result<AlignmentAtom, String> {
    let radius = vdw_radius(symbol).ok_or_else(|| format!("unsupported element {symbol}"))?;
    Ok(AlignmentAtom {
        position,
        gaussian_exponent: SHAPE_ALPHA / (radius * radius),
        gaussian_amplitude: 1.0,
        partial_charge: charge as f32,
    })
}

fn vdw_radius(symbol: &str) -> Option<f32> {
    Some(match symbol {
        "H" => 1.20,
        "B" => 1.92,
        "C" => 1.70,
        "N" => 1.55,
        "O" => 1.52,
        "F" => 1.47,
        "Si" => 2.10,
        "P" => 1.80,
        "S" => 1.80,
        "Cl" => 1.75,
        "As" => 1.85,
        "Se" => 1.90,
        "Br" => 1.85,
        "I" => 1.98,
        "Li" | "Na" | "K" | "Rb" | "Cs" => 2.40,
        "Mg" | "Ca" | "Zn" | "Fe" | "Cu" | "Mn" | "Co" | "Ni" => 1.80,
        _ => return None,
    })
}

fn v2000_charge(code: i32) -> i32 {
    match code {
        1 => 3,
        2 => 2,
        3 => 1,
        5 => -1,
        6 => -2,
        7 => -3,
        _ => 0,
    }
}

fn apply_v2000_charges(lines: &[String], atoms: &mut [AlignmentAtom]) -> Result<(), String> {
    for line in lines.iter().filter(|line| line.starts_with("M  CHG")) {
        let tokens = line.split_whitespace().collect::<Vec<_>>();
        let pair_count = tokens
            .get(2)
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or("invalid M  CHG record")?;
        if tokens.len() < 3 + pair_count * 2 {
            return Err("truncated M  CHG record".into());
        }
        for pair in 0..pair_count {
            let atom = tokens[3 + pair * 2]
                .parse::<usize>()
                .map_err(|_| "invalid M  CHG atom")?;
            let charge = tokens[4 + pair * 2]
                .parse::<i32>()
                .map_err(|_| "invalid M  CHG charge")?;
            let target = atoms
                .get_mut(atom.saturating_sub(1))
                .ok_or("M  CHG atom is out of range")?;
            target.partial_charge = charge as f32;
        }
    }
    Ok(())
}

fn validate_cpu_parity(
    probe: &ParsedMolfile,
    reference: &ParsedMolfile,
    mapping: &[AtomMapping],
    metal: &burrete_compute_metal::MetalAlignmentPairResult,
) -> ComputeResult<()> {
    let cpu = align_and_score(
        &probe.atoms,
        &reference.atoms,
        mapping,
        AlignmentMode::MappedHorn,
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    for (label, observed, expected, tolerance) in [
        (
            "RMSD",
            metal.scores.rmsd.unwrap_or_default(),
            cpu.scores.rmsd.unwrap_or_default(),
            2.0e-4,
        ),
        (
            "shape Tanimoto",
            metal.scores.shape_tanimoto,
            cpu.scores.shape_tanimoto,
            2.0e-4,
        ),
        (
            "combined similarity",
            metal.scores.combined_similarity,
            cpu.scores.combined_similarity,
            2.0e-4,
        ),
    ] {
        if (observed - expected).abs() > tolerance {
            return Err(ComputeCoordinatorError::Validation(format!(
                "Metal alignment {label} failed CPU parity: observed {observed}, expected {expected}"
            )));
        }
    }
    Ok(())
}

fn sdf_record(
    molecule: &ParsedMolfile,
    transform: Option<burrete_compute_core::RigidTransform>,
    score: &GridAlignmentScore,
    device: &str,
) -> ComputeResult<String> {
    let mut lines = molecule.lines.clone();
    if let Some(transform) = transform {
        let positions = molecule
            .atoms
            .iter()
            .map(|atom| transform.apply(atom.position))
            .collect::<Vec<_>>();
        match &molecule.layout {
            MolfileLayout::V2000 { atom_start } => {
                for (offset, position) in positions.iter().enumerate() {
                    let line = &lines[atom_start + offset];
                    let tail = line.get(30..).unwrap_or("");
                    lines[atom_start + offset] = format!(
                        "{:>10.4}{:>10.4}{:>10.4}{tail}",
                        position[0], position[1], position[2]
                    );
                }
            }
            MolfileLayout::V3000 { atom_lines } => {
                for (&line_index, position) in atom_lines.iter().zip(positions) {
                    let tokens = lines[line_index].split_whitespace().collect::<Vec<_>>();
                    let suffix = tokens
                        .get(7..)
                        .map(|items| items.join(" "))
                        .unwrap_or_default();
                    lines[line_index] = format!(
                        "M  V30 {} {} {:.6} {:.6} {:.6} {}{}",
                        tokens[2],
                        tokens[3],
                        position[0],
                        position[1],
                        position[2],
                        tokens[7],
                        if suffix.is_empty() {
                            String::new()
                        } else {
                            format!(" {}", tokens.get(8..).unwrap_or(&[]).join(" "))
                        }
                    );
                }
            }
        }
    }
    let esp = score
        .electrostatic_carbo
        .map(|value| format!("{value:.8}"))
        .unwrap_or_else(|| "unavailable (no non-zero atomic charges)".into());
    Ok(format!(
        "{}\n>  <BURRETE_ALIGNMENT_REFERENCE>\n{}\n\n>  <BURRETE_ALIGNED_RMSD>\n{:.8}\n\n>  <BURRETE_SHAPE_TANIMOTO>\n{:.8}\n\n>  <BURRETE_ELECTROSTATIC_CARBO>\n{}\n\n>  <BURRETE_COMBINED_SIMILARITY>\n{:.8}\n\n>  <BURRETE_COMPUTE_BACKEND>\nMetal GPU ({})\n\n$$$$",
        lines.join("\n"),
        score.is_reference,
        score.rmsd,
        score.shape_tanimoto,
        esp,
        score.combined_similarity,
        device,
    ))
}

fn apply_grid_scores(
    database_path: &Path,
    run_id: Uuid,
    rows: &[GridAlignmentSourceRow],
    scores: &[GridAlignmentScore],
    runtime: &MetalTanimotoRuntime,
    gpu_time_ms: u64,
    charge_model: &str,
    artifact_id: Uuid,
    artifact_manifest_sha256: &str,
) -> ComputeResult<()> {
    let connection: Connection =
        open_grid_database(database_path).map_err(ComputeCoordinatorError::Validation)?;
    let identity = grid_identity::read_source_identity(&connection)
        .map_err(ComputeCoordinatorError::Validation)?;
    let settings = serde_json::json!({
        "mapping": "deterministicElementBondGraph",
        "shapeGaussian": "alpha=2.4179878/r_vdw^2; amplitude=1",
        "chargeModel": charge_model,
        "runtime": runtime.runtime_identity().version,
    });
    let settings_bytes = serde_json::to_vec(&settings)
        .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?;
    let normalized_settings_sha256 = sha256(&settings_bytes);
    let snapshot_sha256 = sha256(
        rows.iter()
            .flat_map(|row| row.molecule_content_sha256.as_bytes())
            .copied()
            .collect::<Vec<_>>()
            .as_slice(),
    );
    let assignments = rows
        .iter()
        .zip(scores)
        .map(|(row, score)| GridAlignmentAssignmentInput {
            molecule_id: row.row_id,
            source_index: row.source_index,
            molecule_content_sha256: row.molecule_content_sha256.clone(),
            is_reference: score.is_reference,
            rmsd: f64::from(score.rmsd),
            shape_tanimoto: f64::from(score.shape_tanimoto),
            electrostatic_carbo: score.electrostatic_carbo.map(f64::from),
            combined_similarity: f64::from(score.combined_similarity),
        })
        .collect();
    apply_alignment_analysis_run(
        database_path,
        &GridAlignmentAnalysisApplyInput {
            run_id,
            document_fingerprint_sha256: identity.document_fingerprint_sha256,
            source_revision: identity.source_revision,
            snapshot_id: Uuid::new_v4(),
            snapshot_sha256,
            normalized_settings_sha256,
            provenance: serde_json::json!({
                "backend": "nativeMetal",
                "device": runtime.device_identity(),
                "gpuTimeMs": gpu_time_ms,
                "cpuParity": "passed",
                "mapping": "deterministic exact element and bond-graph isomorphism",
                "chargeModel": charge_model,
                "electrostaticFallback": "score unavailable when all atomic charges are zero",
                "upstream": "https://github.com/guillaume-osmo/mlxmolkit",
            }),
            created_at_ms: now_ms(),
            artifact_id,
            artifact_manifest_sha256: artifact_manifest_sha256.into(),
            assignments,
        },
    )
    .map_err(ComputeCoordinatorError::Validation)
}

fn fixed_field(text: &str, start: usize, end: usize) -> &str {
    text.get(start..end).unwrap_or("")
}

fn parse_v2000_atom_index(
    text: &str,
    start: usize,
    end: usize,
    atom_count: usize,
) -> Result<usize, String> {
    let one_based = fixed_field(text, start, end)
        .trim()
        .parse::<usize>()
        .map_err(|_| "invalid V2000 bond atom")?;
    let index = one_based.checked_sub(1).ok_or("invalid V2000 bond atom")?;
    if index >= atom_count {
        return Err("V2000 bond atom is out of range".into());
    }
    Ok(index)
}

fn parse_fixed_f32(text: &str, start: usize, end: usize) -> Result<f32, String> {
    fixed_field(text, start, end)
        .trim()
        .parse::<f32>()
        .map_err(|_| "invalid V2000 coordinate".into())
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_rewrites_v2000_coordinates() {
        let mol = "ethane\n  Burrete\n\n  2  1  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\nM  END";
        let parsed = parse_molfile(mol).expect("parse fixture");
        assert_eq!(parsed.symbols, ["C", "C"]);
        assert_eq!(parsed.atoms[1].position[0], 1.5);
    }

    #[test]
    fn infers_non_identity_mapping_from_element_and_bond_graph() {
        let reference = parse_molfile(
            "methanol\n  Burrete\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    2.0000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  2  3  1  0  0  0  0\nM  END",
        )
        .expect("parse reference");
        let reordered = parse_molfile(
            "methanol pose\n  Burrete\n\n  3  2  0  0  0  0            999 V2000\n    2.0000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n  2  3  1  0  0  0  0\n  3  1  1  0  0  0  0\nM  END",
        )
        .expect("parse reordered pose");
        let mapping = infer_atom_mapping(&reordered, &reference).expect("infer mapping");
        let pairs = mapping
            .iter()
            .map(|item| (item.probe_atom, item.reference_atom))
            .collect::<Vec<_>>();
        assert_eq!(pairs, [(0, 2), (1, 0), (2, 1)]);
    }

    #[test]
    fn rejects_same_elements_with_a_different_bond_graph() {
        let connected = parse_molfile(
            "connected\n  Burrete\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    2.0000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  2  3  1  0  0  0  0\nM  END",
        )
        .expect("parse connected");
        let disconnected = parse_molfile(
            "disconnected\n  Burrete\n\n  3  1  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    2.0000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\nM  END",
        )
        .expect("parse disconnected");
        assert!(infer_atom_mapping(&disconnected, &connected).is_err());
    }

    #[test]
    fn rejects_unknown_elements_and_invalid_selection_sizes() {
        let mol = "x\n  Burrete\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 Xx  0  0  0  0  0  0  0  0  0  0  0  0\nM  END";
        assert!(parse_molfile(mol).is_err());
        assert!(normalized_indexes(&[1]).is_err());
    }

    #[test]
    #[ignore = "manual real-GPU smoke; set BURRETE_METAL_RUNTIME_ROOT"]
    fn aligns_a_reordered_grid_pose_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(std::path::PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged runtime");
        let runtime = MetalTanimotoRuntime::load(&root, &"0".repeat(64))
            .expect("load verified Metal runtime");
        let grid_root =
            std::env::temp_dir().join(format!("burrete-alignment-grid-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&grid_root).expect("create Grid root");
        let sdf = "methanol\n  Burrete\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    2.0000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  2  3  1  0  0  0  0\nM  END\n$$$$\nmethanol pose\n  Burrete\n\n  3  2  0  0  0  0            999 V2000\n    2.0000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n  2  3  1  0  0  0  0\n  3  1  1  0  0  0  0\nM  END\n$$$$\n";
        let handle =
            crate::preview::grid_store::build_grid_store(&grid_root, "sdf", sdf.as_bytes())
                .expect("build Grid")
                .expect("Grid handle");
        let result = execute_grid_alignment(
            &runtime,
            &handle.database_path,
            &GridAlignmentRequest {
                document_id: "alignment-smoke".into(),
                source_indexes: vec![0, 1],
                max_memory_bytes: Some(64 * 1024 * 1024),
            },
        )
        .expect("execute Metal alignment");
        assert_eq!(result.backend, "nativeMetal");
        assert_eq!(result.mapping, "deterministicElementBondGraph");
        assert!(result.scores[1].rmsd < 1.0e-4);
        assert!(!result.grid_applied);
        assert!(result.artifact_id.is_none());
        assert!(result.aligned_sdf.contains("Metal GPU"));

        let _ = std::fs::remove_dir_all(&grid_root);
    }
}
