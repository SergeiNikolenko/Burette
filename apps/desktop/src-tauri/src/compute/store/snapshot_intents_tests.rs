use burette_compute_protocol::JobSnapshot;
use rusqlite::Connection;
use uuid::Uuid;

use super::{test_support::*, *};

#[test]
fn intent_lifecycle_is_conditional_and_releases_outstanding_bytes_at_sync() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    let draft = draft_for(&snapshot, 8_192);

    let reserved = test
        .store
        .reserve_snapshot_intent(&draft)
        .expect("reserve intent");
    assert_eq!(reserved.state, SnapshotIntentState::Reserved);
    assert_eq!(reserved.remaining_reservation_bytes, 8_192);
    assert_eq!(reserved.actual_payload_bytes, None);
    assert_eq!(reserved.snapshot_ref, None);
    assert_eq!(
        test.store
            .outstanding_snapshot_reservation_bytes()
            .expect("sum outstanding reservations"),
        8_192
    );

    assert!(matches!(
        test.store.mark_snapshot_intent_synced(
            draft.snapshot_id,
            draft.attempt_id,
            1_024,
            &snapshot.frozen_source,
            102,
        ),
        Err(ComputeCoordinatorError::Validation(_))
    ));
    assert_eq!(
        test.store
            .get_snapshot_intent(draft.snapshot_id)
            .expect("read unchanged intent")
            .state,
        SnapshotIntentState::Reserved
    );

    let writing = test
        .store
        .mark_snapshot_intent_writing(draft.snapshot_id, draft.attempt_id, 101)
        .expect("begin writing");
    assert_eq!(writing.state, SnapshotIntentState::Writing);
    assert_eq!(writing.remaining_reservation_bytes, 8_192);

    let synced = test
        .store
        .mark_snapshot_intent_synced(
            draft.snapshot_id,
            draft.attempt_id,
            1_024,
            &snapshot.frozen_source,
            102,
        )
        .expect("mark synced");
    assert_eq!(synced.state, SnapshotIntentState::Synced);
    assert_eq!(synced.remaining_reservation_bytes, 0);
    assert_eq!(synced.actual_payload_bytes, Some(1_024));
    assert_eq!(synced.snapshot_ref, Some(snapshot.frozen_source.clone()));
    assert_eq!(
        test.store
            .outstanding_snapshot_reservation_bytes()
            .expect("sum released reservations"),
        0
    );

    let renamed = test
        .store
        .mark_snapshot_intent_renamed(draft.snapshot_id, draft.attempt_id, 103)
        .expect("mark renamed");
    assert_eq!(renamed.state, SnapshotIntentState::Renamed);
    assert!(matches!(
        test.store
            .mark_snapshot_intent_renamed(draft.snapshot_id, draft.attempt_id, 104,),
        Err(ComputeCoordinatorError::Validation(_))
    ));
}

#[test]
fn intent_identity_constraints_reject_duplicates_without_replacing_the_original() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    let draft = draft_for(&snapshot, 4_096);
    let original = test
        .store
        .reserve_snapshot_intent(&draft)
        .expect("reserve original intent");

    assert!(matches!(
        test.store.reserve_snapshot_intent(&draft),
        Err(ComputeCoordinatorError::Database(_))
    ));
    let same_job = SnapshotIntentDraft {
        snapshot_id: Uuid::new_v4(),
        attempt_id: Uuid::new_v4(),
        ..draft.clone()
    };
    assert!(matches!(
        test.store.reserve_snapshot_intent(&same_job),
        Err(ComputeCoordinatorError::Database(_))
    ));
    let same_attempt = SnapshotIntentDraft {
        snapshot_id: Uuid::new_v4(),
        job_id: Uuid::new_v4(),
        ..draft.clone()
    };
    assert!(matches!(
        test.store.reserve_snapshot_intent(&same_attempt),
        Err(ComputeCoordinatorError::Database(_))
    ));
    assert_eq!(
        test.store
            .get_snapshot_intent(draft.snapshot_id)
            .expect("read original intent"),
        original
    );
}

#[test]
fn job_commit_atomically_writes_normalized_source_and_consumes_renamed_intent() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    let attempt_id = create_renamed_intent(&test.store, &snapshot);

    test.store
        .insert_prepared_job(MAIN_WINDOW_LABEL, &snapshot, attempt_id)
        .expect("commit prepared job");

    assert!(matches!(
        test.store
            .get_snapshot_intent(snapshot.frozen_source.snapshot_id),
        Err(ComputeCoordinatorError::NotFound { .. })
    ));
    assert_eq!(
        test.store
            .get_job(MAIN_WINDOW_LABEL, snapshot.job_id)
            .expect("read committed job"),
        snapshot
    );
    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    let source: (String, String) = connection
        .query_row(
            "SELECT snapshot_id, snapshot_ref_json
             FROM job_source_snapshots WHERE job_id = ?1",
            [snapshot.job_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read normalized source row");
    assert_eq!(source.0, snapshot.frozen_source.snapshot_id.to_string());
    assert_eq!(
        serde_json::from_str::<burette_compute_protocol::MolecularSnapshotRef>(&source.1)
            .expect("decode normalized source"),
        snapshot.frozen_source
    );
}

#[test]
fn job_commit_rejects_wrong_state_or_reference_and_preserves_intent() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    let draft = draft_for(&snapshot, 4_096);
    test.store
        .reserve_snapshot_intent(&draft)
        .expect("reserve intent");
    test.store
        .mark_snapshot_intent_writing(draft.snapshot_id, draft.attempt_id, 101)
        .expect("begin writing");

    assert!(matches!(
        test.store
            .insert_prepared_job(MAIN_WINDOW_LABEL, &snapshot, draft.attempt_id),
        Err(ComputeCoordinatorError::Validation(_))
    ));
    assert_eq!(
        test.store
            .get_snapshot_intent(draft.snapshot_id)
            .expect("intent survives wrong-state commit")
            .state,
        SnapshotIntentState::Writing
    );
    assert_eq!(job_count(&test), 0);

    test.store
        .mark_snapshot_intent_synced(
            draft.snapshot_id,
            draft.attempt_id,
            1_024,
            &snapshot.frozen_source,
            102,
        )
        .expect("sync intent");
    test.store
        .mark_snapshot_intent_renamed(draft.snapshot_id, draft.attempt_id, 103)
        .expect("rename intent");
    let mut mismatched = snapshot.clone();
    mismatched.frozen_source.snapshot_sha256 = repeated_hash('9');
    mismatched
        .validate()
        .expect("valid mismatched job snapshot");
    assert!(matches!(
        test.store
            .insert_prepared_job(MAIN_WINDOW_LABEL, &mismatched, draft.attempt_id),
        Err(ComputeCoordinatorError::Validation(_))
    ));
    assert_eq!(
        test.store
            .get_snapshot_intent(draft.snapshot_id)
            .expect("intent survives reference mismatch")
            .state,
        SnapshotIntentState::Renamed
    );
    assert_eq!(job_count(&test), 0);
}

#[test]
fn prepared_job_commit_is_idempotent_after_lost_ack_and_blocks_new_intents() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    let attempt_id = create_renamed_intent(&test.store, &snapshot);
    let committed = test
        .store
        .insert_prepared_job(MAIN_WINDOW_LABEL, &snapshot, attempt_id)
        .expect("commit prepared job");
    let retried = test
        .store
        .insert_prepared_job(MAIN_WINDOW_LABEL, &snapshot, attempt_id)
        .expect("resolve lost commit acknowledgement");
    assert_eq!(retried, committed);
    assert_eq!(job_count(&test), 1);

    let duplicate_intent = SnapshotIntentDraft {
        snapshot_id: Uuid::new_v4(),
        job_id: snapshot.job_id,
        attempt_id: Uuid::new_v4(),
        reservation_bytes: 4_096,
        created_at_ms: 200,
    };
    assert!(matches!(
        test.store.reserve_snapshot_intent(&duplicate_intent),
        Err(ComputeCoordinatorError::Validation(_))
    ));

    let mut mismatched = snapshot.clone();
    mismatched.frozen_source.snapshot_sha256 = repeated_hash('9');
    mismatched.validate().expect("valid mismatched retry");
    assert!(matches!(
        test.store
            .insert_prepared_job(MAIN_WINDOW_LABEL, &mismatched, attempt_id),
        Err(ComputeCoordinatorError::Validation(_))
    ));
    assert_eq!(
        test.store
            .get_job(MAIN_WINDOW_LABEL, snapshot.job_id)
            .expect("committed job remains unchanged"),
        snapshot
    );
}

#[test]
fn reconciliation_cas_cleans_every_crash_window_without_early_release() {
    let test = TestStore::new();
    let snapshots = (0..4).map(|_| queued_snapshot()).collect::<Vec<_>>();
    let drafts = snapshots
        .iter()
        .enumerate()
        .map(|(index, snapshot)| {
            let mut draft = draft_for(snapshot, 4_096);
            draft.created_at_ms += index as u64 * 10;
            draft
        })
        .collect::<Vec<_>>();
    for draft in &drafts {
        test.store
            .reserve_snapshot_intent(draft)
            .expect("reserve reconciliation intent");
    }
    test.store
        .mark_snapshot_intent_writing(
            drafts[1].snapshot_id,
            drafts[1].attempt_id,
            drafts[1].created_at_ms + 1,
        )
        .expect("writing crash window");
    test.store
        .mark_snapshot_intent_writing(
            drafts[2].snapshot_id,
            drafts[2].attempt_id,
            drafts[2].created_at_ms + 1,
        )
        .expect("begin synced crash window");
    test.store
        .mark_snapshot_intent_synced(
            drafts[2].snapshot_id,
            drafts[2].attempt_id,
            1_024,
            &snapshots[2].frozen_source,
            drafts[2].created_at_ms + 2,
        )
        .expect("synced crash window");
    test.store
        .mark_snapshot_intent_writing(
            drafts[3].snapshot_id,
            drafts[3].attempt_id,
            drafts[3].created_at_ms + 1,
        )
        .expect("begin renamed crash window");
    test.store
        .mark_snapshot_intent_synced(
            drafts[3].snapshot_id,
            drafts[3].attempt_id,
            1_024,
            &snapshots[3].frozen_source,
            drafts[3].created_at_ms + 2,
        )
        .expect("sync renamed crash window");
    test.store
        .mark_snapshot_intent_renamed(
            drafts[3].snapshot_id,
            drafts[3].attempt_id,
            drafts[3].created_at_ms + 3,
        )
        .expect("renamed crash window");

    let intents = test
        .store
        .snapshot_intents_for_reconciliation()
        .expect("list complete reconciliation set");
    assert_eq!(intents.len(), 4);
    assert_eq!(
        intents
            .iter()
            .map(|intent| intent.state)
            .collect::<Vec<_>>(),
        [
            SnapshotIntentState::Reserved,
            SnapshotIntentState::Writing,
            SnapshotIntentState::Synced,
            SnapshotIntentState::Renamed,
        ]
    );
    assert_eq!(
        test.store
            .outstanding_snapshot_reservation_bytes()
            .expect("sum reservations before cleanup"),
        8_192
    );

    let mut wrong_identity = intents[0].clone();
    wrong_identity.attempt_id = Uuid::new_v4();
    assert!(matches!(
        test.store
            .delete_snapshot_intent_after_cleanup(&wrong_identity),
        Err(ComputeCoordinatorError::Validation(_))
    ));
    assert_eq!(
        test.store
            .outstanding_snapshot_reservation_bytes()
            .expect("reservation remains after failed CAS"),
        8_192
    );

    for intent in &intents {
        test.store
            .delete_snapshot_intent_after_cleanup(intent)
            .expect("delete intent after confirmed filesystem cleanup");
    }
    assert!(test
        .store
        .snapshot_intents_for_reconciliation()
        .expect("list reconciled intents")
        .is_empty());
    assert_eq!(
        test.store
            .outstanding_snapshot_reservation_bytes()
            .expect("reservations released after cleanup"),
        0
    );
}

#[test]
fn strict_job_reads_reject_a_missing_or_mismatched_normalized_source() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    insert_prepared_fixture(&test.store, MAIN_WINDOW_LABEL, &snapshot);
    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    let mut mismatched = snapshot.frozen_source.clone();
    mismatched.snapshot_sha256 = repeated_hash('9');
    connection
        .execute(
            "UPDATE job_source_snapshots SET snapshot_ref_json = ?1 WHERE job_id = ?2",
            rusqlite::params![
                serde_json::to_string(&mismatched).expect("encode mismatch"),
                snapshot.job_id.to_string(),
            ],
        )
        .expect("corrupt normalized source reference");
    drop(connection);
    assert!(matches!(
        test.store.get_job(MAIN_WINDOW_LABEL, snapshot.job_id),
        Err(ComputeCoordinatorError::Protocol(_))
    ));

    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    connection
        .execute(
            "DELETE FROM job_source_snapshots WHERE job_id = ?1",
            [snapshot.job_id.to_string()],
        )
        .expect("remove normalized source row");
    drop(connection);
    assert!(matches!(
        test.store.get_job(MAIN_WINDOW_LABEL, snapshot.job_id),
        Err(ComputeCoordinatorError::Protocol(_))
    ));
}

#[test]
fn schema_v1_migration_backfills_source_rows_without_losing_jobs() {
    let snapshot = queued_snapshot();
    let test = TestStore::new_legacy_v1_with_job(MAIN_WINDOW_LABEL, &snapshot);

    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    let legacy_meta: i64 = connection
        .query_row(
            "SELECT integer_value FROM compute_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .expect("read legacy schema version");
    let legacy_user: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read legacy user version");
    assert_eq!((legacy_meta, legacy_user), (1, 0));
    drop(connection);

    let reopened = test.store.reopen().expect("migrate v1 database");
    assert_eq!(
        reopened
            .get_job(MAIN_WINDOW_LABEL, snapshot.job_id)
            .expect("read migrated job"),
        snapshot
    );
    let connection = Connection::open(reopened.database_path()).expect("open migrated database");
    let version: i64 = connection
        .query_row(
            "SELECT integer_value FROM compute_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .expect("read migrated schema version");
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read migrated user version");
    let source_count: i64 = connection
        .query_row("SELECT count(*) FROM job_source_snapshots", [], |row| {
            row.get(0)
        })
        .expect("count migrated source rows");
    assert_eq!(version, 2);
    assert_eq!(user_version, version);
    assert_eq!(source_count, 1);
}

#[test]
fn schema_v1_migration_allows_multiple_jobs_to_reuse_one_snapshot() {
    let first = queued_snapshot();
    let mut second = first.clone();
    second.job_id = Uuid::new_v4();
    second.validate().expect("valid second legacy job");
    let test =
        TestStore::new_legacy_v1_with_jobs(MAIN_WINDOW_LABEL, &[first.clone(), second.clone()]);

    let reopened = test.store.reopen().expect("migrate shared snapshot jobs");
    assert_eq!(
        reopened
            .list_jobs(MAIN_WINDOW_LABEL, 10)
            .expect("list migrated jobs")
            .len(),
        2
    );
    assert_eq!(
        reopened
            .get_job(MAIN_WINDOW_LABEL, first.job_id)
            .expect("read first migrated job")
            .frozen_source,
        reopened
            .get_job(MAIN_WINDOW_LABEL, second.job_id)
            .expect("read second migrated job")
            .frozen_source
    );
}

#[test]
fn reconciliation_state_deduplicates_committed_sources_and_captures_intents() {
    let test = TestStore::new();
    let first = queued_snapshot();
    insert_prepared_fixture(&test.store, MAIN_WINDOW_LABEL, &first);
    let mut second = first.clone();
    second.job_id = Uuid::new_v4();
    second.validate().expect("valid shared-source job");
    insert_prepared_fixture(&test.store, MAIN_WINDOW_LABEL, &second);

    let pending = queued_snapshot();
    let pending_draft = draft_for(&pending, 4_096);
    test.store
        .reserve_snapshot_intent(&pending_draft)
        .expect("reserve pending reconciliation intent");

    let state = test
        .store
        .snapshot_reconciliation_state()
        .expect("capture reconciliation state");
    assert_eq!(state.intents.len(), 1);
    assert_eq!(state.intents[0].snapshot_id, pending_draft.snapshot_id);
    assert_eq!(state.committed_sources.len(), 1);
    assert_eq!(
        state
            .committed_sources
            .get(&first.frozen_source.snapshot_id),
        Some(&first.frozen_source)
    );
}

#[test]
fn reconciliation_state_rejects_missing_or_mismatched_normalized_sources() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    insert_prepared_fixture(&test.store, MAIN_WINDOW_LABEL, &snapshot);

    let mut mismatched = snapshot.frozen_source.clone();
    mismatched.snapshot_sha256 = repeated_hash('9');
    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    connection
        .execute(
            "UPDATE job_source_snapshots SET snapshot_ref_json = ?1 WHERE job_id = ?2",
            rusqlite::params![
                serde_json::to_string(&mismatched).expect("encode mismatch"),
                snapshot.job_id.to_string(),
            ],
        )
        .expect("corrupt normalized source reference");
    drop(connection);
    assert!(matches!(
        test.store.snapshot_reconciliation_state(),
        Err(ComputeCoordinatorError::Protocol(_))
    ));

    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    connection
        .execute(
            "DELETE FROM job_source_snapshots WHERE job_id = ?1",
            [snapshot.job_id.to_string()],
        )
        .expect("remove normalized source row");
    drop(connection);
    assert!(matches!(
        test.store.snapshot_reconciliation_state(),
        Err(ComputeCoordinatorError::Protocol(_))
    ));
}

#[test]
fn reconciliation_state_rejects_oversized_reference_json_before_loading_rows() {
    let committed = TestStore::new();
    let committed_snapshot = queued_snapshot();
    insert_prepared_fixture(&committed.store, MAIN_WINDOW_LABEL, &committed_snapshot);
    let connection =
        Connection::open(committed.store.database_path()).expect("open compute database");
    connection
        .execute(
            "UPDATE job_source_snapshots SET snapshot_ref_json = ?1 WHERE job_id = ?2",
            rusqlite::params![
                oversized_reference_json(&committed_snapshot.frozen_source),
                committed_snapshot.job_id.to_string(),
            ],
        )
        .expect("inflate committed source reference");
    drop(connection);
    assert!(matches!(
        committed.store.snapshot_reconciliation_state(),
        Err(ComputeCoordinatorError::Unavailable(_))
    ));

    let pending = TestStore::new();
    let pending_snapshot = queued_snapshot();
    let draft = draft_for(&pending_snapshot, 4_096);
    pending
        .store
        .reserve_snapshot_intent(&draft)
        .expect("reserve pending intent");
    pending
        .store
        .mark_snapshot_intent_writing(draft.snapshot_id, draft.attempt_id, draft.created_at_ms + 1)
        .expect("begin pending write");
    pending
        .store
        .mark_snapshot_intent_synced(
            draft.snapshot_id,
            draft.attempt_id,
            1_024,
            &pending_snapshot.frozen_source,
            draft.created_at_ms + 2,
        )
        .expect("sync pending intent");
    let connection =
        Connection::open(pending.store.database_path()).expect("open compute database");
    connection
        .execute(
            "UPDATE snapshot_intents SET snapshot_ref_json = ?1 WHERE snapshot_id = ?2",
            rusqlite::params![
                oversized_reference_json(&pending_snapshot.frozen_source),
                pending_snapshot.frozen_source.snapshot_id.to_string(),
            ],
        )
        .expect("inflate pending source reference");
    drop(connection);
    assert!(matches!(
        pending.store.snapshot_reconciliation_state(),
        Err(ComputeCoordinatorError::Unavailable(_))
    ));
}

fn oversized_reference_json(reference: &burette_compute_protocol::MolecularSnapshotRef) -> String {
    let mut encoded = serde_json::to_string(reference).expect("encode snapshot reference");
    encoded.push_str(&" ".repeat(burette_compute_protocol::MAX_CONTROL_FRAME_BYTES));
    encoded
}

fn draft_for(snapshot: &JobSnapshot, reservation_bytes: u64) -> SnapshotIntentDraft {
    SnapshotIntentDraft {
        snapshot_id: snapshot.frozen_source.snapshot_id,
        job_id: snapshot.job_id,
        attempt_id: Uuid::new_v4(),
        reservation_bytes,
        created_at_ms: 100,
    }
}

fn job_count(test: &TestStore) -> i64 {
    Connection::open(test.store.database_path())
        .expect("open compute database")
        .query_row("SELECT count(*) FROM jobs", [], |row| row.get(0))
        .expect("count jobs")
}

fn repeated_hash(character: char) -> String {
    std::iter::repeat_n(character, 64).collect()
}
