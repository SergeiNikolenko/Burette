use burrete_compute_protocol::{
    AttemptSnapshot, AttemptState, BackendPolicy, ComputeErrorCode, JobState, StageState,
};
use uuid::Uuid;

use super::{
    test_support::{boundary_snapshot, insert_recovery_fixture, queued_snapshot, TestStore},
    *,
};

#[test]
fn restart_recovery_interrupts_running_non_idempotent_work() {
    let test = TestStore::new();
    let mut queued = queued_snapshot();
    queued.plan.stages[0].idempotent = false;
    queued.stages[0].idempotent = false;
    queued.accepted_plan_sha256 = queued.plan.canonical_sha256().expect("changed plan hash");
    queued.validate().expect("valid non-idempotent queued job");
    test.store
        .insert_prepared_job(MAIN_WINDOW_LABEL, &queued)
        .expect("insert prepared job");

    let mut running = queued.clone();
    running.revision = 2;
    running.state = JobState::Preparing;
    running.updated_at_ms = 110;
    running.progress.message = "Preparing source".into();
    let stage = &mut running.stages[0];
    stage.state = StageState::Running;
    stage.progress.message = "Running".into();
    stage.transferred_bytes = 64;
    stage.started_at_ms = Some(101);
    stage.updated_at_ms = Some(110);
    running.attempts = vec![AttemptSnapshot {
        attempt_id: Uuid::new_v4(),
        stage_id: stage.stage_id.clone(),
        attempt_number: 1,
        runtime_version: running.pinned_runtime.version.clone(),
        state: AttemptState::Running,
        started_at_ms: 101,
        heartbeat_at_ms: 110,
        finished_at_ms: None,
        error: None,
        retry_reason: None,
    }];
    test.store
        .apply_successor(MAIN_WINDOW_LABEL, 1, &running)
        .expect("start running job");

    assert_eq!(
        test.store
            .recover_active_jobs(120)
            .expect("recover running jobs"),
        1
    );
    let interrupted = test
        .store
        .get_job(MAIN_WINDOW_LABEL, queued.job_id)
        .expect("read interrupted job");
    assert_eq!(interrupted.revision, 3);
    assert_eq!(interrupted.state, JobState::Interrupted);
    assert_eq!(interrupted.stages[0].state, StageState::Interrupted);
    assert!(!interrupted.stages[0].idempotent);
    assert_eq!(interrupted.attempts[0].state, AttemptState::Interrupted);
    assert_eq!(
        interrupted.error.as_ref().map(|error| error.code),
        Some(ComputeErrorCode::WorkerCrashed)
    );
}

#[test]
fn restart_recovery_closes_every_active_queued_boundary() {
    let test = TestStore::new();
    let cases = [
        (BackendPolicy::ReferenceCpu, 0, JobState::Preparing),
        (BackendPolicy::GpuRequired, 2, JobState::WaitingGpu),
        (BackendPolicy::ReferenceCpu, 3, JobState::Running),
        (BackendPolicy::ReferenceCpu, 4, JobState::Validating),
        (BackendPolicy::ReferenceCpu, 5, JobState::Publishing),
        (BackendPolicy::ReferenceCpu, 3, JobState::CancelRequested),
    ];
    let snapshots = cases
        .into_iter()
        .map(|(policy, stage_index, state)| boundary_snapshot(policy, stage_index, state))
        .collect::<Vec<_>>();
    for snapshot in &snapshots {
        insert_recovery_fixture(&test.store, MAIN_WINDOW_LABEL, snapshot);
    }

    assert_eq!(
        test.store
            .recover_active_jobs(300)
            .expect("recover active boundaries"),
        snapshots.len()
    );
    for previous in &snapshots {
        let interrupted = test
            .store
            .get_job(MAIN_WINDOW_LABEL, previous.job_id)
            .expect("read recovered boundary");
        assert_eq!(interrupted.state, JobState::Interrupted);
        assert_eq!(interrupted.revision, previous.revision + 1);
        let pivot = interrupted
            .stages
            .iter()
            .find(|stage| stage.state != StageState::Succeeded)
            .expect("interrupted pivot");
        assert_eq!(pivot.state, StageState::Interrupted);
        assert_eq!(
            interrupted.attempts.last().map(|attempt| attempt.state),
            Some(AttemptState::Interrupted)
        );
    }
    assert_eq!(
        test.store
            .recover_active_jobs(301)
            .expect("recovery is idempotent"),
        0
    );

    let interrupted = test
        .store
        .get_job(MAIN_WINDOW_LABEL, snapshots[0].job_id)
        .expect("read interrupted job");
    let mut cancellation = interrupted.clone();
    cancellation.revision += 1;
    cancellation.state = JobState::CancelRequested;
    cancellation.updated_at_ms = 301;
    cancellation.error = None;
    cancellation.progress.message = "Cancellation requested".into();
    test.store
        .apply_successor(MAIN_WINDOW_LABEL, interrupted.revision, &cancellation)
        .expect("persist cancellation request");
    assert_eq!(
        test.store
            .recover_active_jobs(302)
            .expect("complete interrupted cancellation"),
        1
    );
    let cancelled = test
        .store
        .get_job(MAIN_WINDOW_LABEL, interrupted.job_id)
        .expect("read recovered cancellation");
    assert_eq!(cancelled.state, JobState::Cancelled);
    assert_eq!(
        cancelled.error.as_ref().map(|error| error.code),
        Some(ComputeErrorCode::Cancelled)
    );
}
