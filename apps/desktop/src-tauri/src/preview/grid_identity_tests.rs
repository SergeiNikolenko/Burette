use rusqlite::Connection;

use super::*;

#[test]
fn source_revision_fingerprint_and_virtual_edit_generation_are_durable() {
    let connection = Connection::open_in_memory().expect("open grid database");
    connection
        .execute_batch(
            "create table molecules (
               id integer primary key,
               source_index integer not null,
               name text not null,
               smiles text,
               molblock text,
               idcode text,
               idcoordinates text,
               props_json text not null
             );
             insert into molecules(
               source_index, name, smiles, props_json
             ) values (0, 'Water', 'O', '{}');",
        )
        .expect("create grid fixture");
    initialize(&connection).expect("initialize identity schema");
    let first = finalize_source_revision(&connection).expect("finalize first revision");
    assert_eq!(first.source_revision, 1);
    assert_eq!(first.virtual_edit_generation, 0);
    assert!(is_lower_sha256(&first.document_fingerprint_sha256));

    connection
        .execute(
            "update molecules set smiles = '[OH-]' where source_index = 0",
            [],
        )
        .expect("change source chemistry");
    let second = finalize_source_revision(&connection).expect("finalize second revision");
    assert_eq!(second.source_revision, 2);
    assert_ne!(
        first.document_fingerprint_sha256,
        second.document_fingerprint_sha256
    );

    let root = std::env::temp_dir().join(format!("burette-grid-identity-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create temp root");
    let database_path = root.join("collection.sqlite");
    let disk = Connection::open(&database_path).expect("open disk database");
    disk.execute_batch(
        "create table molecules (
           id integer primary key,
           source_index integer not null,
           name text not null,
           smiles text,
           molblock text,
           idcode text,
           idcoordinates text,
           props_json text not null
         );",
    )
    .expect("create disk fixture");
    initialize(&disk).expect("initialize disk identity");
    drop(disk);
    assert_eq!(mark_virtual_edit(&database_path).expect("mark edit"), 1);
    let reopened = Connection::open(&database_path).expect("reopen disk database");
    let generation: i64 = reopened
        .query_row(
            "select virtual_edit_generation from grid_metadata where id = 1",
            [],
            |row| row.get(0),
        )
        .expect("read edit generation");
    assert_eq!(generation, 1);
    drop(reopened);
    let _ = std::fs::remove_dir_all(root);
}
