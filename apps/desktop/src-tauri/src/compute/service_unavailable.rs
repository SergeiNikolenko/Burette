//! The out-of-process Metal compute service on platforms without it.
//!
//! The service passes exchange files between processes over a Unix socket
//! (`SCM_RIGHTS`) and only exists to host Metal kernels, so Windows builds
//! never launch it. This module keeps the client's API so callers compile
//! unchanged; the client cannot be constructed and every workflow takes its
//! in-process CPU path.

use std::path::Path;

use burette_compute_core::{
    ChiralVolumeConstraint, DistanceConstraint, DistanceGeometryOptimizationOptions,
    EtkGeometryTerms, Fingerprint2048, GraphBuildOptions, MmffParameters, Rm1Evaluation,
    SemiempiricalMolecule, SymmetricCsr, TetrahedralConstraint,
};
use burette_compute_metal::{
    MetalAlignmentBatch, MetalAlignmentExecution, MetalDistanceEmbedding,
    MetalDistanceOptimization, MetalMmffOptimization, MetalStereoValidation,
};
use burette_compute_protocol::{ComputeCapabilityReport, SimilarityCutoff};
use uuid::Uuid;

const UNAVAILABLE: &str = "The native compute service is only available on macOS.";

#[derive(Debug)]
pub(crate) enum ComputeServiceClient {}

#[allow(clippy::too_many_arguments)]
impl ComputeServiceClient {
    pub(crate) fn launch(_executable: &Path, _runtime_root: &Path) -> Result<Self, String> {
        Err(UNAVAILABLE.into())
    }

    pub(crate) fn capabilities(&self) -> Result<ComputeCapabilityReport, String> {
        match *self {}
    }

    pub(crate) fn build_tanimoto_graph(
        &self,
        _job_id: Uuid,
        _fingerprints: &[Fingerprint2048],
        _cutoff: SimilarityCutoff,
        _options: GraphBuildOptions,
    ) -> Result<(SymmetricCsr, u64), String> {
        match *self {}
    }

    pub(crate) fn align_and_score(
        &self,
        _job_id: Uuid,
        _batch: MetalAlignmentBatch<'_>,
        _max_memory_bytes: u64,
        _before_dispatch: &dyn Fn() -> Result<(), String>,
    ) -> Result<MetalAlignmentExecution, String> {
        match *self {}
    }

    pub(crate) fn evaluate_semiempirical(
        &self,
        _job_id: Uuid,
        _molecule: &SemiempiricalMolecule,
        _max_memory_bytes: u64,
        _before_dispatch: &dyn Fn() -> Result<(), String>,
    ) -> Result<(Rm1Evaluation, u64), String> {
        match *self {}
    }

    pub(crate) fn optimize_mmff(
        &self,
        _job_id: Uuid,
        _positions: &[[f32; 4]],
        _parameters: &MmffParameters,
        _options: DistanceGeometryOptimizationOptions,
        _max_memory_bytes: u64,
    ) -> Result<MetalMmffOptimization, String> {
        match *self {}
    }

    pub(crate) fn embed_distance_bounds(
        &self,
        _job_id: Uuid,
        _seeds: &[[u32; 4]],
        _atom_count: u32,
        _constraints: &[DistanceConstraint],
        _options: DistanceGeometryOptimizationOptions,
        _max_memory_bytes: u64,
    ) -> Result<MetalDistanceEmbedding, String> {
        match *self {}
    }

    pub(crate) fn optimize_etk(
        &self,
        _job_id: Uuid,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _terms: EtkGeometryTerms<'_>,
        _options: DistanceGeometryOptimizationOptions,
        _max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimization, String> {
        match *self {}
    }

    pub(crate) fn validate_stereo(
        &self,
        _job_id: Uuid,
        _positions: &[[f32; 4]],
        _atom_count: u32,
        _chiral: &[ChiralVolumeConstraint],
        _tetrahedral: &[TetrahedralConstraint],
        _max_memory_bytes: u64,
    ) -> Result<MetalStereoValidation, String> {
        match *self {}
    }
}

pub fn run_compute_service() -> Result<(), String> {
    Err(UNAVAILABLE.into())
}
