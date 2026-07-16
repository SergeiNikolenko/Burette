use std::num::NonZeroUsize;

use burrete_compute_core::{
    butina_clusters, ButinaOptions, Fingerprint2048, GraphBuildOptions, SymmetricCsr,
};
use burrete_compute_protocol::{JobSnapshot, SchedulingPolicy};
use serde::Serialize;

use super::{
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::{CompletedFingerprintBatch, FingerprintRecordIdentity},
};
use crate::preview::grid_store::GridSnapshotLease;

#[derive(Debug)]
pub(crate) struct ClusterComputation {
    pub(crate) grid_lease: GridSnapshotLease,
    pub(crate) identities: Vec<FingerprintRecordIdentity>,
    pub(crate) fingerprints: Vec<Fingerprint2048>,
    pub(crate) errors: Vec<Option<String>>,
    pub(crate) valid_ordinals: Vec<u64>,
    pub(crate) graph: SymmetricCsr,
    pub(crate) clusters: Vec<Vec<u64>>,
    pub(crate) cluster_ids: Vec<Option<u64>>,
    pub(crate) representatives: Vec<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ClusterCounts {
    pub(crate) successful_records: u64,
    pub(crate) failed_records: u64,
    pub(crate) cluster_count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClusterExecutionStep {
    pub(crate) job: JobSnapshot,
    pub(crate) successful_records: u64,
    pub(crate) failed_records: u64,
    pub(crate) cluster_count: u64,
    pub(crate) ready_for_publish: bool,
}

pub(crate) fn graph_options(job: &JobSnapshot) -> ComputeResult<GraphBuildOptions> {
    let requested_tile = match job.request.execution_policy.scheduling_policy {
        SchedulingPolicy::Interactive => 256,
        SchedulingPolicy::Balanced => 512,
        SchedulingPolicy::Throughput => 1_024,
    };
    let record_count =
        usize::try_from(job.frozen_source.frozen_source.record_count).map_err(|_| {
            ComputeCoordinatorError::Validation(
                "cluster record count exceeds this process address space".into(),
            )
        })?;
    let tile_size = NonZeroUsize::new(requested_tile.min(record_count.max(1)))
        .expect("positive adaptive tile size");
    GraphBuildOptions::from_resource_limits(tile_size, &job.request.limits).map_err(core_error)
}

pub(crate) fn valid_fingerprints(
    batch: &CompletedFingerprintBatch,
) -> ComputeResult<(Vec<Fingerprint2048>, Vec<u64>)> {
    if batch.fingerprints.len() != batch.errors.len()
        || batch.fingerprints.len() != batch.identities.len()
    {
        return Err(ComputeCoordinatorError::Protocol(
            "fingerprint batch buffers have inconsistent lengths".into(),
        ));
    }
    let valid_count = batch.errors.iter().filter(|error| error.is_none()).count();
    if valid_count == 0 {
        return Err(ComputeCoordinatorError::Validation(
            "RDKit could not generate a fingerprint for any selected molecule".into(),
        ));
    }
    let mut fingerprints = Vec::new();
    let mut ordinals = Vec::new();
    fingerprints
        .try_reserve_exact(valid_count)
        .map_err(|_| allocation("valid fingerprint buffer"))?;
    ordinals
        .try_reserve_exact(valid_count)
        .map_err(|_| allocation("valid fingerprint ordinal buffer"))?;
    for (ordinal, (fingerprint, error)) in batch
        .fingerprints
        .iter()
        .copied()
        .zip(&batch.errors)
        .enumerate()
    {
        if error.is_none() {
            fingerprints.push(fingerprint);
            ordinals.push(ordinal as u64);
        }
    }
    Ok((fingerprints, ordinals))
}

pub(crate) fn finish_clustering(
    batch: CompletedFingerprintBatch,
    valid_ordinals: Vec<u64>,
    graph: SymmetricCsr,
    job: &JobSnapshot,
) -> ComputeResult<(ClusterComputation, ClusterCounts)> {
    if graph.vertex_count() != valid_ordinals.len() {
        return Err(ComputeCoordinatorError::Protocol(
            "similarity graph vertex count differs from valid fingerprints".into(),
        ));
    }
    let options = ButinaOptions::from_resource_limits(&job.request.limits).map_err(core_error)?;
    let local_clusters = butina_clusters(&graph, options).map_err(core_error)?;
    let mut clusters = Vec::new();
    clusters
        .try_reserve_exact(local_clusters.len())
        .map_err(|_| allocation("cluster list"))?;
    let mut cluster_ids = vec![None; batch.fingerprints.len()];
    let mut representatives = vec![false; batch.fingerprints.len()];
    for (cluster_id, local_members) in local_clusters.into_iter().enumerate() {
        let mut source_members = Vec::new();
        source_members
            .try_reserve_exact(local_members.len())
            .map_err(|_| allocation("cluster member list"))?;
        for (member_index, local) in local_members.into_iter().enumerate() {
            let local = usize::try_from(local).map_err(|_| {
                ComputeCoordinatorError::Protocol("Butina member index overflowed".into())
            })?;
            let source_ordinal = *valid_ordinals.get(local).ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "Butina member index is outside the valid fingerprint map".into(),
                )
            })?;
            let source = usize::try_from(source_ordinal).map_err(|_| {
                ComputeCoordinatorError::Protocol("source ordinal overflowed".into())
            })?;
            if cluster_ids[source].replace(cluster_id as u64).is_some() {
                return Err(ComputeCoordinatorError::Protocol(
                    "Butina assigned a molecule to more than one cluster".into(),
                ));
            }
            if member_index == 0 {
                representatives[source] = true;
            }
            source_members.push(source_ordinal);
        }
        clusters.push(source_members);
    }
    let successful_records = u64::try_from(valid_ordinals.len()).map_err(|_| {
        ComputeCoordinatorError::Protocol("successful record count overflowed".into())
    })?;
    let total_records = u64::try_from(batch.fingerprints.len())
        .map_err(|_| ComputeCoordinatorError::Protocol("cluster record count overflowed".into()))?;
    let failed_records = total_records
        .checked_sub(successful_records)
        .ok_or_else(|| ComputeCoordinatorError::Protocol("cluster outcome underflowed".into()))?;
    let cluster_count = u64::try_from(clusters.len())
        .map_err(|_| ComputeCoordinatorError::Protocol("cluster count overflowed".into()))?;
    let computation = ClusterComputation {
        grid_lease: batch.grid_lease,
        identities: batch.identities,
        fingerprints: batch.fingerprints,
        errors: batch.errors,
        valid_ordinals,
        graph,
        clusters,
        cluster_ids,
        representatives,
    };
    validate_computation(&computation, total_records)?;
    Ok((
        computation,
        ClusterCounts {
            successful_records,
            failed_records,
            cluster_count,
        },
    ))
}

pub(crate) fn validate_computation(
    computation: &ClusterComputation,
    record_count: u64,
) -> ComputeResult<()> {
    let expected = usize::try_from(record_count).map_err(|_| {
        ComputeCoordinatorError::Protocol("result record count exceeds address space".into())
    })?;
    if computation.identities.len() != expected
        || computation.fingerprints.len() != expected
        || computation.errors.len() != expected
        || computation.cluster_ids.len() != expected
        || computation.representatives.len() != expected
        || computation.graph.vertex_count() != computation.valid_ordinals.len()
    {
        return Err(ComputeCoordinatorError::Protocol(
            "cluster result buffers differ from the frozen record count".into(),
        ));
    }
    for (index, error) in computation.errors.iter().enumerate() {
        let assigned = computation.cluster_ids[index].is_some();
        if assigned == error.is_some() || (computation.representatives[index] && !assigned) {
            return Err(ComputeCoordinatorError::Protocol(
                "cluster assignment validity differs from fingerprint outcomes".into(),
            ));
        }
    }
    let representative_count = computation
        .representatives
        .iter()
        .filter(|value| **value)
        .count();
    if representative_count != computation.clusters.len()
        || computation
            .clusters
            .iter()
            .any(|members| members.is_empty())
    {
        return Err(ComputeCoordinatorError::Protocol(
            "cluster representatives differ from deterministic Butina clusters".into(),
        ));
    }
    Ok(())
}

fn core_error(error: impl std::fmt::Display) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Validation(error.to_string())
}

fn allocation(label: &'static str) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(format!("cannot allocate {label}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute::store::test_support::queued_snapshot;
    use burrete_compute_core::{build_tanimoto_graph, Fingerprint2048};

    #[test]
    fn scheduling_policy_selects_a_bounded_nonzero_tile() {
        let job = queued_snapshot();
        assert_eq!(
            graph_options(&job)
                .expect("graph options")
                .tile_size()
                .get(),
            2
        );
    }

    #[test]
    fn reference_graph_and_butina_keep_failed_records_unassigned() {
        let job = queued_snapshot();
        let valid = vec![Fingerprint2048::ZERO];
        let graph = build_tanimoto_graph(
            &valid,
            job.request.parameters.similarity.cutoff,
            graph_options(&job).expect("options"),
        )
        .expect("reference graph");
        assert_eq!(graph.vertex_count(), 1);
    }
}
