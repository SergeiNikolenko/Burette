use std::{path::PathBuf, sync::Arc};

use burette_compute_protocol::{JobSnapshot, MolecularSnapshotRef};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    compute::{
        error::{ComputeCoordinatorError, ComputeResult},
        root_lease::{ComputeRootChildDirectory, ComputeRootLease},
    },
    windows::{MAIN_WINDOW_LABEL, WORKSPACE_WINDOW_PREFIX},
};

mod artifacts;
mod events;
mod jobs;
mod recovery;
mod schema;
mod snapshot_intents;
mod snapshot_reconciliation;

#[allow(
    unused_imports,
    reason = "the submit coordinator consumes the typed intent record after snapshot wiring"
)]
pub(crate) use snapshot_intents::{SnapshotIntentDraft, SnapshotIntentRecord, SnapshotIntentState};
#[allow(
    unused_imports,
    reason = "the snapshot repository consumes the reconciliation state after filesystem wiring"
)]
pub(crate) use snapshot_reconciliation::SnapshotReconciliationState;

const DESKTOP_OWNER_PRINCIPAL: &str = "desktop";

#[derive(Clone, Debug)]
pub(crate) struct ComputeStore {
    root_lease: Arc<ComputeRootLease>,
    database_path: Arc<PathBuf>,
}

impl ComputeStore {
    pub(crate) fn initialize(compute_root: PathBuf) -> ComputeResult<Self> {
        let root_lease = Arc::new(ComputeRootLease::acquire(&compute_root)?);
        Self::initialize_with_lease(root_lease)
    }

    fn initialize_with_lease(root_lease: Arc<ComputeRootLease>) -> ComputeResult<Self> {
        root_lease.verify_path_identity()?;
        let database_path = root_lease.compute_root().join("coordinator.sqlite3");
        let mut connection = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        root_lease.verify_path_identity()?;
        schema::configure(&connection)?;
        schema::initialize(&mut connection)?;
        Ok(Self {
            root_lease,
            database_path: Arc::new(database_path),
        })
    }

    fn open_connection(&self) -> ComputeResult<Connection> {
        self.root_lease.verify_path_identity()?;
        let connection = Connection::open_with_flags(
            self.database_path.as_ref(),
            OpenFlags::SQLITE_OPEN_READ_WRITE,
        )?;
        self.root_lease.verify_path_identity()?;
        schema::configure(&connection)?;
        Ok(connection)
    }

    #[cfg(test)]
    fn reopen(&self) -> ComputeResult<Self> {
        Self::initialize_with_lease(self.root_lease.clone())
    }

    #[cfg(test)]
    fn database_path(&self) -> &std::path::Path {
        self.database_path.as_path()
    }

    #[allow(
        dead_code,
        reason = "the Stage 4 artifact publisher owns descriptor-relative access below this root"
    )]
    pub(crate) fn artifact_root(&self) -> ComputeResult<PathBuf> {
        self.root_lease.verify_path_identity()?;
        Ok(self.root_lease.compute_root().join("artifacts"))
    }

    pub(crate) fn open_snapshot_directory(&self) -> ComputeResult<ComputeRootChildDirectory> {
        self.root_lease.open_or_create_snapshots_directory()
    }
}

fn decode_snapshot(encoded: &str) -> ComputeResult<JobSnapshot> {
    let snapshot: JobSnapshot = serde_json::from_str(encoded)?;
    snapshot.validate()?;
    Ok(snapshot)
}

fn decode_snapshot_with_source(
    encoded: &str,
    source_snapshot_id: Option<&str>,
    source_snapshot_json: Option<&str>,
) -> ComputeResult<JobSnapshot> {
    let snapshot = decode_snapshot(encoded)?;
    let source_snapshot_id = source_snapshot_id.ok_or_else(|| {
        ComputeCoordinatorError::Protocol(format!(
            "compute job {} is missing its normalized source snapshot row",
            snapshot.job_id
        ))
    })?;
    let source_snapshot_json = source_snapshot_json.ok_or_else(|| {
        ComputeCoordinatorError::Protocol(format!(
            "compute job {} is missing its normalized source snapshot reference",
            snapshot.job_id
        ))
    })?;
    let source: MolecularSnapshotRef = serde_json::from_str(source_snapshot_json)?;
    source.validate()?;
    if source.snapshot_id.to_string() != source_snapshot_id || source != snapshot.frozen_source {
        return Err(ComputeCoordinatorError::Protocol(format!(
            "compute job {} differs from its normalized source snapshot row",
            snapshot.job_id
        )));
    }
    Ok(snapshot)
}

fn enum_string<T: Serialize>(value: &T) -> ComputeResult<String> {
    let value = serde_json::to_value(value)?;
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| ComputeCoordinatorError::Serialization("enum was not a string".into()))
}

fn to_json<T: Serialize>(value: &T) -> ComputeResult<String> {
    serde_json::to_string(value).map_err(ComputeCoordinatorError::from)
}

pub(crate) fn validate_owner_window_label(label: &str) -> ComputeResult<()> {
    if label == MAIN_WINDOW_LABEL {
        return Ok(());
    }
    let Some(suffix) = label.strip_prefix(WORKSPACE_WINDOW_PREFIX) else {
        return Err(ComputeCoordinatorError::Forbidden(
            "compute owner must be a Burette application window".into(),
        ));
    };
    let workspace_id = Uuid::parse_str(suffix).map_err(|_| {
        ComputeCoordinatorError::Forbidden(
            "compute owner must be a Burette application window".into(),
        )
    })?;
    if workspace_id.is_nil() {
        return Err(ComputeCoordinatorError::Forbidden(
            "compute owner must be a Burette application window".into(),
        ));
    }
    Ok(())
}

fn owner_principal_for_window(label: &str) -> ComputeResult<&'static str> {
    validate_owner_window_label(label)?;
    Ok(DESKTOP_OWNER_PRINCIPAL)
}

#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod snapshot_intents_tests;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
