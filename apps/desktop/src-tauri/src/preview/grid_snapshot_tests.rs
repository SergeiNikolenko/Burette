use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{symlink, PermissionsExt},
    path::Path,
    sync::{Arc, Barrier},
};

use burette_compute_protocol::{
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
    grid_snapshot::{
        freeze_grid_scope, plan_grid_scope_snapshot, prepare_grid_scope, FrozenGridSnapshot,
    },
    grid_store::{
        build_grid_store, replace_descriptor_values_in_database, GridDescriptorValueInput,
    },
    snapshot_fs::{
        PublishedSnapshotRoot, SnapshotPublicationRoot, SnapshotRootEntry, SnapshotStaging,
    },
};

fn temporary_root(label: &str) -> std::path::PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .expect("resolve physical temporary root")
        .join(format!("burette-{label}-{}", Uuid::new_v4()))
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
            Uuid::new_v4(),
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
fn prepared_snapshot_exposes_the_synced_boundary_before_atomic_publish() {
    let runtime_root = temporary_root("grid-snapshot-prepared-runtime");
    let output_root = temporary_root("grid-snapshot-prepared-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let scope = GridScope::All(AllGridScope {});
    let snapshot_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();
    let plan = plan_grid_scope_snapshot(&database_path, &scope).expect("plan snapshot");
    let prepared = prepare_grid_scope(
        &database_path,
        &scope,
        &publication_root,
        snapshot_id,
        attempt_id,
        150,
    )
    .expect("prepare snapshot");
    assert_eq!(prepared.reference().snapshot_id, snapshot_id);
    assert_eq!(prepared.reservation_bytes(), plan.reservation_bytes);
    assert!(prepared.payload_bytes() <= prepared.reservation_bytes());
    assert_eq!(
        publication_root.inventory().expect("staging inventory"),
        vec![SnapshotRootEntry::Staging {
            snapshot_id,
            attempt_id,
        }]
    );
    let reference = prepared.reference().clone();
    let frozen = prepared.publish().expect("publish prepared snapshot");
    assert_eq!(frozen.reference, reference);
    assert_eq!(
        publication_root.inventory().expect("published inventory"),
        vec![SnapshotRootEntry::Published { snapshot_id }]
    );
    assert_snapshot_integrity(&frozen);
    let _ = fs::remove_dir_all(runtime_root);
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
        Uuid::new_v4(),
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
        Uuid::new_v4(),
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
    assert!(SnapshotStaging::create(&capability, Uuid::new_v4(), Uuid::new_v4()).is_err());

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
    let staging = SnapshotStaging::create(&root, snapshot_id, Uuid::new_v4())
        .expect("create snapshot staging");
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
    assert!(SnapshotStaging::create(&capability, broken_id, Uuid::new_v4()).is_err());
    assert!(fs::symlink_metadata(&broken_path)
        .expect("inspect broken destination")
        .file_type()
        .is_symlink());

    let empty_id = Uuid::new_v4();
    let empty_path = capability.destination_path(empty_id);
    fs::create_dir(&empty_path).expect("create existing empty destination");
    assert!(SnapshotStaging::create(&capability, empty_id, Uuid::new_v4()).is_err());
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
    assert!(SnapshotStaging::create(&capability, nonempty_id, Uuid::new_v4()).is_err());
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
                    let staging = SnapshotStaging::create(&capability, snapshot_id, Uuid::new_v4())
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

#[test]
fn verifies_canonical_snapshot_on_the_retained_file_descriptors() {
    let runtime_root = temporary_root("grid-snapshot-verified-runtime");
    let output_root = temporary_root("grid-snapshot-verified-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        700,
    )
    .expect("freeze verified snapshot");
    let FrozenGridSnapshot {
        manifest,
        reference,
        root,
    } = frozen;
    let retained_pack_path = root.path().join("pack/source-record-ids.bin");

    let mut verified = root.verify(&reference).expect("verify snapshot capability");
    assert_eq!(verified.snapshot_id(), reference.snapshot_id);
    assert_eq!(verified.reference(), &reference);
    assert_eq!(verified.manifest(), &manifest);
    verified
        .reverify()
        .expect("reverify retained snapshot descriptors");
    fs::OpenOptions::new()
        .write(true)
        .open(retained_pack_path)
        .expect("open verified pack for mutation")
        .write_all(&[0xfe])
        .expect("mutate verified pack after initial hash");
    assert!(verified.reverify().is_err());

    drop(verified);
    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn reverify_rejects_an_identical_file_entry_swap_after_hashing() {
    let runtime_root = temporary_root("snapshot-file-swap-runtime");
    let output_root = temporary_root("snapshot-file-swap-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        706,
    )
    .expect("freeze file swap fixture");
    let file_path = frozen.root.path().join("pack/source-record-ids.bin");
    let replacement_path = output_root
        .parent()
        .expect("snapshot output parent")
        .join(format!("burette-snapshot-file-swap-{}", Uuid::new_v4()));
    let mut verified = frozen
        .root
        .verify(&frozen.reference)
        .expect("hash snapshot before file entry swap");
    fs::write(
        &replacement_path,
        fs::read(&file_path).expect("read verified file bytes"),
    )
    .expect("write identical replacement file");
    fs::set_permissions(&replacement_path, fs::Permissions::from_mode(0o600))
        .expect("make identical replacement file private");
    fs::rename(&replacement_path, &file_path).expect("replace verified file directory entry");

    let error = verified
        .reverify()
        .expect_err("identical bytes at a different inode must fail structural recheck");
    assert!(error.contains("directory entry changed"));

    let _ = fs::remove_file(replacement_path);
    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn reverify_rejects_an_identical_content_directory_swap_after_hashing() {
    let runtime_root = temporary_root("snapshot-directory-swap-runtime");
    let output_root = temporary_root("snapshot-directory-swap-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        707,
    )
    .expect("freeze directory swap fixture");
    let pack_path = frozen.root.path().join("pack");
    let moved_pack_path = output_root
        .parent()
        .expect("snapshot output parent")
        .join(format!("burette-snapshot-pack-swap-{}", Uuid::new_v4()));
    let mut verified = frozen
        .root
        .verify(&frozen.reference)
        .expect("hash snapshot before content directory swap");
    fs::rename(&pack_path, &moved_pack_path).expect("move verified pack directory");
    fs::create_dir(&pack_path).expect("create replacement pack directory");
    fs::set_permissions(&pack_path, fs::Permissions::from_mode(0o700))
        .expect("make replacement pack directory private");
    for entry in fs::read_dir(&moved_pack_path).expect("enumerate verified pack files") {
        let entry = entry.expect("read verified pack entry");
        let replacement = pack_path.join(entry.file_name());
        fs::copy(entry.path(), &replacement).expect("copy identical pack file");
        fs::set_permissions(replacement, fs::Permissions::from_mode(0o600))
            .expect("make copied pack file private");
    }

    let error = verified
        .reverify()
        .expect_err("identical content at a different directory inode must fail recheck");
    assert!(error.contains("directory entry changed"));

    let _ = fs::remove_dir_all(moved_pack_path);
    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn verification_rejects_pack_corruption_and_unexpected_entries() {
    let runtime_root = temporary_root("grid-snapshot-corrupt-runtime");
    let output_root = temporary_root("grid-snapshot-corrupt-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        701,
    )
    .expect("freeze corruption fixture");
    let pack_file = frozen.root.path().join("pack/source-record-ids.bin");
    fs::OpenOptions::new()
        .write(true)
        .open(&pack_file)
        .expect("open pack file for corruption")
        .write_all(&[0xff])
        .expect("corrupt first pack byte");
    let error = frozen
        .root
        .verify(&frozen.reference)
        .expect_err("corrupt pack must fail verification");
    assert!(error.contains("hash differs"));

    let second = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        702,
    )
    .expect("freeze whitelist fixture");
    fs::write(
        second.root.path().join("pack/unexpected.bin"),
        b"unexpected",
    )
    .expect("write unexpected pack entry");
    let error = second
        .root
        .verify(&second.reference)
        .expect_err("unexpected pack entry must fail verification");
    assert!(error.contains("fixed whitelist"));

    let truncated = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        704,
    )
    .expect("freeze truncation fixture");
    fs::OpenOptions::new()
        .write(true)
        .open(truncated.root.path().join("pack/source-record-ids.bin"))
        .expect("open pack file for truncation")
        .set_len(0)
        .expect("truncate pack file");
    let error = truncated
        .root
        .verify(&truncated.reference)
        .expect_err("truncated pack must fail verification");
    assert!(error.contains("size differs"));

    let linked = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        705,
    )
    .expect("freeze symlink fixture");
    let linked_file = linked.root.path().join("pack/source-record-ids.bin");
    fs::remove_file(&linked_file).expect("remove pack file before symlink replacement");
    symlink("molecule-content-hashes.bin", &linked_file).expect("replace pack file with symlink");
    let error = linked
        .root
        .verify(&linked.reference)
        .expect_err("symlinked pack must fail verification");
    assert!(error.contains("Cannot open published snapshot file"));

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn verification_rejects_hardlinked_snapshot_files() {
    let runtime_root = temporary_root("grid-snapshot-hardlink-runtime");
    let output_root = temporary_root("grid-snapshot-hardlink-output");
    let database_path = build_fixture(&runtime_root);
    let publication_root = publication_root(&output_root);
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &publication_root,
        Uuid::new_v4(),
        Uuid::new_v4(),
        703,
    )
    .expect("freeze hardlink fixture");
    let link_path = output_root
        .parent()
        .expect("snapshot root parent")
        .join(format!("burette-snapshot-hardlink-{}", Uuid::new_v4()));
    fs::hard_link(
        frozen.root.path().join("pack/source-record-ids.bin"),
        &link_path,
    )
    .expect("create external hard link");

    let error = frozen
        .root
        .verify(&frozen.reference)
        .expect_err("hardlinked pack must fail verification");
    assert!(error.contains("must not have hard links"));

    let _ = fs::remove_file(link_path);
    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn inventory_is_canonical_bounded_and_fail_closed() {
    let output_root = temporary_root("snapshot-inventory");
    let root = publication_root(&output_root);
    let published_id = Uuid::new_v4();
    let staging_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();
    let published_path = output_root.join(format!("snapshot-{published_id}"));
    let staging_path = output_root.join(format!(".snapshot-{staging_id}.staging-{attempt_id}"));
    for path in [&published_path, &staging_path] {
        fs::create_dir(path).expect("create canonical inventory entry");
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .expect("make inventory entry private");
    }
    assert_eq!(
        root.inventory().expect("inventory canonical snapshot root"),
        vec![
            SnapshotRootEntry::Published {
                snapshot_id: published_id,
            },
            SnapshotRootEntry::Staging {
                snapshot_id: staging_id,
                attempt_id,
            },
        ]
    );

    let unknown = output_root.join("unexpected");
    fs::write(&unknown, b"unknown").expect("write unknown root entry");
    assert!(root.inventory().is_err());
    fs::remove_file(unknown).expect("remove unknown root entry");

    let noncanonical = output_root.join(format!(
        "snapshot-{}",
        Uuid::new_v4().to_string().to_uppercase()
    ));
    fs::create_dir(&noncanonical).expect("create noncanonical snapshot entry");
    fs::set_permissions(&noncanonical, fs::Permissions::from_mode(0o700))
        .expect("make noncanonical entry private");
    assert!(root.inventory().is_err());
    fs::remove_dir(noncanonical).expect("remove noncanonical snapshot entry");

    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn staging_leaf_is_deterministic_for_the_intent_pair() {
    let output_root = temporary_root("snapshot-staging-intent");
    let root = publication_root(&output_root);
    let snapshot_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();

    let staging = SnapshotStaging::create(&root, snapshot_id, attempt_id)
        .expect("create deterministic staging tree");
    assert_eq!(
        root.inventory().expect("inventory deterministic staging"),
        vec![SnapshotRootEntry::Staging {
            snapshot_id,
            attempt_id,
        }]
    );
    assert!(SnapshotStaging::create(&root, snapshot_id, attempt_id).is_err());
    drop(staging);
    assert!(root
        .inventory()
        .expect("inventory staging after drop cleanup")
        .is_empty());

    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn cleanup_staging_is_strict_prevalidated_and_idempotent() {
    let output_root = temporary_root("snapshot-staging-cleanup");
    let root = publication_root(&output_root);

    let snapshot_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();
    let staging_path = output_root.join(format!(".snapshot-{snapshot_id}.staging-{attempt_id}"));
    let pack_path = staging_path.join("pack");
    fs::create_dir(&staging_path).expect("create partial staging root");
    fs::set_permissions(&staging_path, fs::Permissions::from_mode(0o700))
        .expect("make partial staging root private");
    fs::create_dir(&pack_path).expect("create partial pack directory");
    fs::set_permissions(&pack_path, fs::Permissions::from_mode(0o700))
        .expect("make partial pack directory private");
    let partial_file = pack_path.join("source-record-ids.bin");
    fs::write(&partial_file, b"partial").expect("write partial staging file");
    fs::set_permissions(&partial_file, fs::Permissions::from_mode(0o644))
        .expect("make partial staging file initially unsafe");
    assert!(root.cleanup_staging(snapshot_id, attempt_id).is_err());
    assert!(partial_file.exists());
    fs::set_permissions(&partial_file, fs::Permissions::from_mode(0o600))
        .expect("make partial staging file private");
    root.cleanup_staging(snapshot_id, attempt_id)
        .expect("clean exact partial staging tree");
    assert!(!staging_path.exists());
    root.cleanup_staging(snapshot_id, attempt_id)
        .expect("repeat missing staging cleanup");

    let rejected_snapshot = Uuid::new_v4();
    let rejected_attempt = Uuid::new_v4();
    let rejected_path = output_root.join(format!(
        ".snapshot-{rejected_snapshot}.staging-{rejected_attempt}"
    ));
    let rejected_pack = rejected_path.join("pack");
    fs::create_dir(&rejected_path).expect("create rejected staging root");
    fs::set_permissions(&rejected_path, fs::Permissions::from_mode(0o700))
        .expect("make rejected staging root private");
    fs::create_dir(&rejected_pack).expect("create rejected pack directory");
    fs::set_permissions(&rejected_pack, fs::Permissions::from_mode(0o700))
        .expect("make rejected pack directory private");
    for (name, bytes) in [
        ("source-record-ids.bin", b"allowed".as_slice()),
        ("unexpected.bin", b"reject".as_slice()),
    ] {
        let path = rejected_pack.join(name);
        fs::write(&path, bytes).expect("write rejected staging content");
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .expect("make rejected staging content private");
    }
    assert!(root
        .cleanup_staging(rejected_snapshot, rejected_attempt)
        .is_err());
    assert!(rejected_pack.join("source-record-ids.bin").exists());
    assert!(rejected_pack.join("unexpected.bin").exists());

    let linked_snapshot = Uuid::new_v4();
    let linked_attempt = Uuid::new_v4();
    let linked_path = output_root.join(format!(
        ".snapshot-{linked_snapshot}.staging-{linked_attempt}"
    ));
    let linked_pack = linked_path.join("pack");
    fs::create_dir(&linked_path).expect("create hardlink staging root");
    fs::set_permissions(&linked_path, fs::Permissions::from_mode(0o700))
        .expect("make hardlink staging root private");
    fs::create_dir(&linked_pack).expect("create hardlink pack directory");
    fs::set_permissions(&linked_pack, fs::Permissions::from_mode(0o700))
        .expect("make hardlink pack directory private");
    let linked_file = linked_pack.join("source-record-ids.bin");
    fs::write(&linked_file, b"linked").expect("write hardlinked staging file");
    fs::set_permissions(&linked_file, fs::Permissions::from_mode(0o600))
        .expect("make hardlinked staging file private");
    let external_link = output_root
        .parent()
        .expect("snapshot root parent")
        .join(format!("burette-staging-hardlink-{}", Uuid::new_v4()));
    fs::hard_link(&linked_file, &external_link).expect("hardlink staging file externally");
    assert!(root
        .cleanup_staging(linked_snapshot, linked_attempt)
        .is_err());
    assert!(linked_file.exists());

    let symlink_snapshot = Uuid::new_v4();
    let symlink_attempt = Uuid::new_v4();
    let symlink_path = output_root.join(format!(
        ".snapshot-{symlink_snapshot}.staging-{symlink_attempt}"
    ));
    let symlink_pack = symlink_path.join("pack");
    fs::create_dir(&symlink_path).expect("create symlink staging root");
    fs::set_permissions(&symlink_path, fs::Permissions::from_mode(0o700))
        .expect("make symlink staging root private");
    fs::create_dir(&symlink_pack).expect("create symlink pack directory");
    fs::set_permissions(&symlink_pack, fs::Permissions::from_mode(0o700))
        .expect("make symlink pack directory private");
    let external_target = output_root
        .parent()
        .expect("snapshot root parent")
        .join(format!("burette-staging-symlink-{}", Uuid::new_v4()));
    fs::write(&external_target, b"external").expect("write external symlink target");
    fs::set_permissions(&external_target, fs::Permissions::from_mode(0o600))
        .expect("make external symlink target private");
    let staged_symlink = symlink_pack.join("source-record-ids.bin");
    symlink(&external_target, &staged_symlink).expect("create staged symlink");
    assert!(root
        .cleanup_staging(symlink_snapshot, symlink_attempt)
        .is_err());
    assert!(fs::symlink_metadata(&staged_symlink)
        .expect("inspect rejected staged symlink")
        .file_type()
        .is_symlink());

    let _ = fs::remove_file(external_link);
    let _ = fs::remove_file(external_target);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn opens_verifies_and_removes_published_snapshots_descriptor_relative() {
    let runtime_root = temporary_root("snapshot-observed-runtime");
    let output_root = temporary_root("snapshot-observed-output");
    let database_path = build_fixture(&runtime_root);
    let root = publication_root(&output_root);
    let snapshot_id = Uuid::new_v4();
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &root,
        snapshot_id,
        Uuid::new_v4(),
        800,
    )
    .expect("freeze observed snapshot");
    let expected = frozen.reference.clone();
    let expected_manifest = frozen.manifest.clone();
    drop(frozen.root);

    let observed = root
        .open_published(snapshot_id)
        .expect("open published snapshot descriptor-relative")
        .verify_observed()
        .expect("self-verify observed snapshot");
    assert_eq!(observed.reference(), &expected);
    assert_eq!(observed.manifest(), &expected_manifest);
    root.remove_verified(observed, Uuid::new_v4())
        .expect("remove same verified final capability");
    assert!(!root.destination_path(snapshot_id).exists());
    assert!(root.inventory().expect("inventory emptied root").is_empty());

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn cleanup_resumes_from_a_partially_removed_quarantined_snapshot() {
    let runtime_root = temporary_root("snapshot-cleanup-resume-runtime");
    let output_root = temporary_root("snapshot-cleanup-resume-output");
    let database_path = build_fixture(&runtime_root);
    let root = publication_root(&output_root);
    let snapshot_id = Uuid::new_v4();
    let cleanup_attempt_id = Uuid::new_v4();
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &root,
        snapshot_id,
        Uuid::new_v4(),
        802,
    )
    .expect("freeze cleanup resume snapshot");
    drop(frozen.root);
    let verified = root
        .open_published(snapshot_id)
        .expect("open cleanup resume snapshot")
        .verify_observed()
        .expect("verify cleanup resume snapshot");
    drop(verified);

    let final_path = root.destination_path(snapshot_id);
    let cleanup_path = output_root.join(format!(
        ".snapshot-{snapshot_id}.staging-{cleanup_attempt_id}"
    ));
    fs::rename(&final_path, &cleanup_path).expect("simulate durable cleanup quarantine rename");
    assert_eq!(
        root.inventory().expect("inventory quarantined snapshot"),
        vec![SnapshotRootEntry::Staging {
            snapshot_id,
            attempt_id: cleanup_attempt_id,
        }]
    );

    fs::remove_file(cleanup_path.join("pack/source-record-ids.bin"))
        .expect("simulate interrupted pack cleanup");
    fs::remove_file(cleanup_path.join("snapshot/manifest.json"))
        .expect("simulate interrupted manifest cleanup");
    fs::remove_dir(cleanup_path.join("snapshot"))
        .expect("simulate interrupted snapshot directory cleanup");
    root.cleanup_staging(snapshot_id, cleanup_attempt_id)
        .expect("resume strict cleanup from the partial allowed tree");
    assert!(root
        .inventory()
        .expect("inventory after resumed cleanup")
        .is_empty());

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn remove_verified_never_replaces_a_cleanup_staging_collision() {
    let runtime_root = temporary_root("snapshot-cleanup-collision-runtime");
    let output_root = temporary_root("snapshot-cleanup-collision-output");
    let database_path = build_fixture(&runtime_root);
    let root = publication_root(&output_root);
    let snapshot_id = Uuid::new_v4();
    let cleanup_attempt_id = Uuid::new_v4();
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &root,
        snapshot_id,
        Uuid::new_v4(),
        803,
    )
    .expect("freeze cleanup collision snapshot");
    drop(frozen.root);

    let verified = root
        .open_published(snapshot_id)
        .expect("open snapshot before nil cleanup attempt")
        .verify_observed()
        .expect("verify snapshot before nil cleanup attempt");
    assert!(root.remove_verified(verified, Uuid::nil()).is_err());
    assert!(root.destination_path(snapshot_id).exists());

    let cleanup_path = output_root.join(format!(
        ".snapshot-{snapshot_id}.staging-{cleanup_attempt_id}"
    ));
    fs::create_dir(&cleanup_path).expect("create colliding cleanup staging directory");
    fs::set_permissions(&cleanup_path, fs::Permissions::from_mode(0o700))
        .expect("make colliding cleanup staging directory private");
    let verified = root
        .open_published(snapshot_id)
        .expect("reopen snapshot before cleanup collision")
        .verify_observed()
        .expect("reverify snapshot before cleanup collision");
    assert!(root.remove_verified(verified, cleanup_attempt_id).is_err());
    assert!(root.destination_path(snapshot_id).exists());
    assert!(cleanup_path.exists());
    root.open_published(snapshot_id)
        .expect("published snapshot survives cleanup collision")
        .verify_observed()
        .expect("published snapshot remains valid after cleanup collision");

    root.cleanup_staging(snapshot_id, cleanup_attempt_id)
        .expect("remove colliding empty cleanup staging directory");
    let verified = root
        .open_published(snapshot_id)
        .expect("reopen snapshot after resolving cleanup collision")
        .verify_observed()
        .expect("reverify snapshot after resolving cleanup collision");
    root.remove_verified(verified, Uuid::new_v4())
        .expect("remove snapshot after resolving cleanup collision");

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}

#[test]
fn remove_verified_rejects_a_replaced_final_leaf() {
    let runtime_root = temporary_root("snapshot-remove-swap-runtime");
    let output_root = temporary_root("snapshot-remove-swap-output");
    let database_path = build_fixture(&runtime_root);
    let root = publication_root(&output_root);
    let snapshot_id = Uuid::new_v4();
    let frozen = freeze_grid_scope(
        &database_path,
        &GridScope::All(AllGridScope {}),
        &root,
        snapshot_id,
        Uuid::new_v4(),
        801,
    )
    .expect("freeze removable snapshot");
    drop(frozen.root);
    let verified = root
        .open_published(snapshot_id)
        .expect("open removable snapshot")
        .verify_observed()
        .expect("verify removable snapshot");

    let final_path = root.destination_path(snapshot_id);
    let moved_path = output_root.join(format!("moved-snapshot-{snapshot_id}"));
    fs::rename(&final_path, &moved_path).expect("move verified final leaf");
    fs::create_dir(&final_path).expect("create replacement final leaf");
    fs::set_permissions(&final_path, fs::Permissions::from_mode(0o700))
        .expect("make replacement final leaf private");
    assert!(root.remove_verified(verified, Uuid::new_v4()).is_err());
    assert!(final_path.exists());
    assert!(moved_path.exists());

    let _ = fs::remove_dir_all(runtime_root);
    let _ = fs::remove_dir_all(output_root);
}
