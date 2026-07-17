use std::{
    collections::BTreeSet,
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use burrete_compute_protocol::{
    ArtifactFile, ArtifactManifest, ArtifactManifestSchemaVersion, EnginePackManifest,
    EnginePackRef, EnginePackVersion, JobSnapshot, PackedArrayDescriptor, PackedByteOrder,
    PackedDType, PackedFileDescriptor, PackedLayout, ResultPackManifest, ResultPackRef,
    ResultPackVersion, StageProvenance, WorkflowTemplateId, CLUSTER_FINGERPRINT_ARRAY_NAME,
    CLUSTER_FINGERPRINT_SEMANTIC, CLUSTER_FINGERPRINT_WORDS,
};
use rustix::{
    fs::{renameat_with, RenameFlags},
    process::geteuid,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    cluster_executor::ClusterComputation,
    conformer_executor::ConformerDistanceComputation,
    conformer_stereo_executor::ConformerStereoComputation,
    error::{ComputeCoordinatorError, ComputeResult},
    store::ComputeStore,
};
use burrete_compute_core::{ConformerEnginePackArrays, ConformerPackedArraySpan};

const ARTIFACT_DIRECTORY_MODE: u32 = 0o700;
const ARTIFACT_FILE_MODE: u32 = 0o600;
const MAX_ARTIFACT_ROOT_ENTRIES: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClusterPublicationStep {
    pub(crate) job: JobSnapshot,
    pub(crate) artifact_id: Uuid,
    pub(crate) artifact_manifest_sha256: String,
    pub(crate) grid_applied: bool,
    pub(crate) grid_warning: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerPublicationStep {
    pub(crate) job: JobSnapshot,
    pub(crate) artifact_id: Uuid,
    pub(crate) artifact_manifest_sha256: String,
    pub(crate) grid_applied: bool,
    pub(crate) grid_warning: Option<String>,
    pub(crate) primary_open_path: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AnalysisPublicationStep {
    pub(crate) artifact_id: Uuid,
    pub(crate) artifact_manifest_sha256: String,
}

#[derive(Debug)]
pub(crate) enum AnalysisArtifactPayload {
    Alignment {
        source_record_ids: Vec<u64>,
        is_references: Vec<u8>,
        rmsd_values: Vec<f32>,
        shape_tanimoto_scores: Vec<f32>,
        electrostatic_carbo_scores: Vec<f32>,
        combined_similarities: Vec<f32>,
        transforms: Vec<[f32; 16]>,
        aligned_sdf: String,
    },
    Semiempirical {
        source_record_ids: Vec<u64>,
        electronic_energies: Vec<f64>,
        nuclear_energies: Vec<f64>,
        total_energies: Vec<f64>,
        converged: Vec<u8>,
        iterations: Vec<u32>,
        charge_starts: Vec<u64>,
        atomic_charges: Vec<f64>,
    },
}

#[derive(Debug)]
pub(crate) struct MaterializedComputeArtifact {
    pub(crate) artifact_id: Uuid,
    pub(crate) result_pack: ResultPackRef,
    pub(crate) files: Vec<ArtifactFile>,
    pub(crate) relative_directory: String,
    pub(crate) created_at_ms: u64,
    pub(crate) byte_count: u64,
    final_directory: PathBuf,
}

impl MaterializedComputeArtifact {
    pub(crate) fn conformer_xyz_path(&self) -> PathBuf {
        self.final_directory.join("result/conformers.xyz")
    }

    pub(crate) fn manifest_for_job(
        &self,
        successful_job: &JobSnapshot,
    ) -> ComputeResult<ArtifactManifest> {
        let stages = successful_job
            .stages
            .iter()
            .map(|stage| {
                Ok(StageProvenance {
                    stage_id: stage.stage_id.clone(),
                    kind: stage.kind,
                    engine: stage.engine.clone(),
                    requested_backend: stage.requested_backend,
                    effective_backend: stage.effective_backend,
                    precision: stage.precision,
                    device: stage.device.clone(),
                    kernel_id: stage.kernel_id.clone(),
                    gpu_time_ms: stage.gpu_time_ms,
                    host_time_ms: stage.host_time_ms.ok_or_else(|| {
                        ComputeCoordinatorError::Protocol(
                            "successful stage lacks host timing provenance".into(),
                        )
                    })?,
                    transferred_bytes: stage.transferred_bytes,
                    fallback: stage.fallback.clone(),
                })
            })
            .collect::<ComputeResult<Vec<_>>>()?;
        let manifest = ArtifactManifest {
            schema_version: ArtifactManifestSchemaVersion::V1,
            artifact_id: self.artifact_id,
            job_id: successful_job.job_id,
            workflow_template: successful_job.workflow_template,
            molecular_snapshot: successful_job.frozen_source.clone(),
            normalized_request_sha256: successful_job.normalized_request_sha256.clone(),
            accepted_plan_sha256: successful_job.accepted_plan_sha256.clone(),
            runtime: successful_job.pinned_runtime.clone(),
            result_pack: self.result_pack.clone(),
            files: self.files.clone(),
            stages,
            created_at_ms: self.created_at_ms,
        };
        manifest.validate_against_job(successful_job)?;
        Ok(manifest)
    }

    pub(crate) fn cleanup(&self) -> ComputeResult<()> {
        match fs::remove_dir_all(&self.final_directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(ComputeCoordinatorError::Filesystem(format!(
                "cannot remove uncommitted artifact {}: {error}",
                self.artifact_id
            ))),
        }
    }
}

pub(crate) fn materialize_analysis_artifact(
    store: &ComputeStore,
    job: &JobSnapshot,
    payload: AnalysisArtifactPayload,
    created_at_ms: u64,
) -> ComputeResult<MaterializedComputeArtifact> {
    job.validate()?;
    if created_at_ms == 0 {
        return Err(ComputeCoordinatorError::Validation(
            "artifact creation time must be positive".into(),
        ));
    }
    let (workflow, result_version) = match (&payload, job.workflow_template) {
        (AnalysisArtifactPayload::Alignment { .. }, WorkflowTemplateId::AlignmentV1) => (
            WorkflowTemplateId::AlignmentV1,
            ResultPackVersion::AlignmentV1,
        ),
        (AnalysisArtifactPayload::Semiempirical { .. }, WorkflowTemplateId::SemiempiricalV1) => (
            WorkflowTemplateId::SemiempiricalV1,
            ResultPackVersion::SemiempiricalV1,
        ),
        _ => {
            return Err(ComputeCoordinatorError::Protocol(
                "analysis artifact payload differs from its durable workflow".into(),
            ))
        }
    };
    let root = store.artifact_root()?;
    initialize_artifact_root(&root)?;
    let artifact_id = Uuid::new_v4();
    let staging_leaf = format!(".artifact-{artifact_id}.staging");
    let final_leaf = format!("artifact-{artifact_id}");
    let staging = root.join(&staging_leaf);
    let final_directory = root.join(&final_leaf);
    create_private_directory(&staging)?;
    create_private_directory(&staging.join("engine"))?;
    create_private_directory(&staging.join("result"))?;

    let result = (|| {
        let mut writer = ArtifactWriter::new(&staging);
        let mut arrays = Vec::new();
        match payload {
            AnalysisArtifactPayload::Alignment {
                source_record_ids,
                is_references,
                rmsd_values,
                shape_tanimoto_scores,
                electrostatic_carbo_scores,
                combined_similarities,
                transforms,
                aligned_sdf,
            } => {
                let records = source_record_ids.len() as u64;
                require_equal_analysis_lengths(
                    records,
                    &[
                        is_references.len(),
                        rmsd_values.len(),
                        shape_tanimoto_scores.len(),
                        electrostatic_carbo_scores.len(),
                        combined_similarities.len(),
                        transforms.len(),
                    ],
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "sourceRecordIds",
                    "source_record_id",
                    None,
                    PackedDType::U64,
                    vec![records],
                    &encode_u64(&source_record_ids),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "isReferences",
                    "alignment_reference",
                    None,
                    PackedDType::Bool8,
                    vec![records],
                    &is_references,
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "rmsdValues",
                    "rmsd",
                    Some("angstrom"),
                    PackedDType::F32,
                    vec![records],
                    &encode_f32(&rmsd_values),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "shapeTanimotoScores",
                    "shape_tanimoto",
                    None,
                    PackedDType::F32,
                    vec![records],
                    &encode_f32(&shape_tanimoto_scores),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "electrostaticCarboScores",
                    "electrostatic_carbo",
                    None,
                    PackedDType::F32,
                    vec![records],
                    &encode_f32(&electrostatic_carbo_scores),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "combinedSimilarities",
                    "combined_similarity",
                    None,
                    PackedDType::F32,
                    vec![records],
                    &encode_f32(&combined_similarities),
                )?;
                let transform_values = transforms.into_iter().flatten().collect::<Vec<_>>();
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "transforms",
                    "rigid_transform_4x4",
                    None,
                    PackedDType::F32,
                    vec![records, 16],
                    &encode_f32(&transform_values),
                )?;
                writer.write(
                    "result/aligned.sdf",
                    "chemical/x-mdl-sdfile",
                    aligned_sdf.as_bytes(),
                )?;
            }
            AnalysisArtifactPayload::Semiempirical {
                source_record_ids,
                electronic_energies,
                nuclear_energies,
                total_energies,
                converged,
                iterations,
                charge_starts,
                atomic_charges,
            } => {
                let records = source_record_ids.len() as u64;
                require_equal_analysis_lengths(
                    records,
                    &[
                        electronic_energies.len(),
                        nuclear_energies.len(),
                        total_energies.len(),
                        converged.len(),
                        iterations.len(),
                    ],
                )?;
                if charge_starts.len() != source_record_ids.len() + 1
                    || charge_starts.first() != Some(&0)
                    || charge_starts.last().copied() != Some(atomic_charges.len() as u64)
                    || charge_starts.windows(2).any(|pair| pair[0] > pair[1])
                {
                    return Err(ComputeCoordinatorError::Validation(
                        "semiempirical charge offsets do not bind the atomic charge payload".into(),
                    ));
                }
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "sourceRecordIds",
                    "source_record_id",
                    None,
                    PackedDType::U64,
                    vec![records],
                    &encode_u64(&source_record_ids),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "electronicEnergies",
                    "electronic_energy",
                    Some("eV"),
                    PackedDType::F64,
                    vec![records],
                    &encode_f64(&electronic_energies),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "nuclearEnergies",
                    "nuclear_energy",
                    Some("eV"),
                    PackedDType::F64,
                    vec![records],
                    &encode_f64(&nuclear_energies),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "totalEnergies",
                    "total_energy",
                    Some("eV"),
                    PackedDType::F64,
                    vec![records],
                    &encode_f64(&total_energies),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "converged",
                    "scf_converged",
                    None,
                    PackedDType::Bool8,
                    vec![records],
                    &converged,
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "iterations",
                    "scf_iterations",
                    None,
                    PackedDType::U32,
                    vec![records],
                    &encode_u32(&iterations),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "chargeStarts",
                    "atomic_charge_offsets",
                    None,
                    PackedDType::U64,
                    vec![records + 1],
                    &encode_u64(&charge_starts),
                )?;
                push_analysis_array(
                    &mut writer,
                    &mut arrays,
                    "atomicCharges",
                    "mulliken_atomic_charge",
                    Some("e"),
                    PackedDType::F64,
                    vec![atomic_charges.len() as u64],
                    &encode_f64(&atomic_charges),
                )?;
            }
        }
        arrays.sort_by(|left, right| left.name.cmp(&right.name));
        let mut result_files = writer.descriptors.clone();
        result_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let result_layout = PackedLayout {
            files: result_files,
            arrays,
        };
        let result_pack_id = Uuid::new_v4();
        let kind = match workflow {
            WorkflowTemplateId::AlignmentV1 => "alignment.result-pack.v1",
            WorkflowTemplateId::SemiempiricalV1 => "semiempirical.result-pack.v1",
            _ => unreachable!("analysis workflow was checked"),
        };
        let result_pack_sha256 = pack_identity_sha256(&PackIdentity {
            kind,
            pack_id: result_pack_id,
            job_id: job.job_id,
            snapshot_sha256: &job.frozen_source.snapshot_sha256,
            settings_sha256: &job.normalized_request_sha256,
            layout: &result_layout,
        })?;
        let result_manifest = ResultPackManifest {
            schema_version: result_version,
            result_pack_id,
            result_pack_sha256,
            job_id: job.job_id,
            workflow_template: workflow,
            molecular_snapshot: job.frozen_source.clone(),
            engine_packs: Vec::new(),
            layout: result_layout,
            created_at_ms,
        };
        result_manifest.validate()?;
        let manifest_file = writer.write(
            "result/manifest.json",
            "application/json",
            &serde_json::to_vec(&result_manifest)?,
        )?;
        let result_pack = ResultPackRef::from_manifest(&result_manifest, manifest_file)?;
        writer.sync()?;
        let mut descriptors = writer.descriptors;
        descriptors.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        verify_materialized_files(&staging, &descriptors)?;
        let files = descriptors
            .into_iter()
            .map(|file| ArtifactFile {
                role: artifact_role(&file.relative_path).into(),
                relative_path: file.relative_path,
                sha256: file.sha256,
                byte_count: file.byte_length,
                media_type: file.media_type,
            })
            .collect::<Vec<_>>();
        let byte_count = files.iter().try_fold(0_u64, |total, file| {
            total.checked_add(file.byte_count).ok_or_else(|| {
                ComputeCoordinatorError::Protocol("artifact byte count overflowed".into())
            })
        })?;
        let root_directory = File::open(&root)?;
        renameat_with(
            &root_directory,
            staging_leaf.as_str(),
            &root_directory,
            final_leaf.as_str(),
            RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            ComputeCoordinatorError::Filesystem(format!(
                "cannot atomically publish analysis artifact: {error}"
            ))
        })?;
        root_directory.sync_all()?;
        verify_materialized_files(&final_directory, &files_as_descriptors(&files))?;
        Ok(MaterializedComputeArtifact {
            artifact_id,
            result_pack,
            files,
            relative_directory: format!("artifacts/{final_leaf}"),
            created_at_ms,
            byte_count,
            final_directory: final_directory.clone(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&final_directory);
    }
    result
}

pub(crate) fn materialize_cluster_artifact(
    store: &ComputeStore,
    job: &JobSnapshot,
    computation: &ClusterComputation,
    created_at_ms: u64,
) -> ComputeResult<MaterializedComputeArtifact> {
    job.validate()?;
    if created_at_ms == 0 {
        return Err(ComputeCoordinatorError::Validation(
            "artifact creation time must be positive".into(),
        ));
    }
    let root = store.artifact_root()?;
    initialize_artifact_root(&root)?;
    let artifact_id = Uuid::new_v4();
    let staging_leaf = format!(".artifact-{artifact_id}.staging");
    let final_leaf = format!("artifact-{artifact_id}");
    let staging = root.join(&staging_leaf);
    let final_directory = root.join(&final_leaf);
    create_private_directory(&staging)?;
    create_private_directory(&staging.join("engine"))?;
    create_private_directory(&staging.join("result"))?;

    let result = (|| {
        let mut writer = ArtifactWriter::new(&staging);
        let fingerprints = computation
            .fingerprints
            .iter()
            .flat_map(|fingerprint| fingerprint.to_le_bytes())
            .collect::<Vec<_>>();
        let fingerprint_file = writer.write(
            "engine/fingerprints.bin",
            "application/octet-stream",
            &fingerprints,
        )?;
        let fingerprint_validity = computation
            .errors
            .iter()
            .map(|error| u8::from(error.is_none()))
            .collect::<Vec<_>>();
        let validity_file = writer.write(
            "engine/fingerprint-validity.bin",
            "application/octet-stream",
            &fingerprint_validity,
        )?;
        let error_bytes = fingerprint_errors_jsonl(computation)?;
        let errors_file = writer.write(
            "engine/fingerprint-errors.jsonl",
            "application/x-ndjson",
            &error_bytes,
        )?;
        let mut engine_files = vec![
            errors_file.clone(),
            validity_file.clone(),
            fingerprint_file.clone(),
        ];
        engine_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let record_count = job.frozen_source.frozen_source.record_count;
        let mut engine_arrays = vec![
            packed_array(
                CLUSTER_FINGERPRINT_ARRAY_NAME,
                CLUSTER_FINGERPRINT_SEMANTIC,
                &fingerprint_file,
                PackedDType::U64,
                vec![record_count, CLUSTER_FINGERPRINT_WORDS],
                PackedByteOrder::LittleEndian,
                8,
            )?,
            packed_array(
                "fingerprintValidity",
                "fingerprint_validity",
                &validity_file,
                PackedDType::Bool8,
                vec![record_count],
                PackedByteOrder::NotApplicable,
                1,
            )?,
        ];
        engine_arrays.sort_by(|left, right| left.name.cmp(&right.name));
        let engine_layout = PackedLayout {
            files: engine_files,
            arrays: engine_arrays,
        };
        let fingerprint_stage = &job.stages[1];
        let settings_sha256 = job
            .request
            .as_cluster()?
            .parameters
            .fingerprint
            .canonical_sha256()?;
        let engine_pack_id = Uuid::new_v4();
        let engine_pack_sha256 = pack_identity_sha256(&PackIdentity {
            kind: "cluster.engine-pack.v1",
            pack_id: engine_pack_id,
            job_id: job.job_id,
            snapshot_sha256: &job.frozen_source.snapshot_sha256,
            settings_sha256: &settings_sha256,
            layout: &engine_layout,
        })?;
        let engine_manifest = EnginePackManifest {
            schema_version: EnginePackVersion::ClusterV1,
            engine_pack_id,
            engine_pack_sha256,
            workflow_template: job.workflow_template,
            molecular_snapshot: job.frozen_source.clone(),
            engine_id: fingerprint_stage.engine.engine_id.clone(),
            engine_version: fingerprint_stage.engine.version.clone(),
            normalized_settings_sha256: settings_sha256,
            layout: engine_layout,
            created_at_ms,
        };
        engine_manifest.validate()?;
        let engine_manifest_bytes = serde_json::to_vec(&engine_manifest)?;
        let engine_manifest_file = writer.write(
            "engine/manifest.json",
            "application/json",
            &engine_manifest_bytes,
        )?;
        let engine_ref =
            EnginePackRef::from_manifest(&engine_manifest, engine_manifest_file.clone())?;

        let cluster_ids = computation
            .cluster_ids
            .iter()
            .map(|cluster_id| cluster_id.unwrap_or(u64::MAX))
            .flat_map(u64::to_le_bytes)
            .collect::<Vec<_>>();
        let cluster_ids_file = writer.write(
            "result/cluster-ids.bin",
            "application/octet-stream",
            &cluster_ids,
        )?;
        let representatives = computation
            .representatives
            .iter()
            .map(|value| u8::from(*value))
            .collect::<Vec<_>>();
        let representatives_file = writer.write(
            "result/representatives.bin",
            "application/octet-stream",
            &representatives,
        )?;
        let result_validity_file = writer.write(
            "result/record-validity.bin",
            "application/octet-stream",
            &fingerprint_validity,
        )?;
        let valid_ordinals = encode_u64(&computation.valid_ordinals);
        let valid_ordinals_file = writer.write(
            "result/valid-ordinals.bin",
            "application/octet-stream",
            &valid_ordinals,
        )?;
        let row_offsets = encode_u64(computation.graph.row_offsets());
        let row_offsets_file = writer.write(
            "result/csr-row-offsets.bin",
            "application/octet-stream",
            &row_offsets,
        )?;
        let columns = encode_u64(computation.graph.column_indices());
        let columns_file = writer.write(
            "result/csr-column-indices.bin",
            "application/octet-stream",
            &columns,
        )?;
        let mut result_files = vec![
            cluster_ids_file.clone(),
            columns_file.clone(),
            result_validity_file.clone(),
            representatives_file.clone(),
            row_offsets_file.clone(),
            valid_ordinals_file.clone(),
        ];
        result_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let valid_count = computation.valid_ordinals.len() as u64;
        let mut result_arrays = vec![
            packed_array(
                "clusterIds",
                "cluster_id",
                &cluster_ids_file,
                PackedDType::U64,
                vec![record_count],
                PackedByteOrder::LittleEndian,
                8,
            )?,
            packed_array(
                "csrColumnIndices",
                "valid_fingerprint_csr_column_index",
                &columns_file,
                PackedDType::U64,
                vec![computation.graph.column_indices().len() as u64],
                PackedByteOrder::LittleEndian,
                8,
            )?,
            packed_array(
                "csrRowOffsets",
                "valid_fingerprint_csr_row_offset",
                &row_offsets_file,
                PackedDType::U64,
                vec![valid_count + 1],
                PackedByteOrder::LittleEndian,
                8,
            )?,
            packed_array(
                "recordValidity",
                "cluster_record_validity",
                &result_validity_file,
                PackedDType::Bool8,
                vec![record_count],
                PackedByteOrder::NotApplicable,
                1,
            )?,
            packed_array(
                "representatives",
                "is_representative",
                &representatives_file,
                PackedDType::Bool8,
                vec![record_count],
                PackedByteOrder::NotApplicable,
                1,
            )?,
            packed_array(
                "validOrdinals",
                "source_ordinal_for_valid_fingerprint",
                &valid_ordinals_file,
                PackedDType::U64,
                vec![valid_count],
                PackedByteOrder::LittleEndian,
                8,
            )?,
        ];
        result_arrays.sort_by(|left, right| left.name.cmp(&right.name));
        let result_layout = PackedLayout {
            files: result_files,
            arrays: result_arrays,
        };
        let result_pack_id = Uuid::new_v4();
        let result_pack_sha256 = pack_identity_sha256(&PackIdentity {
            kind: "cluster.result-pack.v1",
            pack_id: result_pack_id,
            job_id: job.job_id,
            snapshot_sha256: &job.frozen_source.snapshot_sha256,
            settings_sha256: &job.normalized_request_sha256,
            layout: &result_layout,
        })?;
        let result_manifest = ResultPackManifest {
            schema_version: ResultPackVersion::ClusterV1,
            result_pack_id,
            result_pack_sha256,
            job_id: job.job_id,
            workflow_template: job.workflow_template,
            molecular_snapshot: job.frozen_source.clone(),
            engine_packs: vec![engine_ref],
            layout: result_layout,
            created_at_ms,
        };
        result_manifest.validate()?;
        let result_manifest_bytes = serde_json::to_vec(&result_manifest)?;
        let result_manifest_file = writer.write(
            "result/manifest.json",
            "application/json",
            &result_manifest_bytes,
        )?;
        let result_pack =
            ResultPackRef::from_manifest(&result_manifest, result_manifest_file.clone())?;

        writer.sync()?;
        let mut all_files = writer.descriptors;
        all_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        verify_materialized_files(&staging, &all_files)?;
        let files = all_files
            .into_iter()
            .map(|file| ArtifactFile {
                role: artifact_role(&file.relative_path).into(),
                relative_path: file.relative_path,
                sha256: file.sha256,
                byte_count: file.byte_length,
                media_type: file.media_type,
            })
            .collect::<Vec<_>>();
        let byte_count = files.iter().try_fold(0_u64, |total, file| {
            total.checked_add(file.byte_count).ok_or_else(|| {
                ComputeCoordinatorError::Protocol("artifact byte count overflowed".into())
            })
        })?;

        let root_directory = File::open(&root)?;
        renameat_with(
            &root_directory,
            staging_leaf.as_str(),
            &root_directory,
            final_leaf.as_str(),
            RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            ComputeCoordinatorError::Filesystem(format!(
                "cannot atomically publish cluster artifact: {error}"
            ))
        })?;
        root_directory.sync_all()?;
        verify_materialized_files(&final_directory, &files_as_descriptors(&files))?;
        Ok(MaterializedComputeArtifact {
            artifact_id,
            result_pack,
            files,
            relative_directory: format!("artifacts/{final_leaf}"),
            created_at_ms,
            byte_count,
            final_directory: final_directory.clone(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&final_directory);
    }
    result
}

pub(crate) fn materialize_conformer_artifact(
    store: &ComputeStore,
    job: &JobSnapshot,
    engine_arrays: &ConformerEnginePackArrays,
    distance: &ConformerDistanceComputation,
    stereo: &ConformerStereoComputation,
    created_at_ms: u64,
) -> ComputeResult<MaterializedComputeArtifact> {
    job.validate()?;
    if job.workflow_template != WorkflowTemplateId::ConformerV1 || created_at_ms == 0 {
        return Err(ComputeCoordinatorError::Validation(
            "conformer artifact requires a conformer job and positive creation time".into(),
        ));
    }
    if engine_arrays.record_count() as u64 != job.frozen_source.frozen_source.record_count
        || stereo.failure_flags.len() != distance.conformer_count()
    {
        return Err(ComputeCoordinatorError::Protocol(
            "conformer artifact inputs differ from the frozen job".into(),
        ));
    }
    let root = store.artifact_root()?;
    initialize_artifact_root(&root)?;
    let artifact_id = Uuid::new_v4();
    let staging_leaf = format!(".artifact-{artifact_id}.staging");
    let final_leaf = format!("artifact-{artifact_id}");
    let staging = root.join(&staging_leaf);
    let final_directory = root.join(&final_leaf);
    create_private_directory(&staging)?;
    create_private_directory(&staging.join("engine"))?;
    create_private_directory(&staging.join("result"))?;

    let result = (|| {
        let mut writer = ArtifactWriter::new(&staging);
        let engine_payload_bytes = engine_arrays
            .payload_bytes()
            .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?;
        let engine_binary = engine_arrays
            .encode_le(engine_payload_bytes)
            .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?;
        let engine_data_file = writer.write(
            "engine/conformer-engine.bin",
            "application/octet-stream",
            &engine_binary.bytes,
        )?;
        let engine_layout = conformer_engine_layout(
            engine_arrays,
            &engine_binary.arrays,
            engine_data_file.clone(),
        )?;
        let engine_pack_id = Uuid::new_v4();
        let engine_pack_sha256 = pack_identity_sha256(&PackIdentity {
            kind: "conformer.engine-pack.v1",
            pack_id: engine_pack_id,
            job_id: job.job_id,
            snapshot_sha256: &job.frozen_source.snapshot_sha256,
            settings_sha256: &job.normalized_request_sha256,
            layout: &engine_layout,
        })?;
        let extraction_stage = &job.stages[1];
        let engine_manifest = EnginePackManifest {
            schema_version: EnginePackVersion::ConformerV1,
            engine_pack_id,
            engine_pack_sha256,
            workflow_template: job.workflow_template,
            molecular_snapshot: job.frozen_source.clone(),
            engine_id: extraction_stage.engine.engine_id.clone(),
            engine_version: extraction_stage.engine.version.clone(),
            normalized_settings_sha256: job.normalized_request_sha256.clone(),
            layout: engine_layout,
            created_at_ms,
        };
        engine_manifest.validate()?;
        let engine_manifest_file = writer.write(
            "engine/manifest.json",
            "application/json",
            &serde_json::to_vec(&engine_manifest)?,
        )?;
        let engine_ref =
            EnginePackRef::from_manifest(&engine_manifest, engine_manifest_file.clone())?;

        let result_layout = write_conformer_results(&mut writer, distance, stereo)?;
        let parameters = &job.request.as_conformer()?.parameters;
        let mmff_variant = parameters.mmff_variant.wire_id();
        let initialization = match parameters.initialization {
            burrete_compute_protocol::ConformerInitialization::Generated => "generated",
            burrete_compute_protocol::ConformerInitialization::InputGeometry => "inputGeometry",
        };
        let xyz = encode_conformer_xyz(
            engine_arrays,
            distance,
            stereo,
            initialization,
            mmff_variant,
        )?;
        writer.write("result/conformers.xyz", "chemical/x-xyz", &xyz)?;
        let result_pack_id = Uuid::new_v4();
        let result_pack_sha256 = pack_identity_sha256(&PackIdentity {
            kind: "conformer.result-pack.v2",
            pack_id: result_pack_id,
            job_id: job.job_id,
            snapshot_sha256: &job.frozen_source.snapshot_sha256,
            settings_sha256: &job.normalized_request_sha256,
            layout: &result_layout,
        })?;
        let result_manifest = ResultPackManifest {
            schema_version: ResultPackVersion::ConformerV2,
            result_pack_id,
            result_pack_sha256,
            job_id: job.job_id,
            workflow_template: job.workflow_template,
            molecular_snapshot: job.frozen_source.clone(),
            engine_packs: vec![engine_ref],
            layout: result_layout,
            created_at_ms,
        };
        result_manifest.validate()?;
        let result_manifest_file = writer.write(
            "result/manifest.json",
            "application/json",
            &serde_json::to_vec(&result_manifest)?,
        )?;
        let result_pack =
            ResultPackRef::from_manifest(&result_manifest, result_manifest_file.clone())?;

        writer.sync()?;
        let mut all_files = writer.descriptors;
        all_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        verify_materialized_files(&staging, &all_files)?;
        let files = all_files
            .into_iter()
            .map(|file| ArtifactFile {
                role: artifact_role(&file.relative_path).into(),
                relative_path: file.relative_path,
                sha256: file.sha256,
                byte_count: file.byte_length,
                media_type: file.media_type,
            })
            .collect::<Vec<_>>();
        let byte_count = files.iter().try_fold(0_u64, |total, file| {
            total.checked_add(file.byte_count).ok_or_else(|| {
                ComputeCoordinatorError::Protocol("artifact byte count overflowed".into())
            })
        })?;
        let root_directory = File::open(&root)?;
        renameat_with(
            &root_directory,
            staging_leaf.as_str(),
            &root_directory,
            final_leaf.as_str(),
            RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            ComputeCoordinatorError::Filesystem(format!(
                "cannot atomically publish conformer artifact: {error}"
            ))
        })?;
        root_directory.sync_all()?;
        verify_materialized_files(&final_directory, &files_as_descriptors(&files))?;
        Ok(MaterializedComputeArtifact {
            artifact_id,
            result_pack,
            files,
            relative_directory: format!("artifacts/{final_leaf}"),
            created_at_ms,
            byte_count,
            final_directory: final_directory.clone(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&final_directory);
    }
    result
}

/// Removes filesystem publication orphans left before the SQLite commit.
///
/// A published directory is retained only when the durable store names the
/// exact canonical relative directory. Unknown or unsafe entries fail closed;
/// recovery never follows symlinks or removes non-private directories.
pub(crate) fn reconcile_artifact_root(store: &ComputeStore) -> ComputeResult<()> {
    let root = store.artifact_root()?;
    initialize_artifact_root(&root)?;
    let published = store.published_artifact_inventory()?;
    for directory in published.keys() {
        let leaf = directory.strip_prefix("artifacts/").ok_or_else(|| {
            ComputeCoordinatorError::Filesystem(format!(
                "published compute artifact has an invalid directory: {directory}"
            ))
        })?;
        if !matches!(canonical_artifact_leaf(leaf), Some(ArtifactLeaf::Final(_))) {
            return Err(ComputeCoordinatorError::Filesystem(format!(
                "published compute artifact has a noncanonical directory: {directory}"
            )));
        }
    }
    let mut entries = fs::read_dir(&root)?;
    let mut observed = 0_usize;
    let mut changed = false;
    let mut retained = BTreeSet::new();
    while let Some(entry) = entries.next().transpose()? {
        observed = observed.checked_add(1).ok_or_else(|| {
            ComputeCoordinatorError::Unavailable(
                "compute artifact inventory counter overflowed".into(),
            )
        })?;
        if observed > MAX_ARTIFACT_ROOT_ENTRIES {
            return Err(ComputeCoordinatorError::Unavailable(
                "compute artifact inventory exceeds the recovery bound".into(),
            ));
        }
        let leaf = entry.file_name().into_string().map_err(|_| {
            ComputeCoordinatorError::Filesystem(
                "compute artifact directory contains a non-UTF-8 entry".into(),
            )
        })?;
        let canonical = canonical_artifact_leaf(&leaf).ok_or_else(|| {
            ComputeCoordinatorError::Filesystem(format!(
                "compute artifact directory contains an unknown entry: {leaf}"
            ))
        })?;
        let path = root.join(&leaf);
        validate_private_directory(&path)?;
        let retain = matches!(canonical, ArtifactLeaf::Final(id)
            if published.contains_key(&format!("artifacts/artifact-{id}")));
        if retain {
            let directory = format!("artifacts/{leaf}");
            let manifest = published.get(&directory).ok_or_else(|| {
                ComputeCoordinatorError::Filesystem(
                    "published artifact disappeared from the recovery inventory".into(),
                )
            })?;
            verify_materialized_files(&path, &files_as_descriptors(&manifest.files))?;
            retained.insert(directory);
        } else {
            fs::remove_dir_all(&path)?;
            changed = true;
        }
    }
    let expected = published.keys().cloned().collect::<BTreeSet<_>>();
    if retained != expected {
        return Err(ComputeCoordinatorError::Filesystem(
            "a published compute artifact directory is missing during recovery".into(),
        ));
    }
    if changed {
        File::open(&root)?.sync_all()?;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArtifactLeaf {
    Staging(Uuid),
    Final(Uuid),
}

fn canonical_artifact_leaf(leaf: &str) -> Option<ArtifactLeaf> {
    if let Some(id) = leaf
        .strip_prefix(".artifact-")
        .and_then(|value| value.strip_suffix(".staging"))
        .and_then(|value| Uuid::parse_str(value).ok())
    {
        return (leaf == format!(".artifact-{id}.staging")).then_some(ArtifactLeaf::Staging(id));
    }
    let id = leaf
        .strip_prefix("artifact-")
        .and_then(|value| Uuid::parse_str(value).ok())?;
    (leaf == format!("artifact-{id}")).then_some(ArtifactLeaf::Final(id))
}

pub(crate) fn artifact_manifest_sha256(manifest: &ArtifactManifest) -> ComputeResult<String> {
    manifest.validate()?;
    Ok(sha256_hex(&serde_json::to_vec(manifest)?))
}

struct ArtifactWriter<'a> {
    root: &'a Path,
    descriptors: Vec<PackedFileDescriptor>,
}

impl<'a> ArtifactWriter<'a> {
    fn new(root: &'a Path) -> Self {
        Self {
            root,
            descriptors: Vec::new(),
        }
    }

    fn write(
        &mut self,
        relative_path: &str,
        media_type: &str,
        bytes: &[u8],
    ) -> ComputeResult<PackedFileDescriptor> {
        let path = self.root.join(relative_path);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(ARTIFACT_FILE_MODE)
            .open(&path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        let descriptor = PackedFileDescriptor {
            relative_path: relative_path.into(),
            sha256: sha256_hex(bytes),
            byte_length: bytes.len() as u64,
            media_type: media_type.into(),
        };
        descriptor.validate()?;
        self.descriptors.push(descriptor.clone());
        Ok(descriptor)
    }

    fn sync(&self) -> ComputeResult<()> {
        File::open(self.root.join("engine"))?.sync_all()?;
        File::open(self.root.join("result"))?.sync_all()?;
        File::open(self.root)?.sync_all()?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintErrorLine<'a> {
    ordinal: u64,
    source_record_id: u64,
    molecule_content_sha256: &'a str,
    error: &'a str,
}

fn fingerprint_errors_jsonl(computation: &ClusterComputation) -> ComputeResult<Vec<u8>> {
    let mut bytes = Vec::new();
    for (ordinal, (identity, error)) in computation
        .identities
        .iter()
        .zip(&computation.errors)
        .enumerate()
    {
        let Some(error) = error else { continue };
        serde_json::to_writer(
            &mut bytes,
            &FingerprintErrorLine {
                ordinal: ordinal as u64,
                source_record_id: identity.source_record_id,
                molecule_content_sha256: &identity.molecule_content_sha256,
                error,
            },
        )?;
        bytes.push(b'\n');
    }
    Ok(bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PackIdentity<'a> {
    kind: &'static str,
    pack_id: Uuid,
    job_id: Uuid,
    snapshot_sha256: &'a str,
    settings_sha256: &'a str,
    layout: &'a PackedLayout,
}

fn pack_identity_sha256(identity: &PackIdentity<'_>) -> ComputeResult<String> {
    Ok(sha256_hex(&serde_json::to_vec(identity)?))
}

fn packed_array(
    name: &str,
    semantic: &str,
    file: &PackedFileDescriptor,
    dtype: PackedDType,
    shape: Vec<u64>,
    byte_order: PackedByteOrder,
    alignment: u32,
) -> ComputeResult<PackedArrayDescriptor> {
    packed_array_with_unit(
        name, semantic, None, file, dtype, shape, byte_order, alignment,
    )
}

#[allow(clippy::too_many_arguments)]
fn push_analysis_array(
    writer: &mut ArtifactWriter<'_>,
    arrays: &mut Vec<PackedArrayDescriptor>,
    name: &str,
    semantic: &str,
    unit: Option<&str>,
    dtype: PackedDType,
    shape: Vec<u64>,
    bytes: &[u8],
) -> ComputeResult<()> {
    let file = writer.write(
        &format!("result/{name}.bin"),
        "application/octet-stream",
        bytes,
    )?;
    arrays.push(packed_array_with_unit(
        name,
        semantic,
        unit,
        &file,
        dtype,
        shape,
        if dtype.byte_width() == 1 {
            PackedByteOrder::NotApplicable
        } else {
            PackedByteOrder::LittleEndian
        },
        dtype.byte_width() as u32,
    )?);
    Ok(())
}

fn require_equal_analysis_lengths(records: u64, lengths: &[usize]) -> ComputeResult<()> {
    if lengths.iter().any(|length| *length as u64 != records) {
        return Err(ComputeCoordinatorError::Validation(
            "analysis result arrays have different record counts".into(),
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn packed_array_with_unit(
    name: &str,
    semantic: &str,
    unit: Option<&str>,
    file: &PackedFileDescriptor,
    dtype: PackedDType,
    shape: Vec<u64>,
    byte_order: PackedByteOrder,
    alignment: u32,
) -> ComputeResult<PackedArrayDescriptor> {
    let array = PackedArrayDescriptor {
        name: name.into(),
        semantic: semantic.into(),
        unit: unit.map(str::to_string),
        file_relative_path: file.relative_path.clone(),
        dtype,
        shape,
        byte_order,
        alignment,
        byte_offset: 0,
        byte_length: file.byte_length,
    };
    array.validate()?;
    Ok(array)
}

fn conformer_engine_layout(
    arrays: &ConformerEnginePackArrays,
    spans: &[ConformerPackedArraySpan],
    file: PackedFileDescriptor,
) -> ComputeResult<PackedLayout> {
    let records = arrays.record_count() as u64;
    let starts = records + 1;
    let atoms = arrays.atomic_numbers.len() as u64;
    let chiral = arrays.chiral_atom_quads.len() as u64;
    let distance = arrays.distance_atom_pairs.len() as u64;
    let etk_distance = arrays.etk_distance_atom_pairs.len() as u64;
    let improper = arrays.improper_atom_quads.len() as u64;
    let stereo = arrays.stereo_atom_quints.len() as u64;
    let torsion = arrays.torsion_atom_quads.len() as u64;
    let mut descriptors = Vec::with_capacity(spans.len());
    for span in spans {
        let (semantic, unit, dtype, shape) = match span.name {
            "atomicNumbers" => ("atomic_number", None, PackedDType::U16, vec![atoms]),
            "chiralAtomQuads" => ("chiral_atom_quad", None, PackedDType::U32, vec![chiral, 4]),
            "chiralTermStarts" => ("chiral_term_offsets", None, PackedDType::U64, vec![starts]),
            "chiralVolumeBounds" => (
                "chiral_volume_bounds",
                Some("angstrom^3"),
                PackedDType::F32,
                vec![chiral, 2],
            ),
            "distanceAtomPairs" => (
                "distance_atom_pair",
                None,
                PackedDType::U32,
                vec![distance, 2],
            ),
            "distanceBoundsSquared" => (
                "distance_bounds_squared",
                Some("angstrom^2"),
                PackedDType::F32,
                vec![distance, 2],
            ),
            "distanceTermStarts" => (
                "distance_pair_offsets",
                None,
                PackedDType::U64,
                vec![starts],
            ),
            "distanceWeights" => (
                "distance_constraint_weight",
                None,
                PackedDType::F32,
                vec![distance],
            ),
            "etkDistanceAtomPairs" => (
                "etk_distance_atom_pair",
                None,
                PackedDType::U32,
                vec![etk_distance, 2],
            ),
            "etkDistanceBounds" => (
                "etk_distance_bounds",
                Some("angstrom"),
                PackedDType::F32,
                vec![etk_distance, 2],
            ),
            "etkDistanceKinds" => ("bond_separation", None, PackedDType::U8, vec![etk_distance]),
            "etkDistanceTermStarts" => (
                "etk_distance_term_offsets",
                None,
                PackedDType::U64,
                vec![starts],
            ),
            "etkDistanceWeights" => (
                "etk_distance_constraint_weight",
                None,
                PackedDType::F32,
                vec![etk_distance],
            ),
            "formalCharges" => (
                "formal_charge",
                Some("elementary_charge"),
                PackedDType::I8,
                vec![atoms],
            ),
            "improperAtomQuads" => (
                "improper_atom_quad",
                None,
                PackedDType::U32,
                vec![improper, 4],
            ),
            "improperTermStarts" => (
                "improper_term_offsets",
                None,
                PackedDType::U64,
                vec![starts],
            ),
            "improperWeights" => (
                "improper_constraint_weight",
                None,
                PackedDType::F32,
                vec![improper],
            ),
            "moleculeAtomStarts" => (
                "molecule_atom_offsets",
                None,
                PackedDType::U64,
                vec![starts],
            ),
            "recordValidity" => (
                "conformer_input_valid",
                None,
                PackedDType::Bool8,
                vec![records],
            ),
            "stereoAtomQuints" => ("stereo_atom_quint", None, PackedDType::U32, vec![stereo, 5]),
            "stereoCenterStarts" => (
                "stereo_center_offsets",
                None,
                PackedDType::U64,
                vec![starts],
            ),
            "stereoFlags" => ("stereo_check_flags", None, PackedDType::U8, vec![stereo]),
            "torsionAtomQuads" => (
                "torsion_atom_quad",
                None,
                PackedDType::U32,
                vec![torsion, 4],
            ),
            "torsionCoefficients" => (
                "torsion_fourier_coefficients",
                None,
                PackedDType::F32,
                vec![torsion, 6],
            ),
            "torsionSigns" => (
                "torsion_fourier_signs",
                None,
                PackedDType::I8,
                vec![torsion, 6],
            ),
            "torsionTermStarts" => ("torsion_term_offsets", None, PackedDType::U64, vec![starts]),
            other => {
                return Err(ComputeCoordinatorError::Protocol(format!(
                    "unknown conformer EnginePack array: {other}"
                )))
            }
        };
        let byte_order = if dtype.byte_width() == 1 {
            PackedByteOrder::NotApplicable
        } else {
            PackedByteOrder::LittleEndian
        };
        let descriptor = PackedArrayDescriptor {
            name: span.name.into(),
            semantic: semantic.into(),
            unit: unit.map(str::to_string),
            file_relative_path: file.relative_path.clone(),
            dtype,
            shape,
            byte_order,
            alignment: dtype.byte_width() as u32,
            byte_offset: span.byte_offset,
            byte_length: span.byte_length,
        };
        descriptor.validate()?;
        descriptors.push(descriptor);
    }
    let layout = PackedLayout {
        files: vec![file],
        arrays: descriptors,
    };
    layout.validate()?;
    Ok(layout)
}

fn write_conformer_results(
    writer: &mut ArtifactWriter<'_>,
    distance: &ConformerDistanceComputation,
    stereo: &ConformerStereoComputation,
) -> ComputeResult<PackedLayout> {
    let conformers = distance.conformer_count() as u64;
    let atoms = distance.positions.len() as u64;
    let starts = writer.write(
        "result/conformer-atom-starts.bin",
        "application/octet-stream",
        &encode_u64(&distance.conformer_atom_starts),
    )?;
    let molecules = writer.write(
        "result/conformer-molecule-indices.bin",
        "application/octet-stream",
        &encode_u32(&distance.conformer_molecule_indices),
    )?;
    let ordinals = writer.write(
        "result/conformer-ordinals.bin",
        "application/octet-stream",
        &encode_u32(&distance.conformer_ordinals),
    )?;
    let attempts = writer.write(
        "result/embedding-attempt-counts.bin",
        "application/octet-stream",
        &encode_u16(&distance.embedding_attempt_counts),
    )?;
    let embedding_energies = writer.write(
        "result/embedding-energies.bin",
        "application/octet-stream",
        &encode_f32(&distance.embedding_energies),
    )?;
    let embedding_statuses = writer.write(
        "result/embedding-statuses.bin",
        "application/octet-stream",
        &distance.embedding_statuses,
    )?;
    let etk_energies = writer.write(
        "result/etk-energies.bin",
        "application/octet-stream",
        &encode_f32(&distance.etk_energies),
    )?;
    let etk_statuses = writer.write(
        "result/etk-statuses.bin",
        "application/octet-stream",
        &distance.etk_statuses,
    )?;
    let mmff_energies = writer.write(
        "result/mmff-energies.bin",
        "application/octet-stream",
        &encode_f32(&distance.mmff_energies),
    )?;
    let mmff_optimizer_kinds = writer.write(
        "result/mmff-optimizer-kinds.bin",
        "application/octet-stream",
        &distance.mmff_optimizer_kinds,
    )?;
    let mmff_statuses = writer.write(
        "result/mmff-statuses.bin",
        "application/octet-stream",
        &distance.mmff_statuses,
    )?;
    let positions = writer.write(
        "result/positions.bin",
        "application/octet-stream",
        &encode_f32(
            &distance
                .positions
                .iter()
                .flatten()
                .copied()
                .collect::<Vec<_>>(),
        ),
    )?;
    let seeds = writer.write(
        "result/seed-words.bin",
        "application/octet-stream",
        &encode_u32(
            &distance
                .seed_words
                .iter()
                .flatten()
                .copied()
                .collect::<Vec<_>>(),
        ),
    )?;
    let stereo_flags = writer.write(
        "result/stereo-failure-flags.bin",
        "application/octet-stream",
        &encode_u32(&stereo.failure_flags),
    )?;
    let files = vec![
        starts.clone(),
        molecules.clone(),
        ordinals.clone(),
        attempts.clone(),
        embedding_energies.clone(),
        embedding_statuses.clone(),
        etk_energies.clone(),
        etk_statuses.clone(),
        mmff_energies.clone(),
        mmff_optimizer_kinds.clone(),
        mmff_statuses.clone(),
        positions.clone(),
        seeds.clone(),
        stereo_flags.clone(),
    ];
    let arrays = vec![
        packed_array(
            "conformerAtomStarts",
            "conformer_atom_offsets",
            &starts,
            PackedDType::U64,
            vec![conformers + 1],
            PackedByteOrder::LittleEndian,
            8,
        )?,
        packed_array(
            "conformerMoleculeIndices",
            "conformer_molecule_index",
            &molecules,
            PackedDType::U32,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "conformerOrdinals",
            "conformer_ordinal",
            &ordinals,
            PackedDType::U32,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "embeddingAttemptCounts",
            "embedding_attempt_count",
            &attempts,
            PackedDType::U16,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            2,
        )?,
        packed_array(
            "embeddingEnergies",
            "distance_geometry_objective",
            &embedding_energies,
            PackedDType::F32,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "embeddingStatuses",
            "conformer_embedding_status",
            &embedding_statuses,
            PackedDType::U8,
            vec![conformers],
            PackedByteOrder::NotApplicable,
            1,
        )?,
        packed_array(
            "etkEnergies",
            "etk_geometry_objective",
            &etk_energies,
            PackedDType::F32,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "etkStatuses",
            "etk_optimization_status",
            &etk_statuses,
            PackedDType::U8,
            vec![conformers],
            PackedByteOrder::NotApplicable,
            1,
        )?,
        packed_array_with_unit(
            "mmffEnergies",
            "mmff_energy",
            Some("kcal/mol"),
            &mmff_energies,
            PackedDType::F32,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "mmffOptimizerKinds",
            "mmff_optimizer_kind",
            &mmff_optimizer_kinds,
            PackedDType::U8,
            vec![conformers],
            PackedByteOrder::NotApplicable,
            1,
        )?,
        packed_array(
            "mmffStatuses",
            "mmff_optimization_status",
            &mmff_statuses,
            PackedDType::U8,
            vec![conformers],
            PackedByteOrder::NotApplicable,
            1,
        )?,
        packed_array_with_unit(
            "positions",
            "cartesian_position",
            Some("angstrom"),
            &positions,
            PackedDType::F32,
            vec![atoms, 3],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "seedWords",
            "conformer_seed_words",
            &seeds,
            PackedDType::U32,
            vec![conformers, 4],
            PackedByteOrder::LittleEndian,
            4,
        )?,
        packed_array(
            "stereoFailureFlags",
            "stereo_failure_flags",
            &stereo_flags,
            PackedDType::U32,
            vec![conformers],
            PackedByteOrder::LittleEndian,
            4,
        )?,
    ];
    let layout = PackedLayout { files, arrays };
    layout.validate()?;
    Ok(layout)
}

fn encode_conformer_xyz(
    engine: &ConformerEnginePackArrays,
    distance: &ConformerDistanceComputation,
    stereo: &ConformerStereoComputation,
    initialization: &str,
    mmff_variant: &str,
) -> ComputeResult<Vec<u8>> {
    if distance.conformer_atom_starts.len() != distance.conformer_count() + 1
        || distance.conformer_atom_starts.last().copied() != Some(distance.positions.len() as u64)
        || stereo.failure_flags.len() != distance.conformer_count()
    {
        return Err(ComputeCoordinatorError::Protocol(
            "conformer XYZ inputs have inconsistent offsets".into(),
        ));
    }
    let capacity = distance
        .positions
        .len()
        .checked_mul(64)
        .and_then(|bytes| bytes.checked_add(distance.conformer_count().saturating_mul(128)))
        .ok_or_else(|| {
            ComputeCoordinatorError::Unavailable("conformer XYZ size overflowed".into())
        })?;
    let mut xyz = String::new();
    xyz.try_reserve(capacity).map_err(|_| {
        ComputeCoordinatorError::Unavailable("cannot allocate conformer XYZ".into())
    })?;
    let mut ranked = (0..distance.conformer_count()).collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        distance.conformer_molecule_indices[*left]
            .cmp(&distance.conformer_molecule_indices[*right])
            .then_with(|| {
                mmff_rank_group(distance.mmff_statuses[*left])
                    .cmp(&mmff_rank_group(distance.mmff_statuses[*right]))
            })
            .then_with(|| distance.mmff_energies[*left].total_cmp(&distance.mmff_energies[*right]))
            .then_with(|| {
                distance.conformer_ordinals[*left].cmp(&distance.conformer_ordinals[*right])
            })
    });
    let mut previous_molecule = None;
    let mut energy_rank = 0_u32;
    for conformer in ranked {
        let molecule = distance.conformer_molecule_indices[conformer] as usize;
        if previous_molecule == Some(molecule) {
            energy_rank += 1;
        } else {
            previous_molecule = Some(molecule);
            energy_rank = 1;
        }
        let atom_start =
            usize::try_from(distance.conformer_atom_starts[conformer]).map_err(|_| {
                ComputeCoordinatorError::Protocol("conformer atom offset exceeds host range".into())
            })?;
        let atom_end =
            usize::try_from(distance.conformer_atom_starts[conformer + 1]).map_err(|_| {
                ComputeCoordinatorError::Protocol("conformer atom offset exceeds host range".into())
            })?;
        let molecule_start = engine
            .molecule_atom_starts
            .get(molecule)
            .copied()
            .ok_or_else(|| {
                ComputeCoordinatorError::Protocol("conformer molecule index is out of range".into())
            })? as usize;
        let molecule_end = engine
            .molecule_atom_starts
            .get(molecule + 1)
            .copied()
            .ok_or_else(|| {
                ComputeCoordinatorError::Protocol("conformer molecule span is incomplete".into())
            })? as usize;
        if atom_end < atom_start
            || molecule_end < molecule_start
            || atom_end - atom_start != molecule_end - molecule_start
            || atom_end > distance.positions.len()
            || molecule_end > engine.atomic_numbers.len()
        {
            return Err(ComputeCoordinatorError::Protocol(
                "conformer XYZ atom spans are inconsistent".into(),
            ));
        }
        writeln!(xyz, "{}", atom_end - atom_start).map_err(formatting_error)?;
        let mmff_status = distance.mmff_statuses[conformer];
        let mmff_energy = if mmff_status == 4 {
            "unavailable".into()
        } else {
            format!("{:.8}", distance.mmff_energies[conformer])
        };
        writeln!(
            xyz,
            "Burrete conformer molecule={} energyRank={} ordinal={} initialization={} etkEnergy={:.8} mmffVariant={} mmffEnergy={} mmffStatus={} stereo={}",
            molecule,
            energy_rank,
            distance.conformer_ordinals[conformer],
            initialization,
            distance.etk_energies[conformer],
            mmff_variant,
            mmff_energy,
            mmff_status_label(mmff_status),
            if stereo.failure_flags[conformer] == 0 {
                "passed"
            } else {
                "failed"
            }
        )
        .map_err(formatting_error)?;
        for (atomic_number, position) in engine.atomic_numbers[molecule_start..molecule_end]
            .iter()
            .zip(&distance.positions[atom_start..atom_end])
        {
            let symbol = element_symbol(*atomic_number).ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "conformer contains an invalid atomic number".into(),
                )
            })?;
            writeln!(
                xyz,
                "{symbol:<2} {:>15.8} {:>15.8} {:>15.8}",
                position[0], position[1], position[2]
            )
            .map_err(formatting_error)?;
        }
    }
    Ok(xyz.into_bytes())
}

fn mmff_rank_group(status: u8) -> u8 {
    match status {
        0 | 1 => 0,
        2 | 3 => 1,
        _ => 2,
    }
}

fn mmff_status_label(status: u8) -> &'static str {
    match status {
        0 => "converged-gradient",
        1 => "converged-step",
        2 => "line-search-exhausted",
        3 => "max-iterations",
        _ => "unavailable",
    }
}

fn formatting_error(_: std::fmt::Error) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable("cannot format conformer XYZ".into())
}

fn element_symbol(atomic_number: u16) -> Option<&'static str> {
    const SYMBOLS: [&str; 119] = [
        "", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S",
        "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga",
        "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd",
        "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm",
        "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os",
        "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa",
        "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg",
        "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
    ];
    SYMBOLS.get(atomic_number as usize).copied()
}

fn encode_u64(values: &[u64]) -> Vec<u8> {
    values.iter().copied().flat_map(u64::to_le_bytes).collect()
}

fn encode_u32(values: &[u32]) -> Vec<u8> {
    values.iter().copied().flat_map(u32::to_le_bytes).collect()
}

fn encode_u16(values: &[u16]) -> Vec<u8> {
    values.iter().copied().flat_map(u16::to_le_bytes).collect()
}

fn encode_f32(values: &[f32]) -> Vec<u8> {
    values.iter().copied().flat_map(f32::to_le_bytes).collect()
}

fn encode_f64(values: &[f64]) -> Vec<u8> {
    values.iter().copied().flat_map(f64::to_le_bytes).collect()
}

fn initialize_artifact_root(root: &Path) -> ComputeResult<()> {
    match fs::DirBuilder::new()
        .mode(ARTIFACT_DIRECTORY_MODE)
        .create(root)
    {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    validate_private_directory(root)
}

fn create_private_directory(path: &Path) -> ComputeResult<()> {
    fs::DirBuilder::new()
        .mode(ARTIFACT_DIRECTORY_MODE)
        .create(path)?;
    validate_private_directory(path)
}

fn validate_private_directory(path: &Path) -> ComputeResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != geteuid().as_raw()
        || metadata.permissions().mode() & 0o777 != ARTIFACT_DIRECTORY_MODE
    {
        return Err(ComputeCoordinatorError::Filesystem(format!(
            "compute artifact directory is not a private owned directory: {}",
            path.display()
        )));
    }
    Ok(())
}

fn verify_materialized_files(
    root: &Path,
    descriptors: &[PackedFileDescriptor],
) -> ComputeResult<()> {
    validate_private_directory(root)?;
    for descriptor in descriptors {
        let path = root.join(&descriptor.relative_path);
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.uid() != geteuid().as_raw()
            || metadata.permissions().mode() & 0o777 != ARTIFACT_FILE_MODE
            || metadata.len() != descriptor.byte_length
        {
            return Err(ComputeCoordinatorError::Filesystem(format!(
                "compute artifact file identity changed: {}",
                descriptor.relative_path
            )));
        }
        let mut file = File::open(&path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        if hex_bytes(hasher.finalize().as_slice()) != descriptor.sha256 {
            return Err(ComputeCoordinatorError::Filesystem(format!(
                "compute artifact file hash changed: {}",
                descriptor.relative_path
            )));
        }
    }
    Ok(())
}

fn files_as_descriptors(files: &[ArtifactFile]) -> Vec<PackedFileDescriptor> {
    files
        .iter()
        .map(|file| PackedFileDescriptor {
            relative_path: file.relative_path.clone(),
            sha256: file.sha256.clone(),
            byte_length: file.byte_count,
            media_type: file.media_type.clone(),
        })
        .collect()
}

fn artifact_role(path: &str) -> &'static str {
    match path {
        "engine/manifest.json" => "enginePackManifest",
        "engine/fingerprints.bin" => "fingerprints",
        "engine/fingerprint-validity.bin" => "fingerprintValidity",
        "engine/fingerprint-errors.jsonl" => "fingerprintErrors",
        "engine/conformer-engine.bin" => "conformerEngineData",
        "result/manifest.json" => "resultPackManifest",
        "result/cluster-ids.bin" => "clusterIds",
        "result/representatives.bin" => "representatives",
        "result/record-validity.bin" => "recordValidity",
        "result/valid-ordinals.bin" => "validOrdinals",
        "result/csr-row-offsets.bin" => "csrRowOffsets",
        "result/csr-column-indices.bin" => "csrColumnIndices",
        path if path.starts_with("result/") => "conformerResultData",
        _ => "computeData",
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_bytes(Sha256::digest(bytes).as_slice())
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod recovery_tests {
    use super::*;

    #[test]
    fn startup_removes_only_canonical_uncommitted_artifact_directories() {
        let temp_root = std::fs::canonicalize(std::env::temp_dir()).expect("canonical temp root");
        let compute_root = temp_root.join(format!("burrete-artifact-recovery-{}", Uuid::new_v4()));
        let store =
            ComputeStore::initialize(compute_root.clone()).expect("initialize compute store");
        let artifacts = store.artifact_root().expect("artifact root");
        initialize_artifact_root(&artifacts).expect("initialize artifact root");
        let staging = artifacts.join(format!(".artifact-{}.staging", Uuid::new_v4()));
        let renamed = artifacts.join(format!("artifact-{}", Uuid::new_v4()));
        create_private_directory(&staging).expect("create staging orphan");
        create_private_directory(&renamed).expect("create renamed orphan");

        reconcile_artifact_root(&store).expect("reconcile artifact root");

        assert!(!staging.exists());
        assert!(!renamed.exists());
        drop(store);
        let _ = fs::remove_dir_all(compute_root);
    }

    #[test]
    fn startup_fails_closed_on_unknown_artifact_entries() {
        let temp_root = std::fs::canonicalize(std::env::temp_dir()).expect("canonical temp root");
        let compute_root = temp_root.join(format!("burrete-artifact-recovery-{}", Uuid::new_v4()));
        let store =
            ComputeStore::initialize(compute_root.clone()).expect("initialize compute store");
        let artifacts = store.artifact_root().expect("artifact root");
        initialize_artifact_root(&artifacts).expect("initialize artifact root");
        create_private_directory(&artifacts.join("unexpected"))
            .expect("create unknown private directory");

        let error = reconcile_artifact_root(&store).expect_err("unknown entry must fail closed");
        assert!(error.to_string().contains("unknown entry"));
        drop(store);
        let _ = fs::remove_dir_all(compute_root);
    }
}
