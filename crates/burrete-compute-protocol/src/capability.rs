use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{
    validation::{validate_bounded_text, validate_json_safe_u64, validate_lower_sha256},
    Backend, Precision, ProtocolError, WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES,
    PROTOCOL_VERSION,
};

const MAX_CAPABILITIES: usize = 256;
const MAX_REASONS: usize = 64;
const MAX_ID_BYTES: usize = 160;
const MAX_MESSAGE_BYTES: usize = 2_048;
const MAX_EDGE_BUDGET: u64 = 500_000_000;
const MIN_MEMORY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MEMORY_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const MAX_DISPATCH_MS: u32 = 2_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CapabilityReportSchemaVersion {
    #[serde(rename = "burrete.compute-capability-report.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
        if self.report_revision == 0 {
            return Err(ProtocolError::Validation(
                "capability report revision must be positive".into(),
            ));
        }
        validate_json_safe_u64("capability report revision", self.report_revision)?;
        validate_json_safe_u64("capability generatedAtMs", self.generated_at_ms)?;
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
        let available_count = self
            .capabilities
            .iter()
            .filter(|capability| capability.available)
            .count();
        match self.availability {
            ComputeAvailability::Available => {
                if self.runtime.is_none()
                    || self.device.is_none()
                    || self.capabilities.is_empty()
                    || available_count != self.capabilities.len()
                    || !self.reasons.is_empty()
                {
                    return Err(ProtocolError::Validation(
                        "available compute requires runtime, device, and only available capabilities"
                            .into(),
                    ));
                }
            }
            ComputeAvailability::Degraded => {
                if self.runtime.is_none()
                    || available_count == 0
                    || available_count == self.capabilities.len()
                    || self.reasons.is_empty()
                {
                    return Err(ProtocolError::Validation(
                        "degraded compute requires a runtime plus mixed capability results and reasons"
                            .into(),
                    ));
                }
            }
            ComputeAvailability::Unavailable => {
                if available_count != 0 || self.reasons.is_empty() {
                    return Err(ProtocolError::Validation(
                        "unavailable compute cannot advertise available capabilities and requires a reason"
                            .into(),
                    ));
                }
            }
        }
        if let Some(runtime) = &self.runtime {
            runtime.validate()?;
        }
        if let Some(device) = &self.device {
            device.validate()?;
        }
        let mut capability_keys = BTreeSet::new();
        let reason_codes: BTreeSet<_> = self.reasons.iter().map(|reason| reason.code).collect();
        for capability in &self.capabilities {
            capability.validate()?;
            let key = format!(
                "{:?}|{}|{}|{:?}|{:?}",
                capability.workflow_template,
                capability.method,
                capability.chemistry_domain,
                capability.backend,
                capability.precision
            );
            if !capability_keys.insert(key) {
                return Err(ProtocolError::Validation(
                    "capability report contains duplicate capability claims".into(),
                ));
            }
            if capability
                .reason_code
                .is_some_and(|code| !reason_codes.contains(&code))
            {
                return Err(ProtocolError::Validation(
                    "capability reasonCode is missing from the report reasons".into(),
                ));
            }
        }
        let mut seen_reason_codes = BTreeSet::new();
        for reason in &self.reasons {
            validate_bounded_text("capability reason", &reason.message, MAX_MESSAGE_BYTES)?;
            if !seen_reason_codes.insert(reason.code) {
                return Err(ProtocolError::Validation(
                    "capability report contains duplicate reason codes".into(),
                ));
            }
        }
        self.limits
            .validate_for_availability(self.availability)?;
        if self.limits.max_control_frame_bytes != MAX_CONTROL_FRAME_BYTES as u64 {
            return Err(ProtocolError::Validation(
                "capability frame limit differs from the negotiated protocol".into(),
            ));
        }
        Ok(())
    }

    /// Verifies untrusted helper claims against coordinator-owned identities.
    pub fn verify_against(
        &self,
        expected: &CapabilityExpectation,
    ) -> Result<(), ProtocolError> {
        self.validate()?;
        expected.validate()?;
        if self.platform.architecture != expected.architecture
            || self.platform.os_name != expected.os_name
        {
            return Err(ProtocolError::Validation(
                "compute helper platform differs from the trusted runtime expectation".into(),
            ));
        }
        if self
            .runtime
            .as_ref()
            .is_some_and(|runtime| runtime != &expected.runtime)
        {
            return Err(ProtocolError::Validation(
                "compute helper runtime identity differs from the trusted manifest".into(),
            ));
        }
        if self.limits.max_control_frame_bytes != expected.maximum_limits.max_control_frame_bytes
            || self.limits.max_edges > expected.maximum_limits.max_edges
            || self.limits.max_memory_bytes > expected.maximum_limits.max_memory_bytes
            || self.limits.max_dispatch_ms > expected.maximum_limits.max_dispatch_ms
        {
            return Err(ProtocolError::Validation(
                "compute helper advertised limits above the coordinator-owned maximum".into(),
            ));
        }
        if self.capabilities.iter().any(|capability| {
            capability.available && capability.backend.is_gpu()
        }) && self.device.is_none()
        {
            return Err(ProtocolError::Validation(
                "available GPU capability requires an observed GPU device".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilityExpectation {
    pub architecture: String,
    pub os_name: String,
    pub runtime: RuntimeIdentity,
    pub maximum_limits: CapabilityLimits,
}

impl CapabilityExpectation {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("expected architecture", &self.architecture, MAX_ID_BYTES)?;
        validate_bounded_text("expected OS name", &self.os_name, MAX_ID_BYTES)?;
        self.runtime.validate()?;
        self.maximum_limits
            .validate_for_availability(ComputeAvailability::Available)
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformIdentity {
    pub architecture: String,
    pub os_name: String,
    pub os_version: String,
}

impl PlatformIdentity {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("architecture", &self.architecture, MAX_ID_BYTES)?;
        validate_bounded_text("OS name", &self.os_name, MAX_ID_BYTES)?;
        validate_bounded_text("OS version", &self.os_version, MAX_ID_BYTES)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeIdentity {
    pub version: String,
    pub manifest_sha256: String,
    pub helper_sha256: String,
    pub metallib_sha256: String,
}

impl RuntimeIdentity {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("runtime version", &self.version, MAX_ID_BYTES)?;
        for (label, hash) in [
            ("runtime manifest", &self.manifest_sha256),
            ("compute helper", &self.helper_sha256),
            ("Metal library", &self.metallib_sha256),
        ] {
            validate_lower_sha256(label, hash)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GpuDeviceIdentity {
    pub name: String,
    pub registry_id: Option<String>,
    pub low_power: bool,
    pub unified_memory: bool,
}

impl GpuDeviceIdentity {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("GPU device name", &self.name, MAX_ID_BYTES)?;
        if self.registry_id.as_deref().is_some_and(|value| {
            !value.starts_with("0x")
                || value.len() <= 2
                || value.len() > 18
                || !value[2..]
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }) {
            return Err(ProtocolError::Validation(
                "GPU registryId must be a lowercase 0x-prefixed 64-bit hexadecimal string".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("capability method", &self.method, MAX_ID_BYTES)?;
        validate_bounded_text(
            "capability chemistry domain",
            &self.chemistry_domain,
            MAX_ID_BYTES,
        )?;
        if self.available && self.maturity == CapabilityMaturity::Unsupported {
            return Err(ProtocolError::Validation(
                "an unsupported capability cannot be available".into(),
            ));
        }
        if self.available == self.reason_code.is_some() {
            return Err(ProtocolError::Validation(
                "available capability forbids reasonCode; unavailable capability requires one"
                    .into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityMaturity {
    Experimental,
    NumericallyValidated,
    ChemicallyValidated,
    Production,
    Unsupported,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityLimits {
    pub max_control_frame_bytes: u64,
    pub max_edges: u64,
    pub max_memory_bytes: u64,
    pub max_dispatch_ms: u32,
}

impl CapabilityLimits {
    pub fn validate_for_availability(
        &self,
        availability: ComputeAvailability,
    ) -> Result<(), ProtocolError> {
        for (label, value) in [
            ("maxControlFrameBytes", self.max_control_frame_bytes),
            ("maxEdges", self.max_edges),
            ("maxMemoryBytes", self.max_memory_bytes),
        ] {
            validate_json_safe_u64(label, value)?;
        }
        if availability == ComputeAvailability::Unavailable {
            if self.max_edges != 0 || self.max_memory_bytes != 0 || self.max_dispatch_ms != 0 {
                return Err(ProtocolError::Validation(
                    "unavailable compute must advertise zero execution limits".into(),
                ));
            }
        } else if self.max_edges == 0
            || self.max_edges > MAX_EDGE_BUDGET
            || !(MIN_MEMORY_BYTES..=MAX_MEMORY_BYTES).contains(&self.max_memory_bytes)
            || self.max_dispatch_ms == 0
            || self.max_dispatch_ms > MAX_DISPATCH_MS
        {
            return Err(ProtocolError::Validation(
                "available compute limits exceed the cluster.v1 hard bounds".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityReason {
    pub code: CapabilityReasonCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum CapabilityReasonCode {
    UnsupportedArchitecture,
    UnsupportedOperatingSystem,
    MetalUnavailable,
    RuntimeMissing,
    RuntimeIntegrityError,
    ProtocolMismatch,
    KernelUnavailable,
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
