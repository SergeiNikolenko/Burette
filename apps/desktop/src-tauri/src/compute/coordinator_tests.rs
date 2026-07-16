use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use burrete_compute_protocol::{
    AllGridScope, ClusterV1Parameters, ComputeJobSchemaVersion, ConformerResourceLimits,
    ConformerV1Parameters, ConformerV1SubmitRequest, ConformerVariant, EnginePackManifest,
    ExecutionPolicy, FingerprintAlgorithm, FingerprintInputOrder, FingerprintSettings, GridScope,
    GridSourceReference, RdkitBaselineVersion, RepresentativePolicy, ResourceLimits,
    ResultPackManifest, SchedulingPolicy, SimilarityCutoff, SimilaritySettings, StageState,
    CONFORMER_RESULT_ARRAY_NAMES, MIN_COMPUTE_MEMORY_BYTES,
};

use crate::compute::similarity_search::SimilaritySearchRequest;
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
fn conformer_submission_streams_raw_extraction_into_a_durable_job() {
    let fixture_id = Uuid::new_v4();
    let temp_root = std::fs::canonicalize(std::env::temp_dir()).expect("canonical temp root");
    let compute_root = temp_root.join(format!("burrete-conformer-submit-{fixture_id}"));
    let grid_root = temp_root.join(format!("burrete-conformer-grid-{fixture_id}"));
    std::fs::create_dir_all(&grid_root).expect("create Grid fixture directory");
    let handle = build_grid_store(&grid_root, "csv", b"smiles,name\nCC,Ethane\nCO,Methanol\n")
        .expect("build Grid fixture")
        .expect("Grid fixture is supported");
    let registry = GridRuntimeRegistry::default();
    registry
        .register(
            "main:conformer-submit",
            handle.database_path,
            "csv",
            handle.cancel_token,
        )
        .expect("register Grid fixture");
    let viewer_root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../PreviewExtension/Web");
    let coordinator = ComputeCoordinator::initialize(compute_root.clone(), None, Some(viewer_root));
    let request = ConformerV1SubmitRequest {
        schema_version: ComputeJobSchemaVersion::V1,
        workflow_template: WorkflowTemplateId::ConformerV1,
        source: GridSourceReference {
            document_id: "conformer-submit".into(),
            scope: GridScope::All(AllGridScope {}),
        },
        parameters: ConformerV1Parameters {
            variant: ConformerVariant::EtkdgV3,
            conformers_per_molecule: 3,
            max_attempts_per_conformer: 2,
        },
        execution_policy: ExecutionPolicy {
            backend_policy: BackendPolicy::ReferenceCpu,
            scheduling_policy: SchedulingPolicy::Throughput,
        },
        limits: ConformerResourceLimits {
            max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
            max_dispatch_ms: 250,
            max_conformers_per_batch: 8,
        },
    };
    let mut step = coordinator
        .begin_conformer_v1_submission(
            "main",
            &request,
            registry
                .acquire_snapshot_lease("main:conformer-submit")
                .expect("lease Grid source"),
        )
        .expect("begin conformer submission");
    while let Some(chunk) = step.conformer_chunk.take() {
        let envelope = conformer_result_envelope(&chunk);
        step = coordinator
            .submit_conformer_extraction_chunk("main", &envelope)
            .expect("submit raw extraction result");
    }
    assert!(step.ready_for_execution);
    let job = step.job.expect("durable conformer job");
    assert_eq!(job.state, JobState::Queued);
    assert_eq!(job.workflow_template, WorkflowTemplateId::ConformerV1);
    assert_eq!(job.frozen_source.frozen_source.record_count, 2);
    assert_eq!(coordinator.get_job("main", job.job_id).unwrap(), job);
    let prepared = coordinator
        .ready()
        .unwrap()
        .prepared_conformers
        .lock()
        .unwrap();
    let batch = prepared
        .get(&job.job_id)
        .expect("prepared conformer arrays");
    assert_eq!(batch.arrays.record_count(), 2);
    assert_eq!(batch.identities.len(), 2);
    assert!(batch.errors.iter().all(Option::is_none));
    drop(prepared);
    let execution = coordinator
        .execute_conformer_distance_v1("main", job.job_id, job.revision)
        .expect("execute reference distance geometry");
    assert_eq!(execution.conformer_count, 6);
    assert_eq!(execution.failed_source_records, 0);
    assert!(execution.ready_for_stereo);
    assert_eq!(execution.job.stages[2].state, StageState::Succeeded);
    assert_eq!(
        execution.job.stages[2].effective_backend,
        Backend::ReferenceCpu
    );
    assert_eq!(execution.job.stages[3].state, StageState::Queued);
    let stereo = coordinator
        .execute_conformer_stereo_v1("main", job.job_id, execution.job.revision)
        .expect("execute reference stereo validation");
    assert_eq!(stereo.conformer_count, 6);
    assert_eq!(stereo.passed_count, 6);
    assert_eq!(stereo.failed_count, 0);
    assert!(stereo.ready_for_validation);
    assert_eq!(stereo.job.stages[3].state, StageState::Succeeded);
    assert_eq!(
        stereo.job.stages[3].effective_backend,
        Backend::ReferenceCpu
    );
    assert_eq!(stereo.job.stages[4].state, StageState::Queued);
    let validation = coordinator
        .validate_conformer_reference_v1("main", job.job_id, stereo.job.revision)
        .expect("validate conformers against CPU reference");
    assert_eq!(validation.conformer_count, 6);
    assert_eq!(validation.passed_count, 6);
    assert_eq!(validation.failed_count, 0);
    assert!(validation.ready_for_publication);
    assert_eq!(validation.job.state, JobState::Publishing);
    assert_eq!(validation.job.stages[4].state, StageState::Succeeded);
    assert_eq!(validation.job.stages[5].state, StageState::Queued);
    let publication = coordinator
        .publish_conformer_v1(
            "main",
            job.job_id,
            validation.job.revision,
            registry
                .acquire_snapshot_lease("main:conformer-submit")
                .expect("lease conformer Grid for writeback"),
        )
        .expect("publish conformer packs");
    assert_eq!(publication.job.state, JobState::Succeeded);
    assert_eq!(publication.job.stages[5].state, StageState::Succeeded);
    assert_eq!(publication.job.artifact_ids, [publication.artifact_id]);
    assert!(publication.job.result_pack.is_some());
    assert_eq!(publication.artifact_manifest_sha256.len(), 64);
    assert!(publication.grid_applied, "{:?}", publication.grid_warning);
    let artifact_root = compute_root
        .join("artifacts")
        .join(format!("artifact-{}", publication.artifact_id));
    assert_eq!(
        publication.primary_open_path,
        artifact_root
            .join("result/conformers.xyz")
            .to_string_lossy()
    );
    assert_eq!(
        coordinator.get_job("main", job.job_id).unwrap(),
        publication.job
    );
    let engine_manifest: EnginePackManifest = serde_json::from_slice(
        &std::fs::read(artifact_root.join("engine/manifest.json"))
            .expect("read conformer EnginePack manifest"),
    )
    .expect("decode conformer EnginePack manifest");
    engine_manifest
        .validate()
        .expect("validate conformer EnginePack manifest");
    let result_manifest: ResultPackManifest = serde_json::from_slice(
        &std::fs::read(artifact_root.join("result/manifest.json"))
            .expect("read conformer ResultPack manifest"),
    )
    .expect("decode conformer ResultPack manifest");
    result_manifest
        .validate()
        .expect("validate conformer ResultPack manifest");
    assert_eq!(
        result_manifest
            .layout
            .arrays
            .iter()
            .map(|array| array.name.as_str())
            .collect::<Vec<_>>(),
        CONFORMER_RESULT_ARRAY_NAMES
    );
    let xyz = std::fs::read_to_string(&publication.primary_open_path)
        .expect("read published conformer XYZ");
    assert_eq!(xyz.matches("Burrete conformer molecule=").count(), 6);
    assert!(xyz.contains("etkEnergy="));
    assert!(xyz.contains("stereo=passed"));
    let page = registry
        .fetch_page(
            "main:conformer-submit",
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
        .expect("fetch conformer Grid result columns");
    assert_eq!(page.analysis_columns.len(), 4);
    assert!(page.analysis_columns.iter().any(|column| {
        column.run_id == publication.job.job_id.to_string()
            && column.value_id == "bestEtkEnergy"
            && column.label == "Best ETK energy"
    }));
    assert!(page.rows.iter().all(|row| {
        row.analyses.get("conformerCount").map(|cell| &cell.value) == Some(&serde_json::json!(3))
            && row
                .analyses
                .get("conformerPassedCount")
                .map(|cell| &cell.value)
                == Some(&serde_json::json!(3))
            && row.analyses.get("conformerStatus").map(|cell| &cell.value)
                == Some(&serde_json::json!("ok"))
            && row.analyses.contains_key("bestEtkEnergy")
    }));
    std::fs::remove_dir_all(compute_root).expect("remove compute fixture");
    std::fs::remove_dir_all(grid_root).expect("remove Grid fixture");
}

fn conformer_result_envelope(
    chunk: &crate::compute::conformer_session::ConformerInputChunk,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 40];
    bytes[..4].copy_from_slice(b"BCER");
    bytes[4..6].copy_from_slice(&1_u16.to_le_bytes());
    bytes[6..8].copy_from_slice(&40_u16.to_le_bytes());
    bytes[8..24].copy_from_slice(chunk.session_id.as_bytes());
    bytes[24..32].copy_from_slice(&chunk.start_ordinal.to_le_bytes());
    bytes[32..36].copy_from_slice(&(chunk.records.len() as u32).to_le_bytes());
    for record in &chunk.records {
        let payload = minimal_conformer_extract_fixture();
        bytes.extend(record.ordinal.to_le_bytes());
        bytes.extend(record.source_record_id.to_le_bytes());
        bytes.extend(decode_test_sha256(&record.molecule_content_sha256));
        bytes.extend([0; 4]);
        bytes.extend((payload.len() as u32).to_le_bytes());
        bytes.extend(payload);
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }
    let total = bytes.len() as u32;
    bytes[36..40].copy_from_slice(&total.to_le_bytes());
    bytes
}

fn minimal_conformer_extract_fixture() -> Vec<u8> {
    let mut bytes = vec![0_u8; 92];
    bytes[..4].copy_from_slice(b"BCEX");
    bytes[4..6].copy_from_slice(&1_u16.to_le_bytes());
    bytes[6..8].copy_from_slice(&64_u16.to_le_bytes());
    bytes[8] = 6;
    bytes[12..16].copy_from_slice(&2_u32.to_le_bytes());
    bytes[16..20].copy_from_slice(&1_u32.to_le_bytes());
    bytes[40..44].copy_from_slice(&28_u32.to_le_bytes());
    bytes[44..48].copy_from_slice(&92_u32.to_le_bytes());
    bytes[48..52].copy_from_slice(&20_250_304_u32.to_le_bytes());
    bytes[64..66].copy_from_slice(&6_u16.to_le_bytes());
    bytes[66..68].copy_from_slice(&1_u16.to_le_bytes());
    bytes[72..76].copy_from_slice(&0_u32.to_le_bytes());
    bytes[76..80].copy_from_slice(&1_u32.to_le_bytes());
    bytes[80..84].copy_from_slice(&1.0_f32.to_le_bytes());
    bytes[84..88].copy_from_slice(&2.0_f32.to_le_bytes());
    bytes[88..92].copy_from_slice(&1.0_f32.to_le_bytes());
    bytes
}

fn decode_test_sha256(value: &str) -> [u8; 32] {
    let mut bytes = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let nibble = |value: u8| match value {
            b'0'..=b'9' => value - b'0',
            b'a'..=b'f' => value - b'a' + 10,
            _ => panic!("invalid fixture SHA-256"),
        };
        bytes[index] = (nibble(pair[0]) << 4) | nibble(pair[1]);
    }
    bytes
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
    let coordinator =
        ComputeCoordinator::initialize(compute_root.clone(), None, Some(viewer_root.clone()));
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

    let similarity = coordinator
        .find_similar(
            "main",
            publication.job.job_id,
            registry
                .acquire_snapshot_lease("main:cluster-e2e")
                .expect("lease Grid for similarity search"),
            SimilaritySearchRequest {
                query_source_index: 0,
                top_k: 50,
                minimum_similarity: SimilarityCutoff {
                    numerator: 1,
                    denominator: 2,
                },
            },
        )
        .expect("find similar molecules from the verified EnginePack");
    assert_eq!(similarity.backend, Backend::ReferenceCpu);
    assert!(similarity.fallback_reason.is_some());
    assert_eq!(similarity.gpu_time_ms, None);
    assert_eq!(similarity.library_record_count, 3);
    assert_eq!(similarity.valid_record_count, 3);
    assert_eq!(similarity.qualified_match_count, 1);
    assert_eq!(similarity.matches.len(), 1);
    assert_eq!(similarity.matches[0].source_record_id, 1);
    assert_eq!(similarity.matches[0].intersection, 1);
    assert_eq!(similarity.matches[0].union, 1);
    assert!(similarity.grid_applied, "{:?}", similarity.grid_warning);
    let similarity_page = registry
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
        .expect("fetch cluster and similarity analysis columns");
    assert_eq!(similarity_page.analysis_columns.len(), 8);
    assert!(similarity_page.analysis_columns.iter().any(|column| {
        column.run_id == similarity.run_id.to_string()
            && column.value_id == "similarityToQuery"
            && column.label == "Tanimoto to query"
    }));
    assert_eq!(
        similarity_page.rows[0]
            .analyses
            .get("isSimilarityQuery")
            .map(|cell| &cell.value),
        Some(&serde_json::json!(true))
    );
    assert_eq!(
        similarity_page.rows[1]
            .analyses
            .get("similarityRank")
            .map(|cell| &cell.value),
        Some(&serde_json::json!(1))
    );
    assert!(similarity_page
        .rows
        .iter()
        .all(|row| row.analyses.contains_key("clusterId")));

    let export_root = temp_root.join(format!("burrete-cluster-export-e2e-{fixture_id}"));
    std::fs::create_dir(&export_root).expect("create representative export root");
    let export = coordinator
        .export_cluster_representatives(
            "main",
            publication.job.job_id,
            export_root.clone(),
            "cluster/e2e",
        )
        .expect("export immutable cluster representatives");
    assert_eq!(export.representative_count, 2);
    assert_eq!(export.sdf_record_count, 0);
    assert_eq!(export.smiles_record_count, 2);
    assert_eq!(export.table_only_record_count, 0);
    assert_eq!(export.structure_paths.len(), 1);
    let table = std::fs::read_to_string(&export.table_path).expect("read representative table");
    assert!(table.contains("Ethanol"));
    assert!(table.contains("Benzene"));
    assert!(!table.contains("Ethylamine"));
    let smiles =
        std::fs::read_to_string(&export.structure_paths[0]).expect("read representative SMILES");
    let structure_lines = smiles
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>();
    assert_eq!(structure_lines.len(), 2);
    assert!(structure_lines.iter().any(|line| line.starts_with("CCO\t")));
    assert!(structure_lines
        .iter()
        .any(|line| line.starts_with("c1ccccc1\t")));
    let report: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&export.report_path).expect("read representative provenance report"),
    )
    .expect("decode representative provenance report");
    assert_eq!(
        report["schemaVersion"],
        "burrete.cluster-representative-export.v1"
    );
    assert_eq!(report["representativeCount"], 2);
    assert_eq!(report["job"]["jobId"], publication.job.job_id.to_string());
    assert_eq!(
        report["artifact"]["artifactId"],
        publication.artifact_id.to_string()
    );
    assert_eq!(
        report["artifactManifestSha256"]
            .as_str()
            .expect("artifact manifest digest")
            .len(),
        64
    );
    assert_eq!(
        report["payloadFiles"]
            .as_array()
            .expect("payload file manifest")
            .len(),
        2
    );
    assert_eq!(export.report_sha256.len(), 64);

    drop(coordinator);
    let restarted =
        ComputeCoordinator::initialize(compute_root.clone(), None, Some(viewer_root.clone()));
    restarted
        .get_artifact_manifest("main", publication.artifact_id)
        .expect("recover the published artifact after restart");
    let restarted_export = restarted
        .export_cluster_representatives(
            "main",
            publication.job.job_id,
            export_root.clone(),
            "cluster/e2e",
        )
        .expect("export representatives after coordinator restart");
    assert_ne!(restarted_export.bundle_path, export.bundle_path);
    assert_eq!(
        std::fs::read(&restarted_export.table_path).expect("read restarted representative table"),
        std::fs::read(&export.table_path).expect("reread representative table")
    );
    let restarted_similarity = restarted
        .find_similar(
            "main",
            publication.job.job_id,
            registry
                .acquire_snapshot_lease("main:cluster-e2e")
                .expect("lease Grid for restarted similarity search"),
            SimilaritySearchRequest {
                query_source_index: 0,
                top_k: 1,
                minimum_similarity: SimilarityCutoff {
                    numerator: 1,
                    denominator: 2,
                },
            },
        )
        .expect("find similar molecules after coordinator restart");
    assert_eq!(restarted_similarity.matches[0].source_record_id, 1);
    let cluster_ids_path = compute_root
        .join("artifacts")
        .join(format!("artifact-{}", publication.artifact_id))
        .join("result/cluster-ids.bin");
    let cluster_ids = std::fs::read(&cluster_ids_path).expect("read cluster IDs before corruption");
    std::fs::write(&cluster_ids_path, b"corrupt").expect("corrupt one published artifact file");
    let export_error = restarted
        .export_cluster_representatives(
            "main",
            publication.job.job_id,
            export_root.clone(),
            "cluster/e2e",
        )
        .expect_err("representative export must reject corrupt ResultPack bytes");
    assert!(export_error
        .to_string()
        .contains("artifact file identity changed"));
    std::fs::write(&cluster_ids_path, cluster_ids).expect("restore cluster IDs");
    let fingerprints_path = compute_root
        .join("artifacts")
        .join(format!("artifact-{}", publication.artifact_id))
        .join("engine/fingerprints.bin");
    std::fs::write(&fingerprints_path, b"corrupt")
        .expect("corrupt the similarity fingerprint source");
    let similarity_error = restarted
        .find_similar(
            "main",
            publication.job.job_id,
            registry
                .acquire_snapshot_lease("main:cluster-e2e")
                .expect("lease Grid for corrupt similarity search"),
            SimilaritySearchRequest {
                query_source_index: 0,
                top_k: 1,
                minimum_similarity: SimilarityCutoff {
                    numerator: 1,
                    denominator: 2,
                },
            },
        )
        .expect_err("similarity search must reject corrupt EnginePack bytes");
    assert!(similarity_error
        .to_string()
        .contains("artifact file identity changed"));
    drop(restarted);
    let corrupt = ComputeCoordinator::initialize(compute_root.clone(), None, Some(viewer_root));
    assert_eq!(
        corrupt
            .capability_report()
            .expect("read unavailable capability report")
            .availability,
        ComputeAvailability::Unavailable
    );
    drop(corrupt);
    drop(registry);
    let _ = std::fs::remove_dir_all(compute_root);
    let _ = std::fs::remove_dir_all(grid_root);
    let _ = std::fs::remove_dir_all(export_root);
}
