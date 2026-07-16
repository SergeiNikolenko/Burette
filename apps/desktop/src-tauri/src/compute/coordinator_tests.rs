use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use burrete_compute_protocol::{
    AllGridScope, ClusterV1Parameters, ComputeJobSchemaVersion, ExecutionPolicy,
    FingerprintAlgorithm, FingerprintInputOrder, FingerprintSettings, GridScope,
    GridSourceReference, RdkitBaselineVersion, RepresentativePolicy, ResourceLimits,
    SchedulingPolicy, SimilarityCutoff, SimilaritySettings,
};

use crate::preview::grid_store::{build_grid_store, GridQuery, GridRuntimeRegistry};

#[test]
fn missing_runtime_never_advertises_gpu_execution() {
    let missing = std::env::temp_dir().join(format!("burrete-missing-metal-{}", Uuid::new_v4()));
    let state = NativeMetalState::probe(Some(missing), &"a".repeat(64));
    let NativeMetalState::Unavailable { code, message } = state else {
        panic!("missing runtime cannot become available");
    };
    assert_eq!(code, CapabilityReasonCode::RuntimeMissing);
    let report = unavailable_report(code, message);
    assert_eq!(report.availability, ComputeAvailability::Unavailable);
    assert_eq!(report.limits.max_edges, 0);
    assert!(!report.capabilities[0].available);
    assert_eq!(report.validate(), Ok(()));
}

#[test]
fn helper_attestation_is_a_real_sha256_digest() {
    let hash = current_executable_sha256().expect("hash current test executable");
    assert_eq!(hash.len(), 64);
    assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
}

#[test]
fn cluster_v1_runs_end_to_end_and_writes_results_back_to_grid() {
    let fixture_id = Uuid::new_v4();
    let temp_root = std::fs::canonicalize(std::env::temp_dir()).expect("canonical temp root");
    let compute_root = temp_root.join(format!("burrete-compute-e2e-{fixture_id}"));
    let grid_root = temp_root.join(format!("burrete-grid-e2e-{fixture_id}"));
    std::fs::create_dir_all(&grid_root).expect("create Grid fixture directory");
    let handle = build_grid_store(
        &grid_root,
        "csv",
        b"smiles,name\nCCO,Ethanol\nCCN,Ethylamine\nc1ccccc1,Benzene\n",
    )
    .expect("build Grid fixture")
    .expect("Grid fixture is supported");
    assert!(handle.summary.index_ready);
    let registry = GridRuntimeRegistry::default();
    registry
        .register(
            "main:cluster-e2e",
            handle.database_path,
            "csv",
            handle.cancel_token,
        )
        .expect("register Grid fixture");

    let viewer_root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../PreviewExtension/Web");
    let coordinator = ComputeCoordinator::initialize(compute_root.clone(), None, Some(viewer_root));
    let request = ClusterV1SubmitRequest {
        schema_version: ComputeJobSchemaVersion::V1,
        workflow_template: WorkflowTemplateId::ClusterV1,
        source: GridSourceReference {
            document_id: "cluster-e2e".into(),
            scope: GridScope::All(AllGridScope {}),
        },
        parameters: ClusterV1Parameters {
            fingerprint: FingerprintSettings {
                algorithm: FingerprintAlgorithm::RdkitMorganBitV1,
                rdkit_version: RdkitBaselineVersion::V2025_03_4,
                radius: 2,
                bit_count: 2_048,
                use_chirality: true,
                use_features: false,
                sanitize: true,
                input_order: FingerprintInputOrder::SourceRecord,
            },
            similarity: SimilaritySettings {
                cutoff: SimilarityCutoff {
                    numerator: 7,
                    denominator: 10,
                },
            },
            representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
        },
        execution_policy: ExecutionPolicy {
            backend_policy: BackendPolicy::GpuPreferred,
            scheduling_policy: SchedulingPolicy::Throughput,
        },
        limits: ResourceLimits {
            max_edges: 1_000,
            max_memory_bytes: 64 * 1024 * 1024,
            max_dispatch_ms: 250,
        },
    };
    let queued = coordinator
        .submit_cluster_v1(
            "main",
            &request,
            registry
                .acquire_snapshot_lease("main:cluster-e2e")
                .expect("lease Grid for submission"),
        )
        .expect("submit cluster job");
    let mut fingerprint_step = coordinator
        .begin_cluster_v1_execution(
            "main",
            queued.job_id,
            queued.revision,
            registry
                .acquire_snapshot_lease("main:cluster-e2e")
                .expect("lease Grid for execution"),
        )
        .expect("begin fingerprint stage");
    while let Some(chunk) = fingerprint_step.fingerprint_chunk.take() {
        let records = chunk
            .records
            .iter()
            .map(|record| {
                let mut fingerprint = vec![0_u8; burrete_compute_core::FINGERPRINT_BYTES];
                fingerprint[if record.ordinal < 2 { 0 } else { 1 }] = 1;
                crate::compute::fingerprint_session::FingerprintOutputRecord {
                    ordinal: record.ordinal,
                    source_record_id: record.source_record_id,
                    molecule_content_sha256: record.molecule_content_sha256.clone(),
                    fingerprint_base64: Some(STANDARD.encode(fingerprint)),
                    error: None,
                }
            })
            .collect();
        fingerprint_step = coordinator
            .submit_fingerprint_chunk(
                "main",
                FingerprintChunkResult {
                    session_id: chunk.session_id,
                    job_id: chunk.job_id,
                    start_ordinal: chunk.start_ordinal,
                    records,
                },
            )
            .expect("submit fingerprint chunk");
    }
    assert!(fingerprint_step.ready_for_compute);
    let execution = coordinator
        .execute_cluster_v1("main", queued.job_id, fingerprint_step.job.revision)
        .expect("execute cluster job");
    assert_eq!(execution.cluster_count, 2);
    assert_eq!(execution.successful_records, 3);
    let publication = coordinator
        .publish_cluster_v1("main", queued.job_id, execution.job.revision)
        .expect("publish cluster job");
    assert!(publication.grid_applied, "{:?}", publication.grid_warning);
    assert_eq!(publication.job.state, JobState::Succeeded);
    coordinator
        .get_artifact_manifest("main", publication.artifact_id)
        .expect("read published artifact manifest");

    let page = registry
        .fetch_page(
            "main:cluster-e2e",
            &GridQuery {
                query: String::new(),
                sort: "index".into(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                analysis_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch Grid result columns");
    assert_eq!(page.analysis_columns.len(), 3);
    assert!(page
        .rows
        .iter()
        .all(|row| row.analyses.contains_key("clusterId")));
    assert_eq!(
        page.rows
            .iter()
            .filter(|row| {
                row.analyses
                    .get("isRepresentative")
                    .is_some_and(|cell| cell.value == serde_json::json!(true))
            })
            .count(),
        2
    );

    drop(coordinator);
    drop(registry);
    let _ = std::fs::remove_dir_all(compute_root);
    let _ = std::fs::remove_dir_all(grid_root);
}
