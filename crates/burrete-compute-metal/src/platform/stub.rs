use burrete_compute_core::{
    ChiralVolumeConstraint, DistanceConstraint, DistanceGeometryOptimizationOptions,
    EtkDistanceConstraint, EtkGeometryTerms, EtkImproperConstraint, EtkTorsionConstraint,
    Fingerprint2048, GraphBuildOptions, MmffParameters, SymmetricCsr, TanimotoCounts,
    TanimotoQueryOptions, TetrahedralConstraint,
};
use burrete_compute_protocol::{GpuDeviceIdentity, SimilarityCutoff};

use crate::platform::{
    MetalDistanceDispatch, MetalDistanceOptimizationDispatch, MetalEtkDispatch, MetalMmffDispatch,
    MetalMmffOptimizationDispatch, MetalStereoValidationDispatch,
};
use crate::MetalRuntimeError;

#[derive(Debug)]
pub(crate) struct MetalHost;

impl MetalHost {
    pub(crate) fn load(_library: &[u8]) -> Result<Self, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn device_identity(&self) -> GpuDeviceIdentity {
        unreachable!("unavailable Metal host has no device")
    }

    pub(crate) fn recommended_max_working_set_size(&self) -> u64 {
        0
    }

    pub(crate) fn build_graph(
        &self,
        _fingerprints: &[Fingerprint2048],
        _cutoff: SimilarityCutoff,
        _options: GraphBuildOptions,
    ) -> Result<SymmetricCsr, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn build_graph_profiled(
        &self,
        _fingerprints: &[Fingerprint2048],
        _cutoff: SimilarityCutoff,
        _options: GraphBuildOptions,
    ) -> Result<(SymmetricCsr, f64), MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn score_query(
        &self,
        _query: &Fingerprint2048,
        _fingerprints: &[Fingerprint2048],
        _options: TanimotoQueryOptions,
    ) -> Result<Vec<TanimotoCounts>, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn score_query_profiled(
        &self,
        _query: &Fingerprint2048,
        _fingerprints: &[Fingerprint2048],
        _options: TanimotoQueryOptions,
    ) -> Result<(Vec<TanimotoCounts>, f64), MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn initialize_conformers_profiled(
        &self,
        _seed_words: &[[u32; 4]],
        _atom_count: u32,
        _max_memory_bytes: u64,
    ) -> Result<(Vec<[f32; 4]>, f64), MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn evaluate_distance_constraints_profiled(
        &self,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _constraints: &[DistanceConstraint],
        _max_memory_bytes: u64,
    ) -> Result<MetalDistanceDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn optimize_distance_geometry_profiled(
        &self,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _constraints: &[DistanceConstraint],
        _options: DistanceGeometryOptimizationOptions,
        _max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimizationDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn validate_stereo_profiled(
        &self,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _chiral: &[ChiralVolumeConstraint],
        _tetrahedral: &[TetrahedralConstraint],
        _max_memory_bytes: u64,
    ) -> Result<MetalStereoValidationDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn evaluate_etk_profiled(
        &self,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _torsions: &[EtkTorsionConstraint],
        _impropers: &[EtkImproperConstraint],
        _distances: &[EtkDistanceConstraint],
        _max_memory_bytes: u64,
    ) -> Result<MetalEtkDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn optimize_etk_profiled(
        &self,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _terms: EtkGeometryTerms<'_>,
        _options: DistanceGeometryOptimizationOptions,
        _max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimizationDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn evaluate_mmff_profiled(
        &self,
        _positions: &[[f32; 4]],
        _parameters: &MmffParameters,
        _max_memory_bytes: u64,
    ) -> Result<MetalMmffDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }

    pub(crate) fn optimize_mmff_profiled(
        &self,
        _positions: &[[f32; 4]],
        _parameters: &MmffParameters,
        _options: DistanceGeometryOptimizationOptions,
        _max_memory_bytes: u64,
    ) -> Result<MetalMmffOptimizationDispatch, MetalRuntimeError> {
        Err(MetalRuntimeError::UnsupportedPlatform(
            "native Metal compute requires macOS on Apple Silicon".into(),
        ))
    }
}
