use std::{fmt, num::NonZeroU32};

use burrete_compute_core::{
    plan_conformer_batches, ConformerEnginePackArrays, ConformerMoleculeWork,
    ConformerSchedulingOptions,
};
use burrete_compute_protocol::{
    Backend, BackendPolicy, ConformerV1SubmitRequest, EngineIdentity, ExecutionPartition,
    ExecutionPlan, ExecutionPlanVersion, FallbackDecision, GridScope, PlannedStage, Precision,
    ProtocolError, StageKind, WorkflowTemplateId, MAX_PACK_BYTES, MAX_PACK_RECORDS,
};

use super::cluster_plan::ClusterV1EngineIdentities;

const MEMORY_HEADROOM_BYTES: u64 = 64 * 1024;
const SOURCE_INDEX_BYTES: u64 = 8;
const MOLECULE_HASH_BYTES: u64 = 32;
const ATOMIC_NUMBER_BYTES: u64 = 2;
const FORMAL_CHARGE_BYTES: u64 = 1;
const RECORD_VALIDITY_BYTES: u64 = 1;
const TERM_START_BYTES: u64 = 8;
const DISTANCE_CONSTRAINT_BYTES: u64 = 20;
const POSITION_COMPONENTS: u64 = 3;
const F32_BYTES: u64 = 4;
const CONFORMER_ATOM_START_BYTES: u64 = 8;
const MOLECULE_INDEX_BYTES: u64 = 4;
const CONFORMER_ORDINAL_BYTES: u64 = 4;
const ATTEMPT_COUNT_BYTES: u64 = 2;
const ENERGY_BYTES: u64 = 4;
const STATUS_BYTES: u64 = 1;
const SEED_BYTES: u64 = 16;
const MAX_FALLBACK_REASON_BYTES: usize = 2_048;
const LBFGS_HISTORY_SIZE: u32 = 8;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ConformerV1AdmissionError {
    Contract(String),
    ArithmeticOverflow(&'static str),
    BackendPolicyMismatch(String),
    GpuRequiredUnavailable {
        stage_id: &'static str,
        reason: String,
    },
    MemoryLimitExceeded {
        stage_id: &'static str,
        required_bytes: u64,
        limit_bytes: u64,
    },
}

impl fmt::Display for ConformerV1AdmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Contract(message) | Self::BackendPolicyMismatch(message) => {
                formatter.write_str(message)
            }
            Self::ArithmeticOverflow(quantity) => {
                write!(formatter, "conformer.v1 {quantity} overflowed")
            }
            Self::GpuRequiredUnavailable { stage_id, reason } => write!(
                formatter,
                "gpuRequired conformer.v1 stage {stage_id} admission failed: {reason}"
            ),
            Self::MemoryLimitExceeded {
                stage_id,
                required_bytes,
                limit_bytes,
            } => write!(
                formatter,
                "conformer.v1 stage {stage_id} requires {required_bytes} accounted bytes; maxMemoryBytes is {limit_bytes}"
            ),
        }
    }
}

impl std::error::Error for ConformerV1AdmissionError {}

impl From<ProtocolError> for ConformerV1AdmissionError {
    fn from(error: ProtocolError) -> Self {
        Self::Contract(error.to_string())
    }
}

/// Exact bounded shape emitted by the chemistry-semantics preflight.
///
/// The planner never estimates molecular topology from the source row count.
/// These values must come from the same verified extraction that will publish
/// the EnginePack, and `numeric_peak_bytes` must include every simultaneously
/// resident input, output, and scratch buffer for one adaptive batch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConformerV1Preflight {
    pub(crate) record_count: u64,
    pub(crate) ordered_record_molecule_identity_sha256: String,
    pub(crate) valid_record_count: u64,
    pub(crate) total_atom_count: u64,
    pub(crate) total_distance_constraint_count: u64,
    pub(crate) engine_pack_bytes: u64,
    pub(crate) result_pack_bytes: u64,
    pub(crate) numeric_peak_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConformerMoleculeIdentity {
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
}

pub(crate) fn derive_conformer_v1_preflight(
    request: &ConformerV1SubmitRequest,
    arrays: &ConformerEnginePackArrays,
    identities: &[ConformerMoleculeIdentity],
    ordered_record_molecule_identity_sha256: String,
) -> Result<ConformerV1Preflight, ConformerV1AdmissionError> {
    request.validate()?;
    let record_count = arrays.record_count() as u64;
    if identities.len() != arrays.record_count()
        || arrays.molecule_atom_starts.len() != arrays.record_count() + 1
        || arrays.distance_term_starts.len() != arrays.record_count() + 1
    {
        return Err(ConformerV1AdmissionError::Contract(
            "conformer extraction identity or offset count differs from its records".into(),
        ));
    }
    let engine_pack_bytes = arrays
        .payload_bytes()
        .map_err(|error| ConformerV1AdmissionError::Contract(error.to_string()))?;
    let conformers_per_molecule = NonZeroU32::new(request.parameters.conformers_per_molecule)
        .ok_or_else(|| {
            ConformerV1AdmissionError::Contract("conformer count must be nonzero".into())
        })?;
    let mut molecules = Vec::new();
    molecules
        .try_reserve_exact(arrays.record_count())
        .map_err(|_| {
            ConformerV1AdmissionError::Contract("cannot allocate conformer plan".into())
        })?;
    for (record, identity) in identities.iter().enumerate() {
        let atom_start = arrays.molecule_atom_starts[record];
        let atom_end = arrays.molecule_atom_starts[record + 1];
        if atom_end < atom_start {
            return Err(ConformerV1AdmissionError::Contract(
                "conformer molecule atom offsets are not monotonic".into(),
            ));
        }
        if !arrays.record_validity[record] {
            if atom_start != atom_end {
                return Err(ConformerV1AdmissionError::Contract(
                    "invalid conformer record owns atom payload".into(),
                ));
            }
            continue;
        }
        let atom_count = u32::try_from(atom_end - atom_start)
            .ok()
            .and_then(NonZeroU32::new)
            .ok_or_else(|| {
                ConformerV1AdmissionError::Contract(
                    "valid conformer molecule has an invalid atom count".into(),
                )
            })?;
        molecules.push(ConformerMoleculeWork {
            source_record_id: identity.source_record_id,
            molecule_content_sha256: decode_sha256(&identity.molecule_content_sha256)?,
            atom_count,
            conformer_count: conformers_per_molecule,
        });
    }
    let valid_record_count = molecules.len() as u64;
    let total_atom_count = arrays.atomic_numbers.len() as u64;
    let total_distance_constraint_count = arrays.distance_atom_pairs.len() as u64;
    let conformer_count = multiply(
        valid_record_count,
        u64::from(conformers_per_molecule.get()),
        "conformer count",
    )?;
    let positioned_atoms = multiply(
        total_atom_count,
        u64::from(conformers_per_molecule.get()),
        "positioned atom count",
    )?;
    let result_pack_bytes = result_pack_payload_bytes(positioned_atoms, conformer_count)?;
    let schedule = plan_conformer_batches(
        &molecules,
        ConformerSchedulingOptions {
            max_memory_bytes: request.limits.max_memory_bytes,
            resident_engine_bytes: engine_pack_bytes,
            max_conformers_per_batch: NonZeroU32::new(request.limits.max_conformers_per_batch)
                .expect("validated nonzero batch limit"),
            lbfgs_history: NonZeroU32::new(LBFGS_HISTORY_SIZE).expect("nonzero history"),
        },
    )
    .map_err(|error| ConformerV1AdmissionError::Contract(error.to_string()))?;
    Ok(ConformerV1Preflight {
        record_count,
        ordered_record_molecule_identity_sha256,
        valid_record_count,
        total_atom_count,
        total_distance_constraint_count,
        engine_pack_bytes,
        result_pack_bytes,
        numeric_peak_bytes: schedule.planned_peak_bytes,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ConformerBackendAdmission {
    NativeMetal(EngineIdentity),
    GpuUnavailable(FallbackDecision),
    ReferenceCpu,
}

impl ConformerBackendAdmission {
    fn label(&self) -> &'static str {
        match self {
            Self::NativeMetal(_) => "nativeMetal",
            Self::GpuUnavailable(_) => "gpuUnavailable",
            Self::ReferenceCpu => "referenceCpu",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ConformerV1MemoryEstimate {
    pub(crate) freeze_scope_bytes: u64,
    pub(crate) conformer_constraints_bytes: u64,
    pub(crate) distance_geometry_bytes: u64,
    pub(crate) stereo_validation_bytes: u64,
    pub(crate) validate_results_bytes: u64,
    pub(crate) publish_results_bytes: u64,
}

impl ConformerV1MemoryEstimate {
    fn stage_bytes(self) -> [(&'static str, u64); 6] {
        [
            ("freezeScope", self.freeze_scope_bytes),
            ("conformerConstraints", self.conformer_constraints_bytes),
            ("distanceGeometry", self.distance_geometry_bytes),
            ("stereoValidation", self.stereo_validation_bytes),
            ("validateResults", self.validate_results_bytes),
            ("publishResults", self.publish_results_bytes),
        ]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AdmittedConformerV1Plan {
    pub(crate) plan: ExecutionPlan,
    pub(crate) memory: ConformerV1MemoryEstimate,
}

pub(crate) fn admit_conformer_v1_plan(
    request: &ConformerV1SubmitRequest,
    frozen_record_count: u64,
    frozen_molecule_identity_sha256: &str,
    preflight: &ConformerV1Preflight,
    engines: &ClusterV1EngineIdentities,
    distance_admission: ConformerBackendAdmission,
    stereo_admission: ConformerBackendAdmission,
) -> Result<AdmittedConformerV1Plan, ConformerV1AdmissionError> {
    request.validate()?;
    validate_preflight(
        request,
        frozen_record_count,
        frozen_molecule_identity_sha256,
        preflight,
    )?;
    engines.coordinator.validate()?;
    engines.rdkit.validate()?;
    engines.reference_cpu.validate()?;

    let memory = estimate_memory(preflight)?;
    for (stage_id, required_bytes) in memory.stage_bytes() {
        if required_bytes > request.limits.max_memory_bytes {
            return Err(ConformerV1AdmissionError::MemoryLimitExceeded {
                stage_id,
                required_bytes,
                limit_bytes: request.limits.max_memory_bytes,
            });
        }
    }

    let distance = admit_numeric_backend(
        "distanceGeometry",
        request.execution_policy.backend_policy,
        &engines.reference_cpu,
        distance_admission,
    )?;
    let stereo = admit_numeric_backend(
        "stereoValidation",
        request.execution_policy.backend_policy,
        &engines.reference_cpu,
        stereo_admission,
    )?;
    let stages = [
        stage(
            "freezeScope",
            StageKind::Materialize,
            Backend::Coordinator,
            Backend::Coordinator,
            Precision::NotApplicable,
            engines.coordinator.clone(),
            memory.freeze_scope_bytes,
            preflight.record_count,
            None,
        ),
        stage(
            "conformerConstraints",
            StageKind::ChemistrySemantics,
            Backend::Rdkit,
            Backend::Rdkit,
            Precision::Float64,
            engines.rdkit.clone(),
            memory.conformer_constraints_bytes,
            preflight.record_count,
            None,
        ),
        stage(
            "distanceGeometry",
            StageKind::NumericCompute,
            distance.requested_backend,
            distance.effective_backend,
            Precision::Float32,
            distance.engine,
            memory.distance_geometry_bytes,
            preflight.record_count,
            distance.fallback,
        ),
        stage(
            "stereoValidation",
            StageKind::NumericCompute,
            stereo.requested_backend,
            stereo.effective_backend,
            Precision::Float32,
            stereo.engine,
            memory.stereo_validation_bytes,
            preflight.record_count,
            stereo.fallback,
        ),
        stage(
            "validateResults",
            StageKind::Validation,
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            Precision::Float64,
            engines.reference_cpu.clone(),
            memory.validate_results_bytes,
            preflight.record_count,
            None,
        ),
        stage(
            "publishResults",
            StageKind::ArtifactIo,
            Backend::Coordinator,
            Backend::Coordinator,
            Precision::NotApplicable,
            engines.coordinator.clone(),
            memory.publish_results_bytes,
            preflight.record_count,
            None,
        ),
    ];
    let plan = ExecutionPlan {
        workflow_template: WorkflowTemplateId::ConformerV1,
        plan_version: ExecutionPlanVersion::ConformerV1,
        backend_policy: request.execution_policy.backend_policy,
        stages: stages.into(),
    };
    plan.validate_against_conformer_request(request, frozen_record_count)?;
    Ok(AdmittedConformerV1Plan { plan, memory })
}

fn validate_preflight(
    request: &ConformerV1SubmitRequest,
    frozen_record_count: u64,
    frozen_molecule_identity_sha256: &str,
    preflight: &ConformerV1Preflight,
) -> Result<(), ConformerV1AdmissionError> {
    if !(1..=MAX_PACK_RECORDS).contains(&frozen_record_count)
        || preflight.record_count != frozen_record_count
    {
        return Err(ConformerV1AdmissionError::Contract(
            "conformer.v1 preflight record count differs from the frozen source".into(),
        ));
    }
    if preflight.ordered_record_molecule_identity_sha256 != frozen_molecule_identity_sha256 {
        return Err(ConformerV1AdmissionError::Contract(
            "conformer.v1 preflight molecular identity differs from the frozen source".into(),
        ));
    }
    if let GridScope::Selected(selected) = &request.source.scope {
        if selected.source_indexes.len() as u64 != frozen_record_count {
            return Err(ConformerV1AdmissionError::Contract(
                "selected request count differs from the frozen source".into(),
            ));
        }
    }
    if preflight.valid_record_count > preflight.record_count
        || preflight.total_atom_count < preflight.valid_record_count
    {
        return Err(ConformerV1AdmissionError::Contract(
            "conformer.v1 preflight has inconsistent valid-record or atom counts".into(),
        ));
    }
    for (label, bytes) in [
        ("EnginePack", preflight.engine_pack_bytes),
        ("ResultPack", preflight.result_pack_bytes),
        ("numeric peak", preflight.numeric_peak_bytes),
    ] {
        if bytes == 0 || bytes > MAX_PACK_BYTES {
            return Err(ConformerV1AdmissionError::Contract(format!(
                "conformer.v1 {label} bytes must be in 1..={MAX_PACK_BYTES}"
            )));
        }
    }
    if preflight.numeric_peak_bytes < preflight.engine_pack_bytes {
        return Err(ConformerV1AdmissionError::Contract(
            "conformer.v1 numeric peak cannot be smaller than the resident EnginePack".into(),
        ));
    }

    let term_start_count = preflight.record_count.checked_add(1).ok_or(
        ConformerV1AdmissionError::ArithmeticOverflow("distance term starts"),
    )?;
    let minimum_engine_bytes = sum_buffers(&[
        multiply(
            preflight.total_atom_count,
            ATOMIC_NUMBER_BYTES + FORMAL_CHARGE_BYTES,
            "atomic properties",
        )?,
        multiply(
            preflight.record_count,
            RECORD_VALIDITY_BYTES,
            "record validity",
        )?,
        multiply(term_start_count, TERM_START_BYTES, "distance term starts")?,
        multiply(
            preflight.total_distance_constraint_count,
            DISTANCE_CONSTRAINT_BYTES,
            "distance constraint arrays",
        )?,
    ])?;
    if preflight.engine_pack_bytes < minimum_engine_bytes {
        return Err(ConformerV1AdmissionError::Contract(format!(
            "conformer.v1 EnginePack preflight is smaller than its {minimum_engine_bytes}-byte required atom/distance payload"
        )));
    }

    let conformer_count = multiply(
        preflight.valid_record_count,
        u64::from(request.parameters.conformers_per_molecule),
        "conformer count",
    )?;
    let positioned_atoms = multiply(
        preflight.total_atom_count,
        u64::from(request.parameters.conformers_per_molecule),
        "positioned atom count",
    )?;
    let minimum_result_bytes = minimum_result_pack_payload(positioned_atoms, conformer_count)?;
    if preflight.result_pack_bytes < minimum_result_bytes {
        return Err(ConformerV1AdmissionError::Contract(format!(
            "conformer.v1 ResultPack preflight is smaller than its {minimum_result_bytes}-byte canonical array payload"
        )));
    }
    Ok(())
}

fn estimate_memory(
    preflight: &ConformerV1Preflight,
) -> Result<ConformerV1MemoryEstimate, ConformerV1AdmissionError> {
    let freeze_scope_bytes = sum_buffers(&[
        MEMORY_HEADROOM_BYTES,
        multiply(
            preflight.record_count,
            SOURCE_INDEX_BYTES,
            "source record IDs",
        )?,
        multiply(
            preflight.record_count,
            MOLECULE_HASH_BYTES,
            "molecule hashes",
        )?,
    ])?;
    let conformer_constraints_bytes =
        sum_buffers(&[MEMORY_HEADROOM_BYTES, preflight.engine_pack_bytes])?;
    let result_bytes = sum_buffers(&[MEMORY_HEADROOM_BYTES, preflight.result_pack_bytes])?;
    Ok(ConformerV1MemoryEstimate {
        freeze_scope_bytes,
        conformer_constraints_bytes,
        distance_geometry_bytes: preflight.numeric_peak_bytes,
        stereo_validation_bytes: preflight.numeric_peak_bytes,
        validate_results_bytes: result_bytes,
        publish_results_bytes: result_bytes,
    })
}

struct NumericStageAdmission {
    requested_backend: Backend,
    effective_backend: Backend,
    engine: EngineIdentity,
    fallback: Option<FallbackDecision>,
}

fn admit_numeric_backend(
    stage_id: &'static str,
    policy: BackendPolicy,
    reference_cpu: &EngineIdentity,
    admission: ConformerBackendAdmission,
) -> Result<NumericStageAdmission, ConformerV1AdmissionError> {
    let admission_label = admission.label();
    match (policy, admission) {
        (
            BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred,
            ConformerBackendAdmission::NativeMetal(engine),
        ) => {
            engine.validate()?;
            Ok(NumericStageAdmission {
                requested_backend: Backend::NativeMetal,
                effective_backend: Backend::NativeMetal,
                engine,
                fallback: None,
            })
        }
        (BackendPolicy::GpuRequired, ConformerBackendAdmission::GpuUnavailable(fallback)) => {
            validate_fallback_reason(&fallback)?;
            Err(ConformerV1AdmissionError::GpuRequiredUnavailable {
                stage_id,
                reason: fallback.reason,
            })
        }
        (BackendPolicy::GpuPreferred, ConformerBackendAdmission::GpuUnavailable(fallback)) => {
            validate_fallback_reason(&fallback)?;
            Ok(NumericStageAdmission {
                requested_backend: Backend::NativeMetal,
                effective_backend: Backend::ReferenceCpu,
                engine: reference_cpu.clone(),
                fallback: Some(fallback),
            })
        }
        (BackendPolicy::ReferenceCpu, ConformerBackendAdmission::ReferenceCpu) => {
            Ok(NumericStageAdmission {
                requested_backend: Backend::ReferenceCpu,
                effective_backend: Backend::ReferenceCpu,
                engine: reference_cpu.clone(),
                fallback: None,
            })
        }
        (policy, _) => Err(ConformerV1AdmissionError::BackendPolicyMismatch(format!(
            "conformer.v1 backend policy {policy:?} is incompatible with {stage_id} admission {admission_label}"
        ))),
    }
}

fn validate_fallback_reason(fallback: &FallbackDecision) -> Result<(), ConformerV1AdmissionError> {
    if fallback.reason.is_empty() || fallback.reason.len() > MAX_FALLBACK_REASON_BYTES {
        return Err(ConformerV1AdmissionError::Contract(format!(
            "fallback reason must contain 1..={MAX_FALLBACK_REASON_BYTES} bytes"
        )));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn stage(
    stage_id: &'static str,
    kind: StageKind,
    requested_backend: Backend,
    effective_backend: Backend,
    precision: Precision,
    engine: EngineIdentity,
    estimated_memory_bytes: u64,
    record_count: u64,
    fallback: Option<FallbackDecision>,
) -> PlannedStage {
    PlannedStage {
        stage_id: stage_id.into(),
        kind,
        idempotent: true,
        requested_backend,
        effective_backend,
        precision,
        engine,
        estimated_memory_bytes,
        fallback: fallback.clone(),
        partitions: vec![ExecutionPartition {
            partition_id: "all".into(),
            chemistry_domain: "conformer.v1/all".into(),
            record_count,
            estimated_memory_bytes,
            requested_backend,
            effective_backend,
            fallback,
        }],
    }
}

fn minimum_result_pack_payload(
    positioned_atom_count: u64,
    conformer_count: u64,
) -> Result<u64, ConformerV1AdmissionError> {
    let starts =
        conformer_count
            .checked_add(1)
            .ok_or(ConformerV1AdmissionError::ArithmeticOverflow(
                "conformer atom starts",
            ))?;
    sum_buffers(&[
        multiply(
            positioned_atom_count,
            POSITION_COMPONENTS * F32_BYTES,
            "Cartesian positions",
        )?,
        multiply(starts, CONFORMER_ATOM_START_BYTES, "conformer atom starts")?,
        multiply(conformer_count, MOLECULE_INDEX_BYTES, "molecule indices")?,
        multiply(
            conformer_count,
            CONFORMER_ORDINAL_BYTES,
            "conformer ordinals",
        )?,
        multiply(conformer_count, ATTEMPT_COUNT_BYTES, "attempt counts")?,
        multiply(conformer_count, ENERGY_BYTES, "objectives")?,
        multiply(conformer_count, STATUS_BYTES, "statuses")?,
        multiply(conformer_count, SEED_BYTES, "seeds")?,
    ])
}

fn result_pack_payload_bytes(
    positioned_atom_count: u64,
    conformer_count: u64,
) -> Result<u64, ConformerV1AdmissionError> {
    let starts =
        conformer_count
            .checked_add(1)
            .ok_or(ConformerV1AdmissionError::ArithmeticOverflow(
                "conformer atom starts",
            ))?;
    let arrays = [
        (starts, CONFORMER_ATOM_START_BYTES, 8),
        (conformer_count, MOLECULE_INDEX_BYTES, 4),
        (conformer_count, CONFORMER_ORDINAL_BYTES, 4),
        (conformer_count, ATTEMPT_COUNT_BYTES, 2),
        (conformer_count, ENERGY_BYTES, 4),
        (conformer_count, STATUS_BYTES, 1),
        (positioned_atom_count, POSITION_COMPONENTS * F32_BYTES, 4),
        (conformer_count, SEED_BYTES, 4),
    ];
    arrays
        .into_iter()
        .try_fold(0_u64, |offset, (count, width, alignment)| {
            let aligned = align_bytes(offset, alignment)?;
            let bytes = multiply(count, width, "conformer ResultPack array")?;
            aligned
                .checked_add(bytes)
                .ok_or(ConformerV1AdmissionError::ArithmeticOverflow(
                    "conformer ResultPack payload",
                ))
        })
}

fn align_bytes(value: u64, alignment: u64) -> Result<u64, ConformerV1AdmissionError> {
    let remainder = value % alignment;
    value
        .checked_add(if remainder == 0 {
            0
        } else {
            alignment - remainder
        })
        .ok_or(ConformerV1AdmissionError::ArithmeticOverflow(
            "packed array alignment",
        ))
}

fn decode_sha256(value: &str) -> Result<[u8; 32], ConformerV1AdmissionError> {
    if value.len() != 64 {
        return Err(ConformerV1AdmissionError::Contract(
            "conformer molecule identity is not SHA-256".into(),
        ));
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        decoded[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Ok(decoded)
}

fn hex_nibble(value: u8) -> Result<u8, ConformerV1AdmissionError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(ConformerV1AdmissionError::Contract(
            "conformer molecule identity is not lowercase SHA-256".into(),
        )),
    }
}

fn multiply(
    count: u64,
    width: u64,
    quantity: &'static str,
) -> Result<u64, ConformerV1AdmissionError> {
    count
        .checked_mul(width)
        .ok_or(ConformerV1AdmissionError::ArithmeticOverflow(quantity))
}

fn sum_buffers(buffers: &[u64]) -> Result<u64, ConformerV1AdmissionError> {
    buffers.iter().try_fold(0_u64, |total, bytes| {
        total
            .checked_add(*bytes)
            .ok_or(ConformerV1AdmissionError::ArithmeticOverflow(
                "memory estimate",
            ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use burrete_compute_core::{ConformerEnginePackBuilder, ExtractedConformerParameters};
    use burrete_compute_protocol::{
        AllGridScope, ComputeJobSchemaVersion, ConformerResourceLimits, ConformerV1Parameters,
        ConformerVariant, ExecutionPolicy, FallbackReasonCode, GridSourceReference,
        SchedulingPolicy, MIN_COMPUTE_MEMORY_BYTES,
    };

    #[test]
    fn admits_independent_native_metal_stages() {
        let plan = admit_conformer_v1_plan(
            &request(BackendPolicy::GpuRequired),
            10,
            &frozen_identity(),
            &preflight(),
            &engines(),
            ConformerBackendAdmission::NativeMetal(engine("burrete-native-metal", '4')),
            ConformerBackendAdmission::NativeMetal(engine("burrete-native-metal", '4')),
        )
        .expect("admit fully native conformer plan");

        assert_eq!(plan.plan.stages[2].effective_backend, Backend::NativeMetal);
        assert_eq!(plan.plan.stages[3].effective_backend, Backend::NativeMetal);
        assert!(plan.plan.stages[2].fallback.is_none());
        assert!(plan.plan.stages[3].fallback.is_none());
        assert_eq!(plan.plan.validate(), Ok(()));
    }

    #[test]
    fn gpu_preferred_records_stage_specific_fallback() {
        let fallback = FallbackDecision {
            code: FallbackReasonCode::CapabilityUnavailable,
            reason: "Verified stereo-validation Metal kernel is not installed.".into(),
        };
        let plan = admit_conformer_v1_plan(
            &request(BackendPolicy::GpuPreferred),
            10,
            &frozen_identity(),
            &preflight(),
            &engines(),
            ConformerBackendAdmission::NativeMetal(engine("burrete-native-metal", '4')),
            ConformerBackendAdmission::GpuUnavailable(fallback.clone()),
        )
        .expect("admit explicit stereo fallback");

        assert_eq!(plan.plan.stages[2].effective_backend, Backend::NativeMetal);
        assert_eq!(plan.plan.stages[3].requested_backend, Backend::NativeMetal);
        assert_eq!(plan.plan.stages[3].effective_backend, Backend::ReferenceCpu);
        assert_eq!(plan.plan.stages[3].fallback, Some(fallback));
    }

    #[test]
    fn gpu_required_rejects_one_missing_numeric_kernel() {
        let error = admit_conformer_v1_plan(
            &request(BackendPolicy::GpuRequired),
            10,
            &frozen_identity(),
            &preflight(),
            &engines(),
            ConformerBackendAdmission::NativeMetal(engine("burrete-native-metal", '4')),
            ConformerBackendAdmission::GpuUnavailable(FallbackDecision {
                code: FallbackReasonCode::CapabilityUnavailable,
                reason: "Stereo-validation Metal kernel is unavailable.".into(),
            }),
        )
        .expect_err("gpuRequired must cover every numeric stage");

        assert!(matches!(
            error,
            ConformerV1AdmissionError::GpuRequiredUnavailable {
                stage_id: "stereoValidation",
                ..
            }
        ));
    }

    #[test]
    fn rejects_unaccounted_result_payload_and_memory_peak() {
        let mut too_small = preflight();
        too_small.result_pack_bytes = 1;
        assert!(matches!(
            admit_conformer_v1_plan(
                &request(BackendPolicy::ReferenceCpu),
                10,
                &frozen_identity(),
                &too_small,
                &engines(),
                ConformerBackendAdmission::ReferenceCpu,
                ConformerBackendAdmission::ReferenceCpu,
            ),
            Err(ConformerV1AdmissionError::Contract(_))
        ));

        let mut too_large = preflight();
        too_large.numeric_peak_bytes = MIN_COMPUTE_MEMORY_BYTES + 1;
        assert!(matches!(
            admit_conformer_v1_plan(
                &request(BackendPolicy::ReferenceCpu),
                10,
                &frozen_identity(),
                &too_large,
                &engines(),
                ConformerBackendAdmission::ReferenceCpu,
                ConformerBackendAdmission::ReferenceCpu,
            ),
            Err(ConformerV1AdmissionError::MemoryLimitExceeded {
                stage_id: "distanceGeometry",
                ..
            })
        ));
    }

    #[test]
    fn rejects_preflight_from_a_different_frozen_library() {
        let mut swapped = preflight();
        swapped.ordered_record_molecule_identity_sha256 = "b".repeat(64);
        assert!(matches!(
            admit_conformer_v1_plan(
                &request(BackendPolicy::ReferenceCpu),
                10,
                &frozen_identity(),
                &swapped,
                &engines(),
                ConformerBackendAdmission::ReferenceCpu,
                ConformerBackendAdmission::ReferenceCpu,
            ),
            Err(ConformerV1AdmissionError::Contract(message))
                if message.contains("molecular identity")
        ));
    }

    fn request(policy: BackendPolicy) -> ConformerV1SubmitRequest {
        ConformerV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ConformerV1,
            source: GridSourceReference {
                document_id: "test-grid-document".into(),
                scope: GridScope::All(AllGridScope {}),
            },
            parameters: ConformerV1Parameters {
                variant: ConformerVariant::EtkdgV3,
                conformers_per_molecule: 4,
                max_attempts_per_conformer: 8,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: policy,
                scheduling_policy: SchedulingPolicy::Balanced,
            },
            limits: ConformerResourceLimits {
                max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
                max_dispatch_ms: 100,
                max_conformers_per_batch: 64,
            },
        }
    }

    fn preflight() -> ConformerV1Preflight {
        ConformerV1Preflight {
            record_count: 10,
            ordered_record_molecule_identity_sha256: frozen_identity(),
            valid_record_count: 8,
            total_atom_count: 40,
            total_distance_constraint_count: 80,
            engine_pack_bytes: 4_096,
            result_pack_bytes: 8_192,
            numeric_peak_bytes: 1024 * 1024,
        }
    }

    #[test]
    fn derives_exact_pack_sizes_and_scheduler_peak_from_extraction() {
        let request = request(BackendPolicy::ReferenceCpu);
        let mut builder = ConformerEnginePackBuilder::new(
            request.parameters.variant,
            request.limits.max_memory_bytes,
        );
        builder
            .append_valid(ExtractedConformerParameters {
                variant: request.parameters.variant,
                atomic_numbers: vec![6, 1],
                formal_charges: vec![0, 0],
                distance_atom_pairs: vec![[0, 1]],
                distance_bounds_squared: vec![[1.0, 2.0]],
                distance_weights: vec![1.0],
                chiral_atom_quads: Vec::new(),
                chiral_volume_bounds: Vec::new(),
                torsion_atom_quads: Vec::new(),
                torsion_coefficients: Vec::new(),
                torsion_signs: Vec::new(),
                improper_atom_quads: Vec::new(),
                improper_weights: Vec::new(),
                etk_distance_atom_pairs: Vec::new(),
                etk_distance_bounds: Vec::new(),
                etk_distance_kinds: Vec::new(),
                etk_distance_weights: Vec::new(),
                stereo_atom_quints: Vec::new(),
                stereo_flags: Vec::new(),
            })
            .expect("valid extraction");
        let arrays = builder.finish(1).expect("complete arrays");
        let derived = derive_conformer_v1_preflight(
            &request,
            &arrays,
            &[ConformerMoleculeIdentity {
                source_record_id: 4,
                molecule_content_sha256: "c".repeat(64),
            }],
            frozen_identity(),
        )
        .expect("derive preflight");

        assert_eq!(derived.record_count, 1);
        assert_eq!(derived.valid_record_count, 1);
        assert_eq!(derived.total_atom_count, 2);
        assert_eq!(derived.total_distance_constraint_count, 1);
        assert_eq!(derived.engine_pack_bytes, arrays.payload_bytes().unwrap());
        assert!(derived.numeric_peak_bytes >= derived.engine_pack_bytes);
        assert!(derived.numeric_peak_bytes <= request.limits.max_memory_bytes);
    }

    fn frozen_identity() -> String {
        "a".repeat(64)
    }

    fn engines() -> ClusterV1EngineIdentities {
        ClusterV1EngineIdentities {
            coordinator: engine("burrete-coordinator", '1'),
            rdkit: engine("rdkit", '2'),
            reference_cpu: engine("burrete-reference-cpu", '3'),
        }
    }

    fn engine(engine_id: &str, digit: char) -> EngineIdentity {
        EngineIdentity {
            engine_id: engine_id.into(),
            version: "test-only-1.0.0".into(),
            manifest_sha256: digit.to_string().repeat(64),
        }
    }
}
