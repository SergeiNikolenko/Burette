pub(crate) struct MetalDistanceDispatch {
    pub(crate) atom_energies: Vec<f32>,
    pub(crate) gradients: Vec<[f32; 4]>,
    pub(crate) gpu_time_seconds: f64,
}

#[cfg(target_os = "macos")]
#[path = "platform/macos.rs"]
mod implementation;

#[cfg(not(target_os = "macos"))]
#[path = "platform/stub.rs"]
mod implementation;

pub(crate) use implementation::MetalHost;
