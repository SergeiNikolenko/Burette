#[allow(
    dead_code,
    reason = "cluster.v1 admission remains unreachable until runtime manifests are verified"
)]
mod cluster_plan;
pub(crate) mod commands;
pub(crate) mod coordinator;
pub(crate) mod error;
#[allow(
    dead_code,
    reason = "queued job creation remains unreachable until snapshot publication is crash-safe"
)]
mod job_factory;
#[allow(
    dead_code,
    reason = "the coordinator will acquire compute-root ownership before runtime activation"
)]
mod root_lease;
pub(crate) use root_lease::ComputeRootChildDirectory;
pub(crate) mod store;
