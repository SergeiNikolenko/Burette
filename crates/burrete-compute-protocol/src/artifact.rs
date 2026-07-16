use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    validation::{
        validate_bounded_text, validate_json_safe_u64, validate_lower_sha256,
        validate_relative_path,
    },
    Backend, BackendPolicy, EngineIdentity, FallbackDecision, JobSnapshot, JobState,
    MolecularSnapshotRef, PackedFileDescriptor, Precision, ProtocolError, ResultPackRef,
    RuntimeIdentity, StageKind, StageState, WorkflowTemplateId, CLUSTER_STAGE_IDS,
    MAX_CONTROL_FRAME_BYTES, MAX_PACK_BYTES,
};

const MAX_FILES: usize = 256;
const MAX_PATH_BYTES: usize = 1_024;
const MAX_LABEL_BYTES: usize = 256;
const MAX_REASON_BYTES: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ArtifactManifestSchemaVersion {
    #[serde(rename = "burrete.compute-artifact-manifest.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ResultPackVersion {
    #[serde(rename = "cluster.result-pack.v1")]
    ClusterV1,
    #[serde(rename = "conformer.result-pack.v1")]
    ConformerV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactManifest {
    pub schema_version: ArtifactManifestSchemaVersion,
    pub artifact_id: Uuid,
    pub job_id: Uuid,
    pub workflow_template: WorkflowTemplateId,
    pub molecular_snapshot: MolecularSnapshotRef,
    pub normalized_request_sha256: String,
    pub accepted_plan_sha256: String,
    pub runtime: RuntimeIdentity,
    pub result_pack: ResultPackRef,
    pub files: Vec<ArtifactFile>,
    pub stages: Vec<StageProvenance>,
    pub created_at_ms: u64,
}

impl ArtifactManifest {
    /// Validates the bounded manifest shape without reading materialized files.
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_uuid("artifact ID", self.artifact_id)?;
        validate_uuid("artifact job ID", self.job_id)?;
        validate_json_safe_u64("artifact creation time", self.created_at_ms)?;
        if self.created_at_ms == 0 {
            return validation_error("artifact creation time must be positive");
        }
        validate_lower_sha256(
            "artifact normalized request",
            &self.normalized_request_sha256,
        )?;
        validate_lower_sha256("artifact accepted plan", &self.accepted_plan_sha256)?;
        self.molecular_snapshot.validate()?;
        self.runtime.validate()?;
        self.result_pack.validate()?;
        self.validate_result_identity()?;
        self.validate_files()?;
        self.validate_stages()?;

        let encoded = serde_json::to_vec(self)?;
        if encoded.len() > MAX_CONTROL_FRAME_BYTES {
            return Err(ProtocolError::FrameTooLarge {
                bytes: encoded.len(),
                limit: MAX_CONTROL_FRAME_BYTES,
            });
        }
        Ok(())
    }

    /// Binds an otherwise valid manifest to the durable successful job snapshot.
    pub fn validate_against_job(&self, job: &JobSnapshot) -> Result<(), ProtocolError> {
        self.validate()?;
        job.validate()?;
        if !matches!(
            job.state,
            JobState::Succeeded | JobState::SucceededWithFailures
        ) {
            return validation_error("artifact manifest requires a successful job snapshot");
        }
        if self.job_id != job.job_id
            || self.workflow_template != job.workflow_template
            || self.molecular_snapshot != job.frozen_source
            || self.normalized_request_sha256 != job.normalized_request_sha256
            || self.accepted_plan_sha256 != job.accepted_plan_sha256
        {
            return validation_error("artifact manifest identity differs from its job snapshot");
        }
        if !job.artifact_ids.contains(&self.artifact_id) {
            return validation_error("artifact ID is not published by the job snapshot");
        }
        if job.result_pack.as_ref() != Some(&self.result_pack) {
            return validation_error("artifact result pack differs from the published job result");
        }
        if self.runtime != job.pinned_runtime {
            return validation_error(
                "artifact runtime identity differs from the job's pinned runtime",
            );
        }
        let publish_stage = job.stages.last().ok_or_else(|| {
            ProtocolError::Validation("successful job lacks a publish stage".into())
        })?;
        let publish_finish = publish_stage.finished_at_ms.ok_or_else(|| {
            ProtocolError::Validation("successful publish stage lacks a finish time".into())
        })?;
        if publish_stage.kind != StageKind::ArtifactIo
            || self.created_at_ms != publish_finish
            || job
                .finished_at_ms
                .is_none_or(|job_finish| self.created_at_ms > job_finish)
        {
            return validation_error(
                "artifact creation must equal the successful publish boundary",
            );
        }
        if self.stages.len() != job.stages.len() {
            return validation_error("artifact stage provenance differs from the job stage count");
        }
        for (artifact_stage, job_stage) in self.stages.iter().zip(&job.stages) {
            artifact_stage.validate_against_job_stage(job_stage)?;
            if job.plan.backend_policy == BackendPolicy::GpuRequired
                && artifact_stage.kind == StageKind::NumericCompute
                && !artifact_stage.effective_backend.is_gpu()
            {
                return validation_error(
                    "gpuRequired artifact contains a CPU numeric stage provenance record",
                );
            }
        }
        Ok(())
    }

    fn validate_result_identity(&self) -> Result<(), ProtocolError> {
        if self.result_pack.job_id != self.job_id
            || self.result_pack.workflow_template != self.workflow_template
            || self.result_pack.snapshot_id != self.molecular_snapshot.snapshot_id
            || self.result_pack.snapshot_sha256 != self.molecular_snapshot.snapshot_sha256
        {
            return validation_error(
                "artifact result pack differs from its job, workflow, or molecular snapshot",
            );
        }
        Ok(())
    }

    fn validate_files(&self) -> Result<(), ProtocolError> {
        if self.files.is_empty() || self.files.len() > MAX_FILES {
            return Err(ProtocolError::Validation(format!(
                "artifact manifest requires 1..={MAX_FILES} files"
            )));
        }
        if self
            .files
            .windows(2)
            .any(|pair| pair[0].relative_path >= pair[1].relative_path)
        {
            return validation_error("artifact files must be strictly sorted by relativePath");
        }
        let mut paths = BTreeSet::new();
        let mut total_bytes = 0_u64;
        for file in &self.files {
            file.validate()?;
            if !paths.insert(file.relative_path.as_str()) {
                return validation_error("artifact manifest contains duplicate file paths");
            }
            total_bytes = total_bytes.checked_add(file.byte_count).ok_or_else(|| {
                ProtocolError::Validation("artifact byte total overflowed".into())
            })?;
        }
        if total_bytes > MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(format!(
                "artifact files exceed the {MAX_PACK_BYTES}-byte limit"
            )));
        }
        if !self
            .files
            .iter()
            .any(|file| file.matches_descriptor(&self.result_pack.manifest))
        {
            return validation_error(
                "artifact files must include the exact result pack manifest descriptor",
            );
        }
        Ok(())
    }

    fn validate_stages(&self) -> Result<(), ProtocolError> {
        let expected_stage_ids = match self.workflow_template {
            WorkflowTemplateId::ClusterV1 => CLUSTER_STAGE_IDS.as_slice(),
            WorkflowTemplateId::SimilaritySearchV1 => {
                return validation_error(
                    "similaritySearch.v1 derived analyses do not publish cluster artifacts",
                )
            }
            WorkflowTemplateId::ConformerV1 => {
                return validation_error(
                    "conformer.v1 artifact publication requires its fixed stage contract",
                )
            }
        };
        if self.stages.len() != expected_stage_ids.len() {
            return validation_error(
                "artifact stage provenance must match the fixed workflow stage count",
            );
        }
        let mut stage_ids = BTreeSet::new();
        for (stage, expected_id) in self.stages.iter().zip(expected_stage_ids) {
            stage.validate()?;
            if stage.stage_id != *expected_id {
                return validation_error(
                    "artifact stage provenance is not in canonical workflow order",
                );
            }
            if !stage_ids.insert(stage.stage_id.as_str()) {
                return validation_error("artifact manifest contains duplicate stage IDs");
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactFile {
    pub role: String,
    pub relative_path: String,
    pub sha256: String,
    pub byte_count: u64,
    pub media_type: String,
}

impl ArtifactFile {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_clean_text("artifact role", &self.role, MAX_LABEL_BYTES)?;
        validate_clean_text("artifact media type", &self.media_type, MAX_LABEL_BYTES)?;
        validate_relative_path(
            "artifact relative path",
            &self.relative_path,
            MAX_PATH_BYTES,
        )?;
        validate_lower_sha256("artifact file", &self.sha256)?;
        validate_json_safe_u64("artifact byte count", self.byte_count)?;
        if self.byte_count > MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(format!(
                "artifact file exceeds the {MAX_PACK_BYTES}-byte limit"
            )));
        }
        Ok(())
    }

    fn matches_descriptor(&self, descriptor: &PackedFileDescriptor) -> bool {
        self.relative_path == descriptor.relative_path
            && self.sha256 == descriptor.sha256
            && self.byte_count == descriptor.byte_length
            && self.media_type == descriptor.media_type
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageProvenance {
    pub stage_id: String,
    pub kind: StageKind,
    pub engine: EngineIdentity,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub precision: Precision,
    pub device: Option<String>,
    pub kernel_id: Option<String>,
    pub gpu_time_ms: Option<f64>,
    pub host_time_ms: f64,
    pub transferred_bytes: u64,
    pub fallback: Option<FallbackDecision>,
}

impl StageProvenance {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_clean_text("stage ID", &self.stage_id, MAX_LABEL_BYTES)?;
        self.engine.validate()?;
        if let Some(device) = &self.device {
            validate_clean_text("stage device", device, MAX_LABEL_BYTES)?;
        }
        if let Some(kernel_id) = &self.kernel_id {
            validate_clean_text("stage kernel ID", kernel_id, MAX_LABEL_BYTES)?;
        }
        if let Some(fallback) = &self.fallback {
            validate_clean_text("stage fallback reason", &fallback.reason, MAX_REASON_BYTES)?;
        }
        validate_json_safe_u64("stage transferred bytes", self.transferred_bytes)?;
        if !self.host_time_ms.is_finite()
            || self.host_time_ms < 0.0
            || self
                .gpu_time_ms
                .is_some_and(|time| !time.is_finite() || time < 0.0)
        {
            return validation_error("stage timings must be finite and non-negative");
        }
        match (
            self.requested_backend == self.effective_backend,
            &self.fallback,
        ) {
            (true, None) | (false, Some(_)) => {}
            (true, Some(_)) => {
                return validation_error(
                    "stage fallback is forbidden when requested and effective backends match",
                )
            }
            (false, None) => {
                return validation_error("stage backend fallback requires a bounded reason")
            }
        }
        let expected_engine = match self.effective_backend {
            Backend::Coordinator => "burrete-coordinator",
            Backend::Rdkit => "rdkit",
            Backend::NativeMetal => "burrete-native-metal",
            Backend::ReferenceCpu => "burrete-reference-cpu",
        };
        if self.engine.engine_id != expected_engine {
            return validation_error("stage engine is incompatible with its effective backend");
        }
        if self.kind == StageKind::NumericCompute && self.effective_backend.is_gpu() {
            if self.device.is_none() || self.kernel_id.is_none() || self.gpu_time_ms.is_none() {
                return validation_error(
                    "GPU numeric stage requires device, kernel ID, and GPU timing",
                );
            }
        } else if self.gpu_time_ms.is_some() {
            return validation_error("non-GPU stage cannot report GPU timing");
        }
        Ok(())
    }

    fn validate_against_job_stage(
        &self,
        stage: &crate::StageSnapshot,
    ) -> Result<(), ProtocolError> {
        if stage.state != StageState::Succeeded
            || stage.host_time_ms != Some(self.host_time_ms)
            || self.stage_id != stage.stage_id
            || self.kind != stage.kind
            || self.engine != stage.engine
            || self.requested_backend != stage.requested_backend
            || self.effective_backend != stage.effective_backend
            || self.precision != stage.precision
            || self.device != stage.device
            || self.kernel_id != stage.kernel_id
            || self.gpu_time_ms != stage.gpu_time_ms
            || self.transferred_bytes != stage.transferred_bytes
            || self.fallback != stage.fallback
        {
            return validation_error("artifact stage provenance differs from the successful job");
        }
        Ok(())
    }
}

fn validate_uuid(label: &str, value: Uuid) -> Result<(), ProtocolError> {
    if value.is_nil() {
        validation_error(&format!("{label} cannot be the nil UUID"))
    } else {
        Ok(())
    }
}

fn validate_clean_text(label: &str, value: &str, max: usize) -> Result<(), ProtocolError> {
    validate_bounded_text(label, value, max)?;
    if value.trim() != value || value.chars().any(char::is_control) {
        return validation_error(&format!(
            "{label} must be trimmed and contain no control characters"
        ));
    }
    Ok(())
}

fn validation_error<T>(message: &str) -> Result<T, ProtocolError> {
    Err(ProtocolError::Validation(message.into()))
}

#[cfg(test)]
#[path = "artifact/tests.rs"]
mod tests;
