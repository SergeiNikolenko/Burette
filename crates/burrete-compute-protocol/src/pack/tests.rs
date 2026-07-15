use super::*;
use crate::{ResultPackVersion, WorkflowTemplateId};
use uuid::Uuid;

fn hash(byte: char) -> String {
    byte.to_string().repeat(64)
}

fn file(path: &str, byte_length: u64, media_type: &str) -> PackedFileDescriptor {
    PackedFileDescriptor {
        relative_path: path.into(),
        sha256: hash('a'),
        byte_length,
        media_type: media_type.into(),
    }
}

fn array(
    name: &str,
    semantic: &str,
    dtype: PackedDType,
    shape: Vec<u64>,
    byte_offset: u64,
    byte_length: u64,
) -> PackedArrayDescriptor {
    let width = dtype.byte_width() as u32;
    PackedArrayDescriptor {
        name: name.into(),
        semantic: semantic.into(),
        unit: None,
        file_relative_path: "pack/data.bin".into(),
        dtype,
        shape,
        byte_order: if width == 1 {
            PackedByteOrder::NotApplicable
        } else {
            PackedByteOrder::LittleEndian
        },
        alignment: width,
        byte_offset,
        byte_length,
    }
}

fn frozen_source() -> FrozenSourceIdentity {
    FrozenSourceIdentity {
        document_fingerprint_sha256: hash('c'),
        source_revision: 7,
        record_count: 2,
        ordered_record_molecule_identity_sha256: hash('d'),
    }
}

fn molecular_manifest() -> MolecularSnapshotManifest {
    MolecularSnapshotManifest {
        schema_version: MolecularSnapshotVersion::V1,
        snapshot_id: Uuid::from_u128(1),
        snapshot_sha256: hash('b'),
        frozen_source: frozen_source(),
        layout: PackedLayout {
            files: vec![file("pack/data.bin", 80, "application/octet-stream")],
            arrays: vec![
                array(
                    MOLECULE_CONTENT_HASHES_ARRAY_NAME,
                    MOLECULE_CONTENT_HASHES_SEMANTIC,
                    PackedDType::U8,
                    vec![2, 32],
                    16,
                    64,
                ),
                array(
                    SOURCE_RECORD_IDS_ARRAY_NAME,
                    SOURCE_RECORD_IDS_SEMANTIC,
                    PackedDType::U64,
                    vec![2],
                    0,
                    16,
                ),
            ],
        },
        created_at_ms: 8,
    }
}

fn snapshot_ref() -> MolecularSnapshotRef {
    MolecularSnapshotRef::from_manifest(
        &molecular_manifest(),
        file("snapshot/manifest.json", 128, "application/json"),
    )
    .expect("derive molecular snapshot reference")
}

fn engine_manifest() -> EnginePackManifest {
    EnginePackManifest {
        schema_version: EnginePackVersion::ClusterV1,
        engine_pack_id: Uuid::from_u128(2),
        engine_pack_sha256: hash('e'),
        workflow_template: WorkflowTemplateId::ClusterV1,
        molecular_snapshot: snapshot_ref(),
        engine_id: "rdkitMorganBit".into(),
        engine_version: "2025.03.4".into(),
        normalized_settings_sha256: hash('f'),
        layout: PackedLayout {
            files: vec![file("pack/data.bin", 64, "application/octet-stream")],
            arrays: vec![array(
                "fingerprints",
                "morgan_fingerprint_bits",
                PackedDType::U64,
                vec![2, 4],
                0,
                64,
            )],
        },
        created_at_ms: 9,
    }
}

fn engine_ref() -> EnginePackRef {
    EnginePackRef::from_manifest(
        &engine_manifest(),
        file("engine/manifest.json", 128, "application/json"),
    )
    .expect("derive engine pack reference")
}

fn result_manifest() -> ResultPackManifest {
    ResultPackManifest {
        schema_version: ResultPackVersion::ClusterV1,
        result_pack_id: Uuid::from_u128(3),
        result_pack_sha256: hash('1'),
        job_id: Uuid::from_u128(4),
        workflow_template: WorkflowTemplateId::ClusterV1,
        molecular_snapshot: snapshot_ref(),
        engine_packs: vec![engine_ref()],
        layout: PackedLayout {
            files: vec![file("pack/data.bin", 18, "application/octet-stream")],
            arrays: vec![
                array("clusterIds", "cluster_id", PackedDType::U64, vec![2], 0, 16),
                array(
                    "representatives",
                    "is_representative",
                    PackedDType::Bool8,
                    vec![2],
                    16,
                    2,
                ),
            ],
        },
        created_at_ms: 10,
    }
}

#[test]
fn round_trips_and_binds_all_pack_contracts() {
    let molecular = molecular_manifest();
    let snapshot_ref = snapshot_ref();
    assert_eq!(snapshot_ref.validate_against_manifest(&molecular), Ok(()));

    let engine = engine_manifest();
    let engine_ref = engine_ref();
    assert_eq!(engine_ref.validate_against_manifest(&engine), Ok(()));

    let result = result_manifest();
    let result_ref = ResultPackRef::from_manifest(
        &result,
        file("result/manifest.json", 128, "application/json"),
    )
    .expect("derive result pack reference");
    assert_eq!(result_ref.validate_against_manifest(&result), Ok(()));

    let encoded = serde_json::to_vec(&result).expect("encode result pack manifest");
    let decoded: ResultPackManifest =
        serde_json::from_slice(&encoded).expect("decode result pack manifest");
    assert_eq!(decoded, result);
}

#[test]
fn molecular_snapshot_content_hash_excludes_job_identity() {
    let mut manifest = molecular_manifest();
    manifest
        .bind_computed_snapshot_sha256()
        .expect("bind snapshot content hash");
    manifest
        .validate_snapshot_sha256()
        .expect("validate snapshot content hash");
    let content_hash = manifest.snapshot_sha256.clone();

    manifest.snapshot_id = Uuid::from_u128(99);
    manifest.created_at_ms += 1;
    assert_eq!(
        manifest
            .computed_snapshot_sha256()
            .expect("recompute snapshot content hash"),
        content_hash
    );

    manifest.layout.files[0].sha256 = hash('9');
    assert_ne!(
        manifest
            .computed_snapshot_sha256()
            .expect("hash changed packed layout"),
        content_hash
    );
    assert!(manifest.validate_snapshot_sha256().is_err());
}

#[test]
fn rejects_missing_or_misshaped_molecular_identity_arrays() {
    let mut manifest = molecular_manifest();
    manifest.layout.arrays.remove(1);
    assert!(manifest.validate().is_err());

    let mut manifest = molecular_manifest();
    manifest.layout.arrays[0].shape = vec![2, 31];
    manifest.layout.arrays[0].byte_length = 62;
    assert!(manifest.validate().is_err());
}

#[test]
fn rejects_refs_with_any_changed_immutable_identity() {
    let molecular = molecular_manifest();
    let mut snapshot_ref = snapshot_ref();
    snapshot_ref.frozen_source.source_revision += 1;
    assert!(snapshot_ref.validate_against_manifest(&molecular).is_err());

    let engine = engine_manifest();
    let mut engine_ref = engine_ref();
    engine_ref.engine_version = "different".into();
    assert!(engine_ref.validate_against_manifest(&engine).is_err());

    let result = result_manifest();
    let mut result_ref = ResultPackRef::from_manifest(
        &result,
        file("result/manifest.json", 128, "application/json"),
    )
    .expect("derive result pack reference");
    result_ref.snapshot_sha256 = hash('9');
    assert!(result_ref.validate_against_manifest(&result).is_err());
}

#[test]
fn rejects_noncanonical_storage_and_unknown_fields() {
    for path in [
        "/absolute.bin",
        "../parent.bin",
        "pack/./data.bin",
        "pack//data.bin",
    ] {
        assert!(file(path, 1, "application/octet-stream")
            .validate()
            .is_err());
    }

    let mut descriptor = array("values", "test", PackedDType::U64, vec![2, 4], 0, 63);
    assert!(descriptor.validate().is_err());
    descriptor.shape = vec![MAX_JSON_SAFE_INTEGER, MAX_JSON_SAFE_INTEGER];
    assert!(descriptor.expected_byte_length().is_err());

    let mut value = serde_json::to_value(result_manifest()).expect("serialize manifest");
    value["unexpected"] = serde_json::json!(true);
    assert!(serde_json::from_value::<ResultPackManifest>(value).is_err());
}

#[test]
fn rejects_duplicate_overlap_foreign_snapshot_and_unsafe_revision() {
    let mut manifest = result_manifest();
    manifest.layout.files.push(manifest.layout.files[0].clone());
    assert!(manifest.validate().is_err());

    let mut manifest = result_manifest();
    manifest.layout.arrays[1].byte_offset = 8;
    assert!(manifest.validate().is_err());

    let mut manifest = result_manifest();
    manifest.engine_packs[0].snapshot_id = Uuid::from_u128(99);
    assert!(manifest.validate().is_err());

    let mut manifest = molecular_manifest();
    manifest.frozen_source.source_revision = MAX_JSON_SAFE_INTEGER + 1;
    assert!(manifest.validate().is_err());

    let mut manifest = molecular_manifest();
    manifest.frozen_source.record_count = 0;
    assert!(manifest.validate().is_err());

    let mut manifest = molecular_manifest();
    manifest.layout.arrays.reverse();
    assert!(manifest.validate().is_err());

    let mut manifest = result_manifest();
    manifest.layout.files = vec![
        file("z.bin", 1, "application/octet-stream"),
        file("a.bin", 1, "application/octet-stream"),
    ];
    assert!(manifest.validate().is_err());
}
