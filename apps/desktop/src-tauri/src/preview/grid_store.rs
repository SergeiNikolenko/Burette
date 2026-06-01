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
    pub(crate) fn register(&self, document_id: &str, database_path: PathBuf) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "grid runtime registry is poisoned")?;
        entries.insert(
            document_id.to_string(),
            RegisteredGridRuntime { database_path },
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
}

pub(crate) fn build_grid_store(
    runtime_dir: &Path,
    extension: &str,
    data: &[u8],
) -> Result<Option<(PathBuf, GridCollectionSummary)>, String> {
    let format = match extension {
        "csv" => "csv",
        "tsv" => "tsv",
        "smi" | "smiles" => "smiles",
        "sdf" | "sd" => "sdf",
        _ => return Ok(None),
    };
    let text = decode_text(data);
    let database_path = runtime_dir.join("collection.sqlite");
    let connection = Connection::open(&database_path).map_err(|err| err.to_string())?;
    initialize_schema(&connection)?;
    let records_total = match extension {
        "csv" => ingest_delimited_with_fallback(&connection, &text, ',', "csv")?,
        "tsv" => ingest_delimited_with_fallback(&connection, &text, '\t', "tsv")?,
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
            index: records_total,
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
            if let Some(record) = finish_sdf_record(&current, current_has_content, records_total) {
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
    if let Some(record) = finish_sdf_record(&current, current_has_content, records_total) {
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
) -> Result<usize, String> {
    ingest_delimited_table(connection, text, separator)
        .or_else(|_| ingest_delimited_rows_as_smiles(connection, text, separator, format))
}

fn ingest_delimited_table(
    connection: &Connection,
    text: &str,
    separator: char,
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
    let normalized_headers: Vec<_> = headers
        .iter()
        .map(|value| value.to_lowercase().replace(' ', "_"))
        .collect();
    let Some(smiles_index) = normalized_headers
        .iter()
        .position(|value| is_smiles_column(value))
    else {
        return Err("missing smiles column".to_string());
    };
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
            index: records_total,
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

fn ingest_delimited_rows_as_smiles(
    connection: &Connection,
    text: &str,
    separator: char,
    format: &str,
) -> Result<usize, String> {
    let rows: Vec<_> = normalized_lines(text)
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let start_index = rows
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
    for row in rows.into_iter().skip(start_index) {
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
            index: records_total,
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

fn is_likely_delimited_header(cells: &[String]) -> bool {
    cells
        .iter()
        .map(|value| value.to_lowercase().replace(' ', "_"))
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
}
