use std::{fs, path::PathBuf};

use burette_compute_protocol::{
    encode_frame, ArtifactManifest, ClusterV1SubmitRequest, ComputeCapabilityReport,
    ControlRequest, ControlResponse, EnginePackManifest, ExecutionPlan, JobSnapshot,
    MolecularSnapshotManifest, MolecularSnapshotRecordV1, ResultPackManifest, WorkerControlRequest,
    WorkerControlResponse,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/compute/fixtures")
        .join(name)
}

fn fixture_value(name: &str) -> Value {
    let path = fixture_path(name);
    let bytes = fs::read(&path).unwrap_or_else(|error| {
        panic!("failed to read schema fixture {}: {error}", path.display())
    });
    serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!("failed to parse schema fixture {}: {error}", path.display())
    })
}

fn decode<T: DeserializeOwned>(name: &str) -> T {
    serde_json::from_value(fixture_value(name))
        .unwrap_or_else(|error| panic!("failed to decode schema fixture {name}: {error}"))
}

#[test]
fn valid_schema_fixtures_pass_authoritative_rust_validation() {
    let selected: ClusterV1SubmitRequest = decode("valid-cluster-request.json");
    selected.validate().expect("validate selected request");
    assert_eq!(
        selected.canonical_sha256().expect("hash selected request"),
        "e9ac23cb9b124ece406aee5619cf49112de538f4fdf6d2f2217387df1ab202af"
    );

    let filtered: ClusterV1SubmitRequest = decode("valid-filtered-cluster-request.json");
    filtered.validate().expect("validate filtered request");
    assert_eq!(
        filtered.canonical_sha256().expect("hash filtered request"),
        "abc35f1fd431bf053362f15ed63e7125e8f573f2762f92e40454afaf02341c9b"
    );

    let plan: ExecutionPlan = decode("valid-execution-plan.json");
    plan.validate().expect("validate execution plan");
    assert_eq!(
        plan.canonical_sha256().expect("hash execution plan"),
        "746fb1f42a9be112bf9d4efc02d50370e64acc8db6790ea70d5d42e178238f58"
    );

    let capability: ComputeCapabilityReport = decode("valid-compute-capability-report.json");
    capability.validate().expect("validate capability report");

    let molecular: MolecularSnapshotManifest = decode("valid-molecular-snapshot-pack.json");
    molecular.validate().expect("validate molecular snapshot");
    let molecular_record: MolecularSnapshotRecordV1 =
        decode("valid-molecular-snapshot-record.json");
    molecular_record
        .validate()
        .expect("validate molecular snapshot record");
    let engine: EnginePackManifest = decode("valid-engine-pack.json");
    engine.validate().expect("validate engine pack");
    let result: ResultPackManifest = decode("valid-result-pack.json");
    result.validate().expect("validate result pack");

    let queued: JobSnapshot = decode("valid-queued-job-snapshot.json");
    queued.validate().expect("validate queued job");
    let succeeded: JobSnapshot = decode("valid-succeeded-job-snapshot.json");
    succeeded.validate().expect("validate succeeded job");

    let artifact: ArtifactManifest = decode("valid-artifact-manifest.json");
    artifact
        .validate_against_job(&succeeded)
        .expect("validate artifact against succeeded job");
}

#[test]
fn valid_control_fixtures_pass_wire_validation() {
    let client_request: ControlRequest = decode("valid-client-handshake-request.json");
    encode_frame(&client_request).expect("validate client request");
    let client_response: ControlResponse = decode("valid-client-handshake-response.json");
    encode_frame(&client_response).expect("validate client response");
    let worker_request: WorkerControlRequest = decode("valid-worker-handshake-request.json");
    encode_frame(&worker_request).expect("validate worker request");
    let worker_response: WorkerControlResponse = decode("valid-worker-handshake-response.json");
    encode_frame(&worker_response).expect("validate worker response");
}

#[test]
fn invalid_request_fixtures_fail_decode_or_validation() {
    for name in [
        "invalid-analysis-nil-run-id.json",
        "invalid-cluster-arbitrary-stages.json",
        "invalid-cluster-oversized.json",
        "invalid-nested-unknown.json",
        "invalid-unsafe-integer.json",
    ] {
        let rejected = serde_json::from_value::<ClusterV1SubmitRequest>(fixture_value(name))
            .map_or(true, |request| request.validate().is_err());
        assert!(rejected, "Rust accepted invalid request fixture {name}");
    }

    for name in [
        "invalid-wrong-protocol.json",
        "invalid-wrong-token-kind.json",
    ] {
        let rejected = serde_json::from_value::<ControlRequest>(fixture_value(name))
            .map_or(true, |request| encode_frame(&request).is_err());
        assert!(rejected, "Rust accepted invalid control fixture {name}");
    }
}
