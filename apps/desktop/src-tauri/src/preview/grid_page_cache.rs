use super::grid_predicate::GridPredicatePlan;
use rusqlite::Connection;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

// Revision triggers cover writes from every connection, including descriptor and
// analysis workers. Cache lookup runs in the same read transaction as the page.
pub(super) fn initialize(connection: &Connection) -> Result<(), String> {
    connection.execute_batch("create table if not exists grid_page_revision (id integer primary key check(id = 1), identity text not null, revision integer not null);").map_err(|e| e.to_string())?;
    connection
        .execute(
            "insert or ignore into grid_page_revision values (1, ?1, 0)",
            [uuid::Uuid::new_v4().to_string()],
        )
        .map_err(|e| e.to_string())?;
    for table in [
        "molecules",
        "descriptor_values",
        "analysis_runs",
        "analysis_values",
        "grid_index_state",
    ] {
        for operation in ["insert", "update", "delete"] {
            connection.execute_batch(&format!("create trigger if not exists page_revision_{table}_{operation} after {operation} on {table} begin update grid_page_revision set revision = revision + 1 where id = 1; end;")).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(PartialEq)]
pub(super) struct Key {
    identity: String,
    revision: i64,
    predicate: String,
}
type Stats = (usize, bool);
fn cache() -> &'static Mutex<VecDeque<(Key, Stats)>> {
    static CACHE: OnceLock<Mutex<VecDeque<(Key, Stats)>>> = OnceLock::new();
    CACHE.get_or_init(Mutex::default)
}
pub(super) fn key(connection: &Connection, predicate: &GridPredicatePlan) -> Option<Key> {
    connection
        .query_row(
            "select identity, revision from grid_page_revision where id = 1",
            [],
            |row| {
                Ok(Key {
                    identity: row.get(0)?,
                    revision: row.get(1)?,
                    predicate: format!("{predicate:?}"),
                })
            },
        )
        .ok()
}
pub(super) fn get(key: &Key) -> Option<Stats> {
    cache()
        .lock()
        .ok()?
        .iter()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| *value)
}
pub(super) fn put(key: Key, stats: Stats) {
    if let Ok(mut cache) = cache().lock() {
        cache.retain(|(old, _)| {
            old.identity != key.identity
                || (old.revision == key.revision && old.predicate != key.predicate)
        });
        cache.push_back((key, stats));
        while cache.len() > 64 {
            cache.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_predicate_write_invalidates_cached_stats() {
        let connection = Connection::open_in_memory().unwrap();
        for table in [
            "molecules",
            "descriptor_values",
            "analysis_runs",
            "analysis_values",
            "grid_index_state",
        ] {
            connection
                .execute_batch(&format!("create table {table}(value integer);"))
                .unwrap();
        }
        initialize(&connection).unwrap();
        let predicate = GridPredicatePlan {
            predicate_sql: String::new(),
            params: vec![],
            fts_query: None,
        };
        for table in [
            "molecules",
            "descriptor_values",
            "analysis_runs",
            "analysis_values",
            "grid_index_state",
        ] {
            for sql in [
                format!("insert into {table} values (1)"),
                format!("update {table} set value = 2"),
                format!("delete from {table}"),
            ] {
                put(key(&connection, &predicate).unwrap(), (7, true));
                assert_eq!(get(&key(&connection, &predicate).unwrap()), Some((7, true)));
                connection.execute(&sql, []).unwrap();
                assert_eq!(get(&key(&connection, &predicate).unwrap()), None);
            }
        }
    }
}
