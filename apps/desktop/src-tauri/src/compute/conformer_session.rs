use std::{
    fmt,
    fs::File,
    io::{BufRead, BufReader},
};

use burrete_compute_core::{
    ConformerEnginePackArrays, ConformerEnginePackBuilder, ExtractedConformerParameters,
};
use burrete_compute_protocol::{
    ConformerV1SubmitRequest, ConformerVariant, MolecularSnapshotRecordV1,
    OrderedRecordMoleculeIdentityHasher, PackedFileDescriptor, MAX_PACK_BYTES,
    MOLECULAR_RECORDS_FILE_PATH,
};
use serde::Serialize;
use uuid::Uuid;

use crate::preview::grid_snapshot::VerifiedSnapshot;

use super::{
    conformer_ipc::{ConformerChunkResult, ConformerRecordResult},
    error::{ComputeCoordinatorError, ComputeResult},
};

pub(crate) const MAX_CONFORMER_RESULT_ENVELOPE_BYTES: usize = 8 * 1024 * 1024;
const MAX_CHUNK_RECORDS: usize = 16;
const MAX_CHUNK_INPUT_BYTES: usize = 1024 * 1024;
const MAX_RECORD_LINE_BYTES: usize = 512 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConformerInputFormat {
    Molblock,
    Smiles,
    UnsupportedIdcode,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerInputRecord {
    pub(crate) ordinal: u64,
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) format: ConformerInputFormat,
    pub(crate) input: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerInputChunk {
    pub(crate) session_id: Uuid,
    pub(crate) start_ordinal: u64,
    pub(crate) completed_records: u64,
    pub(crate) total_records: u64,
    pub(crate) variant: ConformerVariant,
    pub(crate) maximum_result_bytes: usize,
    pub(crate) records: Vec<ConformerInputRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConformerRecordIdentity {
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
}

#[derive(Debug)]
pub(crate) struct CompletedConformerExtraction {
    pub(crate) arrays: ConformerEnginePackArrays,
    pub(crate) identities: Vec<ConformerRecordIdentity>,
    pub(crate) errors: Vec<Option<String>>,
    pub(crate) verified: VerifiedSnapshot,
}

pub(crate) struct ConformerExtractionSession {
    session_id: Uuid,
    owner: String,
    variant: ConformerVariant,
    expected_records: u64,
    next_ordinal: u64,
    reader: BufReader<File>,
    _descriptor: PackedFileDescriptor,
    verified: VerifiedSnapshot,
    identity: OrderedRecordMoleculeIdentityHasher,
    pending: Option<ConformerInputChunk>,
    builder: ConformerEnginePackBuilder,
    identities: Vec<ConformerRecordIdentity>,
    errors: Vec<Option<String>>,
    reached_eof: bool,
}

impl fmt::Debug for ConformerExtractionSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConformerExtractionSession")
            .field("session_id", &self.session_id)
            .field("owner", &self.owner)
            .field("variant", &self.variant)
            .field("expected_records", &self.expected_records)
            .field("next_ordinal", &self.next_ordinal)
            .field("reached_eof", &self.reached_eof)
            .finish_non_exhaustive()
    }
}

impl ConformerExtractionSession {
    pub(crate) fn start(
        owner: &str,
        request: &ConformerV1SubmitRequest,
        verified: VerifiedSnapshot,
    ) -> ComputeResult<(Self, ConformerInputChunk)> {
        request.validate()?;
        let expected_records = verified.reference().frozen_source.record_count;
        if expected_records == 0 {
            return Err(protocol("conformer extraction requires a non-empty source"));
        }
        let (file, descriptor) = verified
            .reopen_file(MOLECULAR_RECORDS_FILE_PATH)
            .map_err(ComputeCoordinatorError::Filesystem)?;
        let capacity = usize::try_from(expected_records).map_err(|_| {
            ComputeCoordinatorError::Validation(
                "conformer source record count exceeds this process address space".into(),
            )
        })?;
        let engine_budget = request
            .limits
            .max_memory_bytes
            .min(MAX_PACK_BYTES)
            .checked_sub(MAX_CONFORMER_RESULT_ENVELOPE_BYTES as u64)
            .ok_or_else(|| {
                ComputeCoordinatorError::Validation(
                    "conformer memory limit cannot admit one extraction envelope".into(),
                )
            })?;
        let mut session = Self {
            session_id: Uuid::new_v4(),
            owner: owner.into(),
            variant: request.parameters.variant,
            expected_records,
            next_ordinal: 0,
            reader: BufReader::new(file),
            _descriptor: descriptor,
            verified,
            identity: OrderedRecordMoleculeIdentityHasher::new(),
            pending: None,
            builder: ConformerEnginePackBuilder::new(request.parameters.variant, engine_budget),
            identities: reserve(capacity, "conformer identity buffer")?,
            errors: reserve(capacity, "conformer error buffer")?,
            reached_eof: false,
        };
        let chunk = session
            .read_next_chunk()?
            .ok_or_else(|| protocol("non-empty conformer source produced no records"))?;
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
        result: ConformerChunkResult,
    ) -> ComputeResult<Option<ConformerInputChunk>> {
        if result.session_id != self.session_id {
            return Err(ComputeCoordinatorError::Forbidden(
                "conformer result does not belong to this extraction session".into(),
            ));
        }
        let expected = self
            .pending
            .as_ref()
            .ok_or_else(|| protocol("conformer extraction has no outstanding chunk"))?;
        if result.start_ordinal != expected.start_ordinal
            || result.records.len() != expected.records.len()
        {
            return Err(protocol(
                "conformer result differs from the outstanding chunk shape",
            ));
        }

        let mut decoded = Vec::new();
        decoded
            .try_reserve_exact(result.records.len())
            .map_err(|_| unavailable("cannot allocate decoded conformer chunk"))?;
        for (observed, source) in result.records.iter().zip(&expected.records) {
            validate_record_identity(observed, source)?;
            let value = match &observed.output {
                Ok(bytes) => Ok(ExtractedConformerParameters::decode(
                    bytes,
                    self.variant,
                    MAX_CONFORMER_RESULT_ENVELOPE_BYTES as u64,
                )
                .map_err(|error| protocol(format!("invalid BCEX result: {error}")))?),
                Err(error) => Err(error.clone()),
            };
            decoded.push(value);
        }
        for (source, value) in expected.records.iter().zip(decoded) {
            self.identities.push(ConformerRecordIdentity {
                source_record_id: source.source_record_id,
                molecule_content_sha256: source.molecule_content_sha256.clone(),
            });
            match value {
                Ok(extracted) => {
                    self.builder.append_valid(extracted).map_err(|error| {
                        protocol(format!("cannot assemble EnginePack: {error}"))
                    })?;
                    self.errors.push(None);
                }
                Err(error) => {
                    self.builder.append_invalid().map_err(|error| {
                        protocol(format!("cannot assemble EnginePack: {error}"))
                    })?;
                    self.errors.push(Some(error));
                }
            }
        }
        self.pending = None;
        let next = self.read_next_chunk()?;
        self.pending = next.clone();
        Ok(next)
    }

    pub(crate) fn finish(mut self) -> ComputeResult<CompletedConformerExtraction> {
        if self.pending.is_some() || !self.reached_eof || self.next_ordinal != self.expected_records
        {
            return Err(protocol("conformer extraction session is not complete"));
        }
        if self.identities.len() != self.errors.len()
            || self.identities.len() as u64 != self.expected_records
        {
            return Err(protocol(
                "conformer extraction result buffers have inconsistent lengths",
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
                "conformer input order differs from the frozen source identity",
            ));
        }
        self.verified
            .reverify()
            .map_err(ComputeCoordinatorError::Filesystem)?;
        let arrays = self
            .builder
            .finish(self.expected_records)
            .map_err(|error| protocol(format!("cannot finish EnginePack: {error}")))?;
        Ok(CompletedConformerExtraction {
            arrays,
            identities: self.identities,
            errors: self.errors,
            verified: self.verified,
        })
    }

    fn read_next_chunk(&mut self) -> ComputeResult<Option<ConformerInputChunk>> {
        if self.reached_eof {
            return Ok(None);
        }
        let start_ordinal = self.next_ordinal;
        let mut records = Vec::new();
        records
            .try_reserve_exact(MAX_CHUNK_RECORDS)
            .map_err(|_| unavailable("cannot allocate conformer input chunk"))?;
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
            chunk_bytes = chunk_bytes
                .checked_add(input.as_ref().map_or(0, String::len))
                .ok_or_else(|| protocol("conformer input chunk byte count overflowed"))?;
            records.push(ConformerInputRecord {
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
        Ok(Some(ConformerInputChunk {
            session_id: self.session_id,
            start_ordinal,
            completed_records: start_ordinal,
            total_records: self.expected_records,
            variant: self.variant,
            maximum_result_bytes: MAX_CONFORMER_RESULT_ENVELOPE_BYTES,
            records,
        }))
    }
}

fn validate_record_identity(
    observed: &ConformerRecordResult,
    source: &ConformerInputRecord,
) -> ComputeResult<()> {
    if observed.ordinal != source.ordinal
        || observed.source_record_id != source.source_record_id
        || observed.molecule_content_sha256 != source.molecule_content_sha256
    {
        return Err(protocol(
            "conformer result record identity differs from its frozen source",
        ));
    }
    Ok(())
}

fn chemistry_input(record: &MolecularSnapshotRecordV1) -> (ConformerInputFormat, Option<String>) {
    if let Some(molblock) = &record.molblock {
        (ConformerInputFormat::Molblock, Some(molblock.clone()))
    } else if let Some(smiles) = &record.smiles {
        (ConformerInputFormat::Smiles, Some(smiles.clone()))
    } else {
        (ConformerInputFormat::UnsupportedIdcode, None)
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
                "molecular snapshot record exceeds the conformer worker input bound",
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
        .map_err(|_| unavailable(format!("cannot allocate {label}")))?;
    Ok(values)
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn unavailable(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(message.into())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use burrete_compute_protocol::MolecularSnapshotRecordVersion;

    use super::*;

    #[test]
    fn chemistry_input_prefers_molblock_then_smiles_and_rejects_idcode() {
        let mut record = MolecularSnapshotRecordV1 {
            schema_version: MolecularSnapshotRecordVersion::V1,
            source_record_id: 1,
            molecule_content_sha256: "a".repeat(64),
            name: "molecule".into(),
            smiles: Some("CC".into()),
            molblock: Some("molblock".into()),
            idcode: Some("idcode".into()),
            idcoordinates: None,
            props: BTreeMap::new(),
        };
        assert_eq!(
            chemistry_input(&record),
            (ConformerInputFormat::Molblock, Some("molblock".into()))
        );
        record.molblock = None;
        assert_eq!(
            chemistry_input(&record),
            (ConformerInputFormat::Smiles, Some("CC".into()))
        );
        record.smiles = None;
        assert_eq!(
            chemistry_input(&record),
            (ConformerInputFormat::UnsupportedIdcode, None)
        );
    }
}
