use std::{
    fmt,
    fs::File,
    io::{BufRead, BufReader},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use burrete_compute_core::{Fingerprint2048, FINGERPRINT_BYTES};
use burrete_compute_protocol::{
    FingerprintSettings, JobSnapshot, JobState, MolecularSnapshotRecordV1,
    OrderedRecordMoleculeIdentityHasher, PackedFileDescriptor, MOLECULAR_RECORDS_FILE_PATH,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::preview::{grid_snapshot::VerifiedSnapshot, grid_store::GridSnapshotLease};

use super::error::{ComputeCoordinatorError, ComputeResult};

const MAX_CHUNK_RECORDS: usize = 256;
const MAX_CHUNK_INPUT_BYTES: usize = 1024 * 1024;
const MAX_RECORD_LINE_BYTES: usize = 512 * 1024;
const MAX_FINGERPRINT_ERROR_BYTES: usize = 2_048;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FingerprintInputFormat {
    Smiles,
    Molblock,
    UnsupportedIdcode,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintInputRecord {
    pub(crate) ordinal: u64,
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) format: FingerprintInputFormat,
    pub(crate) input: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintInputChunk {
    pub(crate) session_id: Uuid,
    pub(crate) job_id: Uuid,
    pub(crate) start_ordinal: u64,
    pub(crate) completed_records: u64,
    pub(crate) total_records: u64,
    pub(crate) settings: FingerprintSettings,
    pub(crate) records: Vec<FingerprintInputRecord>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintExecutionStep {
    pub(crate) job: JobSnapshot,
    pub(crate) fingerprint_chunk: Option<FingerprintInputChunk>,
    pub(crate) ready_for_compute: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FingerprintChunkResult {
    pub(crate) session_id: Uuid,
    pub(crate) job_id: Uuid,
    pub(crate) start_ordinal: u64,
    pub(crate) records: Vec<FingerprintOutputRecord>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FingerprintOutputRecord {
    pub(crate) ordinal: u64,
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) fingerprint_base64: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct FingerprintRecordIdentity {
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
}

#[derive(Debug)]
pub(crate) struct CompletedFingerprintBatch {
    pub(crate) grid_lease: GridSnapshotLease,
    pub(crate) identities: Vec<FingerprintRecordIdentity>,
    pub(crate) fingerprints: Vec<Fingerprint2048>,
    pub(crate) errors: Vec<Option<String>>,
}

pub(crate) struct FingerprintSession {
    session_id: Uuid,
    owner: String,
    job_id: Uuid,
    settings: FingerprintSettings,
    expected_records: u64,
    next_ordinal: u64,
    reader: BufReader<File>,
    _descriptor: PackedFileDescriptor,
    verified: VerifiedSnapshot,
    identity: OrderedRecordMoleculeIdentityHasher,
    pending: Option<FingerprintInputChunk>,
    identities: Vec<FingerprintRecordIdentity>,
    fingerprints: Vec<Fingerprint2048>,
    errors: Vec<Option<String>>,
    grid_lease: GridSnapshotLease,
    reached_eof: bool,
}

impl fmt::Debug for FingerprintSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FingerprintSession")
            .field("session_id", &self.session_id)
            .field("owner", &self.owner)
            .field("job_id", &self.job_id)
            .field("expected_records", &self.expected_records)
            .field("next_ordinal", &self.next_ordinal)
            .field("reached_eof", &self.reached_eof)
            .finish_non_exhaustive()
    }
}

impl FingerprintSession {
    pub(crate) fn start(
        owner: &str,
        job: &JobSnapshot,
        grid_lease: GridSnapshotLease,
        verified: VerifiedSnapshot,
    ) -> ComputeResult<(Self, FingerprintInputChunk)> {
        job.validate()?;
        if job.state != JobState::Queued || job.revision != 1 {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision: 1,
                actual_revision: job.revision,
            });
        }
        if verified.reference() != &job.frozen_source {
            return Err(protocol(
                "fingerprint session source differs from the durable job snapshot",
            ));
        }
        let (file, descriptor) = verified
            .reopen_file(MOLECULAR_RECORDS_FILE_PATH)
            .map_err(ComputeCoordinatorError::Filesystem)?;
        let expected_records = job.frozen_source.frozen_source.record_count;
        let capacity = usize::try_from(expected_records).map_err(|_| {
            ComputeCoordinatorError::Validation(
                "fingerprint record count exceeds this process address space".into(),
            )
        })?;
        let mut session = Self {
            session_id: Uuid::new_v4(),
            owner: owner.into(),
            job_id: job.job_id,
            settings: job.request.as_cluster()?.parameters.fingerprint.clone(),
            expected_records,
            next_ordinal: 0,
            reader: BufReader::new(file),
            _descriptor: descriptor,
            verified,
            identity: OrderedRecordMoleculeIdentityHasher::new(),
            pending: None,
            identities: reserve(capacity, "fingerprint identity buffer")?,
            fingerprints: reserve(capacity, "fingerprint buffer")?,
            errors: reserve(capacity, "fingerprint error buffer")?,
            grid_lease,
            reached_eof: false,
        };
        let chunk = session
            .read_next_chunk()?
            .ok_or_else(|| protocol("non-empty cluster source produced no fingerprint records"))?;
        session.pending = Some(chunk.clone());
        Ok((session, chunk))
    }

    pub(crate) fn owner(&self) -> &str {
        &self.owner
    }

    pub(crate) fn session_id(&self) -> Uuid {
        self.session_id
    }

    pub(crate) fn accept_chunk(
        &mut self,
        result: FingerprintChunkResult,
    ) -> ComputeResult<Option<FingerprintInputChunk>> {
        if result.session_id != self.session_id || result.job_id != self.job_id {
            return Err(ComputeCoordinatorError::Forbidden(
                "fingerprint result does not belong to this compute session".into(),
            ));
        }
        let expected = self
            .pending
            .as_ref()
            .ok_or_else(|| protocol("fingerprint session has no outstanding chunk"))?;
        if result.start_ordinal != expected.start_ordinal
            || result.records.len() != expected.records.len()
        {
            return Err(protocol(
                "fingerprint result differs from the outstanding chunk shape",
            ));
        }
        let mut decoded = Vec::new();
        decoded
            .try_reserve_exact(result.records.len())
            .map_err(|_| allocation("decoded fingerprint chunk"))?;
        for (observed, source) in result.records.iter().zip(&expected.records) {
            if observed.ordinal != source.ordinal
                || observed.source_record_id != source.source_record_id
                || observed.molecule_content_sha256 != source.molecule_content_sha256
            {
                return Err(protocol(
                    "fingerprint result record identity differs from its frozen source",
                ));
            }
            decoded.push(decode_output(observed)?);
        }
        for (source, (fingerprint, error)) in expected.records.iter().zip(decoded) {
            self.identities.push(FingerprintRecordIdentity {
                source_record_id: source.source_record_id,
                molecule_content_sha256: source.molecule_content_sha256.clone(),
            });
            self.fingerprints.push(fingerprint);
            self.errors.push(error);
        }
        self.pending = None;
        let next = self.read_next_chunk()?;
        self.pending = next.clone();
        Ok(next)
    }

    pub(crate) fn finish(mut self) -> ComputeResult<CompletedFingerprintBatch> {
        if self.pending.is_some() || !self.reached_eof || self.next_ordinal != self.expected_records
        {
            return Err(protocol("fingerprint session is not complete"));
        }
        if self.identities.len() != self.fingerprints.len()
            || self.identities.len() != self.errors.len()
            || self.identities.len() as u64 != self.expected_records
        {
            return Err(protocol(
                "fingerprint result buffers have inconsistent lengths",
            ));
        }
        if self.identity.finish_hex()
            != self
                .verified
                .reference()
                .frozen_source
                .ordered_record_molecule_identity_sha256
        {
            return Err(protocol(
                "fingerprint input order differs from the frozen source identity",
            ));
        }
        self.verified
            .reverify()
            .map_err(ComputeCoordinatorError::Filesystem)?;
        Ok(CompletedFingerprintBatch {
            grid_lease: self.grid_lease,
            identities: self.identities,
            fingerprints: self.fingerprints,
            errors: self.errors,
        })
    }

    fn read_next_chunk(&mut self) -> ComputeResult<Option<FingerprintInputChunk>> {
        if self.reached_eof {
            return Ok(None);
        }
        let start_ordinal = self.next_ordinal;
        let mut records = Vec::new();
        records
            .try_reserve_exact(MAX_CHUNK_RECORDS)
            .map_err(|_| allocation("fingerprint input chunk"))?;
        let mut chunk_bytes = 0_usize;
        while records.len() < MAX_CHUNK_RECORDS && self.next_ordinal < self.expected_records {
            let line = read_bounded_line(&mut self.reader)?.ok_or_else(|| {
                protocol("molecular record stream ended before its declared record count")
            })?;
            let record: MolecularSnapshotRecordV1 =
                serde_json::from_slice(&line).map_err(|error| {
                    protocol(format!("cannot decode molecular snapshot record: {error}"))
                })?;
            record.validate()?;
            if record.canonical_json_line_bytes()? != line {
                return Err(protocol(
                    "molecular snapshot record is not canonical JSON Lines",
                ));
            }
            self.identity
                .push(record.source_record_id, &record.molecule_content_sha256)?;
            let (format, input) = chemistry_input(&record);
            let input_bytes = input.len();
            chunk_bytes = chunk_bytes
                .checked_add(input_bytes)
                .ok_or_else(|| protocol("fingerprint chunk byte count overflowed"))?;
            records.push(FingerprintInputRecord {
                ordinal: self.next_ordinal,
                source_record_id: record.source_record_id,
                molecule_content_sha256: record.molecule_content_sha256,
                format,
                input,
            });
            self.next_ordinal += 1;
            if chunk_bytes >= MAX_CHUNK_INPUT_BYTES {
                break;
            }
        }
        if self.next_ordinal == self.expected_records {
            if read_bounded_line(&mut self.reader)?.is_some() {
                return Err(protocol(
                    "molecular record stream exceeds its declared record count",
                ));
            }
            self.reached_eof = true;
        }
        if records.is_empty() {
            return Ok(None);
        }
        Ok(Some(FingerprintInputChunk {
            session_id: self.session_id,
            job_id: self.job_id,
            start_ordinal,
            completed_records: start_ordinal,
            total_records: self.expected_records,
            settings: self.settings.clone(),
            records,
        }))
    }
}

fn chemistry_input(record: &MolecularSnapshotRecordV1) -> (FingerprintInputFormat, String) {
    if let Some(smiles) = &record.smiles {
        (FingerprintInputFormat::Smiles, smiles.clone())
    } else if let Some(molblock) = &record.molblock {
        (FingerprintInputFormat::Molblock, molblock.clone())
    } else {
        (
            FingerprintInputFormat::UnsupportedIdcode,
            record.idcode.clone().unwrap_or_default(),
        )
    }
}

fn decode_output(
    output: &FingerprintOutputRecord,
) -> ComputeResult<(Fingerprint2048, Option<String>)> {
    match (&output.fingerprint_base64, &output.error) {
        (Some(encoded), None) => {
            if encoded.len() > 512 {
                return Err(protocol(
                    "fingerprint payload exceeds its fixed encoding bound",
                ));
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|error| protocol(format!("fingerprint payload is not base64: {error}")))?;
            let bytes: [u8; FINGERPRINT_BYTES] = bytes
                .try_into()
                .map_err(|_| protocol("fingerprint payload is not exactly 2,048 bits"))?;
            Ok((Fingerprint2048::from_le_bytes(bytes), None))
        }
        (None, Some(error)) => {
            if error.is_empty()
                || error.len() > MAX_FINGERPRINT_ERROR_BYTES
                || error.chars().any(char::is_control)
            {
                return Err(protocol("fingerprint error is empty, oversized, or unsafe"));
            }
            Ok((Fingerprint2048::ZERO, Some(error.clone())))
        }
        _ => Err(protocol(
            "fingerprint result requires exactly one fingerprint or error",
        )),
    }
}

fn read_bounded_line(reader: &mut BufReader<File>) -> ComputeResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(ComputeCoordinatorError::from)?;
        if available.is_empty() {
            if line.is_empty() {
                return Ok(None);
            }
            return Err(protocol(
                "molecular record stream ends without a line delimiter",
            ));
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |position| position + 1);
        if line.len().saturating_add(take) > MAX_RECORD_LINE_BYTES {
            return Err(protocol(
                "molecular snapshot record exceeds the worker input bound",
            ));
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        if line.last() == Some(&b'\n') {
            return Ok(Some(line));
        }
    }
}

fn reserve<T>(capacity: usize, label: &'static str) -> ComputeResult<Vec<T>> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(capacity)
        .map_err(|_| allocation(label))?;
    Ok(values)
}

fn allocation(label: &'static str) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(format!("cannot allocate {label}"))
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}
