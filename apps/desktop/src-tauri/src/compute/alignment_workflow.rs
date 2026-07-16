use std::path::Path;

use burrete_compute_core::{align_and_score, AlignmentAtom, AlignmentMode, AtomMapping};
use burrete_compute_metal::{AlignmentPairDescriptor, MetalAlignmentBatch, MetalTanimotoRuntime};
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
    pub(crate) title: String,
    pub(crate) aligned_sdf: String,
    pub(crate) scores: Vec<GridAlignmentScore>,
    pub(crate) gpu_time_ms: u64,
    pub(crate) backend: &'static str,
    pub(crate) mapping: &'static str,
    pub(crate) charge_model: &'static str,
    pub(crate) grid_applied: bool,
}

#[derive(Clone, Debug)]
struct ParsedMolfile {
    atoms: Vec<AlignmentAtom>,
    symbols: Vec<String>,
    lines: Vec<String>,
    layout: MolfileLayout,
}

#[derive(Clone, Debug)]
enum MolfileLayout {
    V2000 { atom_start: usize },
    V3000 { atom_lines: Vec<usize> },
}

pub(crate) fn execute_grid_alignment(
    runtime: &MetalTanimotoRuntime,
    database_path: &Path,
    request: &GridAlignmentRequest,
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
    let reference = &parsed[0];
    let mut probe_atoms = Vec::new();
    let mut reference_atoms = Vec::new();
    let mut mappings = Vec::new();
    let mut descriptors = Vec::new();
    for probe in parsed.iter().skip(1) {
        if probe.symbols != reference.symbols {
            return Err(ComputeCoordinatorError::Validation(
                "Mapped pose alignment requires the same explicit atom order and elements; atom-order remapping is not inferred".into(),
            ));
        }
        let probe_start = probe_atoms.len() as u64;
        let reference_start = reference_atoms.len() as u64;
        let mapping_start = mappings.len() as u64;
        probe_atoms.extend_from_slice(&probe.atoms);
        reference_atoms.extend_from_slice(&reference.atoms);
        mappings.extend((0..probe.atoms.len()).map(|index| AtomMapping {
            probe_atom: index as u32,
            reference_atom: index as u32,
            weight: 1.0,
        }));
        descriptors.push(AlignmentPairDescriptor {
            probe_atom_start: probe_start,
            probe_atom_count: probe.atoms.len() as u64,
            reference_atom_start: reference_start,
            reference_atom_count: reference.atoms.len() as u64,
            mapping_start,
            mapping_count: probe.atoms.len() as u64,
            mode: AlignmentMode::MappedHorn,
        });
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
    let mut sdf_records = vec![sdf_record(
        &parsed[0],
        None,
        &scores[0],
        runtime.device_identity().name.as_str(),
    )?];
    for (pair_index, metal) in execution.pairs.iter().enumerate() {
        let probe = &parsed[pair_index + 1];
        validate_cpu_parity(probe, reference, metal)?;
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
        scores.push(score);
    }
    let aligned_sdf = format!("{}\n", sdf_records.join("\n"));
    if aligned_sdf.len() > MAX_ALIGNMENT_OUTPUT_BYTES {
        return Err(ComputeCoordinatorError::Validation(format!(
            "Aligned SDF exceeds the {} MiB output limit",
            MAX_ALIGNMENT_OUTPUT_BYTES / 1024 / 1024
        )));
    }
    let run_id = Uuid::new_v4();
    apply_grid_scores(
        database_path,
        run_id,
        &rows,
        &scores,
        runtime,
        execution.gpu_time_ms,
    )?;
    Ok(GridAlignmentResult {
        run_id,
        title: format!("aligned-{}-poses.sdf", rows.len()),
        aligned_sdf,
        scores,
        gpu_time_ms: execution.gpu_time_ms,
        backend: "nativeMetal",
        mapping: "explicitIdentityAtomOrder",
        charge_model: "molfileFormalCharge",
        grid_applied: true,
    })
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

fn parse_row(row: &GridAlignmentSourceRow) -> ComputeResult<ParsedMolfile> {
    let molblock = row.molblock.as_deref().ok_or_else(|| {
        ComputeCoordinatorError::Validation(format!("{} has no molfile coordinates", row.name))
    })?;
    parse_molfile(molblock)
        .map_err(|message| ComputeCoordinatorError::Validation(format!("{}: {message}", row.name)))
}

fn parse_molfile(text: &str) -> Result<ParsedMolfile, String> {
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
    apply_v2000_charges(&lines, &mut atoms)?;
    Ok(ParsedMolfile {
        atoms,
        symbols,
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
    for &line_index in &atom_lines {
        let tokens = lines[line_index].split_whitespace().collect::<Vec<_>>();
        if tokens.len() < 8 || tokens[0] != "M" || tokens[1] != "V30" {
            return Err("invalid V3000 atom record".into());
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
    }
    Ok(ParsedMolfile {
        atoms,
        symbols,
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
    metal: &burrete_compute_metal::MetalAlignmentPairResult,
) -> ComputeResult<()> {
    let mapping = (0..probe.atoms.len())
        .map(|index| AtomMapping {
            probe_atom: index as u32,
            reference_atom: index as u32,
            weight: 1.0,
        })
        .collect::<Vec<_>>();
    let cpu = align_and_score(
        &probe.atoms,
        &reference.atoms,
        &mapping,
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
        .unwrap_or_else(|| "unavailable (no non-zero molfile formal charges)".into());
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
) -> ComputeResult<()> {
    let connection: Connection =
        open_grid_database(database_path).map_err(ComputeCoordinatorError::Validation)?;
    let identity = grid_identity::read_source_identity(&connection)
        .map_err(ComputeCoordinatorError::Validation)?;
    let settings = serde_json::json!({
        "mapping": "explicitIdentityAtomOrder",
        "shapeGaussian": "alpha=2.4179878/r_vdw^2; amplitude=1",
        "chargeModel": "molfileFormalCharge",
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
                "mapping": "explicit identity mapping after element-order validation",
                "chargeModel": "molfile formal charges; electrostatic score unavailable when all charges are zero",
                "upstream": "https://github.com/guillaume-osmo/mlxmolkit",
            }),
            created_at_ms: now_ms(),
            assignments,
        },
    )
    .map_err(ComputeCoordinatorError::Validation)
}

fn fixed_field(text: &str, start: usize, end: usize) -> &str {
    text.get(start..end).unwrap_or("")
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
    fn rejects_unknown_elements_and_invalid_selection_sizes() {
        let mol = "x\n  Burrete\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 Xx  0  0  0  0  0  0  0  0  0  0  0  0\nM  END";
        assert!(parse_molfile(mol).is_err());
        assert!(normalized_indexes(&[1]).is_err());
    }
}
