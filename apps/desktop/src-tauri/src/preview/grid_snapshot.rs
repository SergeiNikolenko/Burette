use std::{
    collections::BTreeMap,
    fs::File,
    io::{self, Write},
    path::Path,
};

use burrete_compute_protocol::{
    FrozenSourceIdentity, GridScope, GridTextQuery, MolecularSnapshotManifest,
    MolecularSnapshotRecordV1, MolecularSnapshotRecordVersion, MolecularSnapshotRef,
    MolecularSnapshotVersion, OrderedRecordMoleculeIdentityHasher, PackedArrayDescriptor,
    PackedByteOrder, PackedDType, PackedFileDescriptor, PackedLayout, MAX_CONTROL_FRAME_BYTES,
    MAX_JSON_SAFE_INTEGER, MAX_PACK_BYTES, MAX_PACK_RECORDS, MOLECULAR_RECORDS_FILE_NAME,
    MOLECULAR_RECORDS_FILE_PATH, MOLECULAR_RECORDS_MEDIA_TYPE, MOLECULE_CONTENT_HASHES_ARRAY_NAME,
    MOLECULE_CONTENT_HASHES_SEMANTIC, SOURCE_RECORD_IDS_ARRAY_NAME, SOURCE_RECORD_IDS_SEMANTIC,
};
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection, Row, Statement};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    grid_database::open_grid_database_read_only,
    grid_identity,
    grid_predicate::plan_grid_predicate,
    snapshot_fs::{PublishedSnapshotRoot, SnapshotByteReservation, SnapshotStaging},
};

const SNAPSHOT_DISK_HEADROOM_BYTES: u64 = 64 * 1024 * 1024;
const SNAPSHOT_FILESYSTEM_OVERHEAD_BYTES: u64 = 1024 * 1024;
const IDENTITY_BYTES_PER_RECORD: u64 = 8 + 32;

pub(crate) use super::snapshot_fs::SnapshotPublicationRoot;

#[derive(Debug)]
pub(crate) struct FrozenGridSnapshot {
    pub(crate) manifest: MolecularSnapshotManifest,
    pub(crate) reference: MolecularSnapshotRef,
    pub(crate) root: PublishedSnapshotRoot,
}

pub(crate) fn freeze_grid_scope(
    database_path: &Path,
    scope: &GridScope,
    publication_root: &SnapshotPublicationRoot,
    snapshot_id: Uuid,
    created_at_ms: u64,
) -> Result<FrozenGridSnapshot, String> {
    if snapshot_id.is_nil() {
        return Err("Frozen Grid snapshot ID cannot be nil".into());
    }
    let normalized_scope = scope
        .clone()
        .normalized()
        .map_err(|error| error.to_string())?;
    let mut connection = open_grid_database_read_only(database_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    require_complete_index(&transaction)?;
    let source_identity = grid_identity::read_source_identity(&transaction)?;
    if source_identity.virtual_edit_generation != 0 {
        return Err(format!(
            "Grid source has {} frontend-only edit generation(s); save/reload before compute",
            source_identity.virtual_edit_generation
        ));
    }

    let scope_sql = resolve_scope_sql(&normalized_scope)?;
    let record_count = count_scope_rows(&transaction, &scope_sql)?;
    if record_count == 0 || record_count > MAX_PACK_RECORDS {
        return Err(format!(
            "Frozen Grid scope requires 1..={MAX_PACK_RECORDS} records; resolved {record_count}"
        ));
    }
    if let Some(expected) = scope_sql.expected_record_count {
        if record_count != expected {
            return Err(format!(
                "Selected Grid scope resolved {record_count} of {expected} requested source records"
            ));
        }
    }

    let select_sql = format!(
        "select source_index, name, smiles, molblock, idcode, idcoordinates,
                props_json, molecule_content_sha256
         from molecules
         {where_sql}
         order by source_index asc",
        where_sql = scope_sql.where_sql()
    );
    let mut statement = transaction
        .prepare(&select_sql)
        .map_err(|error| error.to_string())?;
    let expected_pack_bytes = measure_scope_pack(&mut statement, &scope_sql.params, record_count)?;
    let _reservation = reserve_publication_capacity(publication_root, expected_pack_bytes)?;

    let staging = SnapshotStaging::create(publication_root, snapshot_id)?;
    let mut source_ids = HashedFile::new(staging.create_pack_file("source-record-ids.bin")?);
    let mut molecule_hashes =
        HashedFile::new(staging.create_pack_file("molecule-content-hashes.bin")?);
    let mut records = HashedFile::new(staging.create_pack_file(MOLECULAR_RECORDS_FILE_NAME)?);
    let mut pack_budget = PackByteBudget::default();
    let mut identity_digest = OrderedRecordMoleculeIdentityHasher::new();

    let mut rows = statement
        .query(params_from_iter(scope_sql.params.iter()))
        .map_err(|error| error.to_string())?;
    let mut written = 0_u64;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let prepared = prepare_snapshot_record(row)?;
        pack_budget.reserve(8)?;
        source_ids
            .write_all(&prepared.source_index.to_le_bytes())
            .map_err(|error| error.to_string())?;
        pack_budget.reserve(32)?;
        molecule_hashes
            .write_all(&prepared.molecule_hash)
            .map_err(|error| error.to_string())?;
        identity_digest
            .push(prepared.source_index, &prepared.molecule_hash_text)
            .map_err(|error| error.to_string())?;
        pack_budget.reserve(prepared.canonical_line.len())?;
        records
            .write_all(&prepared.canonical_line)
            .map_err(|error| error.to_string())?;
        written += 1;
    }
    drop(rows);
    drop(statement);
    if written != record_count {
        return Err(format!(
            "Frozen Grid scope changed while materializing: counted {record_count}, wrote {written}"
        ));
    }
    if identity_digest.record_count() != written {
        return Err("Frozen Grid ordered identity count differs from its record stream".into());
    }
    if pack_budget.used != expected_pack_bytes {
        return Err(format!(
            "Frozen Grid pack size changed while materializing: measured {expected_pack_bytes}, wrote {}",
            pack_budget.used
        ));
    }
    transaction.commit().map_err(|error| error.to_string())?;

    let source_ids_file =
        source_ids.finish("pack/source-record-ids.bin", "application/octet-stream")?;
    let molecule_hashes_file = molecule_hashes.finish(
        "pack/molecule-content-hashes.bin",
        "application/octet-stream",
    )?;
    let records_file = records.finish(MOLECULAR_RECORDS_FILE_PATH, MOLECULAR_RECORDS_MEDIA_TYPE)?;
    let frozen_source = FrozenSourceIdentity {
        document_fingerprint_sha256: source_identity.document_fingerprint_sha256,
        source_revision: source_identity.source_revision,
        record_count,
        ordered_record_molecule_identity_sha256: identity_digest.finish_hex(),
    };
    let mut files = vec![source_ids_file, molecule_hashes_file, records_file];
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut manifest = MolecularSnapshotManifest {
        schema_version: MolecularSnapshotVersion::V1,
        snapshot_id,
        snapshot_sha256: "0".repeat(64),
        frozen_source,
        layout: PackedLayout {
            files,
            arrays: identity_arrays(record_count)?,
        },
        created_at_ms,
    };
    manifest
        .bind_computed_snapshot_sha256()
        .map_err(|error| error.to_string())?;
    manifest
        .validate_snapshot_sha256()
        .map_err(|error| error.to_string())?;

    let manifest_bytes = manifest
        .canonical_json_bytes()
        .map_err(|error| error.to_string())?;
    let mut manifest_file = HashedFile::new(staging.create_manifest_file()?);
    manifest_file
        .write_all(&manifest_bytes)
        .map_err(|error| error.to_string())?;
    let manifest_descriptor = manifest_file.finish("snapshot/manifest.json", "application/json")?;
    let reference = MolecularSnapshotRef::from_manifest(&manifest, manifest_descriptor)
        .map_err(|error| error.to_string())?;

    staging.sync_directories()?;
    let root = staging.publish()?;
    Ok(FrozenGridSnapshot {
        manifest,
        reference,
        root,
    })
}

struct ScopeSql {
    predicate_sql: String,
    params: Vec<SqlValue>,
    expected_record_count: Option<u64>,
}

impl ScopeSql {
    fn where_sql(&self) -> String {
        if self.predicate_sql.is_empty() {
            String::new()
        } else {
            format!("where {}", self.predicate_sql)
        }
    }
}

fn resolve_scope_sql(scope: &GridScope) -> Result<ScopeSql, String> {
    match scope {
        GridScope::Selected(selected) => {
            let encoded = serde_json::to_string(&selected.source_indexes)
                .map_err(|error| error.to_string())?;
            Ok(ScopeSql {
                predicate_sql: "molecules.source_index in (
                  select cast(value as integer) from json_each(?)
                )"
                .into(),
                params: vec![SqlValue::Text(encoded)],
                expected_record_count: Some(selected.source_indexes.len() as u64),
            })
        }
        GridScope::Filtered(filtered) => {
            let GridTextQuery::Text { .. } = &filtered.query;
            let plan = plan_grid_predicate(
                &filtered.query,
                &filtered.column_filters,
                &filtered.descriptor_filters,
                &filtered.analysis_filters,
            )?;
            Ok(ScopeSql {
                predicate_sql: plan.predicate_sql,
                params: plan.params,
                expected_record_count: None,
            })
        }
        GridScope::All(_) => Ok(ScopeSql {
            predicate_sql: String::new(),
            params: Vec::new(),
            expected_record_count: None,
        }),
    }
}

fn require_complete_index(connection: &Connection) -> Result<(), String> {
    let (indexed, total, ready, error) = connection
        .query_row(
            "select records_indexed, records_total, index_ready, error
             from grid_index_state where id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    if let Some(error) = error {
        return Err(format!("Grid indexing failed: {error}"));
    }
    if ready != 1 || total != Some(indexed) {
        return Err("Grid indexing must finish before compute submission".into());
    }
    Ok(())
}

fn count_scope_rows(connection: &Connection, scope: &ScopeSql) -> Result<u64, String> {
    let sql = format!("select count(*) from molecules {}", scope.where_sql());
    let count = connection
        .query_row(&sql, params_from_iter(scope.params.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    u64::try_from(count).map_err(|_| "Frozen Grid scope count is negative".into())
}

fn measure_scope_pack(
    statement: &mut Statement<'_>,
    parameters: &[SqlValue],
    expected_records: u64,
) -> Result<u64, String> {
    let mut total_bytes = expected_records
        .checked_mul(IDENTITY_BYTES_PER_RECORD)
        .ok_or_else(|| "Frozen Grid identity byte count overflowed".to_string())?;
    if total_bytes > MAX_PACK_BYTES {
        return Err("Frozen Grid identity arrays exceed the pack byte limit".into());
    }

    let mut rows = statement
        .query(params_from_iter(parameters.iter()))
        .map_err(|error| error.to_string())?;
    let mut measured_records = 0_u64;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let prepared = prepare_snapshot_record(row)?;
        total_bytes = total_bytes
            .checked_add(prepared.canonical_line.len() as u64)
            .ok_or_else(|| "Frozen Grid pack byte count overflowed".to_string())?;
        if total_bytes > MAX_PACK_BYTES {
            return Err(format!(
                "Frozen Grid snapshot exceeds the {MAX_PACK_BYTES}-byte pack limit"
            ));
        }
        measured_records += 1;
    }
    if measured_records != expected_records {
        return Err(format!(
            "Frozen Grid scope changed while measuring: counted {expected_records}, measured {measured_records}"
        ));
    }
    Ok(total_bytes)
}

fn reserve_publication_capacity(
    publication_root: &SnapshotPublicationRoot,
    pack_bytes: u64,
) -> Result<SnapshotByteReservation<'_>, String> {
    let publication_bytes = pack_bytes
        .checked_add(MAX_CONTROL_FRAME_BYTES as u64)
        .and_then(|bytes| bytes.checked_add(SNAPSHOT_FILESYSTEM_OVERHEAD_BYTES))
        .ok_or_else(|| "Frozen Grid disk reservation overflowed".to_string())?;
    publication_root.reserve_bytes(publication_bytes, SNAPSHOT_DISK_HEADROOM_BYTES)
}

struct PreparedSnapshotRecord {
    source_index: u64,
    molecule_hash_text: String,
    molecule_hash: [u8; 32],
    canonical_line: Vec<u8>,
}

fn prepare_snapshot_record(row: &Row<'_>) -> Result<PreparedSnapshotRecord, String> {
    let source_index = u64::try_from(row.get::<_, i64>(0).map_err(|error| error.to_string())?)
        .map_err(|_| "Grid source index is negative".to_string())?;
    if source_index > MAX_JSON_SAFE_INTEGER {
        return Err("Grid source index exceeds the JSON-safe integer limit".into());
    }
    let molecule_hash_text = row.get::<_, String>(7).map_err(|error| error.to_string())?;
    let molecule_hash = decode_lower_sha256(&molecule_hash_text)?;
    let props_json = row.get::<_, String>(6).map_err(|error| error.to_string())?;
    let props: BTreeMap<String, String> =
        serde_json::from_str(&props_json).map_err(|error| error.to_string())?;
    let record = MolecularSnapshotRecordV1 {
        schema_version: MolecularSnapshotRecordVersion::V1,
        source_record_id: source_index,
        molecule_content_sha256: molecule_hash_text.clone(),
        name: row.get(1).map_err(|error| error.to_string())?,
        smiles: row.get(2).map_err(|error| error.to_string())?,
        molblock: row.get(3).map_err(|error| error.to_string())?,
        idcode: row.get(4).map_err(|error| error.to_string())?,
        idcoordinates: row.get(5).map_err(|error| error.to_string())?,
        props,
    };
    let canonical_line = record
        .canonical_json_line_bytes()
        .map_err(|error| error.to_string())?;
    Ok(PreparedSnapshotRecord {
        source_index,
        molecule_hash_text,
        molecule_hash,
        canonical_line,
    })
}

fn identity_arrays(record_count: u64) -> Result<Vec<PackedArrayDescriptor>, String> {
    let source_bytes = record_count
        .checked_mul(8)
        .ok_or_else(|| "Source-record identity array size overflowed".to_string())?;
    let hash_bytes = record_count
        .checked_mul(32)
        .ok_or_else(|| "Molecule-hash identity array size overflowed".to_string())?;
    Ok(vec![
        PackedArrayDescriptor {
            name: MOLECULE_CONTENT_HASHES_ARRAY_NAME.into(),
            semantic: MOLECULE_CONTENT_HASHES_SEMANTIC.into(),
            unit: None,
            file_relative_path: "pack/molecule-content-hashes.bin".into(),
            dtype: PackedDType::U8,
            shape: vec![record_count, 32],
            byte_order: PackedByteOrder::NotApplicable,
            alignment: 1,
            byte_offset: 0,
            byte_length: hash_bytes,
        },
        PackedArrayDescriptor {
            name: SOURCE_RECORD_IDS_ARRAY_NAME.into(),
            semantic: SOURCE_RECORD_IDS_SEMANTIC.into(),
            unit: None,
            file_relative_path: "pack/source-record-ids.bin".into(),
            dtype: PackedDType::U64,
            shape: vec![record_count],
            byte_order: PackedByteOrder::LittleEndian,
            alignment: 8,
            byte_offset: 0,
            byte_length: source_bytes,
        },
    ])
}

struct HashedFile {
    file: File,
    digest: Sha256,
    byte_length: u64,
}

#[derive(Default)]
struct PackByteBudget {
    used: u64,
}

impl PackByteBudget {
    fn reserve(&mut self, bytes: usize) -> Result<(), String> {
        let bytes =
            u64::try_from(bytes).map_err(|_| "Frozen Grid write length exceeds u64".to_string())?;
        let next = self
            .used
            .checked_add(bytes)
            .ok_or_else(|| "Frozen Grid pack byte count overflowed".to_string())?;
        if next > MAX_PACK_BYTES {
            return Err(format!(
                "Frozen Grid snapshot exceeds the {MAX_PACK_BYTES}-byte pack limit"
            ));
        }
        self.used = next;
        Ok(())
    }
}

impl HashedFile {
    fn new(file: File) -> Self {
        Self {
            file,
            digest: Sha256::new(),
            byte_length: 0,
        }
    }

    fn finish(
        mut self,
        relative_path: &str,
        media_type: &str,
    ) -> Result<PackedFileDescriptor, String> {
        self.file.flush().map_err(|error| error.to_string())?;
        self.file.sync_all().map_err(|error| error.to_string())?;
        Ok(PackedFileDescriptor {
            relative_path: relative_path.into(),
            sha256: digest_hex(self.digest.finalize()),
            byte_length: self.byte_length,
            media_type: media_type.into(),
        })
    }
}

impl Write for HashedFile {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let next_length = self
            .byte_length
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| io::Error::other("snapshot file size overflowed"))?;
        if next_length > MAX_PACK_BYTES {
            return Err(io::Error::other(
                "snapshot file exceeds the pack byte limit",
            ));
        }
        self.file.write_all(bytes)?;
        self.digest.update(bytes);
        self.byte_length = next_length;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

fn decode_lower_sha256(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 {
        return Err("Grid molecule hash is not a lowercase SHA-256".into());
    }
    let mut bytes = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

fn hex_nibble(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err("Grid molecule hash is not a lowercase SHA-256".into()),
    }
}

fn digest_hex(digest: impl AsRef<[u8]>) -> String {
    let mut encoded = String::with_capacity(64);
    for byte in digest.as_ref() {
        use std::fmt::Write;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}
