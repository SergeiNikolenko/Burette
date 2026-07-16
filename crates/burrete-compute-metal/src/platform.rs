#[cfg(target_os = "macos")]
#[path = "platform/macos.rs"]
mod implementation;

#[cfg(not(target_os = "macos"))]
#[path = "platform/stub.rs"]
mod implementation;

pub(crate) use implementation::MetalHost;
