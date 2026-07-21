use std::io::{BufRead, BufReader};

use burrete_compute_protocol::{MolecularSnapshotRecordV1, MOLECULAR_RECORDS_FILE_PATH};

use crate::preview::{grid_snapshot::VerifiedSnapshot, grid_store::GridAlignmentSourceRow};

use super::error::{ComputeCoordinatorError, ComputeResult};

pub(crate) fn load_analysis_source_rows(
    snapshot: &VerifiedSnapshot,
) -> ComputeResult<Vec<GridAlignmentSourceRow>> {
    let expected = snapshot.reference().frozen_source.record_count;
    let capacity = usize::try_from(expected).map_err(|_| {
        ComputeCoordinatorError::Validation(
            "Analysis snapshot record count exceeds this process address space".into(),
        )
    })?;
    let (file, _) = snapshot
        .reopen_file(MOLECULAR_RECORDS_FILE_PATH)
        .map_err(ComputeCoordinatorError::Filesystem)?;
    let mut rows = Vec::new();
    rows.try_reserve_exact(capacity).map_err(|_| {
        ComputeCoordinatorError::Validation(
            "Cannot reserve memory for the frozen analysis source".into(),
        )
    })?;
    for (ordinal, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| {
            ComputeCoordinatorError::Filesystem(format!(
                "Cannot read frozen analysis record {ordinal}: {error}"
            ))
        })?;
        let record: MolecularSnapshotRecordV1 = serde_json::from_str(&line).map_err(|error| {
            ComputeCoordinatorError::Protocol(format!(
                "Frozen analysis record {ordinal} is invalid JSON: {error}"
            ))
        })?;
        record.validate()?;
        rows.push(GridAlignmentSourceRow {
            row_id: -1,
            source_index: record.source_record_id,
            molecule_content_sha256: record.molecule_content_sha256,
            name: record.name,
            molblock: record.molblock,
        });
    }
    if rows.len() as u64 != expected {
        return Err(ComputeCoordinatorError::Protocol(format!(
            "Frozen analysis source expected {expected} records but decoded {}",
            rows.len()
        )));
    }
    Ok(rows)
}
