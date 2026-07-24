use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};

use burette_compute_protocol::MAX_JSON_SAFE_INTEGER;

use super::grid_database::open_grid_database;

const DOCUMENT_FINGERPRINT_DOMAIN: &[u8] = b"burette.grid-document.v1\0";
const MOLECULE_CONTENT_DOMAIN: &[u8] = b"burette.grid-molecule.v1\0";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GridSourceIdentity {
    pub(crate) document_fingerprint_sha256: String,
    pub(crate) source_revision: u64,
    pub(crate) virtual_edit_generation: u64,
}

pub(crate) fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists grid_metadata (
               id integer primary key check (id = 1),
               schema_version integer not null check (schema_version = 1),
               document_fingerprint_sha256 text,
               source_revision integer not null default 0
                 check (source_revision >= 0 and source_revision <= 9007199254740991),
               virtual_edit_generation integer not null default 0
                 check (virtual_edit_generation >= 0 and virtual_edit_generation <= 9007199254740991)
             );
             insert or ignore into grid_metadata(
               id, schema_version, source_revision, virtual_edit_generation
             ) values (1, 1, 0, 0);",
        )
        .map_err(|error| error.to_string())?;
    let has_molecule_hash = connection
        .prepare("select name from pragma_table_info('molecules') where name = ?1")
        .and_then(|mut statement| statement.exists(["molecule_content_sha256"]))
        .map_err(|error| error.to_string())?;
    if !has_molecule_hash {
        connection
            .execute(
                "alter table molecules add column molecule_content_sha256 text not null default ''",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "create unique index if not exists molecules_source_identity
             on molecules(source_index)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn molecule_content_sha256(
    smiles: Option<&str>,
    molblock: Option<&str>,
    idcode: Option<&str>,
    idcoordinates: Option<&str>,
) -> String {
    let mut digest = Sha256::new();
    digest.update(MOLECULE_CONTENT_DOMAIN);
    update_optional_text(&mut digest, b"smiles", smiles);
    update_optional_text(&mut digest, b"molblock", molblock);
    update_optional_text(&mut digest, b"idcode", idcode);
    update_optional_text(&mut digest, b"idcoordinates", idcoordinates);
    digest_hex(digest.finalize())
}

pub(crate) fn finalize_source_revision(
    connection: &Connection,
) -> Result<GridSourceIdentity, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let identity = advance_source_revision(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(identity)
}

pub(crate) fn advance_source_revision(
    connection: &Connection,
) -> Result<GridSourceIdentity, String> {
    repair_molecule_hashes(connection)?;
    let fingerprint = document_fingerprint(connection)?;
    let current_revision = connection
        .query_row(
            "select source_revision from grid_metadata where id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let next_revision = if current_revision == 0 {
        1
    } else {
        current_revision.checked_add(1).ok_or_else(|| {
            "Grid source revision overflowed its durable integer range".to_string()
        })?
    };
    if next_revision > MAX_JSON_SAFE_INTEGER as i64 {
        return Err("Grid source revision exceeded the JSON-safe integer limit".into());
    }
    connection
        .execute(
            "update grid_metadata
             set document_fingerprint_sha256 = ?1, source_revision = ?2
             where id = 1",
            params![fingerprint, next_revision],
        )
        .map_err(|error| error.to_string())?;
    read_source_identity(connection)
}

pub(crate) fn read_source_identity(connection: &Connection) -> Result<GridSourceIdentity, String> {
    let row = connection
        .query_row(
            "select document_fingerprint_sha256, source_revision, virtual_edit_generation
             from grid_metadata where id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Grid source identity metadata is missing".to_string())?;
    let document_fingerprint_sha256 = row
        .0
        .filter(|fingerprint| is_lower_sha256(fingerprint))
        .ok_or_else(|| "Grid indexing has not finalized a source fingerprint".to_string())?;
    let source_revision = u64::try_from(row.1)
        .ok()
        .filter(|revision| *revision > 0 && *revision <= MAX_JSON_SAFE_INTEGER)
        .ok_or_else(|| "Grid source revision is invalid".to_string())?;
    let virtual_edit_generation = u64::try_from(row.2)
        .ok()
        .filter(|generation| *generation <= MAX_JSON_SAFE_INTEGER)
        .ok_or_else(|| "Grid virtual-edit generation is invalid".to_string())?;
    Ok(GridSourceIdentity {
        document_fingerprint_sha256,
        source_revision,
        virtual_edit_generation,
    })
}

pub(crate) fn mark_virtual_edit(database_path: &std::path::Path) -> Result<u64, String> {
    let mut connection = open_grid_database(database_path)?;
    initialize(&connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let updated = transaction
        .execute(
            "update grid_metadata
             set virtual_edit_generation = virtual_edit_generation + 1
             where id = 1 and virtual_edit_generation < ?1",
            [MAX_JSON_SAFE_INTEGER as i64],
        )
        .map_err(|error| error.to_string())?;
    if updated != 1 {
        return Err("Grid virtual-edit generation exceeded the JSON-safe integer limit".into());
    }
    let generation = transaction
        .query_row(
            "select virtual_edit_generation from grid_metadata where id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    u64::try_from(generation).map_err(|_| "Grid virtual-edit generation is invalid".into())
}

fn repair_molecule_hashes(connection: &Connection) -> Result<(), String> {
    let rows = {
        let mut statement = connection
            .prepare(
                "select id, smiles, molblock, idcode, idcoordinates, molecule_content_sha256
                 from molecules order by source_index asc",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    for (id, smiles, molblock, idcode, idcoordinates, stored_hash) in rows {
        let expected = molecule_content_sha256(
            smiles.as_deref(),
            molblock.as_deref(),
            idcode.as_deref(),
            idcoordinates.as_deref(),
        );
        if stored_hash != expected {
            connection
                .execute(
                    "update molecules set molecule_content_sha256 = ?1 where id = ?2",
                    params![expected, id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn document_fingerprint(connection: &Connection) -> Result<String, String> {
    let mut statement = connection
        .prepare(
            "select source_index, name, smiles, molblock, idcode, idcoordinates,
                    props_json, molecule_content_sha256
             from molecules order by source_index asc",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    digest.update(DOCUMENT_FINGERPRINT_DOMAIN);
    let mut record_count = 0_u64;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let source_index = row.get::<_, i64>(0).map_err(|error| error.to_string())?;
        if source_index < 0 {
            return Err("Grid source index is negative".into());
        }
        digest.update(source_index.to_be_bytes());
        update_text(
            &mut digest,
            b"name",
            &row.get::<_, String>(1).map_err(|e| e.to_string())?,
        );
        update_optional_text(
            &mut digest,
            b"smiles",
            row.get::<_, Option<String>>(2)
                .map_err(|e| e.to_string())?
                .as_deref(),
        );
        update_optional_text(
            &mut digest,
            b"molblock",
            row.get::<_, Option<String>>(3)
                .map_err(|e| e.to_string())?
                .as_deref(),
        );
        update_optional_text(
            &mut digest,
            b"idcode",
            row.get::<_, Option<String>>(4)
                .map_err(|e| e.to_string())?
                .as_deref(),
        );
        update_optional_text(
            &mut digest,
            b"idcoordinates",
            row.get::<_, Option<String>>(5)
                .map_err(|e| e.to_string())?
                .as_deref(),
        );
        update_text(
            &mut digest,
            b"propsJson",
            &row.get::<_, String>(6).map_err(|e| e.to_string())?,
        );
        update_text(
            &mut digest,
            b"moleculeContentSha256",
            &row.get::<_, String>(7).map_err(|e| e.to_string())?,
        );
        record_count = record_count
            .checked_add(1)
            .ok_or_else(|| "Grid record count overflowed".to_string())?;
    }
    if record_count == 0 {
        return Err("Grid source identity requires at least one molecule".into());
    }
    digest.update(record_count.to_be_bytes());
    Ok(digest_hex(digest.finalize()))
}

fn update_optional_text(digest: &mut Sha256, label: &[u8], value: Option<&str>) {
    update_bytes(digest, label, value.map(str::as_bytes));
}

fn update_text(digest: &mut Sha256, label: &[u8], value: &str) {
    update_bytes(digest, label, Some(value.as_bytes()));
}

fn update_bytes(digest: &mut Sha256, label: &[u8], value: Option<&[u8]>) {
    digest.update((label.len() as u64).to_be_bytes());
    digest.update(label);
    match value {
        Some(value) => {
            digest.update([1]);
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value);
        }
        None => digest.update([0]),
    }
}

fn digest_hex(digest: impl AsRef<[u8]>) -> String {
    let bytes = digest.as_ref();
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(text, "{byte:02x}");
    }
    text
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
#[path = "grid_identity_tests.rs"]
mod tests;
