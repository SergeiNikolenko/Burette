use std::{fs, path::PathBuf};

use burrete_compute_protocol::{CapabilityMaturity, RepresentativePolicy, WorkflowTemplateId};
use rusqlite::{params, Connection};
use serde_json::json;
use uuid::Uuid;

use super::{
    apply_analysis_run, initialize, GridAnalysisApplyInput, GridAnalysisArtifactInput,
    GridAnalysisValue, GridAnalysisValueInput,
};
use crate::preview::{
    grid_database::open_grid_database,
    grid_identity::{self, GridSourceIdentity},
    grid_store::build_grid_store,
};

const RUN_ONE: &str = "018f48f2-2e20-7e53-976b-cf93e0897701";
const RUN_TWO: &str = "018f48f2-2e20-7e53-976b-cf93e0897702";
const SNAPSHOT_ID: &str = "018f48f2-2e20-7e53-976b-cf93e0897799";

fn hash(character: char) -> String {
    character.to_string().repeat(64)
}

struct ProductionFixture {
    runtime_dir: PathBuf,
    database_path: PathBuf,
    identity: GridSourceIdentity,
    molecules: Vec<(i64, u64, String)>,
}

impl ProductionFixture {
    fn create() -> Self {
        let runtime_dir =
            std::env::temp_dir().join(format!("burrete-grid-analysis-{}", Uuid::new_v4()));
        fs::create_dir_all(&runtime_dir).expect("create analysis runtime directory");
        let handle = build_grid_store(&runtime_dir, "smi", b"CC Ethane\nO Water\n")
            .expect("build production Grid store")
            .expect("Grid collection");
        let connection = open_grid_database(&handle.database_path).expect("open Grid database");
        let identity = grid_identity::read_source_identity(&connection)
            .expect("read production source identity");
        let molecules = {
            let mut statement = connection
                .prepare(
                    "select id, source_index, molecule_content_sha256
                     from molecules order by source_index",
                )
                .expect("prepare molecule identities");
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .expect("query molecule identities")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect molecule identities")
        };
        Self {
            runtime_dir,
            database_path: handle.database_path,
            identity,
            molecules,
        }
    }

    fn input(&self) -> GridAnalysisApplyInput {
        let molecule = &self.molecules[0];
        GridAnalysisApplyInput {
            run_id: Uuid::new_v4(),
            workflow_template: WorkflowTemplateId::ClusterV1,
            document_fingerprint_sha256: self.identity.document_fingerprint_sha256.clone(),
            source_revision: self.identity.source_revision,
            snapshot_id: Uuid::new_v4(),
            snapshot_sha256: hash('b'),
            normalized_settings_sha256: hash('c'),
            maturity: CapabilityMaturity::Experimental,
            representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
            provenance: json!({ "engine": "test" }),
            created_at_ms: 1,
            values: vec![GridAnalysisValueInput {
                molecule_id: molecule.0,
                source_index: molecule.1,
                molecule_content_sha256: molecule.2.clone(),
                value_id: "cluster_id".into(),
                value: GridAnalysisValue::Integer(7),
            }],
            artifacts: vec![GridAnalysisArtifactInput {
                artifact_id: Uuid::new_v4(),
                role: "result_manifest".into(),
                manifest_sha256: hash('d'),
            }],
        }
    }

    fn assert_analysis_empty(&self) {
        let connection = open_grid_database(&self.database_path).expect("reopen Grid database");
        for table in ["analysis_runs", "analysis_values", "analysis_artifacts"] {
            let count: i64 = connection
                .query_row(&format!("select count(*) from {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count analysis rows");
            assert_eq!(count, 0, "{table} must remain empty");
        }
    }
}

impl Drop for ProductionFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.runtime_dir);
    }
}

fn fixture_connection() -> Connection {
    let connection = Connection::open_in_memory().expect("open database");
    connection
        .execute_batch(
            "pragma foreign_keys = on;
             create table molecules (
               id integer primary key,
               source_index integer not null,
               molecule_content_sha256 text not null
             );
             create table grid_metadata (
               id integer primary key,
               document_fingerprint_sha256 text not null,
               source_revision integer not null,
               virtual_edit_generation integer not null
             );
             insert into molecules(id, source_index, molecule_content_sha256)
             values (1, 0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
             insert into grid_metadata(
               id, document_fingerprint_sha256, source_revision, virtual_edit_generation
             ) values (
               1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 0
             );",
        )
        .expect("create molecule fixture");
    initialize(&connection).expect("initialize analysis schema");
    connection
}

fn insert_run(
    connection: &Connection,
    run_id: &str,
    workflow: &str,
    snapshot_id: &str,
) -> rusqlite::Result<usize> {
    connection.execute(
        "insert into analysis_runs(
           run_id, schema_version, workflow_template,
           document_fingerprint_sha256, source_revision,
           snapshot_id, snapshot_sha256, normalized_settings_sha256,
           maturity, representative_policy, provenance_json, created_at_ms
         ) values (?1, 1, ?2, ?3, 1, ?4, ?5, ?6,
           'experimental', 'butinaMaxNeighbors.v1', '{}', 1)",
        params![
            run_id,
            workflow,
            hash('a'),
            snapshot_id,
            hash('b'),
            hash('c')
        ],
    )
}

fn insert_integer_value(connection: &Connection, run_id: &str) -> rusqlite::Result<usize> {
    connection.execute(
        "insert into analysis_values(
           run_id, molecule_id, source_index, molecule_content_sha256,
           value_id, value_kind, value_integer
         ) values (?1, 1, 0, ?2, 'cluster_id', 'integer', 7)",
        params![run_id, hash('a')],
    )
}

#[test]
fn analysis_rows_are_run_namespaced_and_typed() {
    let connection = fixture_connection();
    for run_id in [RUN_ONE, RUN_TWO] {
        insert_run(&connection, run_id, "cluster.v1", run_id).expect("insert analysis run");
        insert_integer_value(&connection, run_id).expect("insert namespaced analysis value");
    }
    let count: i64 = connection
        .query_row("select count(*) from analysis_values", [], |row| row.get(0))
        .expect("count analysis values");
    assert_eq!(count, 2);

    assert!(connection
        .execute(
            "insert into analysis_values(
               run_id, molecule_id, source_index, molecule_content_sha256,
               value_id, value_kind, value_real
             ) values (?1, 1, 0, ?2, 'broken', 'integer', 1.0)",
            params![RUN_ONE, hash('a')],
        )
        .is_err());
    assert!(connection
        .execute(
            "insert into analysis_values(
               run_id, molecule_id, source_index, molecule_content_sha256,
               value_id, value_kind, value_integer
             ) values (?1, 1, 99, ?2, 'wrong_source', 'integer', 1)",
            params![RUN_ONE, hash('a')],
        )
        .is_err());
}

#[test]
fn stale_runs_cannot_receive_values_or_artifacts() {
    for mutation in [
        "update grid_metadata set source_revision = 2 where id = 1",
        "update grid_metadata set document_fingerprint_sha256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' where id = 1",
        "update grid_metadata set virtual_edit_generation = 1 where id = 1",
    ] {
        let connection = fixture_connection();
        insert_run(&connection, RUN_ONE, "cluster.v1", RUN_ONE).expect("insert analysis run");
        connection
            .execute(mutation, [])
            .expect("invalidate Grid source identity");

        assert!(insert_integer_value(&connection, RUN_ONE).is_err());
        assert!(connection
            .execute(
                "insert into analysis_artifacts(run_id, artifact_id, role, manifest_sha256)
                 values (?1, ?2, 'result', ?3)",
                params![RUN_ONE, RUN_TWO, hash('d')],
            )
            .is_err());
    }
}

#[test]
fn analysis_rows_reject_update_delete_and_replace() {
    let connection = fixture_connection();
    insert_run(&connection, RUN_ONE, "cluster.v1", RUN_ONE).expect("insert analysis run");
    insert_integer_value(&connection, RUN_ONE).expect("insert analysis value");
    connection
        .execute(
            "insert into analysis_artifacts(run_id, artifact_id, role, manifest_sha256)
             values (?1, ?2, 'result', ?3)",
            params![RUN_ONE, RUN_TWO, hash('d')],
        )
        .expect("insert analysis artifact");

    assert!(connection
        .execute(
            "update analysis_runs set created_at_ms = 2 where run_id = ?1",
            [RUN_ONE],
        )
        .is_err());
    assert!(connection
        .execute(
            "update analysis_values set value_integer = 8 where run_id = ?1",
            [RUN_ONE],
        )
        .is_err());
    assert!(connection
        .execute(
            "update analysis_artifacts set role = 'changed' where run_id = ?1",
            [RUN_ONE],
        )
        .is_err());

    assert!(connection
        .execute("delete from analysis_runs where run_id = ?1", [RUN_ONE])
        .is_err());
    assert!(connection
        .execute("delete from analysis_values where run_id = ?1", [RUN_ONE])
        .is_err());
    assert!(connection
        .execute(
            "delete from analysis_artifacts where run_id = ?1",
            [RUN_ONE],
        )
        .is_err());

    assert!(connection
        .execute(
            "insert or replace into analysis_runs(
               run_id, schema_version, workflow_template,
               document_fingerprint_sha256, source_revision,
               snapshot_id, snapshot_sha256, normalized_settings_sha256,
               maturity, representative_policy, provenance_json, created_at_ms
             ) values (?1, 1, 'cluster.v1', ?2, 1, ?1, ?3, ?4,
               'experimental', 'butinaMaxNeighbors.v1', '{}', 2)",
            params![RUN_ONE, hash('a'), hash('b'), hash('c')],
        )
        .is_err());
    assert!(connection
        .execute(
            "insert or replace into analysis_values(
               run_id, molecule_id, source_index, molecule_content_sha256,
               value_id, value_kind, value_integer
             ) values (?1, 1, 0, ?2, 'cluster_id', 'integer', 9)",
            params![RUN_ONE, hash('a')],
        )
        .is_err());
    assert!(connection
        .execute(
            "insert or replace into analysis_artifacts(
               run_id, artifact_id, role, manifest_sha256
             ) values (?1, ?2, 'result', ?3)",
            params![RUN_ONE, RUN_TWO, hash('e')],
        )
        .is_err());
}

#[test]
fn idempotency_namespace_includes_workflow() {
    let connection = fixture_connection();
    insert_run(&connection, RUN_ONE, "cluster.v1", SNAPSHOT_ID).expect("insert cluster run");
    insert_run(&connection, RUN_TWO, "shape.v1", SNAPSHOT_ID)
        .expect("insert independent workflow run");
}

#[test]
fn production_open_enables_integrity_pragmas_and_analysis_schema() {
    let fixture = ProductionFixture::create();
    let connection = open_grid_database(&fixture.database_path).expect("open production Grid");
    initialize(&connection).expect("repeat versioned schema initialization");

    let foreign_keys: i64 = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .expect("read foreign key pragma");
    let busy_timeout: i64 = connection
        .pragma_query_value(None, "busy_timeout", |row| row.get(0))
        .expect("read busy timeout pragma");
    let schema_version: i64 = connection
        .query_row(
            "select schema_version from grid_analysis_schema where id = 1",
            [],
            |row| row.get(0),
        )
        .expect("read analysis schema version");
    assert_eq!(foreign_keys, 1);
    assert_eq!(busy_timeout, 5_000);
    assert_eq!(schema_version, 1);

    let molecule = &fixture.molecules[0];
    assert!(connection
        .execute(
            "insert into analysis_values(
               run_id, molecule_id, source_index, molecule_content_sha256,
               value_id, value_kind, value_integer
             ) values (?1, ?2, ?3, ?4, 'orphan', 'integer', 1)",
            params![
                Uuid::new_v4().to_string(),
                molecule.0,
                molecule.1,
                molecule.2
            ],
        )
        .is_err());
    assert!(connection
        .execute(
            "insert into analysis_artifacts(run_id, artifact_id, role, manifest_sha256)
             values (?1, ?2, 'orphan', ?3)",
            params![
                Uuid::new_v4().to_string(),
                Uuid::new_v4().to_string(),
                hash('e')
            ],
        )
        .is_err());
}

#[test]
fn atomic_apply_persists_typed_values_and_artifacts() {
    let fixture = ProductionFixture::create();
    let molecule = &fixture.molecules[0];
    let mut input = fixture.input();
    input.values = vec![
        GridAnalysisValueInput {
            molecule_id: molecule.0,
            source_index: molecule.1,
            molecule_content_sha256: molecule.2.clone(),
            value_id: "cluster_id".into(),
            value: GridAnalysisValue::Integer(7),
        },
        GridAnalysisValueInput {
            molecule_id: molecule.0,
            source_index: molecule.1,
            molecule_content_sha256: molecule.2.clone(),
            value_id: "score".into(),
            value: GridAnalysisValue::Real(0.75),
        },
        GridAnalysisValueInput {
            molecule_id: molecule.0,
            source_index: molecule.1,
            molecule_content_sha256: molecule.2.clone(),
            value_id: "is_representative".into(),
            value: GridAnalysisValue::Boolean(true),
        },
        GridAnalysisValueInput {
            molecule_id: molecule.0,
            source_index: molecule.1,
            molecule_content_sha256: molecule.2.clone(),
            value_id: "label".into(),
            value: GridAnalysisValue::Text("primary".into()),
        },
    ];

    apply_analysis_run(&fixture.database_path, &input).expect("apply analysis run atomically");

    let connection = open_grid_database(&fixture.database_path).expect("open applied Grid");
    let value_count: i64 = connection
        .query_row(
            "select count(*) from analysis_values where run_id = ?1",
            [input.run_id.to_string()],
            |row| row.get(0),
        )
        .expect("count typed values");
    let artifact_count: i64 = connection
        .query_row(
            "select count(*) from analysis_artifacts where run_id = ?1",
            [input.run_id.to_string()],
            |row| row.get(0),
        )
        .expect("count artifacts");
    assert_eq!(value_count, 4);
    assert_eq!(artifact_count, 1);

    let integer: (String, i64) = connection
        .query_row(
            "select value_kind, value_integer from analysis_values
             where run_id = ?1 and value_id = 'cluster_id'",
            [input.run_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read integer value");
    let real: (String, f64) = connection
        .query_row(
            "select value_kind, value_real from analysis_values
             where run_id = ?1 and value_id = 'score'",
            [input.run_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read real value");
    let boolean: (String, i64) = connection
        .query_row(
            "select value_kind, value_integer from analysis_values
             where run_id = ?1 and value_id = 'is_representative'",
            [input.run_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read boolean value");
    let text: (String, String) = connection
        .query_row(
            "select value_kind, value_text from analysis_values
             where run_id = ?1 and value_id = 'label'",
            [input.run_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read text value");
    assert_eq!(integer, ("integer".into(), 7));
    assert_eq!(real, ("real".into(), 0.75));
    assert_eq!(boolean, ("boolean".into(), 1));
    assert_eq!(text, ("text".into(), "primary".into()));
}

#[test]
fn atomic_apply_rejects_every_stale_source_identity_dimension() {
    for mutation in [
        "update grid_metadata set source_revision = source_revision + 1 where id = 1",
        "update grid_metadata set document_fingerprint_sha256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' where id = 1",
        "update grid_metadata set virtual_edit_generation = 1 where id = 1",
    ] {
        let fixture = ProductionFixture::create();
        let input = fixture.input();
        let connection =
            open_grid_database(&fixture.database_path).expect("open Grid before conflict");
        connection
            .execute(mutation, [])
            .expect("invalidate source identity");
        drop(connection);

        assert!(apply_analysis_run(&fixture.database_path, &input).is_err());
        fixture.assert_analysis_empty();
    }
}

#[test]
fn atomic_apply_rolls_back_when_one_value_has_bad_record_identity() {
    let fixture = ProductionFixture::create();
    let mut input = fixture.input();
    let first = input.values[0].clone();
    input.values.push(GridAnalysisValueInput {
        molecule_id: first.molecule_id,
        source_index: first.source_index + 1,
        molecule_content_sha256: first.molecule_content_sha256,
        value_id: "is_representative".into(),
        value: GridAnalysisValue::Boolean(true),
    });

    assert!(apply_analysis_run(&fixture.database_path, &input).is_err());
    fixture.assert_analysis_empty();
}

#[test]
fn atomic_apply_rejects_unbounded_input_before_writing() {
    let fixture = ProductionFixture::create();
    let mut input = fixture.input();
    input.values[0].value = GridAnalysisValue::Text("x".repeat(4_097));

    let error = apply_analysis_run(&fixture.database_path, &input)
        .expect_err("reject oversized analysis text");
    assert!(error.contains("4096"));
    fixture.assert_analysis_empty();
}

#[test]
fn unversioned_analysis_schema_is_rejected_transactionally() {
    let connection = Connection::open_in_memory().expect("open legacy database");
    connection
        .execute_batch("create table analysis_runs (run_id text primary key);")
        .expect("create unversioned analysis table");

    let error = initialize(&connection).expect_err("reject unversioned analysis tables");
    assert!(error.contains("Unversioned"));
    let version_table_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_schema
             where type = 'table' and name = 'grid_analysis_schema'",
            [],
            |row| row.get(0),
        )
        .expect("check migration rollback");
    assert_eq!(version_table_count, 0);
}
