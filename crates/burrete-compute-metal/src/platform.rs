pub(crate) struct MetalDistanceDispatch {
    pub(crate) atom_energies: Vec<f32>,
    pub(crate) gradients: Vec<[f32; 4]>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalDistanceOptimizationDispatch {
    pub(crate) positions: Vec<[f32; 4]>,
    pub(crate) energies: Vec<f32>,
    pub(crate) scaled_gradient_maxima: Vec<f32>,
    pub(crate) iterations: Vec<u32>,
    pub(crate) statuses: Vec<u32>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalStereoValidationDispatch {
    pub(crate) failure_flags: Vec<u32>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalEtkDispatch {
    pub(crate) atom_energies: Vec<f32>,
    pub(crate) gradients: Vec<[f32; 4]>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalMmffDispatch {
    pub(crate) breakdown_vectors: Vec<[f32; 4]>,
    pub(crate) gradients: Vec<[f32; 4]>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalMmffOptimizationDispatch {
    pub(crate) positions: Vec<[f32; 4]>,
    pub(crate) energies: Vec<f32>,
    pub(crate) scaled_gradient_maxima: Vec<f32>,
    pub(crate) iterations: Vec<u32>,
    pub(crate) statuses: Vec<u32>,
    pub(crate) optimizers: Vec<u32>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalAlignmentDispatch {
    pub(crate) transforms: Vec<[[f32; 4]; 4]>,
    pub(crate) primary_scores: Vec<[f32; 4]>,
    pub(crate) secondary_scores: Vec<[f32; 4]>,
    pub(crate) statuses: Vec<u32>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalRm1FockDispatch {
    pub(crate) contribution_ev: Vec<f32>,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalSymmetricEigenDispatch {
    pub(crate) eigenvalues: Vec<f32>,
    pub(crate) eigenvectors: Vec<f32>,
    pub(crate) status: u32,
    pub(crate) gpu_time_seconds: f64,
}

pub(crate) struct MetalRm1PairRotationDispatch {
    pub(crate) repulsion_ev: Vec<f32>,
    pub(crate) left_core_attraction_ev: Vec<f32>,
    pub(crate) right_core_attraction_ev: Vec<f32>,
    pub(crate) gpu_time_seconds: f64,
}

#[cfg(target_os = "macos")]
#[path = "platform/macos.rs"]
mod implementation;

#[cfg(not(target_os = "macos"))]
#[path = "platform/stub.rs"]
mod implementation;

pub(crate) use implementation::MetalHost;
