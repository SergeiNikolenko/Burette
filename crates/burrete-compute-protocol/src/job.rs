use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{
    validation::{validate_bounded_text, validate_json_safe_u64, validate_lower_sha256},
    BackendPolicy, ProtocolError, WorkflowTemplateId,
};

const MAX_STAGE_ID_BYTES: usize = 96;
const MAX_ENGINE_ID_BYTES: usize = 160;
const MAX_ENGINE_VERSION_BYTES: usize = 160;
const MAX_REASON_BYTES: usize = 2_048;
const MAX_PARTITIONS_PER_STAGE: usize = 128;

pub const CLUSTER_STAGE_IDS: [&str; 6] = [
    "freezeScope",
    "fingerprints",
    "tanimotoNeighbors",
    "butinaClusters",
    "validateResults",
    "publishResults",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OwnerSurface {
    Desktop,
    DesktopAgent,
    BrowserDev,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Preparing,
    WaitingGpu,
    Running,
    Validating,
    Publishing,
    CancelRequested,
    Cancelled,
    Failed,
    Interrupted,
    Succeeded,
    SucceededWithFailures,
}

impl JobState {
    pub fn can_transition_to(self, next: Self) -> bool {
        use JobState::*;
        matches!(
            (self, next),
            (Queued, Preparing | CancelRequested | Failed | Interrupted)
                | (
                    Preparing,
                    WaitingGpu | Running | CancelRequested | Failed | Interrupted
                )
                | (WaitingGpu, Running | CancelRequested | Failed | Interrupted)
                | (Running, Validating | CancelRequested | Failed | Interrupted)
                | (
                    Validating,
                    Publishing | CancelRequested | Failed | Interrupted
                )
                | (
                    Publishing,
                    Succeeded | SucceededWithFailures | CancelRequested | Failed | Interrupted
                )
                | (CancelRequested, Cancelled | Failed | Interrupted)
                | (Interrupted, CancelRequested | Cancelled | Failed)
        )
    }

    pub fn require_transition(self, next: Self) -> Result<(), ProtocolError> {
        if self.can_transition_to(next) {
            Ok(())
        } else {
            Err(ProtocolError::InvalidTransition {
                from: format!("{self:?}"),
                to: format!("{next:?}"),
            })
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Cancelled | Self::Failed | Self::Succeeded | Self::SucceededWithFailures
        )
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StageKind {
    ChemistrySemantics,
    NumericCompute,
    WorkflowSemantics,
    Validation,
    ArtifactIo,
    Materialize,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Backend {
    Coordinator,
    Rdkit,
    NativeMetal,
    Mlx,
    ReferenceCpu,
}

impl Backend {
    pub fn is_gpu(self) -> bool {
        matches!(self, Self::NativeMetal | Self::Mlx)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Precision {
    IntegerExact,
    Float32,
    Float64,
    Mixed,
    NotApplicable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ExecutionPlanVersion {
    #[serde(rename = "cluster.execution-plan.v1")]
    ClusterV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineIdentity {
    pub engine_id: String,
    pub version: String,
    pub manifest_sha256: String,
}

impl EngineIdentity {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("engine ID", &self.engine_id, MAX_ENGINE_ID_BYTES)?;
        validate_bounded_text("engine version", &self.version, MAX_ENGINE_VERSION_BYTES)?;
        validate_lower_sha256("engine manifest", &self.manifest_sha256)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum FallbackReasonCode {
    CapabilityUnavailable,
    UnsupportedPartition,
    MemoryAdmissionDenied,
    RuntimeUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FallbackDecision {
    pub code: FallbackReasonCode,
    pub reason: String,
}

impl FallbackDecision {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("fallback reason", &self.reason, MAX_REASON_BYTES)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPartition {
    pub partition_id: String,
    pub chemistry_domain: String,
    pub record_count: u64,
    pub estimated_memory_bytes: u64,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub fallback: Option<FallbackDecision>,
}

impl ExecutionPartition {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("partition ID", &self.partition_id, MAX_STAGE_ID_BYTES)?;
        validate_bounded_text(
            "partition chemistry domain",
            &self.chemistry_domain,
            MAX_ENGINE_ID_BYTES,
        )?;
        if self.record_count == 0 {
            return Err(ProtocolError::Validation(
                "execution partition recordCount must be positive".into(),
            ));
        }
        validate_json_safe_u64("execution partition recordCount", self.record_count)?;
        validate_json_safe_u64(
            "execution partition estimatedMemoryBytes",
            self.estimated_memory_bytes,
        )?;
        validate_fallback(
            self.requested_backend,
            self.effective_backend,
            self.fallback.as_ref(),
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannedStage {
    pub stage_id: String,
    pub kind: StageKind,
    pub idempotent: bool,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub precision: Precision,
    pub engine: EngineIdentity,
    pub estimated_memory_bytes: u64,
    pub fallback: Option<FallbackDecision>,
    pub partitions: Vec<ExecutionPartition>,
}

impl PlannedStage {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("stage ID", &self.stage_id, MAX_STAGE_ID_BYTES)?;
        self.engine.validate()?;
        validate_json_safe_u64("stage estimatedMemoryBytes", self.estimated_memory_bytes)?;
        validate_fallback(
            self.requested_backend,
            self.effective_backend,
            self.fallback.as_ref(),
        )?;
        if self.partitions.is_empty() || self.partitions.len() > MAX_PARTITIONS_PER_STAGE {
            return Err(ProtocolError::Validation(format!(
                "stage partitions must contain 1..={MAX_PARTITIONS_PER_STAGE} entries"
            )));
        }
        let mut partition_ids = BTreeSet::new();
        let mut partition_memory = 0_u64;
        for partition in &self.partitions {
            partition.validate()?;
            if !partition_ids.insert(partition.partition_id.as_str()) {
                return Err(ProtocolError::Validation(format!(
                    "duplicate execution partition ID: {}",
                    partition.partition_id
                )));
            }
            if partition.requested_backend != self.requested_backend
                || partition.effective_backend != self.effective_backend
            {
                return Err(ProtocolError::Validation(format!(
                    "partition {} backend differs from stage {}",
                    partition.partition_id, self.stage_id
                )));
            }
            partition_memory = partition_memory
                .checked_add(partition.estimated_memory_bytes)
                .ok_or_else(|| {
                    ProtocolError::Validation("partition memory estimate overflow".into())
                })?;
        }
        if self
            .partitions
            .windows(2)
            .any(|pair| pair[0].partition_id >= pair[1].partition_id)
        {
            return Err(ProtocolError::Validation(format!(
                "stage {} partitions must be strictly ordered by partitionId",
                self.stage_id
            )));
        }
        if partition_memory > self.estimated_memory_bytes {
            return Err(ProtocolError::Validation(format!(
                "stage {} memory estimate is smaller than its partitions",
                self.stage_id
            )));
        }
        validate_engine_backend(&self.engine, self.effective_backend)
    }

    fn partition_record_count(&self) -> Result<u64, ProtocolError> {
        self.partitions.iter().try_fold(0_u64, |total, partition| {
            total
                .checked_add(partition.record_count)
                .ok_or_else(|| ProtocolError::Validation("partition record count overflow".into()))
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPlan {
    pub workflow_template: WorkflowTemplateId,
    pub plan_version: ExecutionPlanVersion,
    pub backend_policy: BackendPolicy,
    pub stages: Vec<PlannedStage>,
}

impl ExecutionPlan {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.workflow_template != WorkflowTemplateId::ClusterV1
            || self.plan_version != ExecutionPlanVersion::ClusterV1
        {
            return Err(ProtocolError::Validation(
                "execution plan is not compatible with cluster.v1".into(),
            ));
        }
        if self.stages.len() != CLUSTER_STAGE_IDS.len() {
            return Err(ProtocolError::Validation(format!(
                "cluster.v1 execution plan requires exactly {} stages",
                CLUSTER_STAGE_IDS.len()
            )));
        }

        let expected = [
            (
                CLUSTER_STAGE_IDS[0],
                StageKind::Materialize,
                Backend::Coordinator,
                Precision::NotApplicable,
            ),
            (
                CLUSTER_STAGE_IDS[1],
                StageKind::ChemistrySemantics,
                Backend::Rdkit,
                Precision::IntegerExact,
            ),
            (
                CLUSTER_STAGE_IDS[2],
                StageKind::NumericCompute,
                self.expected_similarity_request_backend(),
                Precision::IntegerExact,
            ),
            (
                CLUSTER_STAGE_IDS[3],
                StageKind::WorkflowSemantics,
                Backend::ReferenceCpu,
                Precision::IntegerExact,
            ),
            (
                CLUSTER_STAGE_IDS[4],
                StageKind::Validation,
                Backend::ReferenceCpu,
                Precision::IntegerExact,
            ),
            (
                CLUSTER_STAGE_IDS[5],
                StageKind::ArtifactIo,
                Backend::Coordinator,
                Precision::NotApplicable,
            ),
        ];

        let mut record_count = None;
        for (stage, (stage_id, kind, requested_backend, precision)) in
            self.stages.iter().zip(expected)
        {
            stage.validate()?;
            if stage.stage_id != stage_id
                || stage.kind != kind
                || stage.requested_backend != requested_backend
                || stage.precision != precision
            {
                return Err(ProtocolError::Validation(format!(
                    "stage {} does not match the fixed cluster.v1 plan registry",
                    stage.stage_id
                )));
            }
            let stage_record_count = stage.partition_record_count()?;
            if record_count
                .replace(stage_record_count)
                .is_some_and(|value| value != stage_record_count)
            {
                return Err(ProtocolError::Validation(
                    "cluster.v1 stages do not cover the same frozen record count".into(),
                ));
            }
        }

        let similarity = &self.stages[2];
        match self.backend_policy {
            BackendPolicy::GpuRequired => {
                if similarity.effective_backend != Backend::NativeMetal {
                    return Err(ProtocolError::Validation(
                        "gpuRequired cluster.v1 similarity must use nativeMetal".into(),
                    ));
                }
            }
            BackendPolicy::GpuPreferred => {
                if !matches!(
                    similarity.effective_backend,
                    Backend::NativeMetal | Backend::ReferenceCpu
                ) {
                    return Err(ProtocolError::Validation(
                        "gpuPreferred cluster.v1 similarity has an unsupported backend".into(),
                    ));
                }
            }
            BackendPolicy::ReferenceCpu => {
                if similarity.effective_backend != Backend::ReferenceCpu {
                    return Err(ProtocolError::Validation(
                        "referenceCpu cluster.v1 similarity must use referenceCpu".into(),
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn validate_for_record_count(&self, record_count: u64) -> Result<(), ProtocolError> {
        self.validate()?;
        validate_json_safe_u64("execution plan record count", record_count)?;
        if self.stages[0].partition_record_count()? != record_count {
            return Err(ProtocolError::Validation(
                "execution plan record count differs from the frozen source".into(),
            ));
        }
        Ok(())
    }

    fn expected_similarity_request_backend(&self) -> Backend {
        match self.backend_policy {
            BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => Backend::NativeMetal,
            BackendPolicy::ReferenceCpu => Backend::ReferenceCpu,
        }
    }
}

fn validate_fallback(
    requested: Backend,
    effective: Backend,
    fallback: Option<&FallbackDecision>,
) -> Result<(), ProtocolError> {
    match (requested == effective, fallback) {
        (true, None) => Ok(()),
        (true, Some(_)) => Err(ProtocolError::Validation(
            "fallback metadata is forbidden when requested and effective backends match".into(),
        )),
        (false, Some(fallback)) => fallback.validate(),
        (false, None) => Err(ProtocolError::Validation(
            "backend fallback requires a bounded reason".into(),
        )),
    }
}

fn validate_engine_backend(engine: &EngineIdentity, backend: Backend) -> Result<(), ProtocolError> {
    let expected_engine = match backend {
        Backend::Coordinator => "burrete-coordinator",
        Backend::Rdkit => "rdkit",
        Backend::NativeMetal => "burrete-native-metal",
        Backend::Mlx => "burrete-mlx",
        Backend::ReferenceCpu => "burrete-reference-cpu",
    };
    if engine.engine_id != expected_engine {
        return Err(ProtocolError::Validation(format!(
            "engine {} is incompatible with backend {backend:?}",
            engine.engine_id
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(backend: Backend) -> EngineIdentity {
        EngineIdentity {
            engine_id: match backend {
                Backend::Coordinator => "burrete-coordinator",
                Backend::Rdkit => "rdkit",
                Backend::NativeMetal => "burrete-native-metal",
                Backend::Mlx => "burrete-mlx",
                Backend::ReferenceCpu => "burrete-reference-cpu",
            }
            .into(),
            version: "1.0.0".into(),
            manifest_sha256: "a".repeat(64),
        }
    }

    fn stage(
        stage_id: &str,
        kind: StageKind,
        requested: Backend,
        effective: Backend,
        precision: Precision,
    ) -> PlannedStage {
        let fallback = (requested != effective).then(|| FallbackDecision {
            code: FallbackReasonCode::CapabilityUnavailable,
            reason: "Metal is unavailable.".into(),
        });
        PlannedStage {
            stage_id: stage_id.into(),
            kind,
            idempotent: true,
            requested_backend: requested,
            effective_backend: effective,
            precision,
            engine: engine(effective),
            estimated_memory_bytes: 1024,
            fallback: fallback.clone(),
            partitions: vec![ExecutionPartition {
                partition_id: "supported".into(),
                chemistry_domain: "cluster.v1/all".into(),
                record_count: 10,
                estimated_memory_bytes: 1024,
                requested_backend: requested,
                effective_backend: effective,
                fallback,
            }],
        }
    }

    fn plan(policy: BackendPolicy, similarity: Backend) -> ExecutionPlan {
        let requested_similarity = match policy {
            BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => Backend::NativeMetal,
            BackendPolicy::ReferenceCpu => Backend::ReferenceCpu,
        };
        ExecutionPlan {
            workflow_template: WorkflowTemplateId::ClusterV1,
            plan_version: ExecutionPlanVersion::ClusterV1,
            backend_policy: policy,
            stages: vec![
                stage(
                    "freezeScope",
                    StageKind::Materialize,
                    Backend::Coordinator,
                    Backend::Coordinator,
                    Precision::NotApplicable,
                ),
                stage(
                    "fingerprints",
                    StageKind::ChemistrySemantics,
                    Backend::Rdkit,
                    Backend::Rdkit,
                    Precision::IntegerExact,
                ),
                stage(
                    "tanimotoNeighbors",
                    StageKind::NumericCompute,
                    requested_similarity,
                    similarity,
                    Precision::IntegerExact,
                ),
                stage(
                    "butinaClusters",
                    StageKind::WorkflowSemantics,
                    Backend::ReferenceCpu,
                    Backend::ReferenceCpu,
                    Precision::IntegerExact,
                ),
                stage(
                    "validateResults",
                    StageKind::Validation,
                    Backend::ReferenceCpu,
                    Backend::ReferenceCpu,
                    Precision::IntegerExact,
                ),
                stage(
                    "publishResults",
                    StageKind::ArtifactIo,
                    Backend::Coordinator,
                    Backend::Coordinator,
                    Precision::NotApplicable,
                ),
            ],
        }
    }

    #[test]
    fn preserves_cancel_requested_as_a_distinct_state() {
        assert!(JobState::Running.can_transition_to(JobState::CancelRequested));
        assert!(JobState::CancelRequested.can_transition_to(JobState::Cancelled));
        assert!(!JobState::Running.can_transition_to(JobState::Cancelled));
        assert!(!JobState::Queued.can_transition_to(JobState::Cancelled));
        assert!(JobState::Succeeded.is_terminal());
        assert!(!JobState::Interrupted.is_terminal());
    }

    #[test]
    fn validates_only_the_fixed_cluster_plan() {
        let valid = plan(BackendPolicy::GpuRequired, Backend::NativeMetal);
        assert_eq!(valid.validate_for_record_count(10), Ok(()));

        let mut arbitrary = valid.clone();
        arbitrary.stages[2].stage_id = "arbitraryGpuStage".into();
        assert!(arbitrary.validate().is_err());
    }

    #[test]
    fn gpu_required_rejects_actual_cpu_resolution() {
        let rejected = plan(BackendPolicy::GpuRequired, Backend::ReferenceCpu);
        assert!(rejected.validate().is_err());
        let fallback = plan(BackendPolicy::GpuPreferred, Backend::ReferenceCpu);
        assert_eq!(fallback.validate(), Ok(()));
    }
}
