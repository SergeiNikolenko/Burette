use std::{fs, sync::Barrier, thread};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use burrete_compute_protocol::{ComputeErrorCode, ComputeFailure, JobState, OwnerSurface};
use rusqlite::Connection;
use uuid::Uuid;

use super::{test_support::*, *};

#[test]
fn initializes_durable_sqlite_pragmas_and_rejects_future_schemas() {
    let test = TestStore::new();
    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    let journal: String = connection
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .expect("journal mode");
    let synchronous: i64 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .expect("synchronous mode");
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("user version");
    let schema_version: i64 = connection
        .query_row(
            "SELECT integer_value FROM compute_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .expect("schema version");
    assert_eq!(journal.to_lowercase(), "wal");
    assert_eq!(synchronous, 2);
    assert_eq!((schema_version, user_version), (2, 2));

    connection
        .execute(
            "UPDATE compute_meta SET integer_value = 3 WHERE key = 'schema_version'",
            [],
        )
        .expect("write future schema version");
    drop(connection);
    assert!(matches!(
        test.store.reopen(),
        Err(ComputeCoordinatorError::Unavailable(_))
    ));
}

#[cfg(unix)]
#[test]
fn store_holds_exclusive_root_ownership_and_fails_closed_after_replacement() {
    let test = TestStore::new();
    assert!(matches!(
        ComputeStore::initialize(test.root.clone()),
        Err(ComputeCoordinatorError::Unavailable(_))
    ));

    let displaced = test.root.with_file_name(format!(
        "{}-displaced",
        test.root
            .file_name()
            .expect("compute root leaf")
            .to_string_lossy()
    ));
    fs::rename(&test.root, &displaced).expect("displace compute root");
    fs::create_dir(&test.root).expect("create replacement compute root");
    fs::set_permissions(&test.root, fs::Permissions::from_mode(0o700))
        .expect("make replacement root private");

    assert!(matches!(
        test.store.list_jobs(MAIN_WINDOW_LABEL, 10),
        Err(ComputeCoordinatorError::Filesystem(_))
    ));

    fs::remove_dir(&test.root).expect("remove replacement root");
    fs::rename(displaced, &test.root).expect("restore held compute root");
    assert!(test
        .store
        .list_jobs(MAIN_WINDOW_LABEL, 10)
        .expect("read after restoring held root")
        .is_empty());
}

#[test]
fn persists_snapshots_for_stable_desktop_owner_and_bounded_events() {
    let test = TestStore::new();
    let mut snapshot = queued_snapshot();
    let created_window = format!("{WORKSPACE_WINDOW_PREFIX}{}", Uuid::new_v4());
    insert_prepared_fixture(&test.store, &created_window, &snapshot);

    assert_eq!(
        test.store
            .get_job(&created_window, snapshot.job_id)
            .expect("read durable job"),
        snapshot
    );
    let reopened_window = format!("{WORKSPACE_WINDOW_PREFIX}{}", Uuid::new_v4());
    assert_eq!(
        test.store
            .get_job(&reopened_window, snapshot.job_id)
            .expect("read from reopened workspace"),
        snapshot
    );
    assert_eq!(
        test.store
            .list_jobs(MAIN_WINDOW_LABEL, 10)
            .expect("list owner jobs"),
        [snapshot.clone()]
    );

    for _ in 0..300 {
        let previous_revision = snapshot.revision;
        snapshot.revision += 1;
        snapshot.updated_at_ms += 1;
        snapshot.progress.message = format!("Queued revision {}", snapshot.revision);
        test.store
            .apply_successor(&reopened_window, previous_revision, &snapshot)
            .expect("append queued revision");
    }
    let events = test
        .store
        .events_since(MAIN_WINDOW_LABEL, snapshot.job_id, 0, 256)
        .expect("read bounded events");
    assert_eq!(events.len(), 256);
    assert_eq!(events.first().expect("first event").revision, 46);
    assert_eq!(events.last().expect("last event").revision, 301);
    assert!(test
        .store
        .events_since(MAIN_WINDOW_LABEL, snapshot.job_id, 0, 257)
        .is_err());

    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    let owner_audit: (String, String) = connection
        .query_row(
            "SELECT owner_principal, created_window_label FROM jobs WHERE job_id = ?1",
            [snapshot.job_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read owner audit fields");
    assert_eq!(owner_audit, ("desktop".into(), created_window));
    drop(connection);

    let reopened = test.store.reopen().expect("reopen durable store");
    assert_eq!(
        reopened
            .get_job(MAIN_WINDOW_LABEL, snapshot.job_id)
            .expect("read after restart"),
        snapshot
    );
}

#[test]
fn compare_and_swap_allows_only_one_concurrent_cancellation() {
    let test = TestStore::new();
    let snapshot = queued_snapshot();
    insert_prepared_fixture(&test.store, MAIN_WINDOW_LABEL, &snapshot);

    let barrier = std::sync::Arc::new(Barrier::new(3));
    let handles = (0..2)
        .map(|_| {
            let barrier = barrier.clone();
            let store = test.store.clone();
            let job_id = snapshot.job_id;
            thread::spawn(move || {
                barrier.wait();
                store.request_cancel(MAIN_WINDOW_LABEL, job_id, 1, 110)
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let results = handles
        .into_iter()
        .map(|handle| handle.join().expect("join cancellation"))
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(ComputeCoordinatorError::Conflict { .. })))
            .count(),
        1
    );

    let requested = test
        .store
        .get_job(MAIN_WINDOW_LABEL, snapshot.job_id)
        .expect("read cancellation request");
    assert_eq!(requested.state, JobState::CancelRequested);
    assert_eq!(requested.revision, 2);

    let mut cancelled = requested.clone();
    cancelled.revision = 3;
    cancelled.state = JobState::Cancelled;
    cancelled.progress.message = "Cancelled".into();
    cancelled.error = Some(ComputeFailure {
        code: ComputeErrorCode::Cancelled,
        message: "Cancelled by owner.".into(),
        stage_id: None,
        molecule_stable_id: None,
        retryable: false,
    });
    cancelled.updated_at_ms = 120;
    cancelled.finished_at_ms = Some(120);
    test.store
        .apply_successor(MAIN_WINDOW_LABEL, 2, &cancelled)
        .expect("commit terminal cancellation");

    let artifact_id = Uuid::new_v4();
    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    assert!(connection
        .execute(
            "INSERT INTO artifacts(
               artifact_id, job_id, publication_state, relative_directory,
               manifest_json, created_at_ms, published_at_ms
             ) VALUES (?1, ?2, 'published', ?3, NULL, ?4, NULL)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                snapshot.job_id.to_string(),
                "artifacts/invalid",
                120_i64,
            ],
        )
        .is_err());
    connection
        .execute(
            "INSERT INTO artifacts(
               artifact_id, job_id, publication_state, relative_directory,
               manifest_json, created_at_ms, published_at_ms
             ) VALUES (?1, ?2, 'staging', ?3, NULL, ?4, NULL)",
            rusqlite::params![
                artifact_id.to_string(),
                snapshot.job_id.to_string(),
                format!("artifacts/{artifact_id}"),
                120_i64,
            ],
        )
        .expect("insert staging artifact");
    drop(connection);

    assert!(matches!(
        test.store.purge_job(MAIN_WINDOW_LABEL, snapshot.job_id),
        Err(ComputeCoordinatorError::Forbidden(_))
    ));
    let connection = Connection::open(test.store.database_path()).expect("open compute database");
    connection
        .execute(
            "DELETE FROM artifacts WHERE artifact_id = ?1",
            [artifact_id.to_string()],
        )
        .expect("simulate coordinated artifact cleanup");
    drop(connection);
    test.store
        .purge_job(MAIN_WINDOW_LABEL, snapshot.job_id)
        .expect("purge terminal job");
    assert!(matches!(
        test.store.get_job(MAIN_WINDOW_LABEL, snapshot.job_id),
        Err(ComputeCoordinatorError::NotFound { .. })
    ));
}

#[test]
fn rejects_untrusted_owner_labels_before_database_access() {
    let test = TestStore::new();
    for label in [
        "preview",
        "workspace-not-a-uuid",
        "workspace-00000000-0000-0000-0000-000000000000",
    ] {
        assert!(matches!(
            test.store.list_jobs(label, 10),
            Err(ComputeCoordinatorError::Forbidden(_))
        ));
    }
}

#[test]
fn rejects_non_desktop_owner_surface_on_tauri_store_path() {
    let test = TestStore::new();
    let mut snapshot = queued_snapshot();
    snapshot.owner_surface = OwnerSurface::DesktopAgent;
    snapshot.validate().expect("valid desktop-agent snapshot");
    assert!(matches!(
        test.store
            .insert_prepared_job(MAIN_WINDOW_LABEL, &snapshot, Uuid::new_v4()),
        Err(ComputeCoordinatorError::Forbidden(_))
    ));
}
