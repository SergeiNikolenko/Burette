use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{
    validation::{
        canonical_json_bytes as serialize_canonical_json, sha256_hex, validate_bounded_text,
        validate_json_safe_u64, validate_lower_sha256,
    },
    BackendPolicy, ClusterV1SubmitRequest, ComputeSubmitRequest, ConformerV1SubmitRequest,
    ProtocolError, WorkflowTemplateId,
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
pub const CONFORMER_STAGE_IDS: [&str; 6] = [
    "freezeScope",
    "conformerConstraints",
    "distanceGeometry",
    "stereoValidation",
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
    ReferenceCpu,
}

impl Backend {
    pub fn is_gpu(self) -> bool {
        self == Self::NativeMetal
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
    #[serde(rename = "conformer.execution-plan.v1")]
    ConformerV1,
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
            if partition.fallback != self.fallback {
                return Err(ProtocolError::Validation(format!(
                    "partition {} fallback metadata differs from stage {}",
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
        let expected = self.expected_stages()?;
        if self.stages.len() != expected.len() {
            return Err(ProtocolError::Validation(format!(
                "workflow execution plan requires exactly {} stages",
                expected.len()
            )));
        }
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
                    "stage {} does not match the fixed workflow plan registry",
                    stage.stage_id
                )));
            }
            let stage_record_count = stage.partition_record_count()?;
            if record_count
                .replace(stage_record_count)
                .is_some_and(|value| value != stage_record_count)
            {
                return Err(ProtocolError::Validation(
                    "workflow stages do not cover the same frozen record count".into(),
                ));
            }
        }
        for &index in self.numeric_stage_indices() {
            self.validate_numeric_backend(&self.stages[index])?;
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

    pub fn validate_against_request(
        &self,
        request: &ClusterV1SubmitRequest,
        record_count: u64,
    ) -> Result<(), ProtocolError> {
        request.validate()?;
        self.validate_for_record_count(record_count)?;
        if self.workflow_template != request.workflow_template
            || self.backend_policy != request.execution_policy.backend_policy
        {
            return Err(ProtocolError::Validation(
                "execution plan differs from the requested workflow or backend policy".into(),
            ));
        }
        self.validate_memory_limit(request.limits.max_memory_bytes)
    }

    pub fn validate_against_conformer_request(
        &self,
        request: &ConformerV1SubmitRequest,
        record_count: u64,
    ) -> Result<(), ProtocolError> {
        request.validate()?;
        self.validate_for_record_count(record_count)?;
        if self.workflow_template != request.workflow_template
            || self.backend_policy != request.execution_policy.backend_policy
        {
            return Err(ProtocolError::Validation(
                "execution plan differs from the requested workflow or backend policy".into(),
            ));
        }
        self.validate_memory_limit(request.limits.max_memory_bytes)
    }

    pub fn validate_against_compute_request(
        &self,
        request: &ComputeSubmitRequest,
        record_count: u64,
    ) -> Result<(), ProtocolError> {
        match request {
            ComputeSubmitRequest::ClusterV1(request) => {
                self.validate_against_request(request, record_count)
            }
            ComputeSubmitRequest::ConformerV1(request) => {
                self.validate_against_conformer_request(request, record_count)
            }
        }
    }

    /// Serializes a validated execution plan using RFC 8785 JSON Canonicalization Scheme.
    pub fn canonical_json_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        serialize_canonical_json(self)
    }

    /// Hashes the canonical bytes stored as the accepted execution-plan identity.
    pub fn canonical_sha256(&self) -> Result<String, ProtocolError> {
        self.canonical_json_bytes().map(|bytes| sha256_hex(&bytes))
    }

    fn expected_similarity_request_backend(&self) -> Backend {
        match self.backend_policy {
            BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => Backend::NativeMetal,
            BackendPolicy::ReferenceCpu => Backend::ReferenceCpu,
        }
    }

    fn expected_stages(
        &self,
    ) -> Result<Vec<(&'static str, StageKind, Backend, Precision)>, ProtocolError> {
        let gpu = self.expected_similarity_request_backend();
        match (self.workflow_template, self.plan_version) {
            (WorkflowTemplateId::ClusterV1, ExecutionPlanVersion::ClusterV1) => Ok(vec![
                (CLUSTER_STAGE_IDS[0], StageKind::Materialize, Backend::Coordinator, Precision::NotApplicable),
                (CLUSTER_STAGE_IDS[1], StageKind::ChemistrySemantics, Backend::Rdkit, Precision::IntegerExact),
                (CLUSTER_STAGE_IDS[2], StageKind::NumericCompute, gpu, Precision::IntegerExact),
                (CLUSTER_STAGE_IDS[3], StageKind::WorkflowSemantics, Backend::ReferenceCpu, Precision::IntegerExact),
                (CLUSTER_STAGE_IDS[4], StageKind::Validation, Backend::ReferenceCpu, Precision::IntegerExact),
                (CLUSTER_STAGE_IDS[5], StageKind::ArtifactIo, Backend::Coordinator, Precision::NotApplicable),
            ]),
            (WorkflowTemplateId::ConformerV1, ExecutionPlanVersion::ConformerV1) => Ok(vec![
                (CONFORMER_STAGE_IDS[0], StageKind::Materialize, Backend::Coordinator, Precision::NotApplicable),
                (CONFORMER_STAGE_IDS[1], StageKind::ChemistrySemantics, Backend::Rdkit, Precision::Float64),
                (CONFORMER_STAGE_IDS[2], StageKind::NumericCompute, gpu, Precision::Float32),
                (CONFORMER_STAGE_IDS[3], StageKind::NumericCompute, gpu, Precision::Float32),
                (CONFORMER_STAGE_IDS[4], StageKind::Validation, Backend::ReferenceCpu, Precision::Float64),
                (CONFORMER_STAGE_IDS[5], StageKind::ArtifactIo, Backend::Coordinator, Precision::NotApplicable),
            ]),
            _ => Err(ProtocolError::Validation(
                "execution plan version is incompatible with its workflow".into(),
            )),
        }
    }

    fn numeric_stage_indices(&self) -> &'static [usize] {
        match self.workflow_template {
            WorkflowTemplateId::ClusterV1 => &[2],
            WorkflowTemplateId::ConformerV1 => &[2, 3],
            WorkflowTemplateId::SimilaritySearchV1 => &[],
        }
    }

    fn validate_numeric_backend(&self, stage: &PlannedStage) -> Result<(), ProtocolError> {
        let valid = match self.backend_policy {
            BackendPolicy::GpuRequired => stage.effective_backend == Backend::NativeMetal,
            BackendPolicy::GpuPreferred => matches!(stage.effective_backend, Backend::NativeMetal | Backend::ReferenceCpu),
            BackendPolicy::ReferenceCpu => stage.effective_backend == Backend::ReferenceCpu,
        };
        if valid {
            Ok(())
        } else {
            Err(ProtocolError::Validation(format!(
                "stage {} effective backend violates the workflow backend policy",
                stage.stage_id
            )))
        }
    }

    fn validate_memory_limit(&self, max_memory_bytes: u64) -> Result<(), ProtocolError> {
        for stage in &self.stages {
            if stage.estimated_memory_bytes > max_memory_bytes
                || stage
                    .partitions
                    .iter()
                    .any(|partition| partition.estimated_memory_bytes > max_memory_bytes)
            {
                return Err(ProtocolError::Validation(format!(
                    "stage {} exceeds the request maxMemoryBytes limit",
                    stage.stage_id
                )));
            }
        }
        Ok(())
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
    use crate::{
        AllGridScope, ClusterV1Parameters, ComputeJobSchemaVersion, ConformerResourceLimits,
        ConformerV1Parameters, ConformerVariant, ExecutionPolicy, FingerprintAlgorithm,
        FingerprintInputOrder, FingerprintSettings, GridScope, GridSourceReference,
        RdkitBaselineVersion, RepresentativePolicy, ResourceLimits, SchedulingPolicy,
        SimilarityCutoff, SimilaritySettings,
    };

    fn engine(backend: Backend) -> EngineIdentity {
        EngineIdentity {
            engine_id: match backend {
                Backend::Coordinator => "burrete-coordinator",
                Backend::Rdkit => "rdkit",
                Backend::NativeMetal => "burrete-native-metal",
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

    fn request(policy: BackendPolicy, max_memory_bytes: u64) -> ClusterV1SubmitRequest {
        ClusterV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ClusterV1,
            source: GridSourceReference {
                document_id: "document-1".into(),
                scope: GridScope::All(AllGridScope {}),
            },
            parameters: ClusterV1Parameters {
                fingerprint: FingerprintSettings {
                    algorithm: FingerprintAlgorithm::RdkitMorganBitV1,
                    rdkit_version: RdkitBaselineVersion::V2025_03_4,
                    radius: 2,
                    bit_count: 2_048,
                    use_chirality: true,
                    use_features: false,
                    sanitize: true,
                    input_order: FingerprintInputOrder::SourceRecord,
                },
                similarity: SimilaritySettings {
                    cutoff: SimilarityCutoff {
                        numerator: 7,
                        denominator: 10,
                    },
                },
                representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: policy,
                scheduling_policy: SchedulingPolicy::Balanced,
            },
            limits: ResourceLimits {
                max_edges: 1_000_000,
                max_memory_bytes,
                max_dispatch_ms: 250,
            },
        }
    }

    fn conformer_plan(policy: BackendPolicy, numeric: Backend) -> ExecutionPlan {
        let requested = match policy {
            BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => Backend::NativeMetal,
            BackendPolicy::ReferenceCpu => Backend::ReferenceCpu,
        };
        ExecutionPlan {
            workflow_template: WorkflowTemplateId::ConformerV1,
            plan_version: ExecutionPlanVersion::ConformerV1,
            backend_policy: policy,
            stages: vec![
                stage("freezeScope", StageKind::Materialize, Backend::Coordinator, Backend::Coordinator, Precision::NotApplicable),
                stage("conformerConstraints", StageKind::ChemistrySemantics, Backend::Rdkit, Backend::Rdkit, Precision::Float64),
                stage("distanceGeometry", StageKind::NumericCompute, requested, numeric, Precision::Float32),
                stage("stereoValidation", StageKind::NumericCompute, requested, numeric, Precision::Float32),
                stage("validateResults", StageKind::Validation, Backend::ReferenceCpu, Backend::ReferenceCpu, Precision::Float64),
                stage("publishResults", StageKind::ArtifactIo, Backend::Coordinator, Backend::Coordinator, Precision::NotApplicable),
            ],
        }
    }

    fn conformer_request(policy: BackendPolicy) -> ConformerV1SubmitRequest {
        ConformerV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ConformerV1,
            source: GridSourceReference {
                document_id: "document-1".into(),
                scope: GridScope::All(AllGridScope {}),
            },
            parameters: ConformerV1Parameters {
                variant: ConformerVariant::EtkdgV3,
                conformers_per_molecule: 16,
                max_attempts_per_conformer: 8,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: policy,
                scheduling_policy: SchedulingPolicy::Balanced,
            },
            limits: ConformerResourceLimits {
                max_memory_bytes: 16 * 1024 * 1024,
                max_dispatch_ms: 250,
                max_conformers_per_batch: 1024,
            },
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

    #[test]
    fn conformer_plan_requires_both_numeric_stages_to_honor_gpu_policy() {
        let request = conformer_request(BackendPolicy::GpuRequired);
        let plan = conformer_plan(BackendPolicy::GpuRequired, Backend::NativeMetal);
        assert_eq!(plan.validate_against_conformer_request(&request, 10), Ok(()));

        let mut cpu_stereo = plan.clone();
        cpu_stereo.stages[3] = stage(
            "stereoValidation",
            StageKind::NumericCompute,
            Backend::NativeMetal,
            Backend::ReferenceCpu,
            Precision::Float32,
        );
        assert!(cpu_stereo
            .validate_against_conformer_request(&request, 10)
            .is_err());

        let fallback = conformer_plan(BackendPolicy::GpuPreferred, Backend::ReferenceCpu);
        assert_eq!(
            fallback.validate_against_conformer_request(
                &conformer_request(BackendPolicy::GpuPreferred),
                10
            ),
            Ok(())
        );
    }

    #[test]
    fn binds_plan_to_request_policy_record_count_and_memory() {
        let accepted = plan(BackendPolicy::GpuRequired, Backend::NativeMetal);
        let accepted_request = request(BackendPolicy::GpuRequired, 16 * 1024 * 1024);
        assert_eq!(
            accepted.validate_against_request(&accepted_request, 10),
            Ok(())
        );

        let wrong_policy = request(BackendPolicy::ReferenceCpu, 16 * 1024 * 1024);
        assert!(accepted
            .validate_against_request(&wrong_policy, 10)
            .is_err());
        assert!(accepted
            .validate_against_request(&accepted_request, 9)
            .is_err());

        let mut oversized = accepted.clone();
        oversized.stages[2].estimated_memory_bytes = 16 * 1024 * 1024 + 1;
        oversized.stages[2].partitions[0].estimated_memory_bytes = 16 * 1024 * 1024 + 1;
        assert!(oversized
            .validate_against_request(&accepted_request, 10)
            .is_err());
    }

    #[test]
    fn requires_exact_stage_partition_fallback_metadata() {
        let mut mismatched = plan(BackendPolicy::GpuPreferred, Backend::ReferenceCpu);
        mismatched.stages[2].partitions[0].fallback = Some(FallbackDecision {
            code: FallbackReasonCode::MemoryAdmissionDenied,
            reason: "The admitted partition exceeds the GPU memory budget.".into(),
        });
        let request = request(BackendPolicy::GpuPreferred, 16 * 1024 * 1024);

        assert!(mismatched.validate_against_request(&request, 10).is_err());
    }

    #[test]
    fn canonical_plan_bytes_and_hash_are_pinned() {
        let plan = plan(BackendPolicy::GpuRequired, Backend::NativeMetal);
        let declaration_order_json = concat!(
            r#"{"workflowTemplate":"cluster.v1","planVersion":"cluster.execution-plan.v1","backendPolicy":"gpuRequired","stages":["#,
            r#"{"stageId":"freezeScope","kind":"materialize","idempotent":true,"requestedBackend":"coordinator","effectiveBackend":"coordinator","precision":"notApplicable","engine":{"engineId":"burrete-coordinator","version":"1.0.0","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"estimatedMemoryBytes":1024,"fallback":null,"partitions":[{"partitionId":"supported","chemistryDomain":"cluster.v1/all","recordCount":10,"estimatedMemoryBytes":1024,"requestedBackend":"coordinator","effectiveBackend":"coordinator","fallback":null}]}"#,
            r#",{"stageId":"fingerprints","kind":"chemistrySemantics","idempotent":true,"requestedBackend":"rdkit","effectiveBackend":"rdkit","precision":"integerExact","engine":{"engineId":"rdkit","version":"1.0.0","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"estimatedMemoryBytes":1024,"fallback":null,"partitions":[{"partitionId":"supported","chemistryDomain":"cluster.v1/all","recordCount":10,"estimatedMemoryBytes":1024,"requestedBackend":"rdkit","effectiveBackend":"rdkit","fallback":null}]}"#,
            r#",{"stageId":"tanimotoNeighbors","kind":"numericCompute","idempotent":true,"requestedBackend":"nativeMetal","effectiveBackend":"nativeMetal","precision":"integerExact","engine":{"engineId":"burrete-native-metal","version":"1.0.0","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"estimatedMemoryBytes":1024,"fallback":null,"partitions":[{"partitionId":"supported","chemistryDomain":"cluster.v1/all","recordCount":10,"estimatedMemoryBytes":1024,"requestedBackend":"nativeMetal","effectiveBackend":"nativeMetal","fallback":null}]}"#,
            r#",{"stageId":"butinaClusters","kind":"workflowSemantics","idempotent":true,"requestedBackend":"referenceCpu","effectiveBackend":"referenceCpu","precision":"integerExact","engine":{"engineId":"burrete-reference-cpu","version":"1.0.0","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"estimatedMemoryBytes":1024,"fallback":null,"partitions":[{"partitionId":"supported","chemistryDomain":"cluster.v1/all","recordCount":10,"estimatedMemoryBytes":1024,"requestedBackend":"referenceCpu","effectiveBackend":"referenceCpu","fallback":null}]}"#,
            r#",{"stageId":"validateResults","kind":"validation","idempotent":true,"requestedBackend":"referenceCpu","effectiveBackend":"referenceCpu","precision":"integerExact","engine":{"engineId":"burrete-reference-cpu","version":"1.0.0","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"estimatedMemoryBytes":1024,"fallback":null,"partitions":[{"partitionId":"supported","chemistryDomain":"cluster.v1/all","recordCount":10,"estimatedMemoryBytes":1024,"requestedBackend":"referenceCpu","effectiveBackend":"referenceCpu","fallback":null}]}"#,
            r#",{"stageId":"publishResults","kind":"artifactIo","idempotent":true,"requestedBackend":"coordinator","effectiveBackend":"coordinator","precision":"notApplicable","engine":{"engineId":"burrete-coordinator","version":"1.0.0","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"estimatedMemoryBytes":1024,"fallback":null,"partitions":[{"partitionId":"supported","chemistryDomain":"cluster.v1/all","recordCount":10,"estimatedMemoryBytes":1024,"requestedBackend":"coordinator","effectiveBackend":"coordinator","fallback":null}]}]}"#,
        )
        .as_bytes();

        assert_ne!(
            plan.canonical_json_bytes().expect("canonical plan"),
            declaration_order_json
        );
        assert_eq!(
            plan.canonical_sha256().expect("plan hash"),
            "746fb1f42a9be112bf9d4efc02d50370e64acc8db6790ea70d5d42e178238f58"
        );
    }
}
