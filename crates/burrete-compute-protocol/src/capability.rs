use serde::{Deserialize, Serialize};

use crate::{
    Backend, Precision, ProtocolError, WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES,
    PROTOCOL_VERSION,
};

const MAX_CAPABILITIES: usize = 256;
const MAX_REASONS: usize = 64;
const MAX_ID_BYTES: usize = 160;
const MAX_MESSAGE_BYTES: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CapabilityReportSchemaVersion {
    #[serde(rename = "burrete.compute-capability-report.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeCapabilityReport {
    pub schema_version: CapabilityReportSchemaVersion,
    pub report_revision: u64,
    pub protocol: ProtocolRange,
    pub availability: ComputeAvailability,
    pub platform: PlatformIdentity,
    pub runtime: Option<RuntimeIdentity>,
    pub device: Option<GpuDeviceIdentity>,
    pub capabilities: Vec<CapabilityEntry>,
    pub limits: CapabilityLimits,
    pub reasons: Vec<CapabilityReason>,
    pub generated_at_ms: u64,
}

impl ComputeCapabilityReport {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.protocol.validate()?;
        self.platform.validate()?;
        if self.capabilities.len() > MAX_CAPABILITIES {
            return Err(ProtocolError::Validation(format!(
                "capability report has too many entries: {}",
                self.capabilities.len()
            )));
        }
        if self.reasons.len() > MAX_REASONS {
            return Err(ProtocolError::Validation(format!(
                "capability report has too many reasons: {}",
                self.reasons.len()
            )));
        }
        if self.availability == ComputeAvailability::Available
            && (self.runtime.is_none() || self.device.is_none())
        {
            return Err(ProtocolError::Validation(
                "available compute requires runtime and device identities".into(),
            ));
        }
        if let Some(runtime) = &self.runtime {
            runtime.validate()?;
        }
        if let Some(device) = &self.device {
            device.validate()?;
        }
        for capability in &self.capabilities {
            capability.validate()?;
        }
        for reason in &self.reasons {
            validate_text("capability reason", &reason.message, MAX_MESSAGE_BYTES)?;
        }
        if self.limits.max_control_frame_bytes as usize != MAX_CONTROL_FRAME_BYTES {
            return Err(ProtocolError::Validation(
                "capability frame limit differs from the negotiated protocol".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ComputeAvailability {
    Available,
    Degraded,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolRange {
    pub min: u32,
    pub max: u32,
}

impl ProtocolRange {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.min == 0
            || self.min > self.max
            || !(self.min..=self.max).contains(&PROTOCOL_VERSION)
        {
            return Err(ProtocolError::Validation(format!(
                "protocol range {}..={} does not include {}",
                self.min, self.max, PROTOCOL_VERSION
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformIdentity {
    pub architecture: String,
    pub os_name: String,
    pub os_version: String,
}

impl PlatformIdentity {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_text("architecture", &self.architecture, MAX_ID_BYTES)?;
        validate_text("OS name", &self.os_name, MAX_ID_BYTES)?;
        validate_text("OS version", &self.os_version, MAX_ID_BYTES)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    pub version: String,
    pub manifest_sha256: String,
    pub helper_sha256: String,
    pub metallib_sha256: String,
}

impl RuntimeIdentity {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_text("runtime version", &self.version, MAX_ID_BYTES)?;
        for (label, hash) in [
            ("runtime manifest", &self.manifest_sha256),
            ("compute helper", &self.helper_sha256),
            ("Metal library", &self.metallib_sha256),
        ] {
            validate_sha256(label, hash)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuDeviceIdentity {
    pub name: String,
    pub registry_id: Option<u64>,
    pub low_power: bool,
    pub unified_memory: bool,
}

impl GpuDeviceIdentity {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_text("GPU device name", &self.name, MAX_ID_BYTES)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEntry {
    pub workflow_template: WorkflowTemplateId,
    pub method: String,
    pub chemistry_domain: String,
    pub backend: Backend,
    pub precision: Precision,
    pub maturity: CapabilityMaturity,
    pub available: bool,
    pub reason_code: Option<CapabilityReasonCode>,
}

impl CapabilityEntry {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_text("capability method", &self.method, MAX_ID_BYTES)?;
        validate_text(
            "capability chemistry domain",
            &self.chemistry_domain,
            MAX_ID_BYTES,
        )?;
        if self.available && self.maturity == CapabilityMaturity::Unsupported {
            return Err(ProtocolError::Validation(
                "an unsupported capability cannot be available".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityMaturity {
    Experimental,
    NumericallyValidated,
    ChemicallyValidated,
    Production,
    Unsupported,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityLimits {
    pub max_control_frame_bytes: u64,
    pub max_edges: u64,
    pub max_memory_bytes: u64,
    pub max_dispatch_ms: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReason {
    pub code: CapabilityReasonCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityReasonCode {
    UnsupportedArchitecture,
    UnsupportedOperatingSystem,
    MetalUnavailable,
    RuntimeMissing,
    RuntimeIntegrityError,
    ProtocolMismatch,
    KernelUnavailable,
}

fn validate_text(label: &str, value: &str, max: usize) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > max {
        return Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={max} bytes"
        )));
    }
    Ok(())
}

fn validate_sha256(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ProtocolError::Validation(format!(
            "{label} SHA-256 must contain 64 hexadecimal characters"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_report_does_not_invent_a_runtime_or_device() {
        let report = ComputeCapabilityReport {
            schema_version: CapabilityReportSchemaVersion::V1,
            report_revision: 1,
            protocol: ProtocolRange { min: 1, max: 1 },
            availability: ComputeAvailability::Unavailable,
            platform: PlatformIdentity {
                architecture: "x86_64".into(),
                os_name: "macOS".into(),
                os_version: "13.6".into(),
            },
            runtime: None,
            device: None,
            capabilities: Vec::new(),
            limits: CapabilityLimits {
                max_control_frame_bytes: MAX_CONTROL_FRAME_BYTES as u64,
                max_edges: 0,
                max_memory_bytes: 0,
                max_dispatch_ms: 0,
            },
            reasons: vec![CapabilityReason {
                code: CapabilityReasonCode::UnsupportedArchitecture,
                message: "GPU compute requires native Apple Silicon.".into(),
            }],
            generated_at_ms: 1,
        };
        assert_eq!(report.validate(), Ok(()));
    }
}
