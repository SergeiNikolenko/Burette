use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use burrete_compute_protocol::{
    ArtifactFile, ArtifactManifest, ArtifactManifestSchemaVersion, EnginePackManifest,
    EnginePackRef, EnginePackVersion, JobSnapshot, PackedArrayDescriptor, PackedByteOrder,
    PackedDType, PackedFileDescriptor, PackedLayout, ResultPackManifest, ResultPackRef,
    ResultPackVersion, StageProvenance, CLUSTER_FINGERPRINT_ARRAY_NAME,
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
    error::{ComputeCoordinatorError, ComputeResult},
    store::ComputeStore,
};

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

#[derive(Debug)]
pub(crate) struct MaterializedClusterArtifact {
    pub(crate) artifact_id: Uuid,
    pub(crate) result_pack: ResultPackRef,
    pub(crate) files: Vec<ArtifactFile>,
    pub(crate) relative_directory: String,
    pub(crate) created_at_ms: u64,
    pub(crate) byte_count: u64,
    final_directory: PathBuf,
}

impl MaterializedClusterArtifact {
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

pub(crate) fn materialize_cluster_artifact(
    store: &ComputeStore,
    job: &JobSnapshot,
    computation: &ClusterComputation,
    created_at_ms: u64,
) -> ComputeResult<MaterializedClusterArtifact> {
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
        Ok(MaterializedClusterArtifact {
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
    let array = PackedArrayDescriptor {
        name: name.into(),
        semantic: semantic.into(),
        unit: None,
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

fn encode_u64(values: &[u64]) -> Vec<u8> {
    values.iter().copied().flat_map(u64::to_le_bytes).collect()
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
        "result/manifest.json" => "resultPackManifest",
        "result/cluster-ids.bin" => "clusterIds",
        "result/representatives.bin" => "representatives",
        "result/record-validity.bin" => "recordValidity",
        "result/valid-ordinals.bin" => "validOrdinals",
        "result/csr-row-offsets.bin" => "csrRowOffsets",
        "result/csr-column-indices.bin" => "csrColumnIndices",
        _ => "clusterData",
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
