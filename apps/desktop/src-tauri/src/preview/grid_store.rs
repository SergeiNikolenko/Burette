use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::runtime_utils::{clipped, decode_text, normalized_lines};

#[derive(Default)]
pub(crate) struct GridRuntimeRegistry {
    entries: Mutex<HashMap<String, RegisteredGridRuntime>>,
}

#[derive(Clone, Debug)]
struct RegisteredGridRuntime {
    database_path: PathBuf,
    format: &'static str,
}

#[derive(Debug)]
pub(crate) struct GridCollectionSummary {
    pub(crate) format: &'static str,
    pub(crate) records_total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridPageResult {
    pub(crate) rows: Vec<GridPageRow>,
    pub(crate) total_rows: usize,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
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

impl GridRuntimeRegistry {
    pub(crate) fn register(
        &self,
        document_id: &str,
        database_path: PathBuf,
        format: &'static str,
    ) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?;
        entries.insert(
            document_id.to_string(),
            RegisteredGridRuntime {
                database_path,
                format,
            },
        );
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
) -> Result<Option<(PathBuf, GridCollectionSummary)>, String> {
    build_grid_store_with_options(runtime_dir, extension, data, &GridParseOptions::default())
}

pub(crate) fn build_grid_store_with_options(
    runtime_dir: &Path,
    extension: &str,
    data: &[u8],
    options: &GridParseOptions,
) -> Result<Option<(PathBuf, GridCollectionSummary)>, String> {
    let Some(format) = grid_format(extension) else {
        return Ok(None);
    };
    let text = decode_text(data);
    let database_path = runtime_dir.join("collection.sqlite");
    let connection = Connection::open(&database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let records_total = match extension {
        "csv" => ingest_delimited_with_fallback(&connection, &text, ',', "csv", options)?,
        "tsv" => ingest_delimited_with_fallback(&connection, &text, '\t', "tsv", options)?,
        "smi" | "smiles" => ingest_smiles(&connection, &text)?,
        "sdf" | "sd" => ingest_sdf(&connection, &text)?,
        _ => 0,
    };
    if records_total == 0 || ((extension == "sdf" || extension == "sd") && records_total <= 1) {
        let _ = std::fs::remove_file(&database_path);
        return Ok(None);
    }
    Ok(Some((
        database_path,
        GridCollectionSummary {
            format,
            records_total,
        },
    )))
}

fn append_grid_text(
    database_path: &Path,
    format: &'static str,
    text: &str,
    options: &GridParseOptions,
) -> Result<GridAppendSummary, String> {
    let connection = Connection::open(database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let start_index = molecule_count(&connection)?;
    let records_appended = match format {
        "csv" => {
            ingest_delimited_with_fallback_at(&connection, text, ',', "csv", start_index, options)?
        }
        "tsv" => {
            ingest_delimited_with_fallback_at(&connection, text, '\t', "tsv", start_index, options)?
        }
        "smiles" => ingest_smiles_at(&connection, text, start_index)?,
        "sdf" => ingest_sdf_at(&connection, text, start_index)?,
        _ => 0,
    };
    if records_appended == 0 {
        return Err(format!(
            "{format} source does not contain supported molecule records"
        ));
    }
    Ok(GridAppendSummary {
        records_appended,
        total_rows: molecule_count(&connection)?,
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
    let normalized_query = query.query.trim().to_lowercase();
    let total_rows = if normalized_query.is_empty() {
        connection
            .query_row("select count(*) from molecules", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|err| err.to_string())? as usize
    } else {
        let pattern = like_pattern(&normalized_query);
        connection
            .query_row(
                "select count(*) from molecules where search_text like ?1 escape '\\'",
                params![pattern],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|err| err.to_string())? as usize
    };

    let sort_sql = match query.sort.as_str() {
        "name" => "name collate nocase asc, source_index asc",
        "smiles" => "coalesce(smiles, '') collate nocase asc, source_index asc",
        _ => "source_index asc",
    };
    let sql = if normalized_query.is_empty() {
        format!(
            "select source_index, name, smiles, molblock, props_json \
             from molecules \
             order by {sort_sql} \
             limit ?1 offset ?2"
        )
    } else {
        format!(
            "select source_index, name, smiles, molblock, props_json \
             from molecules \
             where search_text like ?1 escape '\\' \
             order by {sort_sql} \
             limit ?2 offset ?3"
        )
    };
    let limit = query.limit.clamp(1, 240);
    let offset = query.offset;
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let mut rows = if normalized_query.is_empty() {
        statement
            .query(params![limit as i64, offset as i64])
            .map_err(|err| err.to_string())?
    } else {
        let pattern = like_pattern(&normalized_query);
        statement
            .query(params![pattern, limit as i64, offset as i64])
            .map_err(|err| err.to_string())?
    };
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
    Ok(GridPageResult {
        rows: page_rows,
        total_rows,
        offset,
        limit,
    })
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
                 search_text text not null
             );
             create index if not exists molecules_source_index on molecules(source_index);
             create index if not exists molecules_name on molecules(name collate nocase);
             create index if not exists molecules_smiles on molecules(smiles collate nocase);",
        )
        .map_err(|err| err.to_string())
}

fn ingest_smiles(connection: &Connection, text: &str) -> Result<usize, String> {
    ingest_smiles_at(connection, text, 0)
}

fn ingest_smiles_at(
    connection: &Connection,
    text: &str,
    start_index: usize,
) -> Result<usize, String> {
    let tx = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let mut insert = tx
        .prepare(
            "insert into molecules (source_index, name, smiles, molblock, props_json, search_text)
             values (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|err| err.to_string())?;
    let mut records_total = 0;
    for line in normalized_lines(text) {
        let trimmed = line.trim();
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
            .unwrap_or_else(|| format!("Molecule {}", records_total + 1));
        let record = GridInputRecord {
            index: start_index + records_total,
            name,
            smiles: Some(clipped(smiles, 2048)),
            molblock: None,
            props: BTreeMap::new(),
        };
        insert_record(&mut insert, &record)?;
        records_total += 1;
    }
    drop(insert);
    tx.commit().map_err(|err| err.to_string())?;
    Ok(records_total)
}

fn ingest_sdf(connection: &Connection, text: &str) -> Result<usize, String> {
    ingest_sdf_at(connection, text, 0)
}

fn ingest_sdf_at(connection: &Connection, text: &str, start_index: usize) -> Result<usize, String> {
    let tx = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let mut insert = tx
        .prepare(
            "insert into molecules (source_index, name, smiles, molblock, props_json, search_text)
             values (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|err| err.to_string())?;
    let mut records_total = 0usize;
    let mut current = Vec::new();
    let mut current_has_content = false;
    for line in normalized_lines(text) {
        if line.trim() == "$$$$" {
            if let Some(record) =
                finish_sdf_record(&current, current_has_content, start_index + records_total)
            {
                insert_record(&mut insert, &record)?;
                records_total += 1;
            }
            current.clear();
            current_has_content = false;
        } else {
            if !line.trim().is_empty() {
                current_has_content = true;
            }
            current.push(line);
        }
    }
    if let Some(record) =
        finish_sdf_record(&current, current_has_content, start_index + records_total)
    {
        insert_record(&mut insert, &record)?;
        records_total += 1;
    }
    drop(insert);
    tx.commit().map_err(|err| err.to_string())?;
    Ok(records_total)
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

fn ingest_delimited_with_fallback(
    connection: &Connection,
    text: &str,
    separator: char,
    format: &str,
    options: &GridParseOptions,
) -> Result<usize, String> {
    ingest_delimited_with_fallback_at(connection, text, separator, format, 0, options)
}

fn ingest_delimited_with_fallback_at(
    connection: &Connection,
    text: &str,
    separator: char,
    format: &str,
    start_index: usize,
    options: &GridParseOptions,
) -> Result<usize, String> {
    match ingest_delimited_table_at(connection, text, separator, start_index, options) {
        Ok(records_total) => Ok(records_total),
        Err(error) if error == "missing smiles column" && options.smiles_column.is_none() => {
            ingest_delimited_rows_as_smiles_at(connection, text, separator, format, start_index)
        }
        Err(error) => Err(error),
    }
}

fn ingest_delimited_table_at(
    connection: &Connection,
    text: &str,
    separator: char,
    start_index: usize,
    options: &GridParseOptions,
) -> Result<usize, String> {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let Some(header_line) = rows.first() else {
        return Ok(0);
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
    let tx = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let mut insert = tx
        .prepare(
            "insert into molecules (source_index, name, smiles, molblock, props_json, search_text)
             values (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|err| err.to_string())?;
    let mut records_total = 0usize;
    for line in rows.into_iter().skip(1) {
        let cells = parse_delimited_line(&line, separator);
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
            format!("Molecule {}", records_total + 1)
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
        let record = GridInputRecord {
            index: start_index + records_total,
            name,
            smiles: Some(clipped(smiles, 2048)),
            molblock: None,
            props,
        };
        insert_record(&mut insert, &record)?;
        records_total += 1;
    }
    drop(insert);
    tx.commit().map_err(|err| err.to_string())?;
    Ok(records_total)
}

fn ingest_delimited_rows_as_smiles_at(
    connection: &Connection,
    text: &str,
    separator: char,
    format: &str,
    start_index: usize,
) -> Result<usize, String> {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let row_start = rows
        .first()
        .map(|row| is_likely_delimited_header(&parse_delimited_line(row, separator)))
        .unwrap_or(false) as usize;
    let tx = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let mut insert = tx
        .prepare(
            "insert into molecules (source_index, name, smiles, molblock, props_json, search_text)
             values (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|err| err.to_string())?;
    let mut records_total = 0usize;
    for row in rows.into_iter().skip(row_start) {
        let cells: Vec<_> = parse_delimited_line(&row, separator)
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let Some(smiles) = cells.first().filter(|value| looks_like_smiles(value)) else {
            continue;
        };
        let name = cells
            .get(1)
            .filter(|value| !value.is_empty())
            .map(|value| clipped(value, 160))
            .unwrap_or_else(|| format!("Molecule {}", records_total + 1));
        let mut props = BTreeMap::new();
        for (offset, value) in cells.iter().skip(2).enumerate() {
            if props.len() < 64 {
                props.insert(format!("Column {}", offset + 3), clipped(value, 500));
            }
        }
        let record = GridInputRecord {
            index: start_index + records_total,
            name,
            smiles: Some(clipped(smiles, 2048)),
            molblock: None,
            props,
        };
        insert_record(&mut insert, &record)?;
        records_total += 1;
    }
    drop(insert);
    tx.commit().map_err(|err| err.to_string())?;
    if records_total == 0 {
        return Err(format!(
            "{format} table does not contain supported molecule records"
        ));
    }
    Ok(records_total)
}

fn insert_record(
    insert: &mut rusqlite::Statement<'_>,
    record: &GridInputRecord,
) -> Result<(), String> {
    let props_json = serde_json::to_string(&record.props).map_err(|err| err.to_string())?;
    let search_text = build_search_text(record);
    insert
        .execute(params![
            record.index as i64,
            record.name,
            record.smiles,
            record.molblock,
            props_json,
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
    for (key, value) in &record.props {
        parts.push(key.to_lowercase());
        parts.push(value.to_lowercase());
    }
    parts.join("\n")
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

    #[test]
    fn builds_csv_store_and_fetches_sorted_pages() {
        let runtime_dir = temp_runtime_dir();
        let csv =
            "smiles,name,series\nCCO,Ethanol,Alpha\nc1ccccc1,Benzene,Beta\nCCN,Ethylamine,Gamma\n";

        let (database_path, summary) = build_grid_store(&runtime_dir, "csv", csv.as_bytes())
            .expect("build grid store")
            .expect("collection");
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

        let (database_path, summary) = build_grid_store(&runtime_dir, "tsv", tsv.as_bytes())
            .expect("build grid store")
            .expect("collection");
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

        let (database_path, summary) = build_grid_store(&runtime_dir, "csv", csv.as_bytes())
            .expect("build grid store")
            .expect("collection");
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

        let (database_path, summary) = build_grid_store_with_options(
            &runtime_dir,
            "csv",
            csv.as_bytes(),
            &GridParseOptions {
                smiles_column: Some("decoy".to_string()),
            },
        )
        .expect("build grid store")
        .expect("collection");
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
        assert_eq!(page.rows[0].smiles.as_deref(), Some("CCN"));
        assert_eq!(
            page.rows[0].props.get("active").map(String::as_str),
            Some("CCO")
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

        let (database_path, summary) = build_grid_store(&runtime_dir, "sdf", sdf.as_bytes())
            .expect("build grid store")
            .expect("collection");
        assert_eq!(summary.records_total, 2);

        let appended = append_grid_text(
            &database_path,
            "sdf",
            "Third\n  Burrete\n\nM  END\n$$$$\n",
            &GridParseOptions::default(),
        )
        .expect("append sdf");
        assert_eq!(appended.records_appended, 1);
        assert_eq!(appended.total_rows, 3);

        let page = fetch_page(
            &database_path,
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
