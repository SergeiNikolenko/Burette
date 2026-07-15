mod artifact;
mod capability;
mod error;
mod job;
mod snapshot;
mod validation;
mod wire;
mod workflow;

pub use artifact::{
    ArtifactFile, ArtifactManifest, ArtifactManifestSchemaVersion, ResultPackVersion,
    StageProvenance,
};
pub use capability::{
    CapabilityEntry, CapabilityExpectation, CapabilityLimits, CapabilityMaturity,
    CapabilityReason, CapabilityReasonCode, CapabilityReportSchemaVersion, ComputeAvailability,
    ComputeCapabilityReport, GpuDeviceIdentity, PlatformIdentity, ProtocolRange, RuntimeIdentity,
};
pub use error::{ComputeErrorCode, ComputeFailure, ProtocolError};
pub use job::{Backend, ExecutionPlan, JobState, OwnerSurface, PlannedStage, Precision, StageKind};
pub use snapshot::{
    AttemptSnapshot, AttemptState, ComputeJobSnapshotSchemaVersion, JobProgress, JobSnapshot,
    StageSnapshot, StageState,
};
pub use wire::{decode_frame, encode_frame, read_frame, write_frame, MAX_CONTROL_FRAME_BYTES};
pub use workflow::{
    AllGridScope, AnalysisFilter, BackendPolicy, ClusterV1Parameters, ClusterV1SubmitRequest,
    ColumnFilter, ColumnFilterKind, ComputeJobSchemaVersion, DescriptorFilter, ExecutionPolicy,
    FilteredGridScope, FingerprintAlgorithm, FingerprintInputOrder, FingerprintSettings, GridScope,
    GridSourceReference, GridTextQuery, RdkitBaselineVersion, RepresentativePolicy,
    ResourceLimits, SchedulingPolicy, SelectedGridScope, SimilarityCutoff, SimilaritySettings,
    WorkflowTemplateId,
};

pub const COMPUTE_JOB_SCHEMA_V1: &str = "burrete.compute-job.v1";
pub const COMPUTE_JOB_SNAPSHOT_SCHEMA_V1: &str = "burrete.compute-job-snapshot.v1";
pub const ARTIFACT_MANIFEST_SCHEMA_V1: &str = "burrete.compute-artifact-manifest.v1";
pub const CAPABILITY_REPORT_SCHEMA_V1: &str = "burrete.compute-capability-report.v1";
pub const PROTOCOL_VERSION: u32 = 1;
