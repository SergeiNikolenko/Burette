use std::{
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    mem::size_of,
};

use burrete_compute_core::{Fingerprint2048, FINGERPRINT_BYTES};
use burrete_compute_protocol::{
    ArtifactManifest, EnginePackManifest, JobSnapshot, MolecularSnapshotRecordV1,
    OrderedRecordMoleculeIdentityHasher, PackedArrayDescriptor, PackedByteOrder, PackedDType,
    PackedFileDescriptor, ResultPackManifest, ResultPackRef, CLUSTER_FINGERPRINT_ARRAY_NAME,
    CLUSTER_FINGERPRINT_SEMANTIC, CLUSTER_FINGERPRINT_WORDS, MOLECULAR_RECORDS_FILE_PATH,
};
use serde::de::DeserializeOwned;

use super::{
    artifact_publisher::artifact_manifest_sha256,
    artifact_reader::open_verified_artifact_file,
    error::{ComputeCoordinatorError, ComputeResult},
    snapshot_repository::SnapshotRepository,
    store::ComputeStore,
};

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_RECORD_LINE_BYTES: usize = 512 * 1024;
const MEMORY_HEADROOM_BYTES: u64 = 64 * 1024;
const VALIDITY_ARRAY_NAME: &str = "fingerprintValidity";
const VALIDITY_ARRAY_SEMANTIC: &str = "fingerprint_validity";

#[derive(Clone, Copy)]
pub(crate) struct RecordIdentity {
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: [u8; 32],
}

pub(crate) struct LoadedSimilarityLibrary {
    pub(crate) artifact_manifest_sha256: String,
    pub(crate) result_pack: ResultPackRef,
    pub(crate) record_count: u64,
    pub(crate) identities: Vec<RecordIdentity>,
    pub(crate) valid_count: usize,
    pub(crate) fingerprints: Vec<Fingerprint2048>,
    pub(crate) valid_ordinals: Vec<usize>,
    pub(crate) query: Fingerprint2048,
    pub(crate) query_ordinal: usize,
    pub(crate) scoring_memory_limit: u64,
}

pub(crate) fn load_similarity_library(
    store: &ComputeStore,
    snapshots: &SnapshotRepository,
    job: &JobSnapshot,
    artifact: &ArtifactManifest,
    query_source_index: u64,
    memory_limit: u64,
    gpu_backend: bool,
    candidate_bytes: usize,
) -> ComputeResult<LoadedSimilarityLibrary> {
    let artifact_manifest_sha256 = artifact_manifest_sha256(artifact)?;
    let result_pack_ref = job
        .result_pack
        .as_ref()
        .ok_or_else(|| protocol("successful cluster source job lacks its ResultPack reference"))?;
    let result_manifest: ResultPackManifest = read_verified_manifest(
        store,
        artifact,
        &result_pack_ref.manifest,
        "cluster ResultPack manifest",
    )?;
    result_pack_ref.validate_against_manifest(&result_manifest)?;
    let [engine_ref] = result_manifest.engine_packs.as_slice() else {
        return Err(protocol(
            "cluster ResultPack must contain exactly one fingerprint EnginePack",
        ));
    };
    let engine_manifest: EnginePackManifest = read_verified_manifest(
        store,
        artifact,
        &engine_ref.manifest,
        "cluster fingerprint EnginePack manifest",
    )?;
    engine_ref.validate_against_manifest(&engine_manifest)?;

    let fingerprint_array = engine_manifest
        .layout
        .array(CLUSTER_FINGERPRINT_ARRAY_NAME)
        .ok_or_else(|| protocol("fingerprint EnginePack lacks its canonical fingerprint array"))?;
    let validity_array = engine_manifest
        .layout
        .array(VALIDITY_ARRAY_NAME)
        .ok_or_else(|| protocol("fingerprint EnginePack lacks its validity array"))?;
    validate_fingerprint_array(fingerprint_array, job)?;
    validate_validity_array(validity_array, job)?;
    bind_array_file(artifact, &engine_manifest, fingerprint_array)?;
    bind_array_file(artifact, &engine_manifest, validity_array)?;

    let record_count_u64 = job.frozen_source.frozen_source.record_count;
    let record_count = usize::try_from(record_count_u64)
        .map_err(|_| validation("similarity library exceeds this process address space"))?;
    admit_identity_memory(record_count, memory_limit)?;
    let validity = read_validity(store, artifact, validity_array, record_count)?;
    let valid_count = validity.iter().filter(|value| **value).count();
    let identities = read_snapshot_identities(snapshots, job)?;
    let query_ordinal = identities
        .binary_search_by_key(&query_source_index, |identity| identity.source_record_id)
        .map_err(|_| {
            validation(format!(
                "query source index {query_source_index} is outside the clustered snapshot"
            ))
        })?;
    if !validity[query_ordinal] {
        return Err(validation(
            "the selected query molecule has no valid cluster fingerprint",
        ));
    }
    let extra_bytes = search_extra_bytes(record_count, valid_count, gpu_backend, candidate_bytes)?;
    let scoring_memory_limit = memory_limit.checked_sub(extra_bytes).ok_or_else(|| {
        validation(format!(
            "similarity search metadata requires {extra_bytes} bytes before scoring; limit is {memory_limit}"
        ))
    })?;
    let (fingerprints, valid_ordinals, query) =
        read_valid_fingerprints(store, artifact, fingerprint_array, &validity, query_ordinal)?;
    Ok(LoadedSimilarityLibrary {
        artifact_manifest_sha256,
        result_pack: result_pack_ref.clone(),
        record_count: record_count_u64,
        identities,
        valid_count,
        fingerprints,
        valid_ordinals,
        query,
        query_ordinal,
        scoring_memory_limit,
    })
}

fn read_verified_manifest<T: DeserializeOwned>(
    store: &ComputeStore,
    artifact: &ArtifactManifest,
    descriptor: &PackedFileDescriptor,
    label: &str,
) -> ComputeResult<T> {
    bind_packed_file(artifact, descriptor)?;
    if descriptor.byte_length == 0 || descriptor.byte_length > MAX_MANIFEST_BYTES {
        return Err(protocol(format!(
            "{label} must contain 1..={MAX_MANIFEST_BYTES} bytes"
        )));
    }
    let file = open_verified_artifact_file(store, artifact, &descriptor.relative_path)?;
    serde_json::from_reader(file)
        .map_err(|error| protocol(format!("cannot decode {label}: {error}")))
}

fn bind_array_file(
    artifact: &ArtifactManifest,
    engine: &EnginePackManifest,
    array: &PackedArrayDescriptor,
) -> ComputeResult<()> {
    let descriptor = engine
        .layout
        .files
        .iter()
        .find(|file| file.relative_path == array.file_relative_path)
        .ok_or_else(|| protocol(format!("array {} references an unknown file", array.name)))?;
    bind_packed_file(artifact, descriptor)
}

fn bind_packed_file(
    artifact: &ArtifactManifest,
    descriptor: &PackedFileDescriptor,
) -> ComputeResult<()> {
    let exact = artifact.files.iter().any(|file| {
        file.relative_path == descriptor.relative_path
            && file.sha256 == descriptor.sha256
            && file.byte_count == descriptor.byte_length
            && file.media_type == descriptor.media_type
    });
    if !exact {
        return Err(protocol(format!(
            "artifact does not bind the exact packed file descriptor for {}",
            descriptor.relative_path
        )));
    }
    Ok(())
}

fn validate_fingerprint_array(
    array: &PackedArrayDescriptor,
    job: &JobSnapshot,
) -> ComputeResult<()> {
    if array.semantic != CLUSTER_FINGERPRINT_SEMANTIC
        || array.dtype != PackedDType::U64
        || array.shape
            != [
                job.frozen_source.frozen_source.record_count,
                CLUSTER_FINGERPRINT_WORDS,
            ]
        || array.byte_order != PackedByteOrder::LittleEndian
        || !array.byte_offset.is_multiple_of(8)
        || array.byte_length
            != job
                .frozen_source
                .frozen_source
                .record_count
                .checked_mul(FINGERPRINT_BYTES as u64)
                .ok_or_else(|| protocol("fingerprint array byte length overflowed"))?
    {
        return Err(protocol(
            "fingerprint array differs from the cluster.v1 EnginePack ABI",
        ));
    }
    Ok(())
}

fn validate_validity_array(array: &PackedArrayDescriptor, job: &JobSnapshot) -> ComputeResult<()> {
    let record_count = job.frozen_source.frozen_source.record_count;
    if array.semantic != VALIDITY_ARRAY_SEMANTIC
        || array.dtype != PackedDType::Bool8
        || array.shape != [record_count]
        || array.byte_order != PackedByteOrder::NotApplicable
        || array.byte_length != record_count
    {
        return Err(protocol(
            "fingerprint validity array differs from the cluster.v1 EnginePack ABI",
        ));
    }
    Ok(())
}

fn read_validity(
    store: &ComputeStore,
    artifact: &ArtifactManifest,
    array: &PackedArrayDescriptor,
    record_count: usize,
) -> ComputeResult<Vec<bool>> {
    let mut file = open_verified_artifact_file(store, artifact, &array.file_relative_path)?;
    file.seek(SeekFrom::Start(array.byte_offset))?;
    let mut reader = file.take(array.byte_length);
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(record_count)
        .map_err(|_| unavailable("cannot allocate fingerprint validity buffer"))?;
    bytes.resize(record_count, 0);
    reader.read_exact(&mut bytes)?;
    let mut validity = Vec::new();
    validity
        .try_reserve_exact(record_count)
        .map_err(|_| unavailable("cannot allocate decoded fingerprint validity buffer"))?;
    for (ordinal, value) in bytes.into_iter().enumerate() {
        match value {
            0 => validity.push(false),
            1 => validity.push(true),
            _ => {
                return Err(protocol(format!(
                    "fingerprint validity at ordinal {ordinal} is not bool8"
                )))
            }
        }
    }
    Ok(validity)
}

fn read_valid_fingerprints(
    store: &ComputeStore,
    artifact: &ArtifactManifest,
    array: &PackedArrayDescriptor,
    validity: &[bool],
    query_ordinal: usize,
) -> ComputeResult<(Vec<Fingerprint2048>, Vec<usize>, Fingerprint2048)> {
    let valid_count = validity.iter().filter(|value| **value).count();
    let mut fingerprints = Vec::new();
    let mut valid_ordinals = Vec::new();
    fingerprints
        .try_reserve_exact(valid_count)
        .map_err(|_| unavailable("cannot allocate valid fingerprint buffer"))?;
    valid_ordinals
        .try_reserve_exact(valid_count)
        .map_err(|_| unavailable("cannot allocate valid fingerprint ordinal buffer"))?;
    let mut file = open_verified_artifact_file(store, artifact, &array.file_relative_path)?;
    file.seek(SeekFrom::Start(array.byte_offset))?;
    let mut reader = file.take(array.byte_length);
    let mut query = None;
    for (ordinal, valid) in validity.iter().copied().enumerate() {
        let mut bytes = [0_u8; FINGERPRINT_BYTES];
        reader.read_exact(&mut bytes)?;
        if valid {
            let fingerprint = Fingerprint2048::from_le_bytes(bytes);
            if ordinal == query_ordinal {
                query = Some(fingerprint);
            }
            fingerprints.push(fingerprint);
            valid_ordinals.push(ordinal);
        }
    }
    if reader.limit() != 0 {
        return Err(protocol(
            "fingerprint array ended before its declared byte length",
        ));
    }
    let query = query.ok_or_else(|| protocol("valid query fingerprint was not decoded"))?;
    Ok((fingerprints, valid_ordinals, query))
}

fn read_snapshot_identities(
    snapshots: &SnapshotRepository,
    job: &JobSnapshot,
) -> ComputeResult<Vec<RecordIdentity>> {
    let mut verified = snapshots.open_verified_source(&job.frozen_source)?;
    let (records_file, _) = verified
        .reopen_file(MOLECULAR_RECORDS_FILE_PATH)
        .map_err(ComputeCoordinatorError::Filesystem)?;
    let mut reader = BufReader::new(records_file);
    let record_count = usize::try_from(job.frozen_source.frozen_source.record_count)
        .map_err(|_| validation("snapshot record count exceeds this process address space"))?;
    let mut identities = Vec::new();
    identities
        .try_reserve_exact(record_count)
        .map_err(|_| unavailable("cannot allocate snapshot identity buffer"))?;
    let mut hasher = OrderedRecordMoleculeIdentityHasher::new();
    for _ in 0..record_count {
        let line = read_bounded_line(&mut reader)?
            .ok_or_else(|| protocol("molecular snapshot ended before its declared record count"))?;
        let record: MolecularSnapshotRecordV1 = serde_json::from_slice(&line).map_err(|error| {
            protocol(format!("cannot decode molecular snapshot record: {error}"))
        })?;
        record.validate()?;
        if record.canonical_json_line_bytes()? != line {
            return Err(protocol(
                "molecular snapshot record is not canonical JSON Lines",
            ));
        }
        hasher.push(record.source_record_id, &record.molecule_content_sha256)?;
        identities.push(RecordIdentity {
            source_record_id: record.source_record_id,
            molecule_content_sha256: decode_sha256(&record.molecule_content_sha256),
        });
    }
    if read_bounded_line(&mut reader)?.is_some() {
        return Err(protocol(
            "molecular snapshot exceeds its declared record count",
        ));
    }
    if hasher.finish_hex()
        != job
            .frozen_source
            .frozen_source
            .ordered_record_molecule_identity_sha256
    {
        return Err(protocol(
            "molecular snapshot identity differs from its frozen reference",
        ));
    }
    verified
        .reverify()
        .map_err(ComputeCoordinatorError::Filesystem)?;
    Ok(identities)
}

fn read_bounded_line(reader: &mut impl BufRead) -> ComputeResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    let read = reader
        .take(MAX_RECORD_LINE_BYTES as u64 + 1)
        .read_until(b'\n', &mut line)?;
    if read == 0 {
        return Ok(None);
    }
    if line.len() > MAX_RECORD_LINE_BYTES || line.last() != Some(&b'\n') {
        return Err(protocol(
            "molecular snapshot record is oversized or lacks its LF delimiter",
        ));
    }
    Ok(Some(line))
}

fn admit_identity_memory(record_count: usize, limit: u64) -> ComputeResult<()> {
    let records = record_count as u64;
    let required = MEMORY_HEADROOM_BYTES
        .checked_add(
            records
                .checked_mul((size_of::<RecordIdentity>() + 2) as u64)
                .ok_or_else(|| protocol("similarity identity memory accounting overflowed"))?,
        )
        .ok_or_else(|| protocol("similarity identity memory accounting overflowed"))?;
    if required > limit {
        return Err(validation(format!(
            "similarity identity preparation requires {required} bytes; limit is {limit}"
        )));
    }
    Ok(())
}

fn search_extra_bytes(
    record_count: usize,
    valid_count: usize,
    gpu_backend: bool,
    candidate_bytes: usize,
) -> ComputeResult<u64> {
    let records = record_count as u64;
    let valid = valid_count as u64;
    let identity_and_validity = records
        .checked_mul((size_of::<RecordIdentity>() + 2) as u64)
        .ok_or_else(|| protocol("similarity memory accounting overflowed"))?;
    let ranking_and_ordinals = valid
        .checked_mul((candidate_bytes + size_of::<usize>()) as u64)
        .ok_or_else(|| protocol("similarity memory accounting overflowed"))?;
    let cpu_fingerprints = if gpu_backend {
        0
    } else {
        valid
            .checked_mul(FINGERPRINT_BYTES as u64)
            .ok_or_else(|| protocol("similarity memory accounting overflowed"))?
    };
    MEMORY_HEADROOM_BYTES
        .checked_add(identity_and_validity)
        .and_then(|value| value.checked_add(ranking_and_ordinals))
        .and_then(|value| value.checked_add(cpu_fingerprints))
        .ok_or_else(|| protocol("similarity memory accounting overflowed"))
}

fn decode_sha256(value: &str) -> [u8; 32] {
    let mut bytes = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        bytes[index] = (hex_nibble(pair[0]) << 4) | hex_nibble(pair[1]);
    }
    bytes
}

fn hex_nibble(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => unreachable!("validated SHA-256 contains lowercase hexadecimal bytes"),
    }
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn validation(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Validation(message.into())
}

fn unavailable(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(message.into())
}
