mod artifact;
mod capability;
mod error;
mod event;
mod job;
mod pack;
mod snapshot;
mod validation;
mod wire;
mod workflow;

pub use artifact::{
    ArtifactFile, ArtifactManifest, ArtifactManifestSchemaVersion, ResultPackVersion,
    StageProvenance,
};
pub use capability::{
    CapabilityEntry, CapabilityExpectation, CapabilityLimits, CapabilityMaturity, CapabilityReason,
    CapabilityReasonCode, CapabilityReportSchemaVersion, ComputeAvailability,
    ComputeCapabilityReport, GpuDeviceIdentity, PlatformIdentity, ProtocolRange, RuntimeIdentity,
};
pub use error::{ComputeErrorCode, ComputeFailure, ProtocolError};
pub use event::{ComputeJobEventSchemaVersion, JobRevisionEvent};
pub use job::{
    Backend, EngineIdentity, ExecutionPartition, ExecutionPlan, ExecutionPlanVersion,
    FallbackDecision, FallbackReasonCode, JobState, OwnerSurface, PlannedStage, Precision,
    StageKind, CLUSTER_STAGE_IDS,
};
pub use pack::{
    EnginePackManifest, EnginePackRef, EnginePackVersion, FrozenSourceIdentity,
    MolecularSnapshotManifest, MolecularSnapshotRef, MolecularSnapshotVersion,
    PackedArrayDescriptor, PackedByteOrder, PackedDType, PackedFileDescriptor, PackedLayout,
    ResultPackManifest, ResultPackRef, MAX_JSON_SAFE_INTEGER, MAX_PACK_ARRAYS, MAX_PACK_BYTES,
    MAX_PACK_FILES, MAX_PACK_RECORDS, MOLECULE_CONTENT_HASHES_ARRAY_NAME,
    MOLECULE_CONTENT_HASHES_SEMANTIC, SOURCE_RECORD_IDS_ARRAY_NAME, SOURCE_RECORD_IDS_SEMANTIC,
};
pub use snapshot::{
    AttemptSnapshot, AttemptState, ComputeJobSnapshotSchemaVersion, JobOutcomeSummary, JobProgress,
    JobSnapshot, StageSnapshot, StageState,
};
pub use wire::control::{
    ControlCommand, ControlErrorCode, ControlRequest, ControlResponse, ControlResult,
    JobCapabilityToken, SessionToken, WorkerCommand, WorkerControlRequest, WorkerControlResponse,
    WorkerResult,
};
pub use wire::{
    decode_frame, encode_frame, read_frame, write_frame, WireMessage, MAX_CONTROL_FRAME_BYTES,
};
pub use workflow::{
    AllGridScope, AnalysisFilter, BackendPolicy, ClusterV1Parameters, ClusterV1SubmitRequest,
    ColumnFilter, ColumnFilterKind, ComputeJobSchemaVersion, DescriptorFilter, ExecutionPolicy,
    FilteredGridScope, FingerprintAlgorithm, FingerprintInputOrder, FingerprintSettings, GridScope,
    GridSourceReference, GridTextQuery, RdkitBaselineVersion, RepresentativePolicy, ResourceLimits,
    SchedulingPolicy, SelectedGridScope, SimilarityCutoff, SimilaritySettings, WorkflowTemplateId,
};

pub const COMPUTE_JOB_SCHEMA_V1: &str = "burrete.compute-job.v1";
pub const COMPUTE_JOB_SNAPSHOT_SCHEMA_V1: &str = "burrete.compute-job-snapshot.v1";
pub const ARTIFACT_MANIFEST_SCHEMA_V1: &str = "burrete.compute-artifact-manifest.v1";
pub const CAPABILITY_REPORT_SCHEMA_V1: &str = "burrete.compute-capability-report.v1";
pub const PROTOCOL_VERSION: u32 = 1;
