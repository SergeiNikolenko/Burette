#[allow(
    dead_code,
    reason = "cluster.v1 admission remains unreachable until runtime manifests are verified"
)]
mod cluster_plan;
pub(crate) mod commands;
pub(crate) mod coordinator;
pub(crate) mod error;
pub(crate) mod store;
