use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::{Runtime, State};

use crate::preview::grid_store::{
    descriptor_source_row_batch, open_descriptor_source, GridRuntimeRegistry,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceRow {
    row_id: i64,
    smiles: Option<String>,
    molblock: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Assignment {
    row_id: i64,
    values: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreRequest {
    document_id: String,
    source_rows: Vec<SourceRow>,
    labels: Vec<String>,
    rows: Vec<Assignment>,
    parameters: serde_json::Value,
}

fn replace_results(connection: &mut Connection, request: &StoreRequest) -> Result<(), String> {
    if request.source_rows.is_empty() || request.source_rows.len() > 5_000 {
        return Err("R-group results require 1-5000 source molecules".into());
    }
    let labels: HashSet<_> = request.labels.iter().collect();
    if labels.len() != request.labels.len()
        || labels.is_empty()
        || labels.len() > 64
        || labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 40
                || !label.bytes().all(|c| c.is_ascii_alphanumeric())
        })
    {
        return Err("Invalid R-group result columns".into());
    }
    let source_ids: HashSet<_> = request.source_rows.iter().map(|row| row.row_id).collect();
    let result_ids: HashSet<_> = request.rows.iter().map(|row| row.row_id).collect();
    if source_ids.len() != request.source_rows.len()
        || result_ids.len() != request.rows.len()
        || !result_ids.is_subset(&source_ids)
        || request
            .rows
            .iter()
            .any(|row| row.values.keys().any(|key| !labels.contains(key)))
    {
        return Err("Invalid R-group result rows".into());
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current = descriptor_source_row_batch(&tx, -1, 5_001)?;
    if current.len() != request.source_rows.len()
        || current
            .iter()
            .zip(&request.source_rows)
            .any(|(a, b)| a.row_id != b.row_id || a.smiles != b.smiles || a.molblock != b.molblock)
    {
        return Err(
            "The collection changed. Preview the decomposition again before applying.".into(),
        );
    }
    // Replace the complete owned result set in one transaction. Other derived
    // columns survive, and any failure rolls back both deletion and insertion.
    tx.execute("delete from descriptor_values where descriptor_id in (select column_id from derived_columns where kind = 'rgroup')", []).map_err(|e| e.to_string())?;
    tx.execute("delete from derived_columns where kind = 'rgroup'", [])
        .map_err(|e| e.to_string())?;
    let parameters = request.parameters.to_string();
    for label in &request.labels {
        let id = format!("RGroup_{label}");
        let title = if label == "Core" {
            "R-Group Core"
        } else {
            label
        };
        let occupied: bool = tx
            .query_row(
                "select exists(select 1 from derived_columns where column_id = ?1)",
                [&id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if occupied {
            return Err(format!("Column {id} belongs to another calculation"));
        }
        tx.execute("insert into derived_columns (column_id, label, kind, params_json, created_at_ms) values (?1, ?2, 'rgroup', ?3, unixepoch() * 1000)", params![id, title, parameters]).map_err(|e| e.to_string())?;
        let mut insert = tx.prepare("insert or replace into descriptor_values (molecule_id, descriptor_id, label, value_text, updated_at_ms) values (?1, ?2, ?3, ?4, unixepoch() * 1000)").map_err(|e| e.to_string())?;
        for row in &request.rows {
            insert
                .execute(params![row.row_id, id, title, row.values.get(label)])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn rgroup_store_results<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: StoreRequest,
) -> Result<(), String> {
    if serde_json::to_vec(&request)
        .map_err(|e| e.to_string())?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("R-group results exceed the 16 MiB storage limit".into());
    }
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let path = registry.descriptor_database_path(&document_id)?;
    replace_results(&mut open_descriptor_source(&path)?, &request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_results_atomically_and_rejects_stale_sources() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table molecules (id integer primary key, name text, smiles text, molblock text, source_index integer);
            create table derived_columns (column_id text primary key, label text, kind text, params_json text, created_at_ms integer);
            create table descriptor_values (molecule_id integer, descriptor_id text, label text, value_text text, updated_at_ms integer, primary key (molecule_id, descriptor_id));
            insert into molecules values (1, 'benzene', 'c1ccccc1', null, 0), (2, 'pyridine', 'c1ccncc1', null, 1);
            insert into derived_columns values ('Formula', 'Formula', 'formula', null, 0);
            insert into descriptor_values values (1, 'Formula', 'Formula', 'C6H6', 0);").unwrap();
        let mut request: StoreRequest = serde_json::from_value(serde_json::json!({
            "documentId": "test", "sourceRows": [
                {"rowId": 1, "smiles": "c1ccccc1"}, {"rowId": 2, "smiles": "c1ccncc1"}
            ], "labels": ["Core", "R1", "R2"],
            "rows": [{"rowId": 1, "values": {"Core": "benzene", "R1": "C", "R2": "Cl"}}],
            "parameters": {"core": "c1ccccc1"}
        }))
        .unwrap();
        replace_results(&mut db, &request).unwrap();
        request.labels = vec!["Core".into(), "R1".into()];
        request.rows = vec![Assignment {
            row_id: 2,
            values: BTreeMap::from([
                ("Core".into(), "pyridine".into()),
                ("R1".into(), "Br".into()),
            ]),
        }];
        replace_results(&mut db, &request).unwrap();
        let snapshot = |db: &Connection| -> Vec<(i64, String, String)> {
            db.prepare("select molecule_id, descriptor_id, value_text from descriptor_values order by molecule_id, descriptor_id").unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
        };
        let expected = vec![
            (1, "Formula".into(), "C6H6".into()),
            (2, "RGroup_Core".into(), "pyridine".into()),
            (2, "RGroup_R1".into(), "Br".into()),
        ];
        assert_eq!(snapshot(&db), expected);
        // A write failure after deleting the old results must restore them.
        db.execute_batch("create trigger fail_insert before insert on descriptor_values begin select raise(abort, 'disk failure'); end;").unwrap();
        assert!(replace_results(&mut db, &request).is_err());
        assert_eq!(snapshot(&db), expected);
        db.execute_batch(
            "drop trigger fail_insert; update molecules set smiles = 'CC' where id = 1;",
        )
        .unwrap();
        assert!(replace_results(&mut db, &request)
            .unwrap_err()
            .contains("collection changed"));
        assert_eq!(snapshot(&db), expected);
        let columns: i64 = db
            .query_row(
                "select count(*) from derived_columns where column_id = 'RGroup_R2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(columns, 0);
    }
}
