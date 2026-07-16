mod cluster_plan;
pub(crate) mod commands;
pub(crate) mod coordinator;
mod engine_catalog;
pub(crate) mod error;
mod job_factory;
#[allow(
    dead_code,
    reason = "the coordinator will acquire compute-root ownership before runtime activation"
)]
mod root_lease;
pub(crate) use root_lease::ComputeRootChildDirectory;
mod snapshot_repository;
pub(crate) mod store;
