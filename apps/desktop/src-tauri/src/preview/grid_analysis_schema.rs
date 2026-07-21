use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};

const ANALYSIS_SCHEMA_VERSION: i64 = 1;

pub(super) fn initialize(connection: &Connection) -> Result<(), String> {
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "create table if not exists grid_analysis_schema (
               id integer primary key not null check (id = 1),
               schema_version integer not null check (schema_version > 0)
             ) strict;",
        )
        .map_err(|error| error.to_string())?;
    let installed_version = transaction
        .query_row(
            "select schema_version from grid_analysis_schema where id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    match installed_version {
        Some(ANALYSIS_SCHEMA_VERSION) => install_version_one(&transaction)?,
        Some(version) => {
            return Err(format!(
                "Unsupported Grid analysis schema version: {version}"
            ));
        }
        None => {
            if has_unversioned_analysis_tables(&transaction)? {
                return Err(
                    "Unversioned Grid analysis tables cannot be migrated safely; rebuild the transient Grid runtime"
                        .into(),
                );
            }
            install_version_one(&transaction)?;
            transaction
                .execute(
                    "insert into grid_analysis_schema(id, schema_version) values (1, ?1)",
                    [ANALYSIS_SCHEMA_VERSION],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn has_unversioned_analysis_tables(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "select exists (
               select 1 from sqlite_schema
               where type = 'table'
                 and name in ('analysis_runs', 'analysis_values', 'analysis_artifacts')
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn install_version_one(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "create table if not exists analysis_runs (
               run_id text primary key not null check (length(run_id) = 36),
               schema_version integer not null check (schema_version = 1),
               workflow_template text not null check (length(workflow_template) between 1 and 160),
               document_fingerprint_sha256 text not null
                 check (length(document_fingerprint_sha256) = 64
                   and document_fingerprint_sha256 = lower(document_fingerprint_sha256)
                   and document_fingerprint_sha256 not glob '*[^0-9a-f]*'),
               source_revision integer not null
                 check (source_revision > 0 and source_revision <= 9007199254740991),
               snapshot_id text not null check (length(snapshot_id) = 36),
               snapshot_sha256 text not null
                 check (length(snapshot_sha256) = 64
                   and snapshot_sha256 = lower(snapshot_sha256)
                   and snapshot_sha256 not glob '*[^0-9a-f]*'),
               normalized_settings_sha256 text not null
                 check (length(normalized_settings_sha256) = 64
                   and normalized_settings_sha256 = lower(normalized_settings_sha256)
                   and normalized_settings_sha256 not glob '*[^0-9a-f]*'),
               maturity text not null check (maturity in (
                 'experimental', 'numerically_validated', 'chemically_validated',
                 'production', 'unsupported'
               )),
               representative_policy text not null
                 check (length(representative_policy) between 1 and 160),
               provenance_json text not null
                 check (json_valid(provenance_json)
                   and json_type(provenance_json) = 'object'
                   and length(cast(provenance_json as blob)) <= 65536),
               created_at_ms integer not null
                 check (created_at_ms > 0 and created_at_ms <= 9007199254740991),
               unique(workflow_template, snapshot_id, snapshot_sha256, normalized_settings_sha256)
             ) strict;
             create table if not exists analysis_values (
               run_id text not null references analysis_runs(run_id) on delete restrict,
               molecule_id integer not null references molecules(id) on delete restrict
                 check (molecule_id > 0),
               source_index integer not null
                 check (source_index >= 0 and source_index <= 9007199254740991),
               molecule_content_sha256 text not null
                 check (length(molecule_content_sha256) = 64
                   and molecule_content_sha256 = lower(molecule_content_sha256)
                   and molecule_content_sha256 not glob '*[^0-9a-f]*'),
               value_id text not null check (length(value_id) between 1 and 160),
               value_kind text not null
                 check (value_kind in ('integer', 'real', 'boolean', 'text')),
               value_integer integer,
               value_real real,
               value_text text,
               primary key (run_id, molecule_id, value_id),
               check (
                 (value_kind = 'integer' and value_integer is not null
                   and abs(value_integer) <= 9007199254740991
                   and value_real is null and value_text is null)
                 or (value_kind = 'real' and value_integer is null
                   and value_real is not null and abs(value_real) <= 1.7976931348623157e308
                   and value_text is null)
                 or (value_kind = 'boolean' and value_integer in (0, 1)
                   and value_real is null and value_text is null)
                 or (value_kind = 'text' and value_integer is null
                   and value_real is null and value_text is not null
                   and length(cast(value_text as blob)) <= 4096)
               )
             ) strict;
             create table if not exists analysis_artifacts (
               run_id text not null references analysis_runs(run_id) on delete restrict,
               artifact_id text not null check (length(artifact_id) = 36),
               role text not null check (length(role) between 1 and 160),
               manifest_sha256 text not null
                 check (length(manifest_sha256) = 64
                   and manifest_sha256 = lower(manifest_sha256)
                   and manifest_sha256 not glob '*[^0-9a-f]*'),
               primary key (run_id, artifact_id, role)
             ) strict;
             create index if not exists analysis_values_numeric
               on analysis_values(run_id, value_id, value_real, value_integer, molecule_id);
             create index if not exists analysis_values_molecule
               on analysis_values(molecule_id, run_id, value_id);

             create trigger if not exists analysis_runs_source_identity_insert
               before insert on analysis_runs
               when not exists (
                 select 1 from grid_metadata
                 where id = 1
                   and document_fingerprint_sha256 = new.document_fingerprint_sha256
                   and source_revision = new.source_revision
                   and virtual_edit_generation = 0
               )
               begin
                 select raise(abort, 'analysis run source identity mismatch');
               end;
             create trigger if not exists analysis_values_current_run_insert
               before insert on analysis_values
               when not exists (
                 select 1 from analysis_runs join grid_metadata on grid_metadata.id = 1
                 where analysis_runs.run_id = new.run_id
                   and analysis_runs.document_fingerprint_sha256 = grid_metadata.document_fingerprint_sha256
                   and analysis_runs.source_revision = grid_metadata.source_revision
                   and grid_metadata.virtual_edit_generation = 0
               )
               begin
                 select raise(abort, 'analysis value run is stale or missing');
               end;
             create trigger if not exists analysis_values_source_identity_insert
               before insert on analysis_values
               when not exists (
                 select 1 from molecules
                 where id = new.molecule_id
                   and source_index = new.source_index
                   and molecule_content_sha256 = new.molecule_content_sha256
               )
               begin
                 select raise(abort, 'analysis value source identity mismatch');
               end;
             create trigger if not exists analysis_artifacts_current_run_insert
               before insert on analysis_artifacts
               when not exists (
                 select 1 from analysis_runs join grid_metadata on grid_metadata.id = 1
                 where analysis_runs.run_id = new.run_id
                   and analysis_runs.document_fingerprint_sha256 = grid_metadata.document_fingerprint_sha256
                   and analysis_runs.source_revision = grid_metadata.source_revision
                   and grid_metadata.virtual_edit_generation = 0
               )
               begin
                 select raise(abort, 'analysis artifact run is stale or missing');
               end;

             create trigger if not exists analysis_runs_insert_once
               before insert on analysis_runs
               when exists (
                 select 1 from analysis_runs
                 where run_id = new.run_id
                    or (workflow_template = new.workflow_template
                      and snapshot_id = new.snapshot_id
                      and snapshot_sha256 = new.snapshot_sha256
                      and normalized_settings_sha256 = new.normalized_settings_sha256)
               )
               begin
                 select raise(abort, 'analysis runs are insert-only');
               end;
             create trigger if not exists analysis_values_insert_once
               before insert on analysis_values
               when exists (
                 select 1 from analysis_values
                 where run_id = new.run_id and molecule_id = new.molecule_id
                   and value_id = new.value_id
               )
               begin
                 select raise(abort, 'analysis values are insert-only');
               end;
             create trigger if not exists analysis_artifacts_insert_once
               before insert on analysis_artifacts
               when exists (
                 select 1 from analysis_artifacts
                 where run_id = new.run_id and artifact_id = new.artifact_id and role = new.role
               )
               begin
                 select raise(abort, 'analysis artifacts are insert-only');
               end;

             create trigger if not exists analysis_runs_immutable_update
               before update on analysis_runs begin
                 select raise(abort, 'analysis runs are insert-only');
               end;
             create trigger if not exists analysis_runs_immutable_delete
               before delete on analysis_runs begin
                 select raise(abort, 'analysis runs are insert-only');
               end;
             create trigger if not exists analysis_values_immutable_update
               before update on analysis_values begin
                 select raise(abort, 'analysis values are insert-only');
               end;
             create trigger if not exists analysis_values_immutable_delete
               before delete on analysis_values begin
                 select raise(abort, 'analysis values are insert-only');
               end;
             create trigger if not exists analysis_artifacts_immutable_update
               before update on analysis_artifacts begin
                 select raise(abort, 'analysis artifacts are insert-only');
               end;
             create trigger if not exists analysis_artifacts_immutable_delete
               before delete on analysis_artifacts begin
                 select raise(abort, 'analysis artifacts are insert-only');
               end;",
        )
        .map_err(|error| error.to_string())
}
