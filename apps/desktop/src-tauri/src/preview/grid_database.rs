use std::{path::Path, time::Duration};

use rusqlite::Connection;

const GRID_DATABASE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) fn open_grid_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    configure_grid_database(&connection)?;
    Ok(connection)
}

pub(crate) fn configure_grid_database(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(GRID_DATABASE_BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| error.to_string())?;
    let foreign_keys = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    if foreign_keys != 1 {
        return Err("Grid database foreign keys could not be enabled".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_open_enables_foreign_keys_and_busy_timeout() {
        let path = std::env::temp_dir().join(format!(
            "burrete-grid-database-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let connection = open_grid_database(&path).expect("open configured Grid database");
        let foreign_keys: i64 = connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("read foreign key pragma");
        let busy_timeout: i64 = connection
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .expect("read busy timeout pragma");
        assert_eq!(foreign_keys, 1);
        assert_eq!(busy_timeout, 5_000);
        drop(connection);
        std::fs::remove_file(path).expect("remove Grid database fixture");
    }
}
