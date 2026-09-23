use std::io::{BufRead, BufReader};

use burette_compute_protocol::{MolecularSnapshotRecordV1, MOLECULAR_RECORDS_FILE_PATH};

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

// Resolve transient database row IDs without replacing the hashes used by the
// calculation. The apply transaction separately checks the frozen revision.
pub(crate) fn resolve_analysis_source_rows(
    database_path: &std::path::Path,
    frozen_rows: &[GridAlignmentSourceRow],
) -> ComputeResult<Vec<GridAlignmentSourceRow>> {
    let indexes = frozen_rows
        .iter()
        .map(|row| usize::try_from(row.source_index))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            ComputeCoordinatorError::Validation("Analysis source index exceeds usize".into())
        })?;
    let current =
        crate::preview::grid_store::alignment_source_rows_by_indices(database_path, &indexes)
            .map_err(ComputeCoordinatorError::Validation)?;
    if current.len() != frozen_rows.len()
        || current.iter().zip(frozen_rows).any(|(a, b)| {
            a.source_index != b.source_index
                || a.molecule_content_sha256 != b.molecule_content_sha256
        })
    {
        return Err(ComputeCoordinatorError::Validation(
            "The collection changed during calculation. Results were saved but were not applied."
                .into(),
        ));
    }
    Ok(current)
}
