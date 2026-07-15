use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{symlink, PermissionsExt},
    path::Path,
    sync::{Arc, Barrier},
};

use burrete_compute_protocol::{
    AllGridScope, AnalysisFilter, CapabilityMaturity, DescriptorFilter, FilteredGridScope,
    GridScope, GridTextQuery, MolecularSnapshotRecordV1, RepresentativePolicy, SelectedGridScope,
    WorkflowTemplateId, MOLECULAR_RECORDS_FILE_PATH,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    grid_analysis::{
        apply_analysis_run, GridAnalysisApplyInput, GridAnalysisValue, GridAnalysisValueInput,
    },
    grid_database::open_grid_database_read_only,
    grid_identity,
    grid_snapshot::{freeze_grid_scope, FrozenGridSnapshot},
    grid_store::{
        build_grid_store, replace_descriptor_values_in_database, GridDescriptorValueInput,
    },
    snapshot_fs::{PublishedSnapshotRoot, SnapshotPublicationRoot, SnapshotStaging},
};

fn temporary_root(label: &str) -> std::path::PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .expect("resolve physical temporary root")
        .join(format!("burrete-{label}-{}", Uuid::new_v4()))
}

fn build_fixture(root: &Path) -> std::path::PathBuf {
    fs::create_dir_all(root).expect("create Grid runtime root");
    build_grid_store(root, "smi", b"CC Ethane\nO Water\nc1ccccc1 Benzene\n")
        .expect("build Grid store")
        .expect("create Grid collection")
        .database_path
}

fn publication_root(path: &Path) -> SnapshotPublicationRoot {
    SnapshotPublicationRoot::create(path).expect("create snapshot publication capability")
}

fn snapshot_bytes(snapshot_root: &PublishedSnapshotRoot, relative_path: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    snapshot_root
        .open_file(relative_path)
        .expect("open snapshot file through capability")
        .read_to_end(&mut bytes)
        .expect("read snapshot file through capability");
    bytes
}

fn source_ids(snapshot_root: &PublishedSnapshotRoot) -> Vec<u64> {
    snapshot_bytes(snapshot_root, "pack/source-record-ids.bin")
        .chunks_exact(8)
        .map(|chunk| u64::from_le_bytes(chunk.try_into().expect("eight-byte source ID")))
        .collect()
}

fn molecular_records(snapshot_root: &PublishedSnapshotRoot) -> Vec<MolecularSnapshotRecordV1> {
    let bytes = snapshot_bytes(snapshot_root, MOLECULAR_RECORDS_FILE_PATH);
    assert_eq!(bytes.last(), Some(&b'\n'));
    bytes
        .split_inclusive(|byte| *byte == b'\n')
        .map(|line| {
            let record: MolecularSnapshotRecordV1 =
                serde_json::from_slice(line).expect("decode molecular snapshot record");
            assert_eq!(
                record
                    .canonical_json_line_bytes()
                    .expect("canonicalize molecular snapshot record"),
                line
            );
            record
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_bytes(&Sha256::digest(bytes))
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn assert_snapshot_integrity(frozen: &FrozenGridSnapshot) {
    for descriptor in &frozen.manifest.layout.files {
        let bytes = snapshot_bytes(&frozen.root, &descriptor.relative_path);
        assert_eq!(bytes.len() as u64, descriptor.byte_length);
        assert_eq!(sha256_hex(&bytes), descriptor.sha256);
    }

    let manifest_bytes = snapshot_bytes(&frozen.root, "snapshot/manifest.json");
    assert_eq!(
        manifest_bytes.len() as u64,
        frozen.reference.manifest.byte_length
    );
    assert_eq!(
        sha256_hex(&manifest_bytes),
        frozen.reference.manifest.sha256
    );
    assert_eq!(
        manifest_bytes,
        frozen
            .manifest
            .canonical_json_bytes()
            .expect("canonical snapshot manifest")
    );

    let records = molecular_records(&frozen.root);
    let source_ids = source_ids(&frozen.root);
    let molecule_hashes = snapshot_bytes(&frozen.root, "pack/molecule-content-hashes.bin");
    assert_eq!(source_ids.len(), records.len());
    assert_eq!(molecule_hashes.len(), records.len() * 32);
    for ((record, source_id), molecule_hash) in records
        .iter()
        .zip(source_ids)
        .zip(molecule_hashes.chunks_exact(32))
    {
        assert_eq!(record.source_record_id, source_id);
        assert_eq!(record.molecule_content_sha256, hex_bytes(molecule_hash));
    }
}

#[test]
fn freezes_selected_filtered_and_all_scopes_independently_of_grid_lifetime() {
    let runtime_root = temporary_root("grid-snapshot-runtime");
    let output_root = temporary_root("grid-snapshot-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let scopes = [
        (
            GridScope::Selected(SelectedGridScope {
                source_indexes: vec![0, 2],
            }),
            vec![0, 2],
        ),
        (
            GridScope::Filtered(FilteredGridScope {
                query: GridTextQuery::Text {
                    text: "  WATER  ".into(),
                },
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                analysis_filters: Vec::new(),
            }),
            vec![1],
        ),
        (GridScope::All(AllGridScope {}), vec![0, 1, 2]),
    ];

    let mut snapshots = Vec::new();
    for (ordinal, (scope, expected_ids)) in scopes.into_iter().enumerate() {
        let snapshot_id = Uuid::new_v4();
        let frozen = freeze_grid_scope(
            &database_path,
            &scope,
            &publication_root,
            snapshot_id,
            100 + ordinal as u64,
        )
        .expect("freeze Grid scope");
        assert_eq!(
            frozen.manifest.frozen_source.record_count,
            expected_ids.len() as u64
        );
        frozen
            .manifest
            .validate_snapshot_sha256()
            .expect("validate snapshot content identity");
        assert_snapshot_integrity(&frozen);
        assert_eq!(frozen.reference.snapshot_id, frozen.manifest.snapshot_id);
        assert_eq!(source_ids(&frozen.root), expected_ids);
        assert_eq!(
            molecular_records(&frozen.root)
                .iter()
                .map(|record| record.source_record_id)
                .collect::<Vec<_>>(),
            expected_ids
        );
        assert!(frozen.root.open_file("snapshot/manifest.json").is_ok());
        snapshots.push(frozen.root);
    }

    fs::remove_dir_all(&runtime_root).expect("close transient Grid runtime");
    for snapshot in snapshots {
        assert!(snapshot.open_file("snapshot/manifest.json").is_ok());
        assert!(snapshot.path().join("snapshot/manifest.json").is_file());
    }
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn freezes_shared_descriptor_and_analysis_predicates() {
    let runtime_root = temporary_root("grid-snapshot-analysis-runtime");
    let output_root = temporary_root("grid-snapshot-analysis-output");
    let database_path = build_fixture(&runtime_root);
    let connection = open_grid_database_read_only(&database_path).expect("open Grid fixture");
    let source_identity = grid_identity::read_source_identity(&connection)
        .expect("read Grid fixture source identity");
    let molecules = {
        let mut statement = connection
            .prepare(
                "select id, source_index, molecule_content_sha256
                 from molecules order by source_index",
            )
            .expect("prepare Grid fixture identity query");
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .expect("query Grid fixture identities")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect Grid fixture identities")
    };
    drop(connection);

    for (molecule, descriptor) in molecules.iter().zip([0.5, 2.0, 3.0]) {
        replace_descriptor_values_in_database(
            &database_path,
            molecule.0,
            &[GridDescriptorValueInput {
                id: "logP".into(),
                label: "logP".into(),
                value: Some(serde_json::json!(descriptor)),
                missing_kind: None,
                error_text: None,
            }],
        )
        .expect("write Grid fixture descriptor");
    }

    let run_id = Uuid::new_v4();
    apply_analysis_run(
        &database_path,
        &GridAnalysisApplyInput {
            run_id,
            workflow_template: WorkflowTemplateId::ClusterV1,
            document_fingerprint_sha256: source_identity.document_fingerprint_sha256,
            source_revision: source_identity.source_revision,
            snapshot_id: Uuid::new_v4(),
            snapshot_sha256: "1".repeat(64),
            normalized_settings_sha256: "2".repeat(64),
            maturity: CapabilityMaturity::Experimental,
            representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
            provenance: serde_json::json!({"fixture": "grid snapshot predicate"}),
            created_at_ms: 100,
            values: molecules
                .iter()
                .zip([5.0, 15.0, 25.0])
                .map(|(molecule, score)| GridAnalysisValueInput {
                    molecule_id: molecule.0,
                    source_index: molecule.1,
                    molecule_content_sha256: molecule.2.clone(),
                    value_id: "clusterScore".into(),
                    value: GridAnalysisValue::Real(score),
                })
                .collect(),
            artifacts: Vec::new(),
        },
    )
    .expect("apply Grid fixture analysis");

    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::Filtered(FilteredGridScope {
            query: GridTextQuery::Text {
                text: String::new(),
            },
            column_filters: Vec::new(),
            descriptor_filters: vec![DescriptorFilter {
                id: "logP".into(),
                min: Some(1.5),
                max: Some(2.5),
            }],
            analysis_filters: vec![AnalysisFilter {
                run_id,
                value_id: "clusterScore".into(),
                min: Some(10.0),
                max: Some(20.0),
            }],
        }),
        &publication_root(&output_root),
        Uuid::new_v4(),
        101,
    )
    .expect("freeze descriptor and analysis filtered scope");
    assert_eq!(source_ids(&frozen.root), vec![1]);
    assert_snapshot_integrity(&frozen);

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn rejects_missing_selected_rows_and_frontend_only_edits_without_publication() {
    let runtime_root = temporary_root("grid-snapshot-conflict-runtime");
    let output_root = temporary_root("grid-snapshot-conflict-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let missing_snapshot_id = Uuid::new_v4();
    let missing_destination = publication_root.destination_path(missing_snapshot_id);
    let missing = GridScope::Selected(SelectedGridScope {
        source_indexes: vec![0, 99],
    });
    assert!(freeze_grid_scope(
        &database_path,
        &missing,
        &publication_root,
        missing_snapshot_id,
        100,
    )
    .is_err());
    assert!(!missing_destination.exists());

    assert_eq!(
        grid_identity::mark_virtual_edit(&database_path).expect("mark virtual edit"),
        1
    );
    let edited_snapshot_id = Uuid::new_v4();
    let edited_destination = publication_root.destination_path(edited_snapshot_id);
    assert!(freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        edited_snapshot_id,
        101,
    )
    .is_err());
    assert!(!edited_destination.exists());

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn rejects_symlink_components_and_a_swapped_publication_root() {
    let container = temporary_root("grid-snapshot-symlink-root");
    let real_parent = container.join("real-parent");
    let real_root = real_parent.join("snapshots");
    fs::create_dir_all(&real_root).expect("create real publication root");
    fs::set_permissions(&real_root, fs::Permissions::from_mode(0o700))
        .expect("make real publication root private");
    symlink(&real_parent, container.join("linked-parent")).expect("create intermediate symlink");

    assert!(SnapshotPublicationRoot::open(&container.join("linked-parent/snapshots")).is_err());

    let capability = SnapshotPublicationRoot::open(&real_root).expect("open real root capability");
    let moved_root = container.join("moved-snapshots");
    fs::rename(&real_root, &moved_root).expect("move publication root");
    symlink(&moved_root, &real_root).expect("replace publication root with symlink");
    assert!(SnapshotStaging::create(&capability, Uuid::new_v4()).is_err());

    let _ = fs::remove_file(real_root);
    let _ = fs::remove_dir_all(container);
}

#[test]
fn published_capability_survives_locator_root_replacement() {
    let container = temporary_root("grid-snapshot-published-capability");
    fs::create_dir_all(&container).expect("create capability container");
    let root_path = container.join("snapshots");
    let root = publication_root(&root_path);
    let snapshot_id = Uuid::new_v4();
    let staging = SnapshotStaging::create(&root, snapshot_id).expect("create snapshot staging");
    let mut manifest = staging
        .create_manifest_file()
        .expect("create capability test manifest");
    manifest
        .write_all(b"original")
        .expect("write capability test manifest");
    manifest.sync_all().expect("sync capability test manifest");
    staging
        .sync_directories()
        .expect("sync capability test directories");
    let published = staging.publish().expect("publish capability test snapshot");

    let moved_root = container.join("moved-snapshots");
    fs::rename(&root_path, &moved_root).expect("move published root");
    fs::create_dir(&root_path).expect("create replacement root");
    fs::set_permissions(&root_path, fs::Permissions::from_mode(0o700))
        .expect("make replacement root private");
    let replacement_snapshot = root_path.join(format!("snapshot-{snapshot_id}/snapshot"));
    fs::create_dir_all(&replacement_snapshot).expect("create replacement snapshot tree");
    fs::write(replacement_snapshot.join("manifest.json"), b"replacement")
        .expect("write replacement snapshot manifest");

    assert_eq!(
        snapshot_bytes(&published, "snapshot/manifest.json"),
        b"original"
    );
    assert_eq!(
        fs::read(published.path().join("snapshot/manifest.json"))
            .expect("read diagnostic replacement path"),
        b"replacement"
    );

    let _ = fs::remove_dir_all(container);
}

#[test]
fn rejects_broken_and_existing_destinations_without_modifying_them() {
    let root_path = temporary_root("grid-snapshot-existing-destination");
    let capability = publication_root(&root_path);

    let broken_id = Uuid::new_v4();
    let broken_path = capability.destination_path(broken_id);
    symlink("missing-snapshot-target", &broken_path).expect("create broken destination symlink");
    assert!(SnapshotStaging::create(&capability, broken_id).is_err());
    assert!(fs::symlink_metadata(&broken_path)
        .expect("inspect broken destination")
        .file_type()
        .is_symlink());

    let empty_id = Uuid::new_v4();
    let empty_path = capability.destination_path(empty_id);
    fs::create_dir(&empty_path).expect("create existing empty destination");
    assert!(SnapshotStaging::create(&capability, empty_id).is_err());
    assert_eq!(
        fs::read_dir(&empty_path)
            .expect("read existing empty destination")
            .count(),
        0
    );

    let nonempty_id = Uuid::new_v4();
    let nonempty_path = capability.destination_path(nonempty_id);
    fs::create_dir(&nonempty_path).expect("create existing nonempty destination");
    fs::write(nonempty_path.join("sentinel"), b"preserve")
        .expect("write existing destination sentinel");
    assert!(SnapshotStaging::create(&capability, nonempty_id).is_err());
    assert_eq!(
        fs::read(nonempty_path.join("sentinel")).expect("read preserved sentinel"),
        b"preserve"
    );

    let _ = fs::remove_dir_all(root_path);
}

#[test]
fn concurrent_publishers_never_replace_the_winner() {
    let root_path = temporary_root("grid-snapshot-concurrent-publish");
    drop(publication_root(&root_path));
    let snapshot_id = Uuid::new_v4();
    let barrier = Arc::new(Barrier::new(3));

    let outcomes = std::thread::scope(|scope| {
        let handles = (0..2)
            .map(|_| {
                let root_path = root_path.clone();
                let barrier = Arc::clone(&barrier);
                scope.spawn(move || {
                    let capability = SnapshotPublicationRoot::open(&root_path)
                        .expect("open concurrent publication capability");
                    let staging = SnapshotStaging::create(&capability, snapshot_id)
                        .expect("create concurrent staging root");
                    staging
                        .sync_directories()
                        .expect("sync concurrent staging directories");
                    barrier.wait();
                    staging.publish()
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("join concurrent publisher"))
            .collect::<Vec<_>>()
    });

    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    assert_eq!(
        outcomes.iter().filter(|outcome| outcome.is_err()).count(),
        1
    );
    let capability = SnapshotPublicationRoot::open(&root_path)
        .expect("reopen concurrent publication capability");
    let destination = capability.destination_path(snapshot_id);
    assert!(destination.join("pack").is_dir());
    assert!(destination.join("snapshot").is_dir());
    assert_eq!(
        fs::read_dir(&root_path)
            .expect("read concurrent publication root")
            .count(),
        1
    );

    let _ = fs::remove_dir_all(root_path);
}

#[test]
fn rejects_publication_roots_that_are_not_private() {
    let root_path = temporary_root("grid-snapshot-public-root");
    fs::create_dir_all(&root_path).expect("create public snapshot root");
    fs::set_permissions(&root_path, fs::Permissions::from_mode(0o755))
        .expect("make snapshot root public");

    let error = SnapshotPublicationRoot::open(&root_path)
        .expect_err("public snapshot roots must be rejected");
    assert!(error.contains("0700"));

    let _ = fs::remove_dir_all(root_path);
}
