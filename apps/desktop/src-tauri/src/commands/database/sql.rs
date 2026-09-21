//! "Retrieve From SQL": run a read-only query against PostgreSQL or SQLite and
//! open the answer as a collection.
//!
//! Two things make an in-app SQL console safe enough to ship. The statement is
//! checked to be a single read, and the connection itself is opened read-only -
//! a PostgreSQL read-only transaction and SQLite's read-only open flag - so a
//! statement that slips past the text check still cannot write.
//!
//! Which column holds the structures is worked out the way DataWarrior does it:
//! by column name first, and by what the values look like when the name says
//! nothing. The winning column is renamed so the grid, which finds structures by
//! column name, picks it up.

use rusqlite::types::ValueRef;
use serde::Deserialize;
use serde_json::Value;
// The statement is the feature here: it is the query the user typed. It is
// audited by ensure_read_only_statement and executed inside a read-only
// transaction, which is what AssertSqlSafe is being asserted about.
use sqlx::{AssertSqlSafe, ConnectOptions, Row};

use super::table::DatabaseTable;
use super::{scalar_text, DatabasePayload};

const CONNECT_TIMEOUT_SECONDS: u64 = 20;
const QUERY_TIMEOUT_SECONDS: u64 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SqlEngine {
    Postgres,
    Sqlite,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlQueryRequest {
    pub(crate) engine: SqlEngine,
    /// A `postgres://user@host/db` URL, or the path of a SQLite file.
    pub(crate) connection: String,
    pub(crate) statement: String,
    /// The keychain account holding this connection's password, when it needs one.
    #[serde(default)]
    pub(crate) account: Option<String>,
}

pub(crate) fn query(request: &SqlQueryRequest, limit: usize) -> Result<DatabasePayload, String> {
    let statement = ensure_read_only_statement(&request.statement)?;
    let (headers, rows) = match request.engine {
        SqlEngine::Postgres => postgres_rows(request, &statement, limit)?,
        SqlEngine::Sqlite => sqlite_rows(&request.connection, &statement, limit)?,
    };
    if rows.is_empty() {
        return Ok(DatabasePayload {
            extension: "csv",
            text: String::new(),
            record_count: 0,
            warnings: Vec::new(),
        });
    }
    let structure_column = structure_column_index(&headers, &rows);
    let mut warnings = Vec::new();
    let headers: Vec<String> = headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            if Some(index) == structure_column && !is_smiles_header(header) {
                // The grid recognises a structure column by its name, so the sniffed
                // one is renamed rather than moved - the original name stays visible.
                warnings.push(format!("Read column \"{header}\" as the structure column"));
                format!("{header} (SMILES)")
            } else {
                header.clone()
            }
        })
        .collect();
    if structure_column.is_none() {
        warnings.push("No column held structures, so this collection is a data table.".to_string());
    }
    let mut table = DatabaseTable::new(&headers.iter().map(String::as_str).collect::<Vec<_>>());
    for row in rows {
        table.push_row(row);
    }
    Ok(DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.to_csv(),
        warnings,
    })
}

/// A single read. Anything else - a second statement smuggled in after a
/// semicolon, an UPDATE, a DDL statement - is refused before a connection is
/// even opened.
pub(crate) fn ensure_read_only_statement(statement: &str) -> Result<String, String> {
    let trimmed = statement.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Err("The query is empty".to_string());
    }
    if contains_statement_separator(trimmed) {
        return Err("Only one statement can be run at a time".to_string());
    }
    let head = trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if head != "SELECT" && head != "WITH" {
        return Err("Only SELECT and WITH queries can be run from here".to_string());
    }
    Ok(trimmed.to_string())
}

/// A semicolon inside a string literal or a quoted identifier is data, not a
/// separator; only an unquoted one splits statements.
fn contains_statement_separator(statement: &str) -> bool {
    let mut in_single = false;
    let mut in_double = false;
    let mut characters = statement.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\'' if !in_double => {
                if in_single && characters.peek() == Some(&'\'') {
                    characters.next();
                } else {
                    in_single = !in_single;
                }
            }
            '"' if !in_single => {
                if in_double && characters.peek() == Some(&'"') {
                    characters.next();
                } else {
                    in_double = !in_double;
                }
            }
            ';' if !in_single && !in_double => return true,
            _ => {}
        }
    }
    false
}

fn postgres_rows(
    request: &SqlQueryRequest,
    statement: &str,
    limit: usize,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut options: sqlx::postgres::PgConnectOptions = request
        .connection
        .trim()
        .parse()
        .map_err(|error| format!("The PostgreSQL connection URL is not valid: {error}"))?;
    if let Some(account) = request.account.as_deref() {
        if let Some(password) = super::secrets::read(account)? {
            options = options.password(&password);
        }
    }
    // Statement logging would put the query - and any literal in it - in the log.
    options = options.disable_statement_logging();
    let statement = statement.to_string();
    // The command already runs on a blocking thread, so the shared runtime is only
    // borrowed for the duration of the query rather than a second one being built.
    tauri::async_runtime::block_on(async move {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
            .connect_with(options)
            .await
            .map_err(|error| format!("Could not connect to PostgreSQL: {error}"))?;
        let outcome = run_postgres_query(&pool, &statement, limit).await;
        pool.close().await;
        outcome
    })
}

async fn run_postgres_query(
    pool: &sqlx::PgPool,
    statement: &str,
    limit: usize,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not open a transaction: {error}"))?;
    // The server enforces what the text check only asserts, and stops a query that
    // would otherwise hold the connection open indefinitely.
    sqlx::raw_sql(AssertSqlSafe(format!(
        "SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '{QUERY_TIMEOUT_SECONDS}s'"
    )))
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not open a read-only transaction: {error}"))?;

    let limited = format!("SELECT * FROM ({statement}) AS burette_query LIMIT {limit}");
    // The rows come back as JSON objects, whose keys are read back in sorted
    // order, so the column order is asked for separately: json_each_text WITH
    // ORDINALITY numbers the keys as the server wrote them.
    let header_payload: String = sqlx::query(AssertSqlSafe(format!(
        "SELECT coalesce(json_agg(e.k ORDER BY e.ord)::text, '[]') \
         FROM (SELECT * FROM ({limited}) AS burette_head LIMIT 1) AS q, \
         LATERAL json_each_text(row_to_json(q)) WITH ORDINALITY AS e(k, v, ord)"
    )))
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("PostgreSQL rejected the query: {error}"))?
    .try_get(0)
    .map_err(|error| format!("PostgreSQL sent an unreadable answer: {error}"))?;
    let headers = json_headers(&header_payload)?;
    if headers.is_empty() {
        return Ok((headers, Vec::new()));
    }

    // One text column instead of one decoder per PostgreSQL type: the server
    // renders every value, including the types sqlx has no Rust mapping for.
    let payload: String = sqlx::query(AssertSqlSafe(format!(
        "SELECT coalesce(json_agg(burette_rows)::text, '[]') FROM ({limited}) AS burette_rows"
    )))
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("PostgreSQL rejected the query: {error}"))?
    .try_get(0)
    .map_err(|error| format!("PostgreSQL sent an unreadable answer: {error}"))?;
    let rows = json_rows(&payload, &headers)?;
    // Nothing was written, so the transaction is rolled back rather than committed.
    let _ = transaction.rollback().await;
    Ok((headers, rows))
}

fn json_headers(payload: &str) -> Result<Vec<String>, String> {
    let parsed: Value = serde_json::from_str(payload)
        .map_err(|error| format!("PostgreSQL sent an unreadable answer: {error}"))?;
    Ok(parsed
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(scalar_text)
        .collect())
}

fn json_rows(payload: &str, headers: &[String]) -> Result<Vec<Vec<String>>, String> {
    let parsed: Value = serde_json::from_str(payload)
        .map_err(|error| format!("PostgreSQL sent an unreadable answer: {error}"))?;
    let rows = parsed.as_array().map(Vec::as_slice).unwrap_or_default();
    Ok(rows
        .iter()
        .map(|row| {
            headers
                .iter()
                .map(|header| match row.get(header) {
                    Some(Value::Array(_)) | Some(Value::Object(_)) => row
                        .get(header)
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    Some(value) => scalar_text(value),
                    None => String::new(),
                })
                .collect()
        })
        .collect())
}

fn sqlite_rows(
    path: &str,
    statement: &str,
    limit: usize,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Choose a SQLite database file".to_string());
    }
    let connection = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|error| format!("Could not open the SQLite database: {error}"))?;
    let limited = format!("SELECT * FROM ({statement}) LIMIT {limit}");
    let mut prepared = connection
        .prepare(&limited)
        .map_err(|error| format!("SQLite rejected the query: {error}"))?;
    let headers: Vec<String> = prepared
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    let mut cursor = prepared
        .query([])
        .map_err(|error| format!("SQLite rejected the query: {error}"))?;
    let mut rows = Vec::new();
    while let Some(row) = cursor
        .next()
        .map_err(|error| format!("SQLite stopped answering: {error}"))?
    {
        rows.push(
            (0..headers.len())
                .map(|index| match row.get_ref(index) {
                    Ok(ValueRef::Null) | Err(_) => String::new(),
                    Ok(ValueRef::Integer(value)) => value.to_string(),
                    Ok(ValueRef::Real(value)) => value.to_string(),
                    Ok(ValueRef::Text(value)) => String::from_utf8_lossy(value).to_string(),
                    Ok(ValueRef::Blob(value)) => format!("{} bytes", value.len()),
                })
                .collect(),
        );
    }
    Ok((headers, rows))
}

pub(crate) fn is_smiles_header(header: &str) -> bool {
    let normalized = header.trim().to_lowercase().replace(' ', "_");
    normalized == "smile" || normalized.contains("smiles")
}

/// A named column wins outright. Otherwise every column is scored on how many of
/// its values read as SMILES, and the best one is taken only if most of the
/// column agrees - a table of identifiers should stay a table.
pub(crate) fn structure_column_index(headers: &[String], rows: &[Vec<String>]) -> Option<usize> {
    if let Some(index) = headers.iter().position(|header| is_smiles_header(header)) {
        return Some(index);
    }
    let sampled = rows.len().min(50);
    if sampled == 0 {
        return None;
    }
    let mut best: Option<(usize, usize)> = None;
    for index in 0..headers.len() {
        let hits = rows
            .iter()
            .take(sampled)
            .filter(|row| row.get(index).is_some_and(|value| looks_like_smiles(value)))
            .count();
        if hits * 2 > sampled && best.map(|(_, score)| hits > score).unwrap_or(true) {
            best = Some((index, hits));
        }
    }
    best.map(|(index, _)| index)
}

/// Deliberately shallow: this decides which column to hand to the grid, and the
/// grid's own chemistry toolkit has the final say on whether a value parses.
///
/// The discriminating rule is that outside brackets a SMILES may only use the
/// organic subset - B, C, N, O, P, S, F, I, H, their aromatic lower-case forms
/// and the l and r of Cl and Br. That is what separates a structure from an
/// identifier: "CHEMBL25" and "CPD-001" read as chemistry to a looser filter, but
/// their E, M and D can only appear inside brackets in a real SMILES.
pub(crate) fn looks_like_smiles(value: &str) -> bool {
    let value = value.trim();
    if value.len() < 2 || value.len() > 600 {
        return false;
    }
    if value.chars().any(char::is_whitespace) {
        return false;
    }
    // A number, a date or an identifier full of digits is not a structure.
    if value.chars().filter(char::is_ascii_digit).count() * 2 > value.len() {
        return false;
    }
    let mut bracket_depth = 0usize;
    let mut element_letters = 0usize;
    for character in value.chars() {
        match character {
            '[' => bracket_depth += 1,
            ']' => {
                if bracket_depth == 0 {
                    return false;
                }
                bracket_depth -= 1;
            }
            _ if bracket_depth > 0 => {
                // A bracket atom carries its own charge, isotope and chirality, and
                // any element symbol at all.
                if !character.is_ascii_alphanumeric() && !matches!(character, '+' | '-' | '@' | '*')
                {
                    return false;
                }
                if character.is_ascii_alphabetic() {
                    element_letters += 1;
                }
            }
            'B' | 'C' | 'N' | 'O' | 'P' | 'S' | 'F' | 'I' | 'H' | 'b' | 'c' | 'n' | 'o' | 'p'
            | 's' => element_letters += 1,
            // Only ever the second letter of Cl and Br outside brackets.
            'l' | 'r' => {}
            '(' | ')' | '=' | '#' | '@' | '+' | '-' | '\\' | '/' | '.' | '%' | '*' => {}
            _ if character.is_ascii_digit() => {}
            _ => return false,
        }
    }
    bracket_depth == 0 && element_letters > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_single_read_statement_is_accepted() {
        assert_eq!(
            ensure_read_only_statement("  SELECT * FROM compounds;  ").unwrap(),
            "SELECT * FROM compounds"
        );
        assert!(ensure_read_only_statement("with x as (select 1) select * from x").is_ok());
        assert!(ensure_read_only_statement("").is_err());
        assert!(ensure_read_only_statement("   ;  ").is_err());
        assert!(ensure_read_only_statement("DELETE FROM compounds").is_err());
        assert!(ensure_read_only_statement("UPDATE compounds SET name = 'x'").is_err());
        assert!(ensure_read_only_statement("DROP TABLE compounds").is_err());
        assert!(ensure_read_only_statement("INSERT INTO compounds VALUES (1)").is_err());
    }

    #[test]
    fn a_second_statement_cannot_ride_along_behind_a_semicolon() {
        assert!(ensure_read_only_statement("SELECT 1; DROP TABLE compounds").is_err());
        assert!(ensure_read_only_statement("SELECT 1; DROP TABLE compounds;").is_err());
        // A semicolon inside a literal is data, and must not block a valid query.
        assert!(ensure_read_only_statement("SELECT * FROM t WHERE name = 'a;b'").is_ok());
        assert!(ensure_read_only_statement("SELECT * FROM \"odd;name\"").is_ok());
        assert!(ensure_read_only_statement("SELECT 'it''s' AS x").is_ok());
    }

    #[test]
    fn a_named_smiles_column_wins_over_every_guess() {
        let headers = vec![
            "id".to_string(),
            "structure".to_string(),
            "canonical_smiles".to_string(),
        ];
        let rows = vec![vec!["1".to_string(), "CCO".to_string(), "CCO".to_string()]];
        assert_eq!(structure_column_index(&headers, &rows), Some(2));
        assert!(is_smiles_header("Canonical SMILES"));
        assert!(is_smiles_header("smile"));
        assert!(!is_smiles_header("smiling_face"));
    }

    #[test]
    fn an_unnamed_structure_column_is_found_from_its_values() {
        let headers = vec![
            "compound_id".to_string(),
            "structure".to_string(),
            "mw".to_string(),
        ];
        let rows = vec![
            vec![
                "CPD-001".to_string(),
                "CCO".to_string(),
                "46.07".to_string(),
            ],
            vec![
                "CPD-002".to_string(),
                "CC(=O)Oc1ccccc1C(=O)O".to_string(),
                "180.16".to_string(),
            ],
            vec![
                "CPD-003".to_string(),
                "c1ccccc1".to_string(),
                "78.11".to_string(),
            ],
        ];
        assert_eq!(structure_column_index(&headers, &rows), Some(1));
    }

    #[test]
    fn a_table_without_structures_stays_a_table() {
        let headers = vec!["id".to_string(), "measured_at".to_string()];
        let rows = vec![
            vec!["1".to_string(), "2026-01-02".to_string()],
            vec!["2".to_string(), "2026-01-03".to_string()],
        ];
        assert_eq!(structure_column_index(&headers, &rows), None);
        assert_eq!(structure_column_index(&headers, &[]), None);
    }

    #[test]
    fn identifiers_and_numbers_are_not_mistaken_for_structures() {
        assert!(looks_like_smiles("CC(=O)Oc1ccccc1C(=O)O"));
        assert!(looks_like_smiles("c1ccccc1"));
        assert!(looks_like_smiles("CCO"));
        assert!(!looks_like_smiles("C"));
        assert!(!looks_like_smiles("2026-01-02"));
        assert!(!looks_like_smiles("12345678"));
        assert!(!looks_like_smiles("CHEMBL25"));
        assert!(!looks_like_smiles("CPD-001"));
        assert!(!looks_like_smiles("some name here"));
        assert!(!looks_like_smiles(""));
        assert!(!looks_like_smiles(&"C".repeat(700)));
        // Bracket atoms may name any element, and must be balanced.
        assert!(looks_like_smiles("[Na+].[Cl-]"));
        assert!(looks_like_smiles("C[C@H](N)C(=O)O"));
        assert!(!looks_like_smiles("C[Fe"));
        assert!(!looks_like_smiles("CC]"));
    }

    #[test]
    fn postgres_json_rows_follow_the_described_column_order() {
        let headers = vec![
            "smiles".to_string(),
            "id".to_string(),
            "note".to_string(),
            "tags".to_string(),
        ];
        let payload = r#"[{"id":1,"smiles":"CCO","note":null,"tags":["a","b"]},
                          {"id":2,"smiles":"CCN","note":"kept","tags":{}}]"#;
        let rows = json_rows(payload, &headers).expect("rows");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0], "CCO");
        assert_eq!(rows[0][1], "1");
        assert_eq!(rows[0][2], "");
        assert_eq!(rows[0][3], "[\"a\",\"b\"]");
        assert_eq!(rows[1][0], "CCN");
        assert_eq!(json_rows("[]", &headers).unwrap().len(), 0);
        assert!(json_rows("not json", &headers).is_err());
    }

    #[test]
    fn sqlite_reads_are_read_only_and_typed_by_the_column() {
        let path = std::env::temp_dir().join(format!("burette-sql-{}.db", uuid::Uuid::new_v4()));
        {
            let writable = rusqlite::Connection::open(&path).expect("create");
            writable
                .execute_batch(
                    "CREATE TABLE compounds (id INTEGER, structure TEXT, mw REAL, note TEXT, raw BLOB);
                     INSERT INTO compounds VALUES (1, 'CCO', 46.07, NULL, x'00ff');
                     INSERT INTO compounds VALUES (2, 'CC(=O)Oc1ccccc1C(=O)O', 180.16, 'aspirin', NULL);",
                )
                .expect("seed");
        }
        let request = SqlQueryRequest {
            engine: SqlEngine::Sqlite,
            connection: path.to_string_lossy().to_string(),
            statement: "SELECT id, structure, mw, note, raw FROM compounds".to_string(),
            account: None,
        };
        let payload = query(&request, 10).expect("query");
        assert_eq!(payload.record_count, 2);
        let header = payload.text.lines().next().expect("header");
        // The sniffed structure column is renamed so the grid can find it.
        assert!(header.contains("structure (SMILES)"), "header was {header}");
        assert!(payload.text.contains("1,CCO,46.07,,2 bytes"));
        assert!(payload.text.contains("aspirin"));
        assert!(payload
            .warnings
            .iter()
            .any(|warning| warning.contains("structure column")));

        let writing = SqlQueryRequest {
            statement: "DELETE FROM compounds".to_string(),
            ..request
        };
        assert!(query(&writing, 10).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_sqlite_query_without_a_file_never_opens_a_connection() {
        assert!(sqlite_rows("   ", "SELECT 1", 10).is_err());
    }
}
