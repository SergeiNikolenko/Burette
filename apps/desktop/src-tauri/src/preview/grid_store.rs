use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;

use super::runtime_utils::{clipped, decode_text, normalized_lines};

const GRID_INITIAL_ROWS: usize = 192;
const GRID_INGEST_BATCH_ROWS: usize = 1_000;

#[derive(Default)]
pub(crate) struct GridRuntimeRegistry {
    entries: Mutex<HashMap<String, RegisteredGridRuntime>>,
}

#[derive(Clone, Debug)]
struct RegisteredGridRuntime {
    database_path: PathBuf,
    format: &'static str,
    cancel_token: Arc<AtomicBool>,
}

#[derive(Debug)]
pub(crate) struct GridCollectionSummary {
    pub(crate) format: &'static str,
    pub(crate) records_total: usize,
    pub(crate) records_indexed: usize,
    pub(crate) index_ready: bool,
}

#[derive(Debug)]
pub(crate) struct GridStoreHandle {
    pub(crate) database_path: PathBuf,
    pub(crate) cancel_token: Arc<AtomicBool>,
    pub(crate) summary: GridCollectionSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridPageResult {
    pub(crate) rows: Vec<GridPageRow>,
    pub(crate) total_rows: usize,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
    pub(crate) indexing: bool,
    pub(crate) records_indexed: usize,
    pub(crate) records_total_hint: Option<usize>,
    pub(crate) index_ready: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridAppendSummary {
    pub(crate) records_appended: usize,
    pub(crate) total_rows: usize,
}

#[derive(Debug, Default)]
pub(crate) struct GridParseOptions {
    pub(crate) smiles_column: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridDelimitedColumnChoice {
    pub(crate) index: usize,
    pub(crate) name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridPageRow {
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) smiles: Option<String>,
    pub(crate) molblock: Option<String>,
    pub(crate) props: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GridQuery {
    pub(crate) query: String,
    pub(crate) sort: String,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
}

#[derive(Debug)]
struct GridInputRecord {
    index: usize,
    name: String,
    smiles: Option<String>,
    molblock: Option<String>,
    props: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug)]
struct GridIndexState {
    records_indexed: usize,
    records_total: Option<usize>,
    index_ready: bool,
}

#[derive(Debug)]
struct ParsedGridBatch {
    records: Vec<GridInputRecord>,
    next_line: usize,
    next_index: usize,
    complete: bool,
}

impl GridRuntimeRegistry {
    pub(crate) fn register(
        &self,
        document_id: &str,
        database_path: PathBuf,
        format: &'static str,
        cancel_token: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?;
        if let Some(existing) = entries.remove(document_id) {
            existing.cancel_token.store(true, Ordering::Relaxed);
        }
        entries.insert(
            document_id.to_string(),
            RegisteredGridRuntime {
                database_path,
                format,
                cancel_token,
            },
        );
        Ok(())
    }

    pub(crate) fn unregister(&self, document_id: &str) -> Result<(), String> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?
            .remove(document_id);
        if let Some(entry) = entry {
            entry.cancel_token.store(true, Ordering::Relaxed);
            if let Some(runtime_dir) = entry.database_path.parent() {
                let _ = std::fs::remove_dir_all(runtime_dir);
            }
        }
        Ok(())
    }

    pub(crate) fn fetch_page(
        &self,
        document_id: &str,
        query: &GridQuery,
    ) -> Result<GridPageResult, String> {
        let database_path = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| "grid runtime registry is poisoned")?;
            entries
                .get(document_id)
                .map(|entry| entry.database_path.clone())
                .ok_or_else(|| format!("grid runtime is unavailable for document {document_id}"))?
        };
        fetch_page(&database_path, query)
    }

    pub(crate) fn append_text(
        &self,
        document_id: &str,
        extension: &str,
        text: &str,
    ) -> Result<GridAppendSummary, String> {
        self.append_text_with_options(document_id, extension, text, &GridParseOptions::default())
    }

    pub(crate) fn append_text_with_options(
        &self,
        document_id: &str,
        extension: &str,
        text: &str,
        options: &GridParseOptions,
    ) -> Result<GridAppendSummary, String> {
        let (database_path, target_format) = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| "grid runtime registry is poisoned")?;
            let entry = entries
                .get(document_id)
                .ok_or_else(|| format!("grid runtime is unavailable for document {document_id}"))?;
            (entry.database_path.clone(), entry.format)
        };
        let source_format = grid_format(extension)
            .ok_or_else(|| format!("Unsupported grid append extension: {extension}"))?;
        if source_format != target_format {
            return Err(format!(
                "Cannot append {source_format} records to {target_format} grid"
            ));
        }
        append_grid_text(&database_path, source_format, text, options)
    }
}

#[cfg(test)]
pub(crate) fn build_grid_store(
    runtime_dir: &Path,
    extension: &str,
    data: &[u8],
) -> Result<Option<GridStoreHandle>, String> {
    build_grid_store_with_options(runtime_dir, extension, data, &GridParseOptions::default())
}

pub(crate) fn build_grid_store_with_options(
    runtime_dir: &Path,
    extension: &str,
    data: &[u8],
    options: &GridParseOptions,
) -> Result<Option<GridStoreHandle>, String> {
    let Some(format) = grid_format(extension) else {
        return Ok(None);
    };
    let text = decode_text(data);
    let database_path = runtime_dir.join("collection.sqlite");
    let connection = Connection::open(&database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let cancel_token = Arc::new(AtomicBool::new(false));
    let first_batch =
        parse_grid_batch_with_options(extension, &text, 0, 0, GRID_INITIAL_ROWS, options)?;
    if first_batch.records.is_empty() && first_batch.complete {
        let _ = std::fs::remove_file(&database_path);
        return Ok(None);
    }
    insert_records(&connection, &first_batch.records)?;
    let records_indexed = first_batch.next_index;
    update_index_state(
        &connection,
        records_indexed,
        first_batch.complete.then_some(records_indexed),
        first_batch.complete,
        None,
    )?;
    if first_batch.complete && ((extension == "sdf" || extension == "sd") && records_indexed <= 1) {
        let _ = std::fs::remove_file(&database_path);
        return Ok(None);
    }
    if !first_batch.complete {
        spawn_grid_ingest_worker(
            database_path.clone(),
            extension.to_string(),
            text,
            first_batch.next_line,
            first_batch.next_index,
            options.smiles_column.clone(),
            cancel_token.clone(),
        );
    }
    Ok(Some(GridStoreHandle {
        database_path,
        cancel_token,
        summary: GridCollectionSummary {
            format,
            records_total: records_indexed,
            records_indexed,
            index_ready: first_batch.complete,
        },
    }))
}

fn append_grid_text(
    database_path: &Path,
    format: &'static str,
    text: &str,
    options: &GridParseOptions,
) -> Result<GridAppendSummary, String> {
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let index_state = read_index_state(&connection)?;
    if !index_state.index_ready {
        return Err("Cannot append records while grid indexing is still in progress".to_string());
    }
    let start_index = molecule_count(&connection)?;
    let mut records_appended = 0usize;
    let mut next_line = 0usize;
    let mut next_index = start_index;
    loop {
        let batch = parse_grid_batch_with_options(
            format,
            text,
            next_line,
            next_index,
            GRID_INGEST_BATCH_ROWS,
            options,
        )?;
        if !batch.records.is_empty() {
            records_appended += batch.records.len();
            insert_records(&connection, &batch.records)?;
        }
        next_line = batch.next_line;
        next_index = batch.next_index;
        if batch.complete {
            break;
        }
    }
    if records_appended == 0 {
        return Err(format!(
            "{format} source does not contain supported molecule records"
        ));
    }
    let total_rows = molecule_count(&connection)?;
    update_index_state(&connection, total_rows, Some(total_rows), true, None)?;
    Ok(GridAppendSummary {
        records_appended,
        total_rows,
    })
}

fn molecule_count(connection: &Connection) -> Result<usize, String> {
    connection
        .query_row("select count(*) from molecules", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|value| value as usize)
        .map_err(|err| err.to_string())
}

fn grid_format(extension: &str) -> Option<&'static str> {
    match extension {
        "csv" => Some("csv"),
        "tsv" => Some("tsv"),
        "smi" | "smiles" => Some("smiles"),
        "sdf" | "sd" => Some("sdf"),
        _ => None,
    }
}

fn fetch_page(database_path: &Path, query: &GridQuery) -> Result<GridPageResult, String> {
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    let index_state = read_index_state(&connection)?;
    let normalized_query = normalize_grid_query(&query.query);
    let limit = query.limit.clamp(1, 240);
    let offset = query.offset;
    let sort_sql = sort_sql(&query.sort);
    let total_rows = if normalized_query.is_empty() {
        connection
            .query_row("select count(*) from molecules", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|err| err.to_string())? as usize
    } else {
        return fetch_filtered_page(
            &connection,
            &normalized_query,
            sort_sql,
            limit,
            offset,
            index_state,
        );
    };

    let sql = format!(
        "select source_index, name, smiles, molblock, props_json \
         from molecules \
         order by {sort_sql} \
         limit ?1 offset ?2"
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = statement
        .query(params![limit as i64, offset as i64])
        .map_err(|err| err.to_string())?;
    let page_rows = collect_page_rows(rows)?;
    Ok(GridPageResult {
        rows: page_rows,
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
    })
}

fn fetch_filtered_page(
    connection: &Connection,
    normalized_query: &str,
    sort_sql: &str,
    limit: usize,
    offset: usize,
    index_state: GridIndexState,
) -> Result<GridPageResult, String> {
    if let Some(fts_query) = fts_query(normalized_query) {
        if let Ok(result) = fetch_filtered_page_with_fts(
            connection,
            &fts_query,
            sort_sql,
            limit,
            offset,
            index_state,
        ) {
            if result.total_rows > 0 {
                return Ok(result);
            }
        }
    }
    fetch_filtered_page_with_like(
        connection,
        normalized_query,
        sort_sql,
        limit,
        offset,
        index_state,
    )
}

fn fetch_filtered_page_with_fts(
    connection: &Connection,
    fts_query: &str,
    sort_sql: &str,
    limit: usize,
    offset: usize,
    index_state: GridIndexState,
) -> Result<GridPageResult, String> {
    let total_rows = connection
        .query_row(
            "select count(*) \
             from molecules \
             where id in (select rowid from molecules_fts where molecules_fts match ?1)",
            params![fts_query],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())? as usize;
    let sql = format!(
        "select source_index, name, smiles, molblock, props_json \
         from molecules \
         where id in (select rowid from molecules_fts where molecules_fts match ?1) \
         order by {sort_sql} \
         limit ?2 offset ?3"
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = statement
        .query(params![fts_query, limit as i64, offset as i64])
        .map_err(|err| err.to_string())?;
    Ok(GridPageResult {
        rows: collect_page_rows(rows)?,
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
    })
}

fn fetch_filtered_page_with_like(
    connection: &Connection,
    normalized_query: &str,
    sort_sql: &str,
    limit: usize,
    offset: usize,
    index_state: GridIndexState,
) -> Result<GridPageResult, String> {
    let pattern = like_pattern(normalized_query);
    let total_rows = connection
        .query_row(
            "select count(*) from molecules where search_text like ?1 escape '\\'",
            params![pattern],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())? as usize;
    let sql = format!(
        "select source_index, name, smiles, molblock, props_json \
         from molecules \
         where search_text like ?1 escape '\\' \
         order by {sort_sql} \
         limit ?2 offset ?3"
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = statement
        .query(params![pattern, limit as i64, offset as i64])
        .map_err(|err| err.to_string())?;
    Ok(GridPageResult {
        rows: collect_page_rows(rows)?,
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
    })
}

fn collect_page_rows(mut rows: rusqlite::Rows<'_>) -> Result<Vec<GridPageRow>, String> {
    let mut page_rows = Vec::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let props_json: String = row.get(4).map_err(|err| err.to_string())?;
        page_rows.push(GridPageRow {
            index: row.get::<_, i64>(0).map_err(|err| err.to_string())? as usize,
            name: row.get(1).map_err(|err| err.to_string())?,
            smiles: row.get(2).map_err(|err| err.to_string())?,
            molblock: row.get(3).map_err(|err| err.to_string())?,
            props: serde_json::from_str(&props_json).map_err(|err| err.to_string())?,
        });
    }
    Ok(page_rows)
}

fn sort_sql(sort: &str) -> &'static str {
    match sort {
        "name" => "name collate nocase asc, source_index asc",
        "smiles" => "coalesce(smiles, '') collate nocase asc, source_index asc",
        _ => "source_index asc",
    }
}

fn read_index_state(connection: &Connection) -> Result<GridIndexState, String> {
    connection
        .query_row(
            "select records_indexed, records_total, index_ready from grid_index_state where id = 1",
            [],
            |row| {
                let total: Option<i64> = row.get(1)?;
                Ok(GridIndexState {
                    records_indexed: row.get::<_, i64>(0)? as usize,
                    records_total: total.map(|value| value as usize),
                    index_ready: row.get::<_, i64>(2)? != 0,
                })
            },
        )
        .map_err(|err| err.to_string())
}

fn update_index_state(
    connection: &Connection,
    records_indexed: usize,
    records_total: Option<usize>,
    index_ready: bool,
    error: Option<&str>,
) -> Result<(), String> {
    connection
        .execute(
            "insert into grid_index_state (id, records_indexed, records_total, index_ready, error)
             values (1, ?1, ?2, ?3, ?4)
             on conflict(id) do update set
               records_indexed = excluded.records_indexed,
               records_total = excluded.records_total,
               index_ready = excluded.index_ready,
               error = excluded.error",
            params![
                records_indexed as i64,
                records_total.map(|value| value as i64),
                if index_ready { 1 } else { 0 },
                error,
            ],
        )
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn spawn_grid_ingest_worker(
    database_path: PathBuf,
    extension: String,
    text: String,
    mut next_line: usize,
    mut next_index: usize,
    smiles_column: Option<String>,
    cancel_token: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let Ok(connection) = Connection::open(&database_path) else {
            return;
        };
        let options = GridParseOptions { smiles_column };
        loop {
            if cancel_token.load(Ordering::Relaxed) {
                return;
            }
            let batch = match parse_grid_batch_with_options(
                &extension,
                &text,
                next_line,
                next_index,
                GRID_INGEST_BATCH_ROWS,
                &options,
            ) {
                Ok(batch) => batch,
                Err(error) => {
                    let _ = update_index_state(&connection, next_index, None, true, Some(&error));
                    return;
                }
            };
            if batch.records.is_empty() && !batch.complete {
                next_line = batch.next_line;
                next_index = batch.next_index;
                continue;
            }
            if insert_records(&connection, &batch.records).is_err() {
                return;
            }
            next_line = batch.next_line;
            next_index = batch.next_index;
            let records_total = batch.complete.then_some(next_index);
            let _ =
                update_index_state(&connection, next_index, records_total, batch.complete, None);
            if batch.complete {
                return;
            }
        }
    });
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "pragma journal_mode = wal;
             pragma synchronous = normal;
             create table if not exists molecules (
                 id integer primary key,
                 source_index integer not null,
                 name text not null,
                 smiles text,
                 molblock text,
                 props_json text not null,
                 props_text text not null,
                 search_text text not null
             );
             create index if not exists molecules_source_index on molecules(source_index);
             create index if not exists molecules_name on molecules(name collate nocase);
             create index if not exists molecules_smiles on molecules(smiles collate nocase);
             create table if not exists grid_index_state (
                 id integer primary key check (id = 1),
                 records_indexed integer not null default 0,
                 records_total integer,
                 index_ready integer not null default 0,
                 error text
             );
             insert or ignore into grid_index_state (id, records_indexed, index_ready) values (1, 0, 0);",
        )
        .map_err(|err| err.to_string())?;
    let _ = connection.execute_batch(
        "create virtual table if not exists molecules_fts using fts5(
             name,
             smiles,
             props_text,
             content='molecules',
             content_rowid='id'
         );
         create trigger if not exists molecules_ai after insert on molecules begin
             insert into molecules_fts(rowid, name, smiles, props_text)
             values (new.id, new.name, coalesce(new.smiles, ''), new.props_text);
         end;
         create trigger if not exists molecules_ad after delete on molecules begin
             insert into molecules_fts(molecules_fts, rowid, name, smiles, props_text)
             values ('delete', old.id, old.name, coalesce(old.smiles, ''), old.props_text);
         end;
         create trigger if not exists molecules_au after update on molecules begin
             insert into molecules_fts(molecules_fts, rowid, name, smiles, props_text)
             values ('delete', old.id, old.name, coalesce(old.smiles, ''), old.props_text);
             insert into molecules_fts(rowid, name, smiles, props_text)
             values (new.id, new.name, coalesce(new.smiles, ''), new.props_text);
         end;",
    );
    Ok(())
}

fn finish_sdf_record(lines: &[String], has_content: bool, index: usize) -> Option<GridInputRecord> {
    if !has_content {
        return None;
    }
    let props = parse_sdf_properties(lines);
    let fallback_name = format!("Molecule {}", index + 1);
    let title = lines
        .first()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let name = [props.get("Name"), props.get("NAME"), props.get("ID")]
        .into_iter()
        .flatten()
        .map(String::as_str)
        .chain(title)
        .find(|value| !value.trim().is_empty())
        .map(|value| clipped(value, 160))
        .unwrap_or(fallback_name);
    let smiles = [
        props.get("SMILES"),
        props.get("Smiles"),
        props.get("smiles"),
    ]
    .into_iter()
    .flatten()
    .next()
    .map(|value| clipped(value, 2048));
    Some(GridInputRecord {
        index,
        name,
        smiles,
        molblock: Some(clipped(&extract_molblock(lines), 250_000)),
        props,
    })
}

fn parse_grid_batch_with_options(
    extension: &str,
    text: &str,
    start_line: usize,
    start_index: usize,
    max_records: usize,
    options: &GridParseOptions,
) -> Result<ParsedGridBatch, String> {
    match extension {
        "csv" => parse_delimited_batch(
            text,
            ',',
            "csv",
            start_line,
            start_index,
            max_records,
            options,
        ),
        "tsv" => parse_delimited_batch(
            text,
            '\t',
            "tsv",
            start_line,
            start_index,
            max_records,
            options,
        ),
        "smi" | "smiles" => Ok(parse_smiles_batch(
            text,
            start_line,
            start_index,
            max_records,
        )),
        "sdf" | "sd" => Ok(parse_sdf_batch(text, start_line, start_index, max_records)),
        _ => Err(format!("unsupported grid extension: {extension}")),
    }
}

fn parse_smiles_batch(
    text: &str,
    start_line: usize,
    start_index: usize,
    max_records: usize,
) -> ParsedGridBatch {
    let lines = normalized_lines(text);
    let mut records = Vec::new();
    let mut next_line = start_line.min(lines.len());
    let mut next_index = start_index;
    while next_line < lines.len() {
        let trimmed = lines[next_line].trim();
        next_line += 1;
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(smiles) = parts.next() else { continue };
        if !looks_like_smiles(smiles) {
            continue;
        }
        let name = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| clipped(value, 160))
            .unwrap_or_else(|| format!("Molecule {}", next_index + 1));
        records.push(GridInputRecord {
            index: next_index,
            name,
            smiles: Some(clipped(smiles, 2048)),
            molblock: None,
            props: BTreeMap::new(),
        });
        next_index += 1;
        if records.len() >= max_records {
            break;
        }
    }
    ParsedGridBatch {
        records,
        next_line,
        next_index,
        complete: next_line >= lines.len(),
    }
}

fn parse_sdf_batch(
    text: &str,
    start_line: usize,
    start_index: usize,
    max_records: usize,
) -> ParsedGridBatch {
    let lines = normalized_lines(text);
    let mut records = Vec::new();
    let mut current = Vec::new();
    let mut current_has_content = false;
    let mut next_line = start_line.min(lines.len());
    let mut next_index = start_index;
    while next_line < lines.len() {
        let line = lines[next_line].clone();
        next_line += 1;
        if line.trim() == "$$$$" {
            if let Some(record) = finish_sdf_record(&current, current_has_content, next_index) {
                records.push(record);
                next_index += 1;
            }
            current.clear();
            current_has_content = false;
            if records.len() >= max_records {
                break;
            }
        } else {
            if !line.trim().is_empty() {
                current_has_content = true;
            }
            current.push(line);
        }
    }
    if next_line >= lines.len() {
        if let Some(record) = finish_sdf_record(&current, current_has_content, next_index) {
            records.push(record);
            next_index += 1;
        }
    }
    ParsedGridBatch {
        records,
        next_line,
        next_index,
        complete: next_line >= lines.len(),
    }
}

fn parse_delimited_batch(
    text: &str,
    separator: char,
    format: &str,
    start_line: usize,
    start_index: usize,
    max_records: usize,
    options: &GridParseOptions,
) -> Result<ParsedGridBatch, String> {
    parse_delimited_table_batch(
        text,
        separator,
        start_line,
        start_index,
        max_records,
        options,
    )
    .or_else(|error| {
        if error != "missing smiles column" || options.smiles_column.is_some() {
            return Err(error);
        }
        parse_delimited_rows_as_smiles_batch(
            text,
            separator,
            format,
            start_line,
            start_index,
            max_records,
        )
    })
}

fn parse_delimited_table_batch(
    text: &str,
    separator: char,
    start_line: usize,
    start_index: usize,
    max_records: usize,
    options: &GridParseOptions,
) -> Result<ParsedGridBatch, String> {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let Some(header_line) = rows.first() else {
        return Ok(ParsedGridBatch {
            records: Vec::new(),
            next_line: 0,
            next_index: start_index,
            complete: true,
        });
    };
    let headers: Vec<_> = parse_delimited_line(header_line, separator)
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect();
    if !is_likely_delimited_header(&headers) {
        return Err("missing smiles column".to_string());
    }
    let normalized_headers: Vec<_> = headers
        .iter()
        .map(|value| normalize_column_name(value))
        .collect();
    let smiles_index = resolve_smiles_column(
        &headers,
        &normalized_headers,
        &rows[1..],
        separator,
        options.smiles_column.as_deref(),
    )?;
    let name_index = normalized_headers
        .iter()
        .enumerate()
        .position(|(index, value)| {
            index != smiles_index
                && matches!(
                    value.as_str(),
                    "compound_id" | "id" | "name" | "title" | "compound"
                )
        });
    let mut records = Vec::new();
    let mut next_line = start_line.max(1).min(rows.len());
    let mut next_index = start_index;
    while next_line < rows.len() {
        let cells = parse_delimited_line(&rows[next_line], separator);
        next_line += 1;
        let Some(smiles) = cells
            .get(smiles_index)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let raw_name = name_index
            .and_then(|index| cells.get(index))
            .map(|value| value.trim())
            .unwrap_or("");
        let name = if raw_name.is_empty() {
            format!("Molecule {}", next_index + 1)
        } else {
            clipped(raw_name, 160)
        };
        let mut props = BTreeMap::new();
        for (index, header) in headers.iter().enumerate() {
            if index == smiles_index || Some(index) == name_index {
                continue;
            }
            if let Some(value) = cells
                .get(index)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                if !header.is_empty() && props.len() < 64 {
                    props.insert(clipped(header, 80), clipped(value, 500));
                }
            }
        }
        records.push(GridInputRecord {
            index: next_index,
            name,
            smiles: Some(clipped(smiles, 2048)),
            molblock: None,
            props,
        });
        next_index += 1;
        if records.len() >= max_records {
            break;
        }
    }
    Ok(ParsedGridBatch {
        records,
        next_line,
        next_index,
        complete: next_line >= rows.len(),
    })
}

fn parse_delimited_rows_as_smiles_batch(
    text: &str,
    separator: char,
    format: &str,
    start_line: usize,
    start_index: usize,
    max_records: usize,
) -> Result<ParsedGridBatch, String> {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let header_offset = rows
        .first()
        .map(|row| is_likely_delimited_header(&parse_delimited_line(row, separator)))
        .unwrap_or(false) as usize;
    let mut records = Vec::new();
    let mut next_line = start_line.max(header_offset).min(rows.len());
    let mut next_index = start_index;
    while next_line < rows.len() {
        let cells: Vec<_> = parse_delimited_line(&rows[next_line], separator)
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        next_line += 1;
        let Some(smiles) = cells.first().filter(|value| looks_like_smiles(value)) else {
            continue;
        };
        let name = cells
            .get(1)
            .filter(|value| !value.is_empty())
            .map(|value| clipped(value, 160))
            .unwrap_or_else(|| format!("Molecule {}", next_index + 1));
        let mut props = BTreeMap::new();
        for (offset, value) in cells.iter().skip(2).enumerate() {
            if props.len() < 64 {
                props.insert(format!("Column {}", offset + 3), clipped(value, 500));
            }
        }
        records.push(GridInputRecord {
            index: next_index,
            name,
            smiles: Some(clipped(smiles, 2048)),
            molblock: None,
            props,
        });
        next_index += 1;
        if records.len() >= max_records {
            break;
        }
    }
    if records.is_empty() && next_line >= rows.len() && start_index == 0 {
        return Err(format!(
            "{format} table does not contain supported molecule records"
        ));
    }
    Ok(ParsedGridBatch {
        records,
        next_line,
        next_index,
        complete: next_line >= rows.len(),
    })
}

fn insert_records(connection: &Connection, records: &[GridInputRecord]) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let tx = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let mut insert = tx
        .prepare(
            "insert into molecules (source_index, name, smiles, molblock, props_json, props_text, search_text)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(|err| err.to_string())?;
    for record in records {
        insert_record(&mut insert, record)?;
    }
    drop(insert);
    tx.commit().map_err(|err| err.to_string())
}

fn insert_record(
    insert: &mut rusqlite::Statement<'_>,
    record: &GridInputRecord,
) -> Result<(), String> {
    let props_json = serde_json::to_string(&record.props).map_err(|err| err.to_string())?;
    let props_text = build_props_text(record);
    let search_text = build_search_text(record);
    insert
        .execute(params![
            record.index as i64,
            record.name,
            record.smiles,
            record.molblock,
            props_json,
            props_text,
            search_text,
        ])
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn build_search_text(record: &GridInputRecord) -> String {
    let mut parts = vec![record.name.to_lowercase()];
    if let Some(smiles) = &record.smiles {
        parts.push(smiles.to_lowercase());
    }
    let props_text = build_props_text(record);
    if !props_text.is_empty() {
        parts.push(props_text.to_lowercase());
    }
    parts.join("\n")
}

fn build_props_text(record: &GridInputRecord) -> String {
    let mut parts = Vec::new();
    for (key, value) in &record.props {
        parts.push(key.as_str());
        parts.push(value.as_str());
    }
    parts.join("\n")
}

fn normalize_grid_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn fts_query(query: &str) -> Option<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    for ch in query.chars() {
        if ch.is_alphanumeric() {
            token.push(ch);
        } else if !token.is_empty() {
            tokens.push(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    if tokens.is_empty() {
        return None;
    }
    Some(
        tokens
            .into_iter()
            .take(16)
            .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn parse_delimited_line(line: &str, separator: char) -> Vec<String> {
    let chars: Vec<_> = line.chars().collect();
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut index = 0;
    let mut in_quotes = false;
    while index < chars.len() {
        let ch = chars[index];
        if ch == '"' {
            if in_quotes && index + 1 < chars.len() && chars[index + 1] == '"' {
                field.push(ch);
                index += 1;
            } else {
                in_quotes = !in_quotes;
            }
        } else if ch == separator && !in_quotes {
            fields.push(field);
            field = String::new();
        } else {
            field.push(ch);
        }
        index += 1;
    }
    fields.push(field);
    fields
}

fn is_smiles_column(value: &str) -> bool {
    matches!(
        value,
        "smiles" | "smile" | "canonical_smiles" | "isomeric_smiles" | "cxsmiles" | "smiles_string"
    )
}

fn resolve_smiles_column(
    headers: &[String],
    normalized_headers: &[String],
    data_rows: &[String],
    separator: char,
    explicit_column: Option<&str>,
) -> Result<usize, String> {
    if let Some(column) = explicit_column
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return explicit_smiles_column_index(headers, normalized_headers, column);
    }

    let named: Vec<_> = normalized_headers
        .iter()
        .enumerate()
        .filter_map(|(index, value)| is_smiles_column(value).then_some(index))
        .collect();
    if named.len() == 1 {
        return Ok(named[0]);
    }
    if named.len() > 1 {
        return Err(ambiguous_smiles_columns_error(headers, &named));
    }

    let inferred = infer_smiles_columns_from_values(headers.len(), data_rows, separator);
    if inferred.len() == 1 {
        return Ok(inferred[0]);
    }
    if inferred.len() > 1 {
        return Err(ambiguous_smiles_columns_error(headers, &inferred));
    }

    Err("missing smiles column".to_string())
}

fn explicit_smiles_column_index(
    headers: &[String],
    normalized_headers: &[String],
    column: &str,
) -> Result<usize, String> {
    let normalized_column = normalize_column_name(column);
    if let Some(index) = normalized_headers
        .iter()
        .position(|header| header == &normalized_column)
    {
        return Ok(index);
    }
    if let Ok(index) = column.parse::<usize>() {
        if (1..=headers.len()).contains(&index) {
            return Ok(index - 1);
        }
    }
    Err(format!("unknown structure column: {column}"))
}

fn infer_smiles_columns_from_values(
    column_count: usize,
    data_rows: &[String],
    separator: char,
) -> Vec<usize> {
    let mut candidates = Vec::new();
    for column_index in 0..column_count {
        let mut values = 0usize;
        let mut smiles_values = 0usize;
        for row in data_rows {
            let cells = parse_delimited_line(row, separator);
            let value = cells
                .get(column_index)
                .map(|cell| cell.trim())
                .unwrap_or("");
            if value.is_empty() {
                continue;
            }
            values += 1;
            if looks_like_smiles(value) {
                smiles_values += 1;
            }
        }
        if values > 0 && values == smiles_values {
            candidates.push(column_index);
        }
    }
    candidates
}

fn ambiguous_smiles_columns_error(headers: &[String], indexes: &[usize]) -> String {
    let names = indexes
        .iter()
        .map(|index| column_label(headers, *index))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "multiple possible structure columns: {names}. Rename the intended column to smiles or keep only one structure column"
    )
}

fn column_label(headers: &[String], index: usize) -> String {
    headers
        .get(index)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| format!("'{value}'"))
        .unwrap_or_else(|| format!("column {}", index + 1))
}

pub(crate) fn delimited_smiles_column_choices(
    extension: &str,
    text: &str,
) -> Result<Vec<GridDelimitedColumnChoice>, String> {
    let separator = match extension {
        "csv" => ',',
        "tsv" => '\t',
        _ => return Err(format!("Unsupported delimited extension: {extension}")),
    };
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let Some(header_line) = rows.first() else {
        return Ok(Vec::new());
    };
    let headers: Vec<_> = parse_delimited_line(header_line, separator)
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect();
    if !is_likely_delimited_header(&headers) {
        return Ok(Vec::new());
    }
    let normalized_headers: Vec<_> = headers
        .iter()
        .map(|value| normalize_column_name(value))
        .collect();
    let named: Vec<_> = normalized_headers
        .iter()
        .enumerate()
        .filter_map(|(index, value)| is_smiles_column(value).then_some(index))
        .collect();
    let indexes = if named.is_empty() {
        infer_smiles_columns_from_values(headers.len(), &rows[1..], separator)
    } else {
        named
    };
    Ok(indexes
        .into_iter()
        .map(|index| GridDelimitedColumnChoice {
            index: index + 1,
            name: headers
                .get(index)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or("Column")
                .to_string(),
        })
        .collect())
}

fn normalize_column_name(value: &str) -> String {
    value.trim().to_lowercase().replace(' ', "_")
}

fn is_likely_delimited_header(cells: &[String]) -> bool {
    cells
        .iter()
        .map(|value| normalize_column_name(value))
        .any(|value| {
            is_smiles_column(&value)
                || matches!(
                    value.as_str(),
                    "id" | "name" | "title" | "compound" | "molecule" | "structure" | "inchi"
                )
        })
}

fn looks_like_smiles(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.contains(char::is_whitespace) {
        return false;
    }
    let lowered = trimmed.to_lowercase();
    if matches!(
        lowered.as_str(),
        "smiles"
            | "smile"
            | "id"
            | "name"
            | "title"
            | "compound"
            | "molecule"
            | "structure"
            | "inchi"
    ) {
        return false;
    }
    let mut chars = trimmed.chars().peekable();
    let mut has_atom = false;
    let mut has_aromatic_atom = false;
    let mut has_structural_marker = false;
    while let Some(ch) = chars.next() {
        if ch.is_ascii_digit() || "[]=#@+-/\\().,:".contains(ch) {
            has_structural_marker = true;
        } else if matches!((ch, chars.peek()), ('B', Some(&'r')) | ('C', Some(&'l'))) {
            has_atom = true;
            chars.next();
        } else if "BCNOFPSIKH".contains(ch) {
            has_atom = true;
        } else if "bcnops".contains(ch) {
            has_atom = true;
            has_aromatic_atom = true;
        } else {
            return false;
        }
    }
    has_atom && (!has_aromatic_atom || has_structural_marker)
}

fn parse_sdf_properties(lines: &[String]) -> BTreeMap<String, String> {
    let mut props = BTreeMap::new();
    let mut index = 0;
    while index < lines.len() {
        let line = &lines[index];
        if !line.starts_with('>') {
            index += 1;
            continue;
        }
        let name = property_name(line);
        index += 1;
        let mut values = Vec::new();
        while index < lines.len() {
            let value_line = &lines[index];
            if value_line.starts_with('>') {
                break;
            }
            if value_line.trim().is_empty() {
                index += 1;
                break;
            }
            values.push(value_line.as_str());
            index += 1;
        }
        if let Some(name) = name.filter(|value| !value.is_empty()) {
            let value = values.join("\n").trim().to_string();
            if !value.is_empty() && props.len() < 64 {
                props.insert(clipped(&name, 80), clipped(&value, 500));
            }
        }
    }
    props
}

fn property_name(line: &str) -> Option<String> {
    let open = line.find('<')?;
    let close = line[open + 1..].find('>')? + open + 1;
    (open < close).then(|| line[open + 1..close].trim().to_string())
}

fn extract_molblock(lines: &[String]) -> String {
    if let Some(end) = lines.iter().position(|line| line.trim() == "M  END") {
        return lines[..=end].join("\n");
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_runtime_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("burrete-grid-store-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp runtime dir");
        dir
    }

    fn build_store(
        runtime_dir: &Path,
        extension: &str,
        data: &[u8],
    ) -> (PathBuf, GridCollectionSummary) {
        let handle = build_grid_store(runtime_dir, extension, data)
            .expect("build grid store")
            .expect("collection");
        (handle.database_path, handle.summary)
    }

    fn wait_for_index_ready(database_path: &Path) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        while std::time::Instant::now() < deadline {
            let connection = Connection::open(database_path).expect("open database");
            if read_index_state(&connection)
                .expect("read index state")
                .index_ready
            {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("grid index did not become ready");
    }

    #[test]
    fn builds_csv_store_and_fetches_sorted_pages() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.format, "csv");
        assert_eq!(summary.records_total, 3);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "name".to_string(),
                offset: 0,
                limit: 2,
            },
        )
        .expect("fetch page");
        assert_eq!(page.total_rows, 3);
        assert_eq!(page.rows.len(), 2);
        assert_eq!(page.rows[0].name, "Benzene");
        assert_eq!(
            page.rows[0].props.get("series").map(String::as_str),
            Some("Beta")
        );
        assert_eq!(page.rows[1].name, "Ethanol");

        let filtered = fetch_page(
            &database_path,
            &GridQuery {
                query: "gamma".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch filtered page");
        assert_eq!(filtered.total_rows, 1);
        assert_eq!(filtered.rows.len(), 1);
        assert_eq!(filtered.rows[0].name, "Ethylamine");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn ingests_headerless_tsv_rows_as_smiles_records() {
        let runtime_dir = temp_runtime_dir();
        let tsv = "CCO\tEthanol\t42\nCCN\tEthylamine\t17\n";

        let (database_path, summary) = build_store(&runtime_dir, "tsv", tsv.as_bytes());
        assert_eq!(summary.format, "tsv");
        assert_eq!(summary.records_total, 2);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: "column 3".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.total_rows, 2);
        assert_eq!(page.rows.len(), 2);
        assert_eq!(
            page.rows[0].props.get("Column 3").map(String::as_str),
            Some("42")
        );
        assert_eq!(page.rows[1].name, "Ethylamine");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn infers_single_smiles_column_from_csv_values() {
        let runtime_dir = temp_runtime_dir();
        let csv = "compound,structure,series\nLigand A,CCO,Alpha\nLigand B,c1ccccc1,Beta\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.format, "csv");
        assert_eq!(summary.records_total, 2);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.rows[0].name, "Ligand A");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCO"));
        assert_eq!(
            page.rows[0].props.get("series").map(String::as_str),
            Some("Alpha")
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn rejects_ambiguous_delimited_structure_columns() {
        let runtime_dir = temp_runtime_dir();
        let csv = "compound,active,decoy\nLigand A,CCO,CCN\nLigand B,c1ccccc1,CCCl\n";

        let error = build_grid_store(&runtime_dir, "csv", csv.as_bytes())
            .expect_err("ambiguous structure columns should fail");
        assert!(error.contains("multiple possible structure columns"));
        assert!(error.contains("'active'"));
        assert!(error.contains("'decoy'"));

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn rejects_multiple_named_smiles_columns() {
        let runtime_dir = temp_runtime_dir();
        let csv = "canonical_smiles,isomeric_smiles,name\nCCO,CCO,Ethanol\nCCN,CCN,Ethylamine\n";

        let error = build_grid_store(&runtime_dir, "csv", csv.as_bytes())
            .expect_err("multiple named structure columns should fail");
        assert!(error.contains("multiple possible structure columns"));
        assert!(error.contains("'canonical_smiles'"));
        assert!(error.contains("'isomeric_smiles'"));

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn uses_explicit_column_for_ambiguous_delimited_table() {
        let runtime_dir = temp_runtime_dir();
        let csv = "compound,active,decoy\nLigand A,CCO,CCN\nLigand B,c1ccccc1,CCCl\n";

        let handle = build_grid_store_with_options(
            &runtime_dir,
            "csv",
            csv.as_bytes(),
            &GridParseOptions {
                smiles_column: Some("decoy".to_string()),
            },
        )
        .expect("build grid store")
        .expect("collection");
        assert_eq!(handle.summary.records_total, 2);

        let page = fetch_page(
            &handle.database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCN"));
        assert_eq!(
            page.rows[0].props.get("active").map(String::as_str),
            Some("CCO")
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn build_grid_store_returns_after_initial_batch_for_large_collections() {
        let runtime_dir = temp_runtime_dir();
        let mut smiles = String::new();
        for index in 0..10_000 {
            smiles.push_str(&format!("CC{index} Molecule {index:05}\n"));
        }

        let (database_path, summary) = build_store(&runtime_dir, "smi", smiles.as_bytes());
        assert_eq!(summary.format, "smiles");
        assert_eq!(summary.records_indexed, GRID_INITIAL_ROWS);
        assert_eq!(summary.records_total, GRID_INITIAL_ROWS);
        assert!(!summary.index_ready);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch initial page");
        assert_eq!(page.rows.len(), 96);
        assert!(page.records_indexed >= GRID_INITIAL_ROWS);
        assert!(!page.rows.is_empty());

        wait_for_index_ready(&database_path);
        let ready_page = fetch_page(
            &database_path,
            &GridQuery {
                query: "Molecule 09999".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch completed page");
        assert!(ready_page.index_ready);
        assert_eq!(ready_page.records_total_hint, Some(10_000));
        assert_eq!(ready_page.total_rows, 1);
        assert_eq!(ready_page.rows[0].name, "Molecule 09999");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn unregister_cancels_and_removes_grid_runtime() {
        let runtime_dir = temp_runtime_dir();
        let mut smiles = String::new();
        for index in 0..2_000 {
            smiles.push_str(&format!("CC{index} Molecule {index:05}\n"));
        }
        let handle = build_grid_store(&runtime_dir, "smi", smiles.as_bytes())
            .expect("build grid store")
            .expect("collection");
        let registry = GridRuntimeRegistry::default();
        registry
            .register(
                "doc-grid",
                handle.database_path.clone(),
                handle.summary.format,
                handle.cancel_token.clone(),
            )
            .expect("register grid runtime");
        registry
            .unregister("doc-grid")
            .expect("unregister grid runtime");
        assert!(handle.cancel_token.load(Ordering::Relaxed));
        assert!(!runtime_dir.exists());
        let missing = registry.fetch_page(
            "doc-grid",
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        );
        assert!(missing.is_err());
    }

    #[test]
    fn fts_search_covers_name_smiles_and_properties() {
        let runtime_dir = temp_runtime_dir();
        let csv = "smiles,name,series,assay\n\
                   CCO,Ethanol,Alpha,solvent\n\
                   c1ccccc1,Benzene,Beta,aromatic\n\
                   CCN,Ethylamine,Gamma,amine\n";

        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        let connection = Connection::open(&database_path).expect("open database");
        let fts_rows = connection
            .query_row("select count(*) from molecules_fts", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count fts rows");
        assert_eq!(fts_rows, 3);

        let by_name = fetch_page(
            &database_path,
            &GridQuery {
                query: "benzene".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch by name");
        assert_eq!(by_name.total_rows, 1);
        assert_eq!(by_name.rows[0].name, "Benzene");

        let by_smiles = fetch_page(
            &database_path,
            &GridQuery {
                query: "CCN".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch by smiles");
        assert_eq!(by_smiles.total_rows, 1);
        assert_eq!(by_smiles.rows[0].name, "Ethylamine");

        let by_property = fetch_page(
            &database_path,
            &GridQuery {
                query: "aromatic".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch by property");
        assert_eq!(by_property.total_rows, 1);
        assert_eq!(by_property.rows[0].name, "Benzene");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn empty_query_and_fallback_preserve_existing_like_behavior() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());

        let empty = fetch_page(
            &database_path,
            &GridQuery {
                query: "   ".to_string(),
                sort: "name".to_string(),
                offset: 0,
                limit: 2,
            },
        )
        .expect("fetch empty query");
        assert_eq!(empty.total_rows, 3);
        assert_eq!(empty.rows.len(), 2);
        assert_eq!(empty.rows[0].name, "Benzene");

        let substring = fetch_page(
            &database_path,
            &GridQuery {
                query: "eth".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch substring fallback");
        assert_eq!(substring.total_rows, 2);
        assert_eq!(
            substring
                .rows
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Ethanol", "Ethylamine"]
        );

        let connection = Connection::open(&database_path).expect("open database");
        connection
            .execute("drop table molecules_fts", [])
            .expect("drop fts table");
        let missing_fts = fetch_page(
            &database_path,
            &GridQuery {
                query: "gamma".to_string(),
                sort: "index".to_string(),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch through missing fts fallback");
        assert_eq!(missing_fts.total_rows, 1);
        assert_eq!(missing_fts.rows[0].name, "Ethylamine");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn fts_filtered_pages_preserve_sort_and_pagination() {
        let runtime_dir = temp_runtime_dir();
        let mut csv = String::from("smiles,name,series\n");
        for index in 0..260 {
            let name = format!("Mol {:03}", 260 - index);
            csv.push_str(&format!("CC{index},{name},SharedNeedle\n"));
        }

        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        wait_for_index_ready(&database_path);
        let first_page = fetch_page(
            &database_path,
            &GridQuery {
                query: "SharedNeedle".to_string(),
                sort: "name".to_string(),
                offset: 0,
                limit: 25,
            },
        )
        .expect("fetch first page");
        let second_page = fetch_page(
            &database_path,
            &GridQuery {
                query: "SharedNeedle".to_string(),
                sort: "name".to_string(),
                offset: 25,
                limit: 25,
            },
        )
        .expect("fetch second page");
        assert_eq!(first_page.total_rows, 260);
        assert_eq!(first_page.rows.len(), 25);
        assert_eq!(second_page.rows.len(), 25);
        assert_eq!(first_page.rows[0].name, "Mol 001");
        assert_eq!(first_page.rows[24].name, "Mol 025");
        assert_eq!(second_page.rows[0].name, "Mol 026");
        assert!(first_page.rows.iter().all(|row| !second_page
            .rows
            .iter()
            .any(|other| other.index == row.index)));

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn limit_clamp_and_unknown_sort_remain_deterministic() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        let oversized = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "prop:series".to_string(),
                offset: 0,
                limit: 1000,
            },
        )
        .expect("fetch oversized limit");
        assert_eq!(oversized.limit, 240);
        assert_eq!(
            oversized
                .rows
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Ethanol", "Benzene", "Ethylamine"]
        );

        let past_end = fetch_page(
            &database_path,
            &GridQuery {
                query: "gamma".to_string(),
                sort: "index".to_string(),
                offset: 10,
                limit: 0,
            },
        )
        .expect("fetch past end");
        assert_eq!(past_end.limit, 1);
        assert_eq!(past_end.total_rows, 1);
        assert!(past_end.rows.is_empty());

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    #[ignore = "50k row perf smoke is opt-in for local developer runs"]
    fn fts_search_is_faster_than_like_on_synthetic_collection() {
        let runtime_dir = temp_runtime_dir();
        let mut csv = String::from("smiles,name,series\n");
        for index in 0..50_000 {
            let marker = if index == 42_424 {
                "NeedlePerfMarker"
            } else {
                "BulkPerfMarker"
            };
            csv.push_str(&format!("CC{index},Molecule {index:05},{marker}\n"));
        }

        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        wait_for_index_ready(&database_path);
        let connection = Connection::open(&database_path).expect("open database");
        let fts_query = fts_query("NeedlePerfMarker").expect("fts query");
        let started = std::time::Instant::now();
        let fts_total = fetch_filtered_page_with_fts(
            &connection,
            &fts_query,
            sort_sql("index"),
            96,
            0,
            read_index_state(&connection).expect("read index state"),
        )
        .expect("fts query")
        .total_rows;
        let fts_elapsed = started.elapsed();

        let started = std::time::Instant::now();
        let like_total = fetch_filtered_page_with_like(
            &connection,
            "needleperfmarker",
            sort_sql("index"),
            96,
            0,
            read_index_state(&connection).expect("read index state"),
        )
        .expect("like query")
        .total_rows;
        let like_elapsed = started.elapsed();

        eprintln!(
            "grid_fts_ms={:?} grid_like_ms={:?}",
            fts_elapsed, like_elapsed
        );
        assert_eq!(fts_total, 1);
        assert_eq!(like_total, 1);
        assert!(
            fts_elapsed < like_elapsed,
            "expected FTS ({fts_elapsed:?}) to beat LIKE ({like_elapsed:?})"
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }
    #[test]
    fn lists_delimited_structure_column_choices() {
        let csv = "compound,active,decoy\nLigand A,CCO,CCN\nLigand B,c1ccccc1,CCCl\n";
        let choices =
            delimited_smiles_column_choices("csv", csv).expect("delimited column choices");
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0].index, 2);
        assert_eq!(choices[0].name, "active");
        assert_eq!(choices[1].index, 3);
        assert_eq!(choices[1].name, "decoy");
    }

    #[test]
    fn appends_sdf_records_to_existing_grid_store() {
        let runtime_dir = temp_runtime_dir();
        let sdf = "First\n  Burrete\n\nM  END\n$$$$\nSecond\n  Burrete\n\nM  END\n$$$$\n";

        let handle = build_grid_store(&runtime_dir, "sdf", sdf.as_bytes())
            .expect("build grid store")
            .expect("collection");
        assert_eq!(handle.summary.records_total, 2);

        let appended = append_grid_text(
            &handle.database_path,
            "sdf",
            "Third\n  Burrete\n\nM  END\n$$$$\n",
            &GridParseOptions::default(),
        )
        .expect("append sdf");
        assert_eq!(appended.records_appended, 1);
        assert_eq!(appended.total_rows, 3);

        let page = fetch_page(
            &handle.database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                offset: 2,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.total_rows, 3);
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].index, 2);
        assert_eq!(page.rows[0].name, "Third");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }
}
