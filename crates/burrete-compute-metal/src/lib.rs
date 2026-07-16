//! Verified native Metal runtime for Burrete compute workflows.

mod package;
mod platform;
mod runtime;

pub use package::{verify_runtime_package, MetalRuntimeError, VerifiedMetalPackage};
pub use runtime::{
    AlignmentPairDescriptor, MetalAlignmentBatch, MetalAlignmentExecution,
    MetalAlignmentPairResult, MetalComputeRuntime, MetalConformerInitialization,
    MetalDistanceEmbedding, MetalDistanceEvaluation, MetalDistanceOptimization,
    MetalEtkEvaluation, MetalGraphExecution, MetalMmffEvaluation, MetalMmffOptimization,
    MetalQueryExecution, MetalRm1FockContribution, MetalRm1PreparedPairs, MetalStereoValidation,
    MetalSymmetricEigen, MetalTanimotoRuntime,
};

pub const NATIVE_METAL_RUNTIME_VERSION: &str = "burrete-native-metal-v14";
