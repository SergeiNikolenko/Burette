use std::{path::PathBuf, sync::Arc};

use burrete_compute_protocol::JobSnapshot;
use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;

use crate::{
    compute::error::{ComputeCoordinatorError, ComputeResult},
    windows::{MAIN_WINDOW_LABEL, WORKSPACE_WINDOW_PREFIX},
};

mod artifacts;
mod events;
mod jobs;
mod recovery;
mod schema;

const DESKTOP_OWNER_PRINCIPAL: &str = "desktop";

#[derive(Clone, Debug)]
pub(crate) struct ComputeStore {
    compute_root: Arc<PathBuf>,
    database_path: Arc<PathBuf>,
}

impl ComputeStore {
    pub(crate) fn initialize(compute_root: PathBuf) -> ComputeResult<Self> {
        std::fs::create_dir_all(&compute_root)?;
        let database_path = compute_root.join("coordinator.sqlite3");
        let mut connection = Connection::open(&database_path)?;
        schema::configure(&connection)?;
        schema::initialize(&mut connection)?;
        Ok(Self {
            compute_root: Arc::new(compute_root),
            database_path: Arc::new(database_path),
        })
    }

    fn open_connection(&self) -> ComputeResult<Connection> {
        let connection = Connection::open(self.database_path.as_ref())?;
        schema::configure(&connection)?;
        Ok(connection)
    }

    #[cfg(test)]
    fn database_path(&self) -> &std::path::Path {
        self.database_path.as_path()
    }

    #[allow(
        dead_code,
        reason = "the Stage 4 artifact publisher owns descriptor-relative access below this root"
    )]
    pub(crate) fn artifact_root(&self) -> PathBuf {
        self.compute_root.join("artifacts")
    }
}

fn decode_snapshot(encoded: &str) -> ComputeResult<JobSnapshot> {
    let snapshot: JobSnapshot = serde_json::from_str(encoded)?;
    snapshot.validate()?;
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
            "compute owner must be a Burrete application window".into(),
        ));
    };
    let workspace_id = Uuid::parse_str(suffix).map_err(|_| {
        ComputeCoordinatorError::Forbidden(
            "compute owner must be a Burrete application window".into(),
        )
    })?;
    if workspace_id.is_nil() {
        return Err(ComputeCoordinatorError::Forbidden(
            "compute owner must be a Burrete application window".into(),
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
mod test_support;
#[cfg(test)]
mod tests;
