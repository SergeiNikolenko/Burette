use burette_compute_protocol::{
    Backend, BackendPolicy, ComputeSubmitRequest, EngineIdentity, ExecutionPartition,
    ExecutionPlan, ExecutionPlanVersion, FallbackDecision, PlannedStage, Precision, StageKind,
    WorkflowTemplateId, ALIGNMENT_STAGE_IDS, SEMIEMPIRICAL_STAGE_IDS,
};

use super::{
    cluster_plan::{ClusterV1EngineIdentities, SimilarityBackendAdmission},
    error::{ComputeCoordinatorError, ComputeResult},
};

pub(crate) fn admit_analysis_plan(
    request: &ComputeSubmitRequest,
    record_count: u64,
    engines: &ClusterV1EngineIdentities,
    admission: SimilarityBackendAdmission,
) -> ComputeResult<ExecutionPlan> {
    request.validate()?;
    let (workflow, version, stage_ids, numeric_indices, max_memory_bytes) = match request {
        ComputeSubmitRequest::AlignmentV1(request) => (
            WorkflowTemplateId::AlignmentV1,
            ExecutionPlanVersion::AlignmentV1,
            ALIGNMENT_STAGE_IDS.as_slice(),
            &[2_usize][..],
            request.limits.max_memory_bytes,
        ),
        ComputeSubmitRequest::SemiempiricalV1(request) => (
            WorkflowTemplateId::SemiempiricalV1,
            ExecutionPlanVersion::SemiempiricalV1,
            SEMIEMPIRICAL_STAGE_IDS.as_slice(),
            &[2_usize][..],
            request.limits.max_memory_bytes,
        ),
        _ => {
            return Err(ComputeCoordinatorError::Protocol(
                "analysis plan requires alignment.v1 or semiempirical.v1".into(),
            ))
        }
    };
    let (requested_numeric, effective_numeric, numeric_engine, fallback) =
        resolve_numeric_backend(request.backend_policy(), engines, admission)?;
    let ordinary_memory = record_count
        .checked_mul(64)
        .and_then(|bytes| bytes.checked_add(1_048_576))
        .unwrap_or(max_memory_bytes)
        .min(max_memory_bytes);
    let stages = stage_ids
        .iter()
        .enumerate()
        .map(|(index, stage_id)| {
            let (kind, requested, effective, precision, engine, memory, stage_fallback) =
                if index == 0 {
                    (
                        StageKind::Materialize,
                        Backend::Coordinator,
                        Backend::Coordinator,
                        Precision::NotApplicable,
                        engines.coordinator.clone(),
                        ordinary_memory,
                        None,
                    )
                } else if index + 1 == stage_ids.len() {
                    (
                        StageKind::ArtifactIo,
                        Backend::Coordinator,
                        Backend::Coordinator,
                        Precision::NotApplicable,
                        engines.coordinator.clone(),
                        ordinary_memory,
                        None,
                    )
                } else if numeric_indices.contains(&index) {
                    (
                        StageKind::NumericCompute,
                        requested_numeric,
                        effective_numeric,
                        if workflow == WorkflowTemplateId::AlignmentV1 {
                            Precision::Float32
                        } else {
                            Precision::Mixed
                        },
                        numeric_engine.clone(),
                        max_memory_bytes,
                        fallback.clone(),
                    )
                } else if *stage_id == "validateResults" {
                    (
                        StageKind::Validation,
                        Backend::ReferenceCpu,
                        Backend::ReferenceCpu,
                        Precision::Float64,
                        engines.reference_cpu.clone(),
                        ordinary_memory,
                        None,
                    )
                } else {
                    (
                        StageKind::ChemistrySemantics,
                        Backend::ReferenceCpu,
                        Backend::ReferenceCpu,
                        Precision::Float64,
                        engines.reference_cpu.clone(),
                        ordinary_memory,
                        None,
                    )
                };
            planned_stage(
                stage_id,
                kind,
                requested,
                effective,
                precision,
                engine,
                memory,
                record_count,
                workflow,
                stage_fallback,
            )
        })
        .collect();
    let plan = ExecutionPlan {
        workflow_template: workflow,
        plan_version: version,
        backend_policy: request.backend_policy(),
        stages,
    };
    plan.validate_against_compute_request(request, record_count)?;
    Ok(plan)
}

fn resolve_numeric_backend(
    policy: BackendPolicy,
    engines: &ClusterV1EngineIdentities,
    admission: SimilarityBackendAdmission,
) -> ComputeResult<(Backend, Backend, EngineIdentity, Option<FallbackDecision>)> {
    match (policy, admission) {
        (
            BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred,
            SimilarityBackendAdmission::NativeMetal(engine),
        ) => Ok((Backend::NativeMetal, Backend::NativeMetal, engine, None)),
        (BackendPolicy::GpuPreferred, SimilarityBackendAdmission::GpuUnavailable(fallback)) => {
            Ok((
                Backend::NativeMetal,
                Backend::ReferenceCpu,
                engines.reference_cpu.clone(),
                Some(fallback),
            ))
        }
        (BackendPolicy::GpuRequired, SimilarityBackendAdmission::GpuUnavailable(fallback)) => {
            Err(ComputeCoordinatorError::Unavailable(format!(
                "gpuRequired analysis admission failed: {}",
                fallback.reason
            )))
        }
        (BackendPolicy::ReferenceCpu, SimilarityBackendAdmission::ReferenceCpu) => Ok((
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            engines.reference_cpu.clone(),
            None,
        )),
        _ => Err(ComputeCoordinatorError::Protocol(
            "analysis backend admission differs from its requested policy".into(),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn planned_stage(
    stage_id: &str,
    kind: StageKind,
    requested_backend: Backend,
    effective_backend: Backend,
    precision: Precision,
    engine: EngineIdentity,
    estimated_memory_bytes: u64,
    record_count: u64,
    workflow: WorkflowTemplateId,
    fallback: Option<FallbackDecision>,
) -> PlannedStage {
    PlannedStage {
        stage_id: stage_id.into(),
        kind,
        idempotent: true,
        requested_backend,
        effective_backend,
        precision,
        engine,
        estimated_memory_bytes,
        fallback: fallback.clone(),
        partitions: vec![ExecutionPartition {
            partition_id: "all".into(),
            chemistry_domain: match workflow {
                WorkflowTemplateId::AlignmentV1 => "alignment.v1/selected",
                WorkflowTemplateId::SemiempiricalV1 => "semiempirical.v1/selected",
                _ => unreachable!("analysis plan workflow was checked"),
            }
            .into(),
            record_count,
            estimated_memory_bytes,
            requested_backend,
            effective_backend,
            fallback,
        }],
    }
}
