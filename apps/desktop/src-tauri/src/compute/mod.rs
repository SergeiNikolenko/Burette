mod artifact_publisher;
mod artifact_reader;
mod cluster_executor;
mod cluster_plan;
pub(crate) mod commands;
mod conformer_executor;
mod conformer_ipc;
mod conformer_plan;
mod conformer_reference_validator;
mod conformer_session;
mod conformer_stereo_executor;
pub(crate) mod coordinator;
mod engine_catalog;
pub(crate) mod error;
mod fingerprint_session;
mod job_factory;
mod job_lifecycle;
mod representative_export;
#[allow(
    dead_code,
    reason = "the coordinator will acquire compute-root ownership before runtime activation"
)]
mod root_lease;
mod similarity_artifact;
pub(crate) use root_lease::ComputeRootChildDirectory;
mod similarity_search;
mod snapshot_repository;
pub(crate) mod store;
