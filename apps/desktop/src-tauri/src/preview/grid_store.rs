use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
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
    pub(crate) descriptor_ids: Vec<String>,
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
    pub(crate) include_single_sdf: bool,
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
    pub(crate) row_id: i64,
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) smiles: Option<String>,
    pub(crate) molblock: Option<String>,
    pub(crate) props: BTreeMap<String, String>,
    pub(crate) descriptors: BTreeMap<String, GridDescriptorCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridDescriptorCell {
    pub(crate) label: String,
    pub(crate) value: Option<serde_json::Value>,
    pub(crate) missing_kind: Option<String>,
    pub(crate) error_text: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GridQuery {
    pub(crate) query: String,
    pub(crate) sort: String,
    pub(crate) column_filters: Vec<GridColumnFilter>,
    pub(crate) descriptor_filters: Vec<GridDescriptorFilter>,
    pub(crate) descriptor_sort: Option<GridDescriptorSort>,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct GridColumnFilter {
    pub(crate) id: String,
    pub(crate) filter_type: String,
    pub(crate) text: Option<String>,
    pub(crate) min: Option<f64>,
    pub(crate) max: Option<f64>,
}

#[derive(Debug, Clone)]
pub(crate) struct GridDescriptorFilter {
    pub(crate) id: String,
    pub(crate) min: Option<f64>,
    pub(crate) max: Option<f64>,
}

#[derive(Debug, Clone)]
pub(crate) struct GridDescriptorSort {
    pub(crate) id: String,
    pub(crate) direction: String,
}

#[derive(Debug)]
struct GridInputRecord {
    index: usize,
    name: String,
    smiles: Option<String>,
    molblock: Option<String>,
    props: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GridDescriptorSourceRow {
    pub(crate) row_id: i64,
    pub(crate) name: String,
    pub(crate) smiles: Option<String>,
    pub(crate) molblock: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GridDescriptorValueInput {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) value: Option<serde_json::Value>,
    pub(crate) missing_kind: Option<String>,
    pub(crate) error_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridDescriptorRunSummary {
    pub(crate) total_rows: usize,
    pub(crate) calculated_rows: usize,
    pub(crate) failed_rows: usize,
    pub(crate) descriptor_id_count: usize,
    pub(crate) descriptor_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug)]
struct GridIndexState {
    records_indexed: usize,
    records_total: Option<usize>,
    index_ready: bool,
}

#[derive(Debug, Clone)]
struct PageSortClause {
    join_sql: &'static str,
    order_sql: String,
    params: Vec<SqlValue>,
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

    pub(crate) fn unregister_prefix(&self, document_id_prefix: &str) -> Result<(), String> {
        let entries = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "grid runtime registry is poisoned")?;
            let document_ids: Vec<String> = entries
                .keys()
                .filter(|document_id| document_id.starts_with(document_id_prefix))
                .cloned()
                .collect();
            document_ids
                .into_iter()
                .filter_map(|document_id| entries.remove(&document_id))
                .collect::<Vec<_>>()
        };
        for entry in entries {
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

    pub(crate) fn descriptor_source_row_count(&self, document_id: &str) -> Result<usize, String> {
        let database_path = self.database_path(document_id)?;
        descriptor_source_row_count(&database_path)
    }

    pub(crate) fn descriptor_database_path(&self, document_id: &str) -> Result<PathBuf, String> {
        self.database_path(document_id)
    }

    pub(crate) fn descriptor_run_summary(
        &self,
        document_id: &str,
    ) -> Result<GridDescriptorRunSummary, String> {
        let database_path = self.database_path(document_id)?;
        descriptor_run_summary_in_database(&database_path)
    }

    fn database_path(&self, document_id: &str) -> Result<PathBuf, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?;
        entries
            .get(document_id)
            .map(|entry| entry.database_path.clone())
            .ok_or_else(|| format!("grid runtime is unavailable for document {document_id}"))
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
    if first_batch.complete
        && !options.include_single_sdf
        && ((extension == "sdf" || extension == "sd") && records_indexed <= 1)
    {
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
    let sort_clause = page_sort_clause(query.descriptor_sort.as_ref(), &query.sort);
    if !query.descriptor_filters.is_empty() || !query.column_filters.is_empty() {
        return fetch_descriptor_filtered_page(
            &connection,
            &normalized_query,
            &query.column_filters,
            &query.descriptor_filters,
            &sort_clause,
            limit,
            offset,
            index_state,
        );
    }
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
            &sort_clause,
            limit,
            offset,
            index_state,
        );
    };

    let sql = format!(
        "select id, source_index, name, smiles, molblock, props_json \
         from molecules \
         {join_sql} \
         order by {order_sql} \
         limit ? offset ?",
        join_sql = sort_clause.join_sql,
        order_sql = sort_clause.order_sql
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut page_params = sort_clause.params;
    page_params.push(SqlValue::Integer(limit as i64));
    page_params.push(SqlValue::Integer(offset as i64));
    let rows = statement
        .query(params_from_iter(page_params.iter()))
        .map_err(|err| err.to_string())?;
    let mut page_rows = collect_page_rows(rows)?;
    attach_descriptor_cells(&connection, &mut page_rows)?;
    Ok(GridPageResult {
        rows: page_rows,
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
        descriptor_ids: descriptor_ids_in_connection(&connection)?,
    })
}

fn fetch_filtered_page(
    connection: &Connection,
    normalized_query: &str,
    sort_clause: &PageSortClause,
    limit: usize,
    offset: usize,
    index_state: GridIndexState,
) -> Result<GridPageResult, String> {
    if let Some(fts_query) = fts_query(normalized_query) {
        if let Ok(result) = fetch_filtered_page_with_fts(
            connection,
            &fts_query,
            sort_clause,
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
        sort_clause,
        limit,
        offset,
        index_state,
    )
}

fn fetch_filtered_page_with_fts(
    connection: &Connection,
    fts_query: &str,
    sort_clause: &PageSortClause,
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
        "select id, source_index, name, smiles, molblock, props_json \
         from molecules \
         {join_sql} \
         where id in (select rowid from molecules_fts where molecules_fts match ?) \
         order by {order_sql} \
         limit ? offset ?",
        join_sql = sort_clause.join_sql,
        order_sql = sort_clause.order_sql
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut page_params = sort_clause.params.clone();
    page_params.push(SqlValue::Text(fts_query.to_string()));
    page_params.push(SqlValue::Integer(limit as i64));
    page_params.push(SqlValue::Integer(offset as i64));
    let rows = statement
        .query(params_from_iter(page_params.iter()))
        .map_err(|err| err.to_string())?;
    Ok(GridPageResult {
        rows: {
            let mut page_rows = collect_page_rows(rows)?;
            attach_descriptor_cells(connection, &mut page_rows)?;
            page_rows
        },
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
        descriptor_ids: descriptor_ids_in_connection(connection)?,
    })
}

fn fetch_filtered_page_with_like(
    connection: &Connection,
    normalized_query: &str,
    sort_clause: &PageSortClause,
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
        "select id, source_index, name, smiles, molblock, props_json \
         from molecules \
         {join_sql} \
         where search_text like ? escape '\\' \
         order by {order_sql} \
         limit ? offset ?",
        join_sql = sort_clause.join_sql,
        order_sql = sort_clause.order_sql
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut page_params = sort_clause.params.clone();
    page_params.push(SqlValue::Text(pattern));
    page_params.push(SqlValue::Integer(limit as i64));
    page_params.push(SqlValue::Integer(offset as i64));
    let rows = statement
        .query(params_from_iter(page_params.iter()))
        .map_err(|err| err.to_string())?;
    Ok(GridPageResult {
        rows: {
            let mut page_rows = collect_page_rows(rows)?;
            attach_descriptor_cells(connection, &mut page_rows)?;
            page_rows
        },
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
        descriptor_ids: descriptor_ids_in_connection(connection)?,
    })
}

fn collect_page_rows(mut rows: rusqlite::Rows<'_>) -> Result<Vec<GridPageRow>, String> {
    let mut page_rows = Vec::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let row_id = row.get::<_, i64>(0).map_err(|err| err.to_string())?;
        let props_json: String = row.get(5).map_err(|err| err.to_string())?;
        page_rows.push(GridPageRow {
            row_id,
            index: row.get::<_, i64>(1).map_err(|err| err.to_string())? as usize,
            name: row.get(2).map_err(|err| err.to_string())?,
            smiles: row.get(3).map_err(|err| err.to_string())?,
            molblock: row.get(4).map_err(|err| err.to_string())?,
            props: serde_json::from_str(&props_json).map_err(|err| err.to_string())?,
            descriptors: BTreeMap::new(),
        });
    }
    Ok(page_rows)
}

fn attach_descriptor_cells(
    connection: &Connection,
    page_rows: &mut [GridPageRow],
) -> Result<(), String> {
    if page_rows.is_empty() {
        return Ok(());
    }
    let row_ids = page_rows.iter().map(|row| row.row_id).collect::<Vec<_>>();
    let placeholders = vec!["?"; row_ids.len()].join(", ");
    let sql = format!(
        "select molecule_id, descriptor_id, label, value_real, value_text, missing_kind, error_text
         from descriptor_values
         where molecule_id in ({placeholders})
         order by molecule_id, descriptor_id collate nocase"
    );
    let mut descriptor_statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut rows = descriptor_statement
        .query(params_from_iter(row_ids.iter()))
        .map_err(|err| err.to_string())?;
    let mut values_by_row_id: HashMap<i64, BTreeMap<String, GridDescriptorCell>> = HashMap::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let molecule_id: i64 = row.get(0).map_err(|err| err.to_string())?;
        let descriptor_id: String = row.get(1).map_err(|err| err.to_string())?;
        let value_real: Option<f64> = row.get(3).map_err(|err| err.to_string())?;
        let value_text: Option<String> = row.get(4).map_err(|err| err.to_string())?;
        values_by_row_id.entry(molecule_id).or_default().insert(
            descriptor_id,
            GridDescriptorCell {
                label: row.get(2).map_err(|err| err.to_string())?,
                value: value_real
                    .map(serde_json::Value::from)
                    .or_else(|| value_text.map(serde_json::Value::from)),
                missing_kind: row.get(5).map_err(|err| err.to_string())?,
                error_text: row.get(6).map_err(|err| err.to_string())?,
            },
        );
    }
    for page_row in page_rows {
        page_row.descriptors = values_by_row_id
            .remove(&page_row.row_id)
            .unwrap_or_default();
    }
    Ok(())
}

fn sort_sql(sort: &str) -> &'static str {
    match sort {
        "name" => "name collate nocase asc, source_index asc",
        "smiles" => "coalesce(smiles, '') collate nocase asc, source_index asc",
        _ => "source_index asc",
    }
}

fn page_sort_clause(
    descriptor_sort: Option<&GridDescriptorSort>,
    fallback_sort: &str,
) -> PageSortClause {
    let Some(sort) = descriptor_sort else {
        return PageSortClause {
            join_sql: "",
            order_sql: sort_sql(fallback_sort).to_string(),
            params: Vec::new(),
        };
    };
    if !is_descriptor_identifier(&sort.id) {
        return PageSortClause {
            join_sql: "",
            order_sql: sort_sql(fallback_sort).to_string(),
            params: Vec::new(),
        };
    }
    let direction = if sort.direction.eq_ignore_ascii_case("desc") {
        "desc"
    } else {
        "asc"
    };
    PageSortClause {
        join_sql: "left join descriptor_values descriptor_sort on descriptor_sort.molecule_id = molecules.id and descriptor_sort.descriptor_id = ?",
        order_sql: format!(
            "descriptor_sort.value_real is null asc, descriptor_sort.value_real {direction}, source_index asc"
        ),
        params: vec![SqlValue::Text(sort.id.clone())],
    }
}

fn fetch_descriptor_filtered_page(
    connection: &Connection,
    normalized_query: &str,
    column_filters: &[GridColumnFilter],
    filters: &[GridDescriptorFilter],
    sort_clause: &PageSortClause,
    limit: usize,
    offset: usize,
    index_state: GridIndexState,
) -> Result<GridPageResult, String> {
    let (filter_sql, filter_params) = descriptor_filter_sql(filters)?;
    let mut clauses = Vec::new();
    let mut query_params: Vec<SqlValue> = Vec::new();
    if !normalized_query.is_empty() {
        clauses.push("search_text like ? escape '\\'".to_string());
        query_params.push(SqlValue::Text(like_pattern(normalized_query)));
    }
    let (column_filter_sql, column_filter_params) = column_filter_sql(column_filters)?;
    if !column_filter_sql.is_empty() {
        clauses.push(column_filter_sql);
        query_params.extend(column_filter_params);
    }
    if !filter_sql.is_empty() {
        clauses.push(filter_sql);
        query_params.extend(filter_params);
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" where {}", clauses.join(" and "))
    };
    let count_sql = format!("select count(*) from molecules{where_sql}");
    let total_rows = connection
        .query_row(&count_sql, params_from_iter(query_params.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|err| err.to_string())? as usize;
    let page_sql = format!(
        "select id, source_index, name, smiles, molblock, props_json
         from molecules
         {join_sql}
         {where_sql}
         order by {order_sql}
         limit ? offset ?",
        join_sql = sort_clause.join_sql,
        order_sql = sort_clause.order_sql
    );
    let mut page_params = sort_clause.params.clone();
    page_params.extend(query_params);
    page_params.push(SqlValue::Integer(limit as i64));
    page_params.push(SqlValue::Integer(offset as i64));
    let mut statement = connection
        .prepare(&page_sql)
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query(params_from_iter(page_params.iter()))
        .map_err(|err| err.to_string())?;
    let mut page_rows = collect_page_rows(rows)?;
    attach_descriptor_cells(connection, &mut page_rows)?;
    Ok(GridPageResult {
        rows: page_rows,
        total_rows,
        offset,
        limit,
        indexing: !index_state.index_ready,
        records_indexed: index_state.records_indexed,
        records_total_hint: index_state.records_total,
        index_ready: index_state.index_ready,
        descriptor_ids: descriptor_ids_in_connection(connection)?,
    })
}

fn descriptor_filter_sql(
    filters: &[GridDescriptorFilter],
) -> Result<(String, Vec<SqlValue>), String> {
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    for filter in filters {
        if !is_descriptor_identifier(&filter.id) {
            return Err(format!("Invalid descriptor filter id: {}", filter.id));
        }
        let mut clause = "exists (select 1 from descriptor_values where molecule_id = molecules.id and descriptor_id = ?".to_string();
        params.push(SqlValue::Text(filter.id.clone()));
        if let Some(min) = filter.min {
            clause.push_str(" and value_real >= ?");
            params.push(SqlValue::Real(min));
        }
        if let Some(max) = filter.max {
            clause.push_str(" and value_real <= ?");
            params.push(SqlValue::Real(max));
        }
        clause.push(')');
        clauses.push(clause);
    }
    Ok((clauses.join(" and "), params))
}

fn column_filter_sql(filters: &[GridColumnFilter]) -> Result<(String, Vec<SqlValue>), String> {
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    for filter in filters {
        let filter_type = filter.filter_type.as_str();
        if filter_type == "number" {
            let Some(expression) = numeric_column_expression(&filter.id)? else {
                continue;
            };
            let mut parts = Vec::new();
            if let Some(min) = filter.min {
                parts.push(format!("{expression} >= ?"));
                params.push(SqlValue::Real(min));
            }
            if let Some(max) = filter.max {
                parts.push(format!("{expression} <= ?"));
                params.push(SqlValue::Real(max));
            }
            if !parts.is_empty() {
                clauses.push(format!("({})", parts.join(" and ")));
            }
            continue;
        }
        let Some(text) = filter
            .text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(expression) = text_column_expression(&filter.id)? else {
            continue;
        };
        clauses.push(format!(
            "lower(coalesce({expression}, '')) like ? escape '\\'"
        ));
        params.push(SqlValue::Text(like_pattern(&text.to_lowercase())));
    }
    Ok((clauses.join(" and "), params))
}

fn numeric_column_expression(id: &str) -> Result<Option<String>, String> {
    if id == "index" {
        return Ok(Some("(source_index + 1)".to_string()));
    }
    if let Some(key) = id.strip_prefix("prop:") {
        return property_json_number_expression(key).map(Some);
    }
    Ok(None)
}

fn text_column_expression(id: &str) -> Result<Option<String>, String> {
    match id {
        "name" => Ok(Some("name".to_string())),
        "smiles" => Ok(Some("smiles".to_string())),
        _ => {
            if let Some(key) = id.strip_prefix("prop:") {
                return property_json_text_expression(key).map(Some);
            }
            Ok(None)
        }
    }
}

fn property_json_text_expression(key: &str) -> Result<String, String> {
    Ok(format!(
        "json_extract(props_json, '{}')",
        property_json_path(key)?
    ))
}

fn property_json_number_expression(key: &str) -> Result<String, String> {
    Ok(format!(
        "cast(json_extract(props_json, '{}') as real)",
        property_json_path(key)?
    ))
}

fn property_json_path(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 120 {
        return Err(format!("Invalid property filter id: prop:{key}"));
    }
    let escaped = key
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\'', "''");
    Ok(format!("$.\"{escaped}\""))
}

fn is_descriptor_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn descriptor_ids_in_connection(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("select distinct descriptor_id from descriptor_values order by descriptor_id")
        .map_err(|err| err.to_string())?;
    let descriptor_ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(descriptor_ids)
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
        let options = GridParseOptions {
            smiles_column,
            ..GridParseOptions::default()
        };
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
             create table if not exists descriptor_values (
                 molecule_id integer not null references molecules(id) on delete cascade,
                 descriptor_id text not null,
                 label text not null,
                 value_real real,
                 value_text text,
                 missing_kind text,
                 error_text text,
                 updated_at_ms integer not null,
                 primary key (molecule_id, descriptor_id)
             );
             create index if not exists descriptor_values_descriptor_real
                 on descriptor_values(descriptor_id, value_real);
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

pub(crate) fn descriptor_source_row_count(database_path: &Path) -> Result<usize, String> {
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    connection
        .query_row("select count(*) from molecules", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|err| err.to_string())
        .and_then(|count| {
            usize::try_from(count).map_err(|_| format!("Invalid molecule count: {count}"))
        })
}

pub(crate) fn descriptor_source_row_batch(
    database_path: &Path,
    offset: usize,
    limit: usize,
) -> Result<Vec<GridDescriptorSourceRow>, String> {
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let mut statement = connection
        .prepare(
            "select id, name, smiles, molblock
             from molecules
             order by source_index asc
             limit ?1 offset ?2",
        )
        .map_err(|err| err.to_string())?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let offset = i64::try_from(offset).unwrap_or(i64::MAX);
    let mut rows = statement
        .query(params![limit, offset])
        .map_err(|err| err.to_string())?;
    let mut source_rows = Vec::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        source_rows.push(GridDescriptorSourceRow {
            row_id: row.get(0).map_err(|err| err.to_string())?,
            name: row.get(1).map_err(|err| err.to_string())?,
            smiles: row.get(2).map_err(|err| err.to_string())?,
            molblock: row.get(3).map_err(|err| err.to_string())?,
        });
    }
    Ok(source_rows)
}

pub(crate) fn descriptor_source_rows_by_indices(
    database_path: &Path,
    indexes: &[usize],
) -> Result<Vec<GridDescriptorSourceRow>, String> {
    if indexes.is_empty() {
        return Ok(Vec::new());
    }
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let placeholders = std::iter::repeat_n("?", indexes.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "select id, name, smiles, molblock
         from molecules
         where source_index in ({placeholders})
         order by source_index asc"
    );
    let params = indexes
        .iter()
        .map(|index| SqlValue::Integer(i64::try_from(*index).unwrap_or(i64::MAX)));
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut rows = statement
        .query(params_from_iter(params))
        .map_err(|err| err.to_string())?;
    let mut source_rows = Vec::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        source_rows.push(GridDescriptorSourceRow {
            row_id: row.get(0).map_err(|err| err.to_string())?,
            name: row.get(1).map_err(|err| err.to_string())?,
            smiles: row.get(2).map_err(|err| err.to_string())?,
            molblock: row.get(3).map_err(|err| err.to_string())?,
        });
    }
    Ok(source_rows)
}

pub(crate) fn replace_descriptor_values_in_database(
    database_path: &Path,
    row_id: i64,
    values: &[GridDescriptorValueInput],
) -> Result<(), String> {
    let mut connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let tx = connection.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "delete from descriptor_values where molecule_id = ?1",
        params![row_id],
    )
    .map_err(|err| err.to_string())?;
    let updated_at_ms = current_time_millis();
    {
        let mut statement = tx
            .prepare(
                "insert into descriptor_values (
                   molecule_id, descriptor_id, label, value_real, value_text,
                   missing_kind, error_text, updated_at_ms
                 )
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|err| err.to_string())?;
        for value in values {
            let (value_real, value_text) = descriptor_storage_value(&value.value);
            statement
                .execute(params![
                    row_id,
                    value.id,
                    value.label,
                    value_real,
                    value_text,
                    value.missing_kind,
                    value.error_text,
                    updated_at_ms,
                ])
                .map_err(|err| err.to_string())?;
        }
    }
    tx.commit().map_err(|err| err.to_string())
}

pub(crate) fn descriptor_run_summary_in_database(
    database_path: &Path,
) -> Result<GridDescriptorRunSummary, String> {
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let total_rows = molecule_count(&connection)?;
    let calculated_rows = connection
        .query_row(
            "select count(distinct molecule_id) from descriptor_values where descriptor_id <> 'error'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())? as usize;
    let failed_rows = connection
        .query_row(
            "select count(distinct molecule_id) from descriptor_values where descriptor_id = 'error' and error_text is not null",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())? as usize;
    let descriptor_ids = descriptor_ids_in_connection(&connection)?;
    Ok(GridDescriptorRunSummary {
        total_rows,
        calculated_rows,
        failed_rows,
        descriptor_id_count: descriptor_ids.len(),
        descriptor_ids,
    })
}

fn descriptor_storage_value(value: &Option<serde_json::Value>) -> (Option<f64>, Option<String>) {
    match value {
        Some(serde_json::Value::Number(number)) => (number.as_f64(), None),
        Some(serde_json::Value::String(text)) => (None, Some(clipped(text, 4096))),
        Some(serde_json::Value::Bool(value)) => (None, Some(value.to_string())),
        Some(other) => (None, Some(clipped(&other.to_string(), 4096))),
        None => (None, None),
    }
}

fn current_time_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
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
    let inferred_smiles_indexes =
        infer_smiles_columns_from_values(headers.len(), &rows[1..], separator);
    let first_row_looks_like_data = headers.iter().any(|value| looks_like_smiles(value));
    if !is_likely_delimited_header(&headers)
        && (inferred_smiles_indexes.is_empty() || first_row_looks_like_data)
    {
        return Err("missing smiles column".to_string());
    }
    let normalized_headers: Vec<_> = headers
        .iter()
        .map(|value| normalize_column_name(value))
        .collect();
    let smiles_indexes = resolve_smiles_columns(
        &headers,
        &normalized_headers,
        options.smiles_column.as_deref(),
        &inferred_smiles_indexes,
    )?;
    let has_multiple_smiles_columns = smiles_indexes.len() > 1;
    let name_index = normalized_headers
        .iter()
        .enumerate()
        .position(|(index, value)| {
            !smiles_indexes.contains(&index)
                && matches!(
                    value.as_str(),
                    "compound_id" | "id" | "name" | "title" | "compound"
                )
        });
    let mut records = Vec::new();
    let mut next_line = start_line.max(1).min(rows.len());
    let mut next_index = start_index;
    while next_line < rows.len() {
        let row_number = next_line;
        let cells = parse_delimited_line(&rows[next_line], separator);
        next_line += 1;
        for smiles_index in &smiles_indexes {
            let Some(smiles) = cells
                .get(*smiles_index)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let raw_name = name_index
                .and_then(|index| cells.get(index))
                .map(|value| value.trim())
                .unwrap_or("");
            let base_name = if raw_name.is_empty() {
                format!("Molecule {}", row_number)
            } else {
                clipped(raw_name, 160)
            };
            let name = if has_multiple_smiles_columns {
                format!(
                    "{} {}",
                    base_name,
                    column_label(&headers, *smiles_index).trim_matches('\'')
                )
            } else {
                base_name
            };
            let mut props = BTreeMap::new();
            props.insert("CSV row".to_string(), row_number.to_string());
            props.insert(
                "SMILES column".to_string(),
                column_label(&headers, *smiles_index)
                    .trim_matches('\'')
                    .to_string(),
            );
            for (index, header) in headers.iter().enumerate() {
                if smiles_indexes.contains(&index) || Some(index) == name_index {
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
    value == "smile" || value.contains("smiles")
}

fn resolve_smiles_columns(
    headers: &[String],
    normalized_headers: &[String],
    explicit_column: Option<&str>,
    inferred_indexes: &[usize],
) -> Result<Vec<usize>, String> {
    if let Some(column) = explicit_column
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return explicit_smiles_column_index(headers, normalized_headers, column)
            .map(|index| vec![index]);
    }

    let named: Vec<_> = normalized_headers
        .iter()
        .enumerate()
        .filter_map(|(index, value)| is_smiles_column(value).then_some(index))
        .collect();
    let mut indexes = named;
    for index in inferred_indexes {
        if !indexes.contains(index) {
            indexes.push(*index);
        }
    }
    indexes.sort_unstable();
    if indexes.is_empty() {
        Err("missing smiles column".to_string())
    } else {
        Ok(indexes)
    }
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
        if is_likely_smiles_column(values, smiles_values) {
            candidates.push(column_index);
        }
    }
    candidates
}

fn is_likely_smiles_column(non_empty: usize, valid: usize) -> bool {
    if non_empty == 0 || valid == 0 {
        return false;
    }
    if valid < 2 && non_empty > 2 {
        return false;
    }
    valid * 5 >= non_empty * 4
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
    if trimmed.starts_with("InChI=") {
        return false;
    }
    if is_inchi_key(trimmed) {
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
        if ch == '[' {
            let mut has_bracket_atom = false;
            let mut closed_bracket = false;
            for bracket_ch in chars.by_ref() {
                if bracket_ch == ']' {
                    closed_bracket = true;
                    break;
                }
                if bracket_ch.is_ascii_alphabetic() {
                    has_bracket_atom = true;
                }
            }
            if !closed_bracket || !has_bracket_atom {
                return false;
            }
            has_atom = true;
            has_structural_marker = true;
        } else if ch.is_ascii_digit() || "]=#@+-/\\().,:$%".contains(ch) {
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

fn is_inchi_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 27 || bytes[14] != b'-' || bytes[25] != b'-' {
        return false;
    }
    bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 14 || index == 25 || byte.is_ascii_uppercase())
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
    let mut molblock_lines =
        if let Some(end) = lines.iter().position(|line| line.trim() == "M  END") {
            lines[..=end].to_vec()
        } else {
            lines.to_vec()
        };
    normalize_molblock_header(&mut molblock_lines);
    molblock_lines.join("\n")
}

fn normalize_molblock_header(lines: &mut Vec<String>) {
    let Some(mut counts_index) = lines.iter().position(|line| is_molfile_counts_line(line)) else {
        return;
    };
    while counts_index < 3 {
        lines.insert(counts_index, String::new());
        counts_index += 1;
    }
}

fn is_molfile_counts_line(line: &str) -> bool {
    let fields: Vec<&str> = line.split_whitespace().collect();
    fields.len() >= 10
        && matches!(fields.last(), Some(&"V2000" | &"V3000"))
        && fields[0].parse::<usize>().is_ok()
        && fields[1].parse::<usize>().is_ok()
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
    fn fetches_table_column_filtered_pages() {
        let runtime_dir = temp_runtime_dir();
        let csv = "smiles,name,series,score\nCCO,Ethanol,Alpha,1.5\nc1ccccc1,Benzene,Beta,3.0\nCCN,Ethylamine,Alpha,2.2\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 3);

        let property_filtered = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: vec![
                    GridColumnFilter {
                        id: "prop:series".to_string(),
                        filter_type: "text".to_string(),
                        text: Some("alpha".to_string()),
                        min: None,
                        max: None,
                    },
                    GridColumnFilter {
                        id: "prop:score".to_string(),
                        filter_type: "number".to_string(),
                        text: None,
                        min: Some(2.0),
                        max: None,
                    },
                ],
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch property filtered page");
        assert_eq!(property_filtered.total_rows, 1);
        assert_eq!(property_filtered.rows[0].name, "Ethylamine");

        let name_filtered = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: vec![GridColumnFilter {
                    id: "name".to_string(),
                    filter_type: "text".to_string(),
                    text: Some("benz".to_string()),
                    min: None,
                    max: None,
                }],
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch name filtered page");
        assert_eq!(name_filtered.total_rows, 1);
        assert_eq!(name_filtered.rows[0].name, "Benzene");

        let index_filtered = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: vec![GridColumnFilter {
                    id: "index".to_string(),
                    filter_type: "number".to_string(),
                    text: None,
                    min: Some(2.0),
                    max: Some(3.0),
                }],
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch index filtered page");
        assert_eq!(
            index_filtered
                .rows
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Benzene", "Ethylamine"]
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn fetches_filters_and_sorts_descriptor_values() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 3);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch initial page");
        let connection = Connection::open(&database_path).expect("open database");
        for row in &page.rows {
            let molecular_weight = match row.name.as_str() {
                "Ethanol" => 46.07,
                "Benzene" => 78.11,
                "Ethylamine" => 45.08,
                _ => unreachable!("unexpected row"),
            };
            connection
                .execute(
                    "insert into descriptor_values (
                        molecule_id, descriptor_id, label, value_real, value_text, missing_kind, error_text, updated_at_ms
                    ) values (?1, ?2, ?3, ?4, null, null, null, ?5)",
                    params![
                        row.row_id,
                        "MW",
                        "Molecular weight",
                        molecular_weight,
                        current_time_millis()
                    ],
                )
                .expect("insert descriptor value");
        }

        let filtered = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: vec![GridDescriptorFilter {
                    id: "MW".to_string(),
                    min: Some(46.0),
                    max: Some(80.0),
                }],
                descriptor_sort: Some(GridDescriptorSort {
                    id: "MW".to_string(),
                    direction: "desc".to_string(),
                }),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch descriptor filtered page");

        assert_eq!(filtered.total_rows, 2);
        assert_eq!(filtered.descriptor_ids, vec!["MW"]);
        assert_eq!(
            filtered
                .rows
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Benzene", "Ethanol"]
        );
        let benzene_mw = filtered.rows[0]
            .descriptors
            .get("MW")
            .and_then(|cell| cell.value.as_ref())
            .and_then(serde_json::Value::as_f64);
        assert_eq!(benzene_mw, Some(78.11));

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn sorts_descriptor_values_without_filtering() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 3);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch initial page");
        let connection = Connection::open(&database_path).expect("open database");
        for row in &page.rows {
            let Some(molecular_weight) = (match row.name.as_str() {
                "Ethanol" => Some(46.07),
                "Benzene" => Some(78.11),
                "Ethylamine" => None,
                _ => unreachable!("unexpected row"),
            }) else {
                continue;
            };
            connection
                .execute(
                    "insert into descriptor_values (
                        molecule_id, descriptor_id, label, value_real, value_text, missing_kind, error_text, updated_at_ms
                    ) values (?1, ?2, ?3, ?4, null, null, null, ?5)",
                    params![
                        row.row_id,
                        "MW",
                        "Molecular weight",
                        molecular_weight,
                        current_time_millis()
                    ],
                )
                .expect("insert descriptor value");
        }

        let sorted = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: Some(GridDescriptorSort {
                    id: "MW".to_string(),
                    direction: "asc".to_string(),
                }),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch descriptor sorted page");

        assert_eq!(
            sorted
                .rows
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Ethanol", "Benzene", "Ethylamine"]
        );
        assert!(!sorted.rows[2].descriptors.contains_key("MW"));

        let searched = fetch_page(
            &database_path,
            &GridQuery {
                query: "alpha".to_string(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: Some(GridDescriptorSort {
                    id: "MW".to_string(),
                    direction: "desc".to_string(),
                }),
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch descriptor sorted search page");
        assert_eq!(searched.total_rows, 1);
        assert_eq!(searched.rows[0].name, "Ethanol");

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn fetches_descriptor_cells_for_page_rows_in_batch() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 3);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch initial page");
        let connection = Connection::open(&database_path).expect("open database");
        for row in &page.rows {
            let (mw, bucket) = match row.name.as_str() {
                "Ethanol" => (46.07, "small"),
                "Benzene" => (78.11, "aromatic"),
                "Ethylamine" => (45.08, "amine"),
                _ => unreachable!("unexpected row"),
            };
            connection
                .execute(
                    "insert into descriptor_values (
                        molecule_id, descriptor_id, label, value_real, value_text, missing_kind, error_text, updated_at_ms
                    ) values (?1, ?2, ?3, ?4, null, null, null, ?5)",
                    params![row.row_id, "MW", "Molecular weight", mw, current_time_millis()],
                )
                .expect("insert numeric descriptor value");
            connection
                .execute(
                    "insert into descriptor_values (
                        molecule_id, descriptor_id, label, value_real, value_text, missing_kind, error_text, updated_at_ms
                    ) values (?1, ?2, ?3, null, ?4, null, null, ?5)",
                    params![row.row_id, "bucket", "Bucket", bucket, current_time_millis()],
                )
                .expect("insert text descriptor value");
        }

        let fetched = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page with descriptor cells");

        assert_eq!(fetched.rows.len(), 3);
        assert_eq!(
            fetched.rows[0]
                .descriptors
                .get("MW")
                .and_then(|cell| cell.value.as_ref())
                .and_then(serde_json::Value::as_f64),
            Some(46.07)
        );
        assert_eq!(
            fetched.rows[1]
                .descriptors
                .get("bucket")
                .and_then(|cell| cell.value.as_ref())
                .and_then(serde_json::Value::as_str),
            Some("aromatic")
        );
        assert_eq!(fetched.rows[2].descriptors.len(), 2);

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn descriptor_summary_counts_only_row_level_failures_as_failed() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch initial page");

        replace_descriptor_values_in_database(
            &database_path,
            page.rows[0].row_id,
            &[
                GridDescriptorValueInput {
                    id: "MW".into(),
                    label: "Molecular weight".into(),
                    value: Some(serde_json::Value::from(46.07)),
                    missing_kind: None,
                    error_text: None,
                },
                GridDescriptorValueInput {
                    id: "ABC".into(),
                    label: "ABC".into(),
                    value: None,
                    missing_kind: Some("Missing".into()),
                    error_text: Some("descriptor is not available".into()),
                },
            ],
        )
        .expect("store descriptor values");
        replace_descriptor_values_in_database(
            &database_path,
            page.rows[1].row_id,
            &[GridDescriptorValueInput {
                id: "error".into(),
                label: "Descriptor error".into(),
                value: None,
                missing_kind: None,
                error_text: Some("SMILES did not parse".into()),
            }],
        )
        .expect("store row-level descriptor error");

        let summary =
            descriptor_run_summary_in_database(&database_path).expect("fetch descriptor summary");
        assert_eq!(summary.total_rows, 3);
        assert_eq!(summary.calculated_rows, 1);
        assert_eq!(summary.failed_rows, 1);

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn fetches_descriptor_source_rows_in_batches() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 3);
        assert_eq!(
            descriptor_source_row_count(&database_path).expect("count descriptor source rows"),
            3
        );

        let first_batch =
            descriptor_source_row_batch(&database_path, 0, 2).expect("fetch first batch");
        assert_eq!(
            first_batch
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Ethanol", "Benzene"]
        );

        let second_batch =
            descriptor_source_row_batch(&database_path, 2, 2).expect("fetch second batch");
        assert_eq!(
            second_batch
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Ethylamine"]
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn ingests_canonical_smiles_csv_fixture() {
        let runtime_dir = temp_runtime_dir();
        let csv = "compound_id,canonical_smiles,pIC50,vendor\n\
                   CMPD-001,CCO,5.1,TestVendor\n\
                   CMPD-002,c1ccccc1,6.4,TestVendor\n\
                   CMPD-003,CC(=O)O,4.8,Reference\n\
                   CMPD-004,CCN(CC)CC,7.2,Reference\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.format, "csv");
        assert_eq!(summary.records_total, 4);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 144,
            },
        )
        .expect("fetch page");
        assert_eq!(page.total_rows, 4);
        assert_eq!(page.rows.len(), 4);
        assert_eq!(page.rows[0].name, "CMPD-001");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCO"));

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn ingests_all_smiles_columns_from_calibration_csv() {
        let runtime_dir = temp_runtime_dir();
        let csv = "target_smiles,target_inchi_key,proposal_smiles,spec_name\n\
                   CCO,LFQSCWFLJHTTHZ,CCN,MassSpecGymID0001\n\
                   c1ccccc1,UHOVQNZJYSORNB,CCCl,MassSpecGymID0002\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.format, "csv");
        assert_eq!(summary.records_total, 4);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.total_rows, 4);
        assert_eq!(page.rows[0].name, "Molecule 1 target_smiles");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCO"));
        assert_eq!(page.rows[1].name, "Molecule 1 proposal_smiles");
        assert_eq!(page.rows[1].smiles.as_deref(), Some("CCN"));
        assert_eq!(
            page.rows[0].props.get("CSV row").map(String::as_str),
            Some("1")
        );
        assert_eq!(
            page.rows[0].props.get("SMILES column").map(String::as_str),
            Some("target_smiles")
        );
        assert_eq!(
            page.rows[1].props.get("SMILES column").map(String::as_str),
            Some("proposal_smiles")
        );
        assert!(!page.rows[0].props.contains_key("proposal_smiles"));
        assert!(!page.rows[1].props.contains_key("target_smiles"));

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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
    fn ingests_inferred_delimited_structure_columns() {
        let runtime_dir = temp_runtime_dir();
        let csv = "compound,active,decoy\nLigand A,CCO,CCN\nLigand B,c1ccccc1,CCCl\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 4);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.rows[0].name, "Ligand A active");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCO"));
        assert_eq!(page.rows[1].name, "Ligand A decoy");
        assert_eq!(page.rows[1].smiles.as_deref(), Some("CCN"));

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn infers_smiles_columns_without_smiles_headers() {
        let runtime_dir = temp_runtime_dir();
        let csv = "candidate_1,candidate_2,label\nCCO,CCN,first\nc1ccccc1,CCCl,second\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 4);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.rows[0].name, "Molecule 1 candidate_1");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCO"));
        assert_eq!(page.rows[1].name, "Molecule 1 candidate_2");
        assert_eq!(page.rows[1].smiles.as_deref(), Some("CCN"));
        assert_eq!(
            page.rows[0].props.get("CSV row").map(String::as_str),
            Some("1")
        );
        assert_eq!(
            page.rows[0].props.get("SMILES column").map(String::as_str),
            Some("candidate_1")
        );
        assert_eq!(
            page.rows[0].props.get("label").map(String::as_str),
            Some("first")
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn ingests_multiple_named_smiles_columns() {
        let runtime_dir = temp_runtime_dir();
        let csv = "canonical_smiles,isomeric_smiles,name\nCCO,CCO,Ethanol\nCCN,CCN,Ethylamine\n";

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 4);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch page");
        assert_eq!(page.rows[0].name, "Ethanol canonical_smiles");
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCO"));
        assert_eq!(page.rows[1].name, "Ethanol isomeric_smiles");
        assert_eq!(page.rows[1].smiles.as_deref(), Some("CCO"));

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
                ..GridParseOptions::default()
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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
        let sort_clause = page_sort_clause(None, "index");
        let started = std::time::Instant::now();
        let fts_total = fetch_filtered_page_with_fts(
            &connection,
            &fts_query,
            &sort_clause,
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
            &sort_clause,
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
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
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

    #[test]
    fn normalizes_ketcher_molblock_with_missing_header_line() {
        let lines = vec![
            "Ketcher sketch".to_string(),
            "".to_string(),
            "  6  6  0  0  0  0  0  0  0  0999 V2000".to_string(),
            "    5.1809   -4.2751    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0".to_string(),
            "M  END".to_string(),
        ];
        let molblock = extract_molblock(&lines);
        let normalized: Vec<&str> = molblock.lines().collect();
        assert_eq!(
            normalized[3].trim(),
            "6  6  0  0  0  0  0  0  0  0999 V2000"
        );
    }
}
