mod error;
mod job;
mod wire;
mod workflow;

pub use error::ProtocolError;
pub use job::{Backend, ExecutionPlan, JobState, OwnerSurface, PlannedStage, Precision, StageKind};
pub use wire::{decode_frame, encode_frame, read_frame, write_frame, MAX_CONTROL_FRAME_BYTES};
pub use workflow::{
    AnalysisFilter, BackendPolicy, ClusterV1Parameters, ClusterV1SubmitRequest, ColumnFilter,
    ColumnFilterKind, ComputeJobSchemaVersion, DescriptorFilter, ExecutionPolicy,
    FingerprintAlgorithm, FingerprintSettings, GridScope, GridSourceReference, GridTextQuery,
    RepresentativePolicy, ResourceLimits, SchedulingPolicy, SimilarityCutoff, SimilaritySettings,
    WorkflowTemplateId,
};

pub const COMPUTE_JOB_SCHEMA_V1: &str = "burrete.compute-job.v1";
pub const PROTOCOL_VERSION: u32 = 1;
