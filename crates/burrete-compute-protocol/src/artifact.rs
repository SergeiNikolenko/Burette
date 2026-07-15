use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Backend, Precision, ProtocolError, StageKind, WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES,
};

const MAX_FILES: usize = 256;
const MAX_STAGE_TRACES: usize = 64;
const MAX_PATH_BYTES: usize = 1_024;
const MAX_LABEL_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ArtifactManifestSchemaVersion {
    #[serde(rename = "burrete.compute-artifact-manifest.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ResultPackVersion {
    #[serde(rename = "cluster.result-pack.v1")]
    ClusterV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifest {
    pub schema_version: ArtifactManifestSchemaVersion,
    pub artifact_id: Uuid,
    pub job_id: Uuid,
    pub workflow_template: WorkflowTemplateId,
    pub result_pack_version: ResultPackVersion,
    pub files: Vec<ArtifactFile>,
    pub stages: Vec<StageProvenance>,
    pub created_at_ms: u64,
}

impl ArtifactManifest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.files.is_empty() || self.files.len() > MAX_FILES {
            return Err(ProtocolError::Validation(format!(
                "artifact manifest requires 1..={MAX_FILES} files"
            )));
        }
        if self.stages.is_empty() || self.stages.len() > MAX_STAGE_TRACES {
            return Err(ProtocolError::Validation(format!(
                "artifact manifest requires 1..={MAX_STAGE_TRACES} stage traces"
            )));
        }
        for file in &self.files {
            file.validate()?;
        }
        for stage in &self.stages {
            stage.validate()?;
        }
        let encoded = serde_json::to_vec(self)?;
        if encoded.len() > MAX_CONTROL_FRAME_BYTES {
            return Err(ProtocolError::FrameTooLarge {
                bytes: encoded.len(),
                limit: MAX_CONTROL_FRAME_BYTES,
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactFile {
    pub role: String,
    pub relative_path: String,
    pub sha256: String,
    pub byte_count: u64,
    pub media_type: String,
}

impl ArtifactFile {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_label("artifact role", &self.role)?;
        validate_label("artifact media type", &self.media_type)?;
        if self.relative_path.is_empty() || self.relative_path.len() > MAX_PATH_BYTES {
            return Err(ProtocolError::Validation(format!(
                "artifact relative path must contain 1..={MAX_PATH_BYTES} bytes"
            )));
        }
        let path = Path::new(&self.relative_path);
        if path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(ProtocolError::Validation(
                "artifact path must stay relative to the coordinator-issued job root".into(),
            ));
        }
        validate_sha256(&self.sha256)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageProvenance {
    pub stage_id: String,
    pub kind: StageKind,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub device: Option<String>,
    pub precision: Precision,
    pub kernel_id: Option<String>,
    pub gpu_time_ms: Option<f64>,
    pub host_time_ms: f64,
    pub transferred_bytes: u64,
    pub fallback_reason: Option<String>,
}

impl StageProvenance {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_label("stage ID", &self.stage_id)?;
        if let Some(device) = &self.device {
            validate_label("stage device", device)?;
        }
        if let Some(kernel_id) = &self.kernel_id {
            validate_label("stage kernel ID", kernel_id)?;
        }
        if let Some(reason) = &self.fallback_reason {
            validate_label("stage fallback reason", reason)?;
        }
        if !self.host_time_ms.is_finite()
            || self.host_time_ms < 0.0
            || self
                .gpu_time_ms
                .is_some_and(|time| !time.is_finite() || time < 0.0)
        {
            return Err(ProtocolError::Validation(
                "stage timings must be finite and non-negative".into(),
            ));
        }
        if self.kind == StageKind::NumericCompute
            && self.effective_backend.is_gpu()
            && (self.device.is_none() || self.kernel_id.is_none() || self.gpu_time_ms.is_none())
        {
            return Err(ProtocolError::Validation(
                "GPU numeric stage requires device, kernel ID, and GPU timing".into(),
            ));
        }
        Ok(())
    }
}

fn validate_label(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > MAX_LABEL_BYTES {
        return Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={MAX_LABEL_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), ProtocolError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ProtocolError::Validation(
            "artifact SHA-256 must contain 64 hexadecimal characters".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_artifacts_outside_the_job_root() {
        let file = ArtifactFile {
            role: "resultPack".into(),
            relative_path: "../result.bin".into(),
            sha256: "a".repeat(64),
            byte_count: 10,
            media_type: "application/octet-stream".into(),
        };
        assert!(file.validate().is_err());
    }
}
