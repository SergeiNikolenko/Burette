//! Verified native Metal runtime for Burrete compute workflows.

mod package;
mod platform;
mod runtime;

pub use package::{verify_runtime_package, MetalRuntimeError, VerifiedMetalPackage};
pub use runtime::{MetalGraphExecution, MetalTanimotoRuntime};

pub const NATIVE_METAL_RUNTIME_VERSION: &str = "burrete-native-metal-v1";
