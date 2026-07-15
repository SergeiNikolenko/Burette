use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, TransactionBehavior,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;

use super::{
    grid_analysis,
    grid_database::open_grid_database,
    grid_identity, grid_predicate,
    runtime_utils::{clipped, decode_text, normalized_lines},
};

const GRID_INITIAL_ROWS: usize = 192;
const GRID_INGEST_BATCH_ROWS: usize = 1_000;

#[derive(Default)]
pub(crate) struct GridRuntimeRegistry {
    entries: Mutex<HashMap<String, Arc<RegisteredGridRuntime>>>,
}

#[derive(Debug)]
struct RegisteredGridRuntime {
    database_path: PathBuf,
    format: &'static str,
    cancel_token: Arc<AtomicBool>,
}

impl Drop for RegisteredGridRuntime {
    fn drop(&mut self) {
        self.cancel_token.store(true, Ordering::Relaxed);
        if let Some(runtime_dir) = self.database_path.parent() {
            let _ = std::fs::remove_dir_all(runtime_dir);
        }
    }
}

/// Pins the exact Grid runtime selected for snapshot materialization.
///
/// Removing or replacing the registry entry cancels ingestion immediately, but
/// the runtime directory remains available until this lease is dropped.
#[derive(Debug)]
#[allow(
    dead_code,
    reason = "the compute snapshot submission path consumes this lease"
)]
pub(crate) struct GridSnapshotLease {
    runtime: Arc<RegisteredGridRuntime>,
}

#[allow(
    dead_code,
    reason = "the compute snapshot submission path consumes this lease"
)]
impl GridSnapshotLease {
    pub(crate) fn database_path_for_freeze(&self) -> &Path {
        &self.runtime.database_path
    }
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
    pub(crate) idcode: Option<String>,
    pub(crate) idcoordinates: Option<String>,
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
    pub(crate) analysis_filters: Vec<GridAnalysisFilter>,
    pub(crate) descriptor_sort: Option<GridDescriptorSort>,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
}

pub(crate) type GridColumnFilter = burrete_compute_protocol::ColumnFilter;
pub(crate) type GridDescriptorFilter = burrete_compute_protocol::DescriptorFilter;
pub(crate) type GridAnalysisFilter = burrete_compute_protocol::AnalysisFilter;

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
    idcode: Option<String>,
    idcoordinates: Option<String>,
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
        let runtime = Arc::new(RegisteredGridRuntime {
            database_path,
            format,
            cancel_token,
        });
        let existing = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?
            .insert(document_id.to_string(), runtime);
        if let Some(existing) = existing {
            existing.cancel_token.store(true, Ordering::Relaxed);
        }
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
        }
        Ok(())
    }

    #[allow(
        dead_code,
        reason = "the compute snapshot submission path acquires this lease"
    )]
    pub(crate) fn acquire_snapshot_lease(
        &self,
        namespaced_document_id: &str,
    ) -> Result<GridSnapshotLease, String> {
        Ok(GridSnapshotLease {
            runtime: self.runtime_entry(namespaced_document_id)?,
        })
    }

    pub(crate) fn fetch_page(
        &self,
        document_id: &str,
        query: &GridQuery,
    ) -> Result<GridPageResult, String> {
        let runtime = self.runtime_entry(document_id)?;
        fetch_page(&runtime.database_path, query)
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
        let runtime = self.runtime_entry(document_id)?;
        let source_format = grid_format(extension)
            .ok_or_else(|| format!("Unsupported grid append extension: {extension}"))?;
        if source_format != runtime.format {
            return Err(format!(
                "Cannot append {source_format} records to {} grid",
                runtime.format
            ));
        }
        append_grid_text(&runtime.database_path, source_format, text, options)
    }

    pub(crate) fn descriptor_source_row_count(&self, document_id: &str) -> Result<usize, String> {
        let runtime = self.runtime_entry(document_id)?;
        descriptor_source_row_count(&runtime.database_path)
    }

    pub(crate) fn descriptor_database_path(&self, document_id: &str) -> Result<PathBuf, String> {
        self.database_path(document_id)
    }

    pub(crate) fn descriptor_run_summary(
        &self,
        document_id: &str,
    ) -> Result<GridDescriptorRunSummary, String> {
        let runtime = self.runtime_entry(document_id)?;
        descriptor_run_summary_in_database(&runtime.database_path)
    }

    pub(crate) fn mark_virtual_edit(&self, document_id: &str) -> Result<u64, String> {
        let runtime = self.runtime_entry(document_id)?;
        grid_identity::mark_virtual_edit(&runtime.database_path)
    }

    fn database_path(&self, document_id: &str) -> Result<PathBuf, String> {
        Ok(self.runtime_entry(document_id)?.database_path.clone())
    }

    fn runtime_entry(&self, document_id: &str) -> Result<Arc<RegisteredGridRuntime>, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?;
        entries
            .get(document_id)
            .cloned()
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
    let connection = open_grid_database(&database_path)?;
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
    if first_batch.complete {
        grid_identity::finalize_source_revision(&connection)?;
    } else {
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
    let connection = open_grid_database(database_path)?;
    initialize_schema(&connection)?;
    let index_state = read_index_state(&connection)?;
    if !index_state.index_ready {
        return Err("Cannot append records while grid indexing is still in progress".to_string());
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let start_index = molecule_count(&transaction)?;
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
            insert_records_in_connection(&transaction, &batch.records)?;
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
    let total_rows = molecule_count(&transaction)?;
    grid_identity::advance_source_revision(&transaction)?;
    update_index_state(&transaction, total_rows, Some(total_rows), true, None)?;
    transaction.commit().map_err(|error| error.to_string())?;
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
        "dwar" => Some("dwar"),
        "tsv" => Some("tsv"),
        "smi" | "smiles" => Some("smiles"),
        "sdf" | "sd" => Some("sdf"),
        _ => None,
    }
}

fn fetch_page(database_path: &Path, query: &GridQuery) -> Result<GridPageResult, String> {
    let mut connection = open_grid_database(database_path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Deferred)
        .map_err(|err| err.to_string())?;
    let index_state = read_index_state(&transaction)?;
    let limit = query.limit.clamp(1, 240);
    let offset = query.offset;
    let sort_clause = page_sort_clause(query.descriptor_sort.as_ref(), &query.sort);
    let text_query = burrete_compute_protocol::GridTextQuery::Text {
        text: query.query.clone(),
    };
    let predicate = grid_predicate::plan_grid_predicate(
        &text_query,
        &query.column_filters,
        &query.descriptor_filters,
        &query.analysis_filters,
    )?;
    let result = fetch_predicate_page(
        &transaction,
        &predicate,
        &sort_clause,
        limit,
        offset,
        index_state,
    )?;
    transaction.commit().map_err(|err| err.to_string())?;
    Ok(result)
}

fn fetch_predicate_page(
    connection: &Connection,
    predicate: &grid_predicate::GridPredicatePlan,
    sort_clause: &PageSortClause,
    limit: usize,
    offset: usize,
    index_state: GridIndexState,
) -> Result<GridPageResult, String> {
    let where_sql = if predicate.predicate_sql.is_empty() {
        String::new()
    } else {
        format!(" where {}", predicate.predicate_sql)
    };
    let count_sql = format!("select count(*) from molecules{where_sql}");
    let total_rows = connection
        .query_row(
            &count_sql,
            params_from_iter(predicate.params.iter()),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())? as usize;
    let fts_query = predicate.fts_query.as_deref().filter(|fts_query| {
        fts_candidates_cover_exact_result(connection, predicate, fts_query, total_rows)
    });
    let fts_sql = if fts_query.is_some() {
        " and molecules.id in (
             select rowid from molecules_fts where molecules_fts match ?
           )"
    } else {
        ""
    };
    let sql = format!(
        "select id, source_index, name, smiles, molblock, idcode, idcoordinates, props_json \
         from molecules \
         {join_sql} \
         {where_sql}{fts_sql} \
         order by {order_sql} \
         limit ? offset ?",
        join_sql = sort_clause.join_sql,
        order_sql = sort_clause.order_sql
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut page_params = sort_clause.params.clone();
    page_params.extend(predicate.params.iter().cloned());
    if let Some(fts_query) = fts_query {
        page_params.push(SqlValue::Text(fts_query.to_string()));
    }
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

fn fts_candidates_cover_exact_result(
    connection: &Connection,
    predicate: &grid_predicate::GridPredicatePlan,
    fts_query: &str,
    exact_total: usize,
) -> bool {
    let where_sql = if predicate.predicate_sql.is_empty() {
        "where".to_string()
    } else {
        format!("where {} and", predicate.predicate_sql)
    };
    let sql = format!(
        "select count(*) from molecules
         {where_sql} molecules.id in (
           select rowid from molecules_fts where molecules_fts match ?
         )"
    );
    let mut params = predicate.params.clone();
    params.push(SqlValue::Text(fts_query.to_string()));
    connection
        .query_row(&sql, params_from_iter(params.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map(|count| count as usize == exact_total)
        .unwrap_or(false)
}

fn collect_page_rows(mut rows: rusqlite::Rows<'_>) -> Result<Vec<GridPageRow>, String> {
    let mut page_rows = Vec::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let row_id = row.get::<_, i64>(0).map_err(|err| err.to_string())?;
        let props_json: String = row.get(7).map_err(|err| err.to_string())?;
        page_rows.push(GridPageRow {
            row_id,
            index: row.get::<_, i64>(1).map_err(|err| err.to_string())? as usize,
            name: row.get(2).map_err(|err| err.to_string())?,
            smiles: row.get(3).map_err(|err| err.to_string())?,
            molblock: row.get(4).map_err(|err| err.to_string())?,
            idcode: row.get(5).map_err(|err| err.to_string())?,
            idcoordinates: row.get(6).map_err(|err| err.to_string())?,
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
        let Ok(connection) = open_grid_database(&database_path) else {
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
            if batch.complete && grid_identity::finalize_source_revision(&connection).is_err() {
                return;
            }
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
                 idcode text,
                 idcoordinates text,
                 molecule_content_sha256 text not null,
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
    grid_identity::initialize(connection)?;
    grid_analysis::initialize(connection)
}

pub(crate) fn descriptor_source_row_count(database_path: &Path) -> Result<usize, String> {
    let connection = open_grid_database(database_path)?;
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
    let connection = open_grid_database(database_path)?;
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
    let connection = open_grid_database(database_path)?;
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
    let mut connection = open_grid_database(database_path)?;
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
    let connection = open_grid_database(database_path)?;
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
        idcode: None,
        idcoordinates: None,
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
        "dwar" => Ok(parse_datawarrior_batch(
            text,
            start_line,
            start_index,
            max_records,
        )),
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

#[derive(Default)]
struct DataWarriorColumn {
    parent: Option<String>,
    special_type: Option<String>,
}

fn parse_datawarrior_batch(
    text: &str,
    start_record: usize,
    start_index: usize,
    max_records: usize,
) -> ParsedGridBatch {
    let lines = normalized_lines(text);
    let columns = datawarrior_column_properties(&lines);
    let Some(table_start) = datawarrior_table_start(&lines) else {
        return ParsedGridBatch {
            records: Vec::new(),
            next_line: 0,
            next_index: start_index,
            complete: true,
        };
    };
    let headers: Vec<_> = parse_delimited_line(&lines[table_start], '\t')
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect();
    let structure_columns: Vec<_> = headers
        .iter()
        .enumerate()
        .filter_map(|(index, header)| {
            let special_type = columns
                .get(header)
                .and_then(|column| column.special_type.as_deref())
                .unwrap_or("")
                .to_ascii_lowercase();
            if special_type == "idcode" {
                Some((index, true))
            } else if is_smiles_column(&normalize_column_name(header)) {
                Some((index, false))
            } else {
                None
            }
        })
        .collect();
    if structure_columns.is_empty() {
        return ParsedGridBatch {
            records: Vec::new(),
            next_line: 0,
            next_index: start_index,
            complete: true,
        };
    }
    let special_indexes: HashSet<_> = headers
        .iter()
        .enumerate()
        .filter_map(|(index, header)| columns.get(header)?.special_type.as_ref().map(|_| index))
        .collect();
    let coordinate_indexes: HashMap<_, _> = headers
        .iter()
        .enumerate()
        .filter_map(|(index, header)| {
            let column = columns.get(header)?;
            let special_type = column.special_type.as_deref()?.to_ascii_lowercase();
            special_type
                .starts_with("idcoordinates")
                .then(|| column.parent.clone().map(|parent| (parent, index)))?
        })
        .collect();
    let name_index = headers.iter().enumerate().position(|(index, header)| {
        !special_indexes.contains(&index)
            && matches!(
                normalize_column_name(header).as_str(),
                "compound_id" | "id" | "name" | "title" | "compound"
            )
    });
    let multiple_structure_columns = structure_columns.len() > 1;
    let mut records = Vec::new();
    let mut candidate_index = 0usize;
    let mut complete = true;

    for (row_offset, line) in lines.iter().skip(table_start + 1).enumerate() {
        if looks_like_datawarrior_section_tag(line) {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        let cells = parse_delimited_line(line, '\t');
        for (structure_index, is_idcode) in &structure_columns {
            let value = cells
                .get(*structure_index)
                .map(|cell| cell.trim())
                .unwrap_or("");
            if value.is_empty() {
                continue;
            }
            if candidate_index < start_record {
                candidate_index += 1;
                continue;
            }
            if records.len() >= max_records {
                complete = false;
                break;
            }
            let column_name = headers
                .get(*structure_index)
                .map(|header| header.trim())
                .filter(|header| !header.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Column {}", structure_index + 1));
            let raw_name = name_index
                .and_then(|index| cells.get(index))
                .map(|cell| cell.trim())
                .unwrap_or("");
            let base_name = if raw_name.is_empty() {
                format!("Molecule {}", row_offset + 1)
            } else {
                clipped(raw_name, 160)
            };
            let name = if multiple_structure_columns {
                clipped(&format!("{base_name} {column_name}"), 160)
            } else {
                base_name
            };
            let mut props = BTreeMap::from([
                ("DataWarrior row".to_string(), (row_offset + 1).to_string()),
                ("Structure column".to_string(), clipped(&column_name, 500)),
            ]);
            for (index, header) in headers.iter().enumerate() {
                if index == *structure_index
                    || Some(index) == name_index
                    || special_indexes.contains(&index)
                {
                    continue;
                }
                if let Some(cell) = cells
                    .get(index)
                    .map(|cell| cell.trim())
                    .filter(|cell| !cell.is_empty())
                {
                    if props.len() < 64 {
                        props.insert(clipped(header, 80), clipped(cell, 500));
                    }
                }
            }
            let coordinates = coordinate_indexes
                .get(&column_name)
                .and_then(|index| cells.get(*index))
                .map(|cell| cell.trim())
                .filter(|cell| !cell.is_empty())
                .map(|cell| clipped(cell, 16_384));
            records.push(GridInputRecord {
                index: start_index + records.len(),
                name,
                smiles: (!is_idcode).then(|| clipped(value, 2048)),
                molblock: None,
                idcode: is_idcode.then(|| clipped(value, 4096)),
                idcoordinates: coordinates,
                props,
            });
            candidate_index += 1;
        }
        if !complete {
            break;
        }
    }
    ParsedGridBatch {
        next_line: start_record + records.len(),
        next_index: start_index + records.len(),
        records,
        complete,
    }
}

fn datawarrior_column_properties(lines: &[String]) -> HashMap<String, DataWarriorColumn> {
    let mut columns = HashMap::new();
    let mut current_name: Option<String> = None;
    let mut in_properties = false;
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "<column properties>" {
            in_properties = true;
            continue;
        }
        if trimmed == "</column properties>" {
            break;
        }
        if !in_properties {
            continue;
        }
        if let Some(name) = datawarrior_tag_value(trimmed, "columnName") {
            current_name = Some(name.clone());
            columns.insert(name, DataWarriorColumn::default());
            continue;
        }
        let Some(property) = datawarrior_tag_value(trimmed, "columnProperty") else {
            continue;
        };
        let Some(name) = current_name.as_ref() else {
            continue;
        };
        let mut parts = property.splitn(2, ['\t']);
        let key = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        let Some(column) = columns.get_mut(name) else {
            continue;
        };
        match key {
            "specialType" if !value.is_empty() => column.special_type = Some(value.to_string()),
            "parent" if !value.is_empty() => column.parent = Some(value.to_string()),
            _ => {}
        }
    }
    columns
}

fn datawarrior_table_start(lines: &[String]) -> Option<usize> {
    let mut section: Option<String> = None;
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("</") && trimmed.ends_with('>') {
            section = None;
            continue;
        }
        if trimmed.starts_with('<')
            && trimmed.ends_with('>')
            && !trimmed.contains('=')
            && !trimmed.starts_with("</")
        {
            section = Some(trimmed.to_string());
            continue;
        }
        if section.is_none() && !trimmed.is_empty() && !trimmed.starts_with('<') {
            return Some(index);
        }
    }
    None
}

fn datawarrior_tag_value(line: &str, tag: &str) -> Option<String> {
    let prefix = format!("<{tag}=\"");
    line.strip_prefix(&prefix)
        .and_then(|value| value.strip_suffix("\">"))
        .map(|value| {
            value
                .replace("&#x09;", "\t")
                .replace("&#9;", "\t")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
        })
}

fn looks_like_datawarrior_section_tag(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('<') && trimmed.ends_with('>')
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
            idcode: None,
            idcoordinates: None,
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
                clipped(
                    &format!(
                        "{} {}",
                        base_name,
                        column_label(&headers, *smiles_index).trim_matches('\'')
                    ),
                    160,
                )
            } else {
                base_name
            };
            let mut props = BTreeMap::new();
            props.insert("CSV row".to_string(), row_number.to_string());
            props.insert(
                "SMILES column".to_string(),
                clipped(
                    column_label(&headers, *smiles_index).trim_matches('\''),
                    500,
                ),
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
                idcode: None,
                idcoordinates: None,
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
            idcode: None,
            idcoordinates: None,
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
    insert_records_in_connection(&tx, records)?;
    tx.commit().map_err(|err| err.to_string())
}

fn insert_records_in_connection(
    connection: &Connection,
    records: &[GridInputRecord],
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let mut insert = connection
        .prepare(
            "insert into molecules (
               source_index, name, smiles, molblock, idcode, idcoordinates,
               molecule_content_sha256, props_json, props_text, search_text
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .map_err(|err| err.to_string())?;
    for record in records {
        insert_record(&mut insert, record)?;
    }
    Ok(())
}

fn insert_record(
    insert: &mut rusqlite::Statement<'_>,
    record: &GridInputRecord,
) -> Result<(), String> {
    let props_json = serde_json::to_string(&record.props).map_err(|err| err.to_string())?;
    let props_text = build_props_text(record);
    let search_text = build_search_text(record);
    let molecule_content_sha256 = grid_identity::molecule_content_sha256(
        record.smiles.as_deref(),
        record.molblock.as_deref(),
        record.idcode.as_deref(),
        record.idcoordinates.as_deref(),
    );
    insert
        .execute(params![
            record.index as i64,
            record.name,
            record.smiles,
            record.molblock,
            record.idcode,
            record.idcoordinates,
            molecule_content_sha256,
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
    use burrete_compute_protocol::{
        AnalysisFilter, CapabilityMaturity, ColumnFilterKind, FilteredGridScope, GridScope,
        GridTextQuery, RepresentativePolicy, WorkflowTemplateId,
    };

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
    fn builds_datawarrior_store_with_idcode_coordinates() {
        let runtime_dir = temp_runtime_dir();
        let data = include_str!("../../../../../samples/collections/datawarrior/mini.dwar");
        let (database_path, summary) = build_store(&runtime_dir, "dwar", data.as_bytes());
        assert_eq!(summary.format, "dwar");
        assert_eq!(summary.records_total, 2);

        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                analysis_filters: Vec::new(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch DataWarrior page");
        assert_eq!(page.rows[0].name, "Ethanol");
        assert_eq!(page.rows[0].idcode.as_deref(), Some("eMHAIh@"));
        assert_eq!(page.rows[0].idcoordinates.as_deref(), Some("!B_vq?Dp"));
        assert_eq!(
            page.rows[0].props.get("Activity").map(String::as_str),
            Some("1.25")
        );

        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn bounds_datawarrior_structure_column_properties() {
        let runtime_dir = temp_runtime_dir();
        let structure_column = format!("Structure_{}", "s".repeat(600));
        let data = format!(
            "<datawarrior-fileinfo>\n<version=\"3.3\">\n<rowcount=\"1\">\n</datawarrior-fileinfo>\n<column properties>\n<columnName=\"{structure_column}\">\n<columnProperty=\"specialType\tidcode\">\n</column properties>\n{structure_column}\tName\neMHAIh@\tEthanol\n"
        );

        let (database_path, summary) = build_store(&runtime_dir, "dwar", data.as_bytes());
        assert_eq!(summary.records_total, 1);
        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                analysis_filters: Vec::new(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch bounded DataWarrior record");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].props["Structure column"].chars().count(), 500);

        let _ = std::fs::remove_dir_all(&runtime_dir);
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
                column_filters: vec![
                    GridColumnFilter {
                        id: "prop:series".to_string(),
                        filter_type: ColumnFilterKind::Text,
                        text: Some("alpha".to_string()),
                        min: None,
                        max: None,
                    },
                    GridColumnFilter {
                        id: "prop:score".to_string(),
                        filter_type: ColumnFilterKind::Number,
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
                analysis_filters: Vec::new(),
                column_filters: vec![GridColumnFilter {
                    id: "name".to_string(),
                    filter_type: ColumnFilterKind::Text,
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
                analysis_filters: Vec::new(),
                column_filters: vec![GridColumnFilter {
                    id: "index".to_string(),
                    filter_type: ColumnFilterKind::Number,
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
                column_filters: Vec::new(),
                descriptor_filters: vec![
                    GridDescriptorFilter {
                        id: "MW".to_string(),
                        min: Some(46.0),
                        max: None,
                    },
                    GridDescriptorFilter {
                        id: "MW".to_string(),
                        min: None,
                        max: Some(80.0),
                    },
                ],
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
    fn analysis_filtered_page_matches_the_shared_predicate() {
        let runtime_dir = temp_runtime_dir();
        let csv = "smiles,name\nCCO,Ethanol\nc1ccccc1,Benzene\nCCN,Ethylamine\n";
        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        wait_for_index_ready(&database_path);
        let connection = Connection::open(&database_path).expect("open database");
        let run_id = uuid::Uuid::from_u128(7);
        let (document_fingerprint_sha256, source_revision) = connection
            .query_row(
                "select document_fingerprint_sha256, source_revision
                 from grid_metadata where id = 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?)),
            )
            .expect("read current Grid identity");
        let molecules = {
            let mut statement = connection
                .prepare(
                    "select id, source_index, molecule_content_sha256
                     from molecules order by source_index",
                )
                .expect("prepare molecule identities");
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .expect("query molecule identities")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect molecule identities");
            rows
        };
        drop(connection);
        grid_analysis::apply_analysis_run(
            &database_path,
            &grid_analysis::GridAnalysisApplyInput {
                run_id,
                workflow_template: WorkflowTemplateId::ClusterV1,
                document_fingerprint_sha256,
                source_revision,
                snapshot_id: uuid::Uuid::from_u128(8),
                snapshot_sha256: "c".repeat(64),
                normalized_settings_sha256: "b".repeat(64),
                maturity: CapabilityMaturity::Experimental,
                representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
                provenance: serde_json::json!({}),
                created_at_ms: 1,
                values: molecules
                    .into_iter()
                    .map(|(molecule_id, source_index, molecule_content_sha256)| {
                        grid_analysis::GridAnalysisValueInput {
                            molecule_id,
                            source_index,
                            molecule_content_sha256,
                            value_id: "clusterId".into(),
                            value: grid_analysis::GridAnalysisValue::Integer(
                                ((source_index + 1) * 10) as i64,
                            ),
                        }
                    })
                    .collect(),
                artifacts: Vec::new(),
            },
        )
        .expect("apply typed analysis values");

        let analysis_filters = vec![AnalysisFilter {
            run_id,
            value_id: "clusterId".to_string(),
            min: Some(15.0),
            max: Some(25.0),
        }];
        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                analysis_filters: analysis_filters.clone(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch analysis-filtered page");
        let plan = grid_predicate::plan_grid_predicate(
            &GridTextQuery::Text {
                text: String::new(),
            },
            &[],
            &[],
            &analysis_filters,
        )
        .expect("plan matching predicate");
        let connection = Connection::open(&database_path).expect("reopen database");
        let direct_sql = format!(
            "select source_index from molecules where {} order by source_index",
            plan.predicate_sql
        );
        let direct_indexes = connection
            .prepare(&direct_sql)
            .expect("prepare direct predicate")
            .query_map(params_from_iter(plan.params.iter()), |row| row.get(0))
            .expect("query direct predicate")
            .collect::<Result<Vec<usize>, _>>()
            .expect("collect direct indexes");

        assert_eq!(
            page.rows.iter().map(|row| row.index).collect::<Vec<_>>(),
            direct_indexes
        );
        assert_eq!(direct_indexes, vec![1]);
        let _ = std::fs::remove_dir_all(&runtime_dir);
    }

    #[test]
    fn duplicate_descriptor_page_filters_match_the_normalized_scope_predicate() {
        let runtime_dir = temp_runtime_dir();
        let csv = "smiles,name\nCCO,Ethanol\nc1ccccc1,Benzene\nCCN,Ethylamine\n";
        let (database_path, _) = build_store(&runtime_dir, "csv", csv.as_bytes());
        wait_for_index_ready(&database_path);
        let connection = Connection::open(&database_path).expect("open database");
        let rows = {
            let mut statement = connection
                .prepare("select id, name from molecules order by source_index")
                .expect("prepare molecules");
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .expect("query molecules")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect molecules")
        };
        for (molecule_id, name) in rows {
            let value = match name.as_str() {
                "Ethanol" => 46.07,
                "Benzene" => 78.11,
                "Ethylamine" => 45.08,
                _ => unreachable!("unexpected molecule"),
            };
            connection
                .execute(
                    "insert into descriptor_values(
                       molecule_id, descriptor_id, label, value_real, value_text,
                       missing_kind, error_text, updated_at_ms
                     ) values (?1, 'MW', 'Molecular weight', ?2, null, null, null, 1)",
                    params![molecule_id, value],
                )
                .expect("insert descriptor");
        }
        drop(connection);

        let descriptor_filters = vec![
            GridDescriptorFilter {
                id: "MW".to_string(),
                min: Some(46.0),
                max: None,
            },
            GridDescriptorFilter {
                id: "MW".to_string(),
                min: None,
                max: Some(80.0),
            },
        ];
        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                analysis_filters: Vec::new(),
                column_filters: Vec::new(),
                descriptor_filters: descriptor_filters.clone(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch duplicate descriptor filters");
        let GridScope::Filtered(normalized) = GridScope::Filtered(FilteredGridScope {
            query: GridTextQuery::Text {
                text: String::new(),
            },
            column_filters: Vec::new(),
            descriptor_filters,
            analysis_filters: Vec::new(),
        })
        .normalized()
        .expect("normalize duplicate descriptor filters") else {
            unreachable!("test creates a filtered scope")
        };
        let plan = grid_predicate::plan_grid_predicate(
            &normalized.query,
            &normalized.column_filters,
            &normalized.descriptor_filters,
            &normalized.analysis_filters,
        )
        .expect("plan normalized descriptor predicate");
        let direct_sql = format!(
            "select source_index from molecules where {} order by source_index",
            plan.predicate_sql
        );
        let direct_connection = Connection::open(&database_path).expect("reopen database");
        let direct_indexes = direct_connection
            .prepare(&direct_sql)
            .expect("prepare normalized predicate")
            .query_map(params_from_iter(plan.params.iter()), |row| {
                row.get::<_, u64>(0)
            })
            .expect("query normalized predicate")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect normalized indexes");

        assert_eq!(
            page.rows
                .iter()
                .map(|row| row.index as u64)
                .collect::<Vec<_>>(),
            direct_indexes
        );
        assert_eq!(direct_indexes, vec![0, 1]);
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
    fn bounds_composite_names_and_smiles_column_properties() {
        let runtime_dir = temp_runtime_dir();
        let primary = format!("primary_smiles_{}", "a".repeat(600));
        let alternate = format!("alternate_smiles_{}", "b".repeat(600));
        let csv = format!("name,{primary},{alternate}\nCompound,CCO,CCN\n");

        let (database_path, summary) = build_store(&runtime_dir, "csv", csv.as_bytes());
        assert_eq!(summary.records_total, 2);
        let page = fetch_page(
            &database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                analysis_filters: Vec::new(),
                column_filters: Vec::new(),
                descriptor_filters: Vec::new(),
                descriptor_sort: None,
                offset: 0,
                limit: 96,
            },
        )
        .expect("fetch bounded composite records");
        assert_eq!(page.rows.len(), 2);
        for row in &page.rows {
            assert_eq!(row.name.chars().count(), 160);
            assert_eq!(
                row.props["SMILES column"].chars().count(),
                500,
                "snapshot-visible Grid properties must respect the public record contract"
            );
        }

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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
        let connection = Connection::open(&database_path).expect("open completed database");
        let identity = grid_identity::read_source_identity(&connection)
            .expect("read completed source identity");
        assert_eq!(identity.source_revision, 1);

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
                analysis_filters: Vec::new(),
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
    fn unregister_keeps_runtime_alive_until_snapshot_lease_drops() {
        fn assert_send_static<T: Send + 'static>() {}
        assert_send_static::<GridSnapshotLease>();

        let runtime_dir = temp_runtime_dir();
        let handle = build_grid_store(&runtime_dir, "smi", b"CC Ethane\n")
            .expect("build grid store")
            .expect("collection");
        let cancel_token = handle.cancel_token.clone();
        let registry = GridRuntimeRegistry::default();
        registry
            .register(
                "main:doc-grid",
                handle.database_path,
                handle.summary.format,
                handle.cancel_token,
            )
            .expect("register grid runtime");
        let lease = registry
            .acquire_snapshot_lease("main:doc-grid")
            .expect("acquire snapshot lease");
        let database_path = lease.database_path_for_freeze().to_path_buf();
        let rendezvous = Arc::new(std::sync::Barrier::new(2));
        let worker_rendezvous = Arc::clone(&rendezvous);
        let worker = thread::spawn(move || {
            assert!(lease.database_path_for_freeze().is_file());
            worker_rendezvous.wait();
            worker_rendezvous.wait();
            assert!(lease.database_path_for_freeze().is_file());
            drop(lease);
        });

        rendezvous.wait();
        registry
            .unregister("main:doc-grid")
            .expect("unregister grid runtime");
        assert!(cancel_token.load(Ordering::Relaxed));
        assert!(database_path.is_file());
        assert!(registry.acquire_snapshot_lease("main:doc-grid").is_err());
        rendezvous.wait();
        worker.join().expect("snapshot lease worker");
        assert!(!runtime_dir.exists());
    }

    #[test]
    fn replacement_keeps_existing_lease_pinned_to_old_runtime() {
        let old_runtime_dir = temp_runtime_dir();
        let old_handle = build_grid_store(&old_runtime_dir, "smi", b"CC Ethane\n")
            .expect("build old grid store")
            .expect("old collection");
        let old_database_path = old_handle.database_path.clone();
        let old_cancel_token = old_handle.cancel_token.clone();
        let registry = GridRuntimeRegistry::default();
        registry
            .register(
                "main:doc-grid",
                old_handle.database_path,
                old_handle.summary.format,
                old_handle.cancel_token,
            )
            .expect("register old grid runtime");
        let old_lease = registry
            .acquire_snapshot_lease("main:doc-grid")
            .expect("acquire old snapshot lease");

        let new_runtime_dir = temp_runtime_dir();
        let new_handle = build_grid_store(&new_runtime_dir, "smi", b"O Water\n")
            .expect("build new grid store")
            .expect("new collection");
        let new_database_path = new_handle.database_path.clone();
        let new_cancel_token = new_handle.cancel_token.clone();
        registry
            .register(
                "main:doc-grid",
                new_handle.database_path,
                new_handle.summary.format,
                new_handle.cancel_token,
            )
            .expect("replace grid runtime");

        assert!(old_cancel_token.load(Ordering::Relaxed));
        assert_eq!(
            old_lease.database_path_for_freeze(),
            old_database_path.as_path()
        );
        assert!(old_database_path.is_file());
        let new_lease = registry
            .acquire_snapshot_lease("main:doc-grid")
            .expect("acquire new snapshot lease");
        assert_eq!(
            new_lease.database_path_for_freeze(),
            new_database_path.as_path()
        );

        drop(old_lease);
        assert!(!old_runtime_dir.exists());
        assert!(new_runtime_dir.exists());
        registry
            .unregister("main:doc-grid")
            .expect("unregister replacement");
        assert!(new_cancel_token.load(Ordering::Relaxed));
        assert!(new_runtime_dir.exists());
        drop(new_lease);
        assert!(!new_runtime_dir.exists());
    }

    #[test]
    fn snapshot_lease_uses_the_full_namespaced_document_id() {
        let runtime_dir = temp_runtime_dir();
        let handle = build_grid_store(&runtime_dir, "smi", b"CC Ethane\n")
            .expect("build grid store")
            .expect("collection");
        let registry = GridRuntimeRegistry::default();
        registry
            .register(
                "workspace-a:doc-grid",
                handle.database_path,
                handle.summary.format,
                handle.cancel_token,
            )
            .expect("register namespaced grid runtime");

        assert!(registry.acquire_snapshot_lease("doc-grid").is_err());
        assert!(registry
            .acquire_snapshot_lease("workspace-b:doc-grid")
            .is_err());
        let lease = registry
            .acquire_snapshot_lease("workspace-a:doc-grid")
            .expect("acquire exact namespaced grid runtime");
        assert!(lease.database_path_for_freeze().is_file());

        registry
            .unregister("workspace-a:doc-grid")
            .expect("unregister namespaced grid runtime");
        drop(lease);
        assert!(!runtime_dir.exists());
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
        let substring_plan = grid_predicate::plan_grid_predicate(
            &GridTextQuery::Text {
                text: "eth".to_string(),
            },
            &[],
            &[],
            &[],
        )
        .expect("plan substring query");
        assert!(!fts_candidates_cover_exact_result(
            &connection,
            &substring_plan,
            substring_plan.fts_query.as_deref().expect("FTS candidate"),
            2,
        ));
        let exact_plan = grid_predicate::plan_grid_predicate(
            &GridTextQuery::Text {
                text: "gamma".to_string(),
            },
            &[],
            &[],
            &[],
        )
        .expect("plan exact-token query");
        assert!(fts_candidates_cover_exact_result(
            &connection,
            &exact_plan,
            exact_plan.fts_query.as_deref().expect("FTS candidate"),
            1,
        ));
        connection
            .execute("drop table molecules_fts", [])
            .expect("drop fts table");
        let missing_fts = fetch_page(
            &database_path,
            &GridQuery {
                query: "gamma".to_string(),
                sort: "index".to_string(),
                analysis_filters: Vec::new(),
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
    #[ignore = "50k row perf smoke is opt-in for local developer runs"]
    fn exact_fts_fast_path_is_faster_than_like_fallback_on_synthetic_collection() {
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
        let query = GridQuery {
            query: "NeedlePerfMarker".to_string(),
            sort: "index".to_string(),
            analysis_filters: Vec::new(),
            column_filters: Vec::new(),
            descriptor_filters: Vec::new(),
            descriptor_sort: None,
            offset: 0,
            limit: 96,
        };
        let started = std::time::Instant::now();
        let indexed = fetch_page(&database_path, &query).expect("fetch through exact FTS path");
        let indexed_elapsed = started.elapsed();

        let connection = Connection::open(&database_path).expect("open database");
        connection
            .execute("drop table molecules_fts", [])
            .expect("disable FTS fast path");
        drop(connection);
        let started = std::time::Instant::now();
        let fallback = fetch_page(&database_path, &query).expect("fetch through LIKE fallback");
        let fallback_elapsed = started.elapsed();

        eprintln!(
            "grid_exact_fts_ms={:?} grid_like_fallback_ms={:?}",
            indexed_elapsed, fallback_elapsed
        );
        assert_eq!(indexed.total_rows, 1);
        assert_eq!(fallback.total_rows, indexed.total_rows);
        assert_eq!(fallback.rows[0].name, indexed.rows[0].name);
        assert!(
            indexed_elapsed < fallback_elapsed,
            "expected exact FTS fast path ({indexed_elapsed:?}) to beat LIKE fallback ({fallback_elapsed:?})"
        );

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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
                analysis_filters: Vec::new(),
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
        let connection = Connection::open(&handle.database_path).expect("open grid database");
        let initial_identity =
            grid_identity::read_source_identity(&connection).expect("read initial source identity");
        assert_eq!(initial_identity.source_revision, 1);
        drop(connection);

        let appended = append_grid_text(
            &handle.database_path,
            "sdf",
            "Third\n  Burrete\n\nM  END\n$$$$\n",
            &GridParseOptions::default(),
        )
        .expect("append sdf");
        assert_eq!(appended.records_appended, 1);
        assert_eq!(appended.total_rows, 3);
        let connection = Connection::open(&handle.database_path).expect("open grid database");
        let appended_identity = grid_identity::read_source_identity(&connection)
            .expect("read appended source identity");
        assert_eq!(appended_identity.source_revision, 2);
        assert_ne!(
            initial_identity.document_fingerprint_sha256,
            appended_identity.document_fingerprint_sha256
        );
        let hashed_records: i64 = connection
            .query_row(
                "select count(*) from molecules where length(molecule_content_sha256) = 64",
                [],
                |row| row.get(0),
            )
            .expect("count molecule hashes");
        assert_eq!(hashed_records, 3);
        drop(connection);

        let page = fetch_page(
            &handle.database_path,
            &GridQuery {
                query: String::new(),
                sort: "index".to_string(),
                analysis_filters: Vec::new(),
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
