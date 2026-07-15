use burrete_compute_protocol::{MolecularSnapshotRef, MAX_JSON_SAFE_INTEGER};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use uuid::Uuid;

use super::{to_json, ComputeCoordinatorError, ComputeResult, ComputeStore};

const MAX_SNAPSHOT_INTENTS: usize = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SnapshotIntentState {
    Reserved,
    Writing,
    Synced,
    Renamed,
}

impl SnapshotIntentState {
    #[allow(
        dead_code,
        reason = "the snapshot publisher uses encoded states after submit wiring"
    )]
    fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Writing => "writing",
            Self::Synced => "synced",
            Self::Renamed => "renamed",
        }
    }

    fn decode(value: &str) -> ComputeResult<Self> {
        match value {
            "reserved" => Ok(Self::Reserved),
            "writing" => Ok(Self::Writing),
            "synced" => Ok(Self::Synced),
            "renamed" => Ok(Self::Renamed),
            _ => Err(ComputeCoordinatorError::Protocol(format!(
                "snapshot intent has unknown state '{value}'"
            ))),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(
    dead_code,
    reason = "the snapshot publisher constructs durable intents after submit wiring"
)]
pub(crate) struct SnapshotIntentDraft {
    pub(crate) snapshot_id: Uuid,
    pub(crate) job_id: Uuid,
    pub(crate) attempt_id: Uuid,
    pub(crate) reservation_bytes: u64,
    pub(crate) created_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SnapshotIntentRecord {
    pub(crate) snapshot_id: Uuid,
    pub(crate) job_id: Uuid,
    pub(crate) attempt_id: Uuid,
    pub(crate) state: SnapshotIntentState,
    pub(crate) reservation_bytes: u64,
    pub(crate) remaining_reservation_bytes: u64,
    pub(crate) actual_payload_bytes: Option<u64>,
    pub(crate) snapshot_ref: Option<MolecularSnapshotRef>,
    pub(crate) created_at_ms: u64,
    pub(crate) updated_at_ms: u64,
}

#[allow(
    dead_code,
    reason = "the snapshot publisher consumes the intent lifecycle after submit wiring"
)]
impl ComputeStore {
    pub(crate) fn reserve_snapshot_intent(
        &self,
        draft: &SnapshotIntentDraft,
    ) -> ComputeResult<SnapshotIntentRecord> {
        validate_uuid("snapshot intent snapshot ID", draft.snapshot_id)?;
        validate_uuid("snapshot intent job ID", draft.job_id)?;
        validate_uuid("snapshot intent attempt ID", draft.attempt_id)?;
        validate_positive_json_integer(
            "snapshot intent reservation bytes",
            draft.reservation_bytes,
        )?;
        validate_positive_json_integer("snapshot intent creation time", draft.created_at_ms)?;

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing_job = transaction
            .query_row(
                "SELECT 1 FROM jobs WHERE job_id = ?1",
                [draft.job_id.to_string()],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if existing_job.is_some() {
            return Err(ComputeCoordinatorError::Validation(format!(
                "snapshot intent job {} is already committed",
                draft.job_id
            )));
        }
        transaction.execute(
            "INSERT INTO snapshot_intents(
               snapshot_id, job_id, attempt_id, state, reservation_bytes,
               remaining_reservation_bytes, actual_payload_bytes, snapshot_ref_json,
               created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, 'reserved', ?4, ?4, NULL, NULL, ?5, ?5)",
            params![
                draft.snapshot_id.to_string(),
                draft.job_id.to_string(),
                draft.attempt_id.to_string(),
                draft.reservation_bytes as i64,
                draft.created_at_ms as i64,
            ],
        )?;
        let record = load_snapshot_intent(&transaction, draft.snapshot_id)?;
        transaction.commit()?;
        Ok(record)
    }

    pub(crate) fn get_snapshot_intent(
        &self,
        snapshot_id: Uuid,
    ) -> ComputeResult<SnapshotIntentRecord> {
        validate_uuid("snapshot intent snapshot ID", snapshot_id)?;
        let connection = self.open_connection()?;
        load_snapshot_intent(&connection, snapshot_id)
    }

    pub(crate) fn outstanding_snapshot_reservation_bytes(&self) -> ComputeResult<u64> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT remaining_reservation_bytes
             FROM snapshot_intents ORDER BY snapshot_id ASC",
        )?;
        let mut rows = statement.query([])?;
        let mut total = 0_u64;
        while let Some(row) = rows.next()? {
            let bytes = row.get::<_, i64>(0)?;
            let bytes = decode_nonnegative("snapshot intent remaining reservation bytes", bytes)?;
            total = total.checked_add(bytes).ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "snapshot intent outstanding reservation sum overflowed".into(),
                )
            })?;
        }
        Ok(total)
    }

    /// Returns the complete bounded reconciliation set.
    ///
    /// More than this many simultaneous publication intents indicates corrupt
    /// or unsupported coordinator state, so startup must fail closed instead
    /// of silently leaving rows unreconciled.
    pub(crate) fn snapshot_intents_for_reconciliation(
        &self,
    ) -> ComputeResult<Vec<SnapshotIntentRecord>> {
        let connection = self.open_connection()?;
        let count = connection.query_row("SELECT COUNT(*) FROM snapshot_intents", [], |row| {
            row.get::<_, i64>(0)
        })?;
        let count = usize::try_from(count).map_err(|_| {
            ComputeCoordinatorError::Protocol(
                "snapshot intent count cannot be represented in memory".into(),
            )
        })?;
        if count > MAX_SNAPSHOT_INTENTS {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "snapshot reconciliation has {count} intents, exceeding the supported bound of {MAX_SNAPSHOT_INTENTS}"
            )));
        }
        let mut statement = connection.prepare(
            "SELECT snapshot_id, job_id, attempt_id, state, reservation_bytes,
                    remaining_reservation_bytes, actual_payload_bytes, snapshot_ref_json,
                    created_at_ms, updated_at_ms
             FROM snapshot_intents
             ORDER BY created_at_ms ASC, snapshot_id ASC",
        )?;
        let records = statement
            .query_map([], read_raw_intent)?
            .map(|raw| decode_record(raw?))
            .collect();
        records
    }

    /// Deletes exactly the intent whose filesystem state the repository has
    /// already proven absent. The full record comparison and SQL predicate are
    /// the CAS boundary; a concurrent state transition fails closed.
    pub(crate) fn delete_snapshot_intent_after_cleanup(
        &self,
        expected: &SnapshotIntentRecord,
    ) -> ComputeResult<()> {
        validate_record(expected)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_snapshot_intent(&transaction, expected.snapshot_id)?;
        if current != *expected {
            return Err(ComputeCoordinatorError::Validation(
                "snapshot intent changed before filesystem cleanup completed".into(),
            ));
        }
        let deleted = transaction.execute(
            "DELETE FROM snapshot_intents
             WHERE snapshot_id = ?1 AND job_id = ?2 AND attempt_id = ?3
               AND state = ?4 AND updated_at_ms = ?5",
            params![
                expected.snapshot_id.to_string(),
                expected.job_id.to_string(),
                expected.attempt_id.to_string(),
                expected.state.as_str(),
                expected.updated_at_ms as i64,
            ],
        )?;
        if deleted != 1 {
            return Err(ComputeCoordinatorError::Protocol(
                "snapshot intent cleanup lost its conditional delete".into(),
            ));
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn mark_snapshot_intent_writing(
        &self,
        snapshot_id: Uuid,
        attempt_id: Uuid,
        updated_at_ms: u64,
    ) -> ComputeResult<SnapshotIntentRecord> {
        self.transition_snapshot_intent(
            snapshot_id,
            attempt_id,
            SnapshotIntentState::Reserved,
            SnapshotIntentState::Writing,
            updated_at_ms,
            None,
        )
    }

    pub(crate) fn mark_snapshot_intent_synced(
        &self,
        snapshot_id: Uuid,
        attempt_id: Uuid,
        actual_payload_bytes: u64,
        snapshot_ref: &MolecularSnapshotRef,
        updated_at_ms: u64,
    ) -> ComputeResult<SnapshotIntentRecord> {
        validate_positive_json_integer(
            "snapshot intent actual payload bytes",
            actual_payload_bytes,
        )?;
        snapshot_ref.validate()?;
        if snapshot_ref.snapshot_id != snapshot_id {
            return Err(ComputeCoordinatorError::Validation(
                "snapshot intent reference ID differs from the reserved snapshot ID".into(),
            ));
        }
        self.transition_snapshot_intent(
            snapshot_id,
            attempt_id,
            SnapshotIntentState::Writing,
            SnapshotIntentState::Synced,
            updated_at_ms,
            Some((actual_payload_bytes, snapshot_ref)),
        )
    }

    pub(crate) fn mark_snapshot_intent_renamed(
        &self,
        snapshot_id: Uuid,
        attempt_id: Uuid,
        updated_at_ms: u64,
    ) -> ComputeResult<SnapshotIntentRecord> {
        self.transition_snapshot_intent(
            snapshot_id,
            attempt_id,
            SnapshotIntentState::Synced,
            SnapshotIntentState::Renamed,
            updated_at_ms,
            None,
        )
    }

    fn transition_snapshot_intent(
        &self,
        snapshot_id: Uuid,
        attempt_id: Uuid,
        expected: SnapshotIntentState,
        next: SnapshotIntentState,
        updated_at_ms: u64,
        publication: Option<(u64, &MolecularSnapshotRef)>,
    ) -> ComputeResult<SnapshotIntentRecord> {
        validate_uuid("snapshot intent snapshot ID", snapshot_id)?;
        validate_uuid("snapshot intent attempt ID", attempt_id)?;
        validate_positive_json_integer("snapshot intent update time", updated_at_ms)?;

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_snapshot_intent(&transaction, snapshot_id)?;
        require_transition_identity(&current, attempt_id, expected, updated_at_ms)?;

        let updated = match publication {
            Some((actual_payload_bytes, snapshot_ref)) => {
                if actual_payload_bytes > current.reservation_bytes {
                    return Err(ComputeCoordinatorError::Validation(format!(
                        "snapshot payload requires {actual_payload_bytes} bytes but only {} bytes were reserved",
                        current.reservation_bytes
                    )));
                }
                transaction.execute(
                    "UPDATE snapshot_intents
                     SET state = ?1, remaining_reservation_bytes = 0,
                         actual_payload_bytes = ?2, snapshot_ref_json = ?3,
                         updated_at_ms = ?4
                     WHERE snapshot_id = ?5 AND attempt_id = ?6 AND state = ?7
                       AND updated_at_ms <= ?4",
                    params![
                        next.as_str(),
                        actual_payload_bytes as i64,
                        to_json(snapshot_ref)?,
                        updated_at_ms as i64,
                        snapshot_id.to_string(),
                        attempt_id.to_string(),
                        expected.as_str(),
                    ],
                )?
            }
            None => transaction.execute(
                "UPDATE snapshot_intents
                 SET state = ?1, updated_at_ms = ?2
                 WHERE snapshot_id = ?3 AND attempt_id = ?4 AND state = ?5
                   AND updated_at_ms <= ?2",
                params![
                    next.as_str(),
                    updated_at_ms as i64,
                    snapshot_id.to_string(),
                    attempt_id.to_string(),
                    expected.as_str(),
                ],
            )?,
        };
        if updated != 1 {
            return Err(ComputeCoordinatorError::Protocol(
                "snapshot intent transition lost its conditional update".into(),
            ));
        }
        let record = load_snapshot_intent(&transaction, snapshot_id)?;
        transaction.commit()?;
        Ok(record)
    }
}

pub(super) fn load_snapshot_intent(
    connection: &Connection,
    snapshot_id: Uuid,
) -> ComputeResult<SnapshotIntentRecord> {
    let raw = connection
        .query_row(
            "SELECT snapshot_id, job_id, attempt_id, state, reservation_bytes,
                    remaining_reservation_bytes, actual_payload_bytes, snapshot_ref_json,
                    created_at_ms, updated_at_ms
             FROM snapshot_intents WHERE snapshot_id = ?1",
            [snapshot_id.to_string()],
            read_raw_intent,
        )
        .optional()?
        .ok_or_else(|| snapshot_intent_not_found(snapshot_id))?;
    decode_record(raw)
}

pub(super) fn require_renamed_intent(
    transaction: &Transaction<'_>,
    snapshot_id: Uuid,
    job_id: Uuid,
    attempt_id: Uuid,
    snapshot_ref: &MolecularSnapshotRef,
) -> ComputeResult<SnapshotIntentRecord> {
    let intent = load_snapshot_intent(transaction, snapshot_id)?;
    if intent.job_id != job_id
        || intent.attempt_id != attempt_id
        || intent.state != SnapshotIntentState::Renamed
        || intent.snapshot_ref.as_ref() != Some(snapshot_ref)
    {
        return Err(ComputeCoordinatorError::Validation(
            "prepared job does not match its renamed snapshot intent".into(),
        ));
    }
    Ok(intent)
}

pub(super) fn delete_renamed_intent(
    transaction: &Transaction<'_>,
    intent: &SnapshotIntentRecord,
) -> ComputeResult<()> {
    let deleted = transaction.execute(
        "DELETE FROM snapshot_intents
         WHERE snapshot_id = ?1 AND job_id = ?2 AND attempt_id = ?3 AND state = 'renamed'",
        params![
            intent.snapshot_id.to_string(),
            intent.job_id.to_string(),
            intent.attempt_id.to_string(),
        ],
    )?;
    if deleted != 1 {
        return Err(ComputeCoordinatorError::Protocol(
            "renamed snapshot intent disappeared before job commit".into(),
        ));
    }
    Ok(())
}

type RawIntentRecord = (
    String,
    String,
    String,
    String,
    i64,
    i64,
    Option<i64>,
    Option<String>,
    i64,
    i64,
);

fn read_raw_intent(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawIntentRecord> {
    Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, String>(3)?,
        row.get::<_, i64>(4)?,
        row.get::<_, i64>(5)?,
        row.get::<_, Option<i64>>(6)?,
        row.get::<_, Option<String>>(7)?,
        row.get::<_, i64>(8)?,
        row.get::<_, i64>(9)?,
    ))
}

fn decode_record(raw: RawIntentRecord) -> ComputeResult<SnapshotIntentRecord> {
    let record = SnapshotIntentRecord {
        snapshot_id: parse_uuid("snapshot intent snapshot ID", &raw.0)?,
        job_id: parse_uuid("snapshot intent job ID", &raw.1)?,
        attempt_id: parse_uuid("snapshot intent attempt ID", &raw.2)?,
        state: SnapshotIntentState::decode(&raw.3)?,
        reservation_bytes: decode_nonnegative("snapshot intent reservation bytes", raw.4)?,
        remaining_reservation_bytes: decode_nonnegative(
            "snapshot intent remaining reservation bytes",
            raw.5,
        )?,
        actual_payload_bytes: raw
            .6
            .map(|value| decode_nonnegative("snapshot intent actual payload bytes", value))
            .transpose()?,
        snapshot_ref: raw
            .7
            .as_deref()
            .map(serde_json::from_str::<MolecularSnapshotRef>)
            .transpose()?,
        created_at_ms: decode_nonnegative("snapshot intent creation time", raw.8)?,
        updated_at_ms: decode_nonnegative("snapshot intent update time", raw.9)?,
    };
    validate_record(&record)?;
    Ok(record)
}

fn validate_record(record: &SnapshotIntentRecord) -> ComputeResult<()> {
    validate_uuid("snapshot intent snapshot ID", record.snapshot_id)?;
    validate_uuid("snapshot intent job ID", record.job_id)?;
    validate_uuid("snapshot intent attempt ID", record.attempt_id)?;
    validate_positive_json_integer(
        "snapshot intent reservation bytes",
        record.reservation_bytes,
    )?;
    validate_positive_json_integer("snapshot intent creation time", record.created_at_ms)?;
    validate_positive_json_integer("snapshot intent update time", record.updated_at_ms)?;
    if record.updated_at_ms < record.created_at_ms {
        return Err(ComputeCoordinatorError::Protocol(
            "snapshot intent update time precedes its creation time".into(),
        ));
    }
    match record.state {
        SnapshotIntentState::Reserved | SnapshotIntentState::Writing => {
            if record.remaining_reservation_bytes != record.reservation_bytes
                || record.actual_payload_bytes.is_some()
                || record.snapshot_ref.is_some()
            {
                return Err(ComputeCoordinatorError::Protocol(
                    "unpublished snapshot intent contains publication evidence".into(),
                ));
            }
        }
        SnapshotIntentState::Synced | SnapshotIntentState::Renamed => {
            let actual = record.actual_payload_bytes.ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "synced snapshot intent is missing its payload byte count".into(),
                )
            })?;
            validate_positive_json_integer("snapshot intent actual payload bytes", actual)?;
            if record.remaining_reservation_bytes != 0 || actual > record.reservation_bytes {
                return Err(ComputeCoordinatorError::Protocol(
                    "synced snapshot intent has inconsistent reservation accounting".into(),
                ));
            }
            let snapshot_ref = record.snapshot_ref.as_ref().ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "synced snapshot intent is missing its snapshot reference".into(),
                )
            })?;
            snapshot_ref.validate()?;
            if snapshot_ref.snapshot_id != record.snapshot_id {
                return Err(ComputeCoordinatorError::Protocol(
                    "snapshot intent reference differs from its snapshot ID".into(),
                ));
            }
        }
    }
    Ok(())
}

#[allow(
    dead_code,
    reason = "the snapshot publisher uses conditional transitions after submit wiring"
)]
fn require_transition_identity(
    current: &SnapshotIntentRecord,
    attempt_id: Uuid,
    expected: SnapshotIntentState,
    updated_at_ms: u64,
) -> ComputeResult<()> {
    if current.attempt_id != attempt_id {
        return Err(ComputeCoordinatorError::Validation(
            "snapshot intent attempt ID does not match the active publication attempt".into(),
        ));
    }
    if current.state != expected {
        return Err(ComputeCoordinatorError::Validation(format!(
            "snapshot intent transition expected state '{}' but found '{}'",
            expected.as_str(),
            current.state.as_str()
        )));
    }
    if updated_at_ms < current.updated_at_ms {
        return Err(ComputeCoordinatorError::Validation(
            "snapshot intent update time cannot move backwards".into(),
        ));
    }
    Ok(())
}

fn parse_uuid(label: &str, value: &str) -> ComputeResult<Uuid> {
    let parsed = Uuid::parse_str(value).map_err(|_| {
        ComputeCoordinatorError::Protocol(format!("{label} is not a canonical UUID"))
    })?;
    if parsed.to_string() != value || parsed.is_nil() {
        return Err(ComputeCoordinatorError::Protocol(format!(
            "{label} is not a canonical non-nil UUID"
        )));
    }
    Ok(parsed)
}

fn validate_uuid(label: &str, value: Uuid) -> ComputeResult<()> {
    if value.is_nil() {
        return Err(ComputeCoordinatorError::Validation(format!(
            "{label} cannot be nil"
        )));
    }
    Ok(())
}

fn validate_positive_json_integer(label: &str, value: u64) -> ComputeResult<()> {
    if value == 0 || value > MAX_JSON_SAFE_INTEGER {
        return Err(ComputeCoordinatorError::Validation(format!(
            "{label} must be in 1..={MAX_JSON_SAFE_INTEGER}"
        )));
    }
    Ok(())
}

fn decode_nonnegative(label: &str, value: i64) -> ComputeResult<u64> {
    let value = u64::try_from(value)
        .map_err(|_| ComputeCoordinatorError::Protocol(format!("{label} cannot be negative")))?;
    if value > MAX_JSON_SAFE_INTEGER {
        return Err(ComputeCoordinatorError::Protocol(format!(
            "{label} exceeds the JSON-safe integer limit"
        )));
    }
    Ok(value)
}

fn snapshot_intent_not_found(snapshot_id: Uuid) -> ComputeCoordinatorError {
    ComputeCoordinatorError::NotFound {
        entity: "snapshot intent",
        id: snapshot_id.to_string(),
    }
}
