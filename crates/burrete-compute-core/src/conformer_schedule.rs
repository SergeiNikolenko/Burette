//! Deterministic, chunk-invariant `molecule x conformer` scheduling.
//!
//! This module was implemented independently from Burrete's execution and
//! reproducibility contracts. It does not copy or adapt `mlxmolkit` source.

use std::{error::Error, fmt, mem::size_of, num::NonZeroU32};

use burrete_compute_protocol::{ConformerVariant, MAX_COMPUTE_MEMORY_BYTES};
use sha2::{Digest, Sha256};

const SEED_DOMAIN: &[u8] = b"burrete.conformer-seed.v1\0";
const MEMORY_HEADROOM_BYTES: u64 = 64 * 1024;
const DG_DIMENSIONS: u64 = 4;
const POSITION_SIZED_BUFFERS: u64 = 7;
// Two resident Metal history buffers plus the temporary unified-memory source
// allocation used while each no-copy-compatible buffer is materialized.
const HISTORY_POSITION_SIZED_BUFFERS: u64 = 3;
const HISTORY_SCALAR_SIZED_BUFFERS: u64 = 3;
// Four scalar Metal outputs and their simultaneously resident host copies.
const SCALAR_OUTPUT_BYTES: u64 = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConformerMoleculeWork {
    pub source_record_id: u64,
    pub molecule_content_sha256: [u8; 32],
    pub atom_count: NonZeroU32,
    pub conformer_count: NonZeroU32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConformerSchedulingOptions {
    pub max_memory_bytes: u64,
    pub resident_engine_bytes: u64,
    pub max_conformers_per_batch: NonZeroU32,
    pub lbfgs_history: NonZeroU32,
}

impl ConformerSchedulingOptions {
    pub fn validate(self) -> Result<Self, ConformerScheduleError> {
        if !(MEMORY_HEADROOM_BYTES..=MAX_COMPUTE_MEMORY_BYTES).contains(&self.max_memory_bytes) {
            return Err(invalid(format!(
                "max memory must be in {MEMORY_HEADROOM_BYTES}..={MAX_COMPUTE_MEMORY_BYTES}"
            )));
        }
        if self.resident_engine_bytes >= self.max_memory_bytes {
            return Err(invalid(
                "resident conformer EnginePack must leave memory for at least one work item",
            ));
        }
        if self.lbfgs_history.get() > 64 {
            return Err(invalid("L-BFGS history must be in 1..=64"));
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConformerSpan {
    pub molecule_index: u32,
    pub source_record_id: u64,
    pub first_conformer: u32,
    pub conformer_count: NonZeroU32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerBatch {
    pub batch_index: u32,
    pub spans: Vec<ConformerSpan>,
    pub conformer_count: u32,
    pub planned_peak_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerBatchPlan {
    pub batches: Vec<ConformerBatch>,
    pub molecule_count: u32,
    pub conformer_count: u64,
    pub planned_peak_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConformerWorkIdentity {
    pub job_id: [u8; 16],
    pub source_record_id: u64,
    pub molecule_content_sha256: [u8; 32],
    pub variant: ConformerVariant,
    pub conformer_index: u32,
    pub retry_index: u16,
}

impl ConformerWorkIdentity {
    /// Returns a 128-bit counter/key seed as four little-endian Metal words.
    pub fn seed_words(self) -> [u32; 4] {
        let mut digest = Sha256::new();
        digest.update(SEED_DOMAIN);
        digest.update(self.job_id);
        digest.update(self.source_record_id.to_le_bytes());
        digest.update(self.molecule_content_sha256);
        digest.update(self.variant.wire_id().as_bytes());
        digest.update([0]);
        digest.update(self.conformer_index.to_le_bytes());
        digest.update(self.retry_index.to_le_bytes());
        let bytes = digest.finalize();
        std::array::from_fn(|index| {
            u32::from_le_bytes(
                bytes[index * size_of::<u32>()..(index + 1) * size_of::<u32>()]
                    .try_into()
                    .expect("SHA-256 prefix has four u32 words"),
            )
        })
    }
}

pub fn plan_conformer_batches(
    molecules: &[ConformerMoleculeWork],
    options: ConformerSchedulingOptions,
) -> Result<ConformerBatchPlan, ConformerScheduleError> {
    let options = options.validate()?;
    let molecule_count = u32::try_from(molecules.len())
        .map_err(|_| invalid("molecule count exceeds the u32 scheduler ABI"))?;
    let mut total_conformers = 0_u64;
    let mut batches = Vec::new();
    let mut current = PendingBatch::new(options.resident_engine_bytes)?;

    for (molecule_index, molecule) in molecules.iter().copied().enumerate() {
        let molecule_index = u32::try_from(molecule_index)
            .map_err(|_| invalid("molecule index exceeds the u32 scheduler ABI"))?;
        let item_bytes = conformer_work_bytes(molecule.atom_count, options.lbfgs_history)?;
        let minimum = base_batch_bytes(options.resident_engine_bytes)?
            .checked_add(item_bytes)
            .ok_or(ConformerScheduleError::Overflow)?;
        if minimum > options.max_memory_bytes {
            return Err(ConformerScheduleError::MoleculeExceedsMemory {
                source_record_id: molecule.source_record_id,
                required_bytes: minimum,
                max_memory_bytes: options.max_memory_bytes,
            });
        }
        total_conformers = total_conformers
            .checked_add(u64::from(molecule.conformer_count.get()))
            .ok_or(ConformerScheduleError::Overflow)?;

        let mut first_conformer = 0_u32;
        while first_conformer < molecule.conformer_count.get() {
            let remaining = molecule.conformer_count.get() - first_conformer;
            let count_limit = options
                .max_conformers_per_batch
                .get()
                .saturating_sub(current.conformer_count);
            let byte_limit = (options.max_memory_bytes - current.planned_bytes) / item_bytes;
            let take = remaining
                .min(count_limit)
                .min(u32::try_from(byte_limit).unwrap_or(u32::MAX));
            if take == 0 {
                batches.push(current.finish(batches.len())?);
                current = PendingBatch::new(options.resident_engine_bytes)?;
                continue;
            }
            let take = NonZeroU32::new(take).expect("positive scheduled span");
            current.push(
                ConformerSpan {
                    molecule_index,
                    source_record_id: molecule.source_record_id,
                    first_conformer,
                    conformer_count: take,
                },
                item_bytes,
            )?;
            first_conformer = first_conformer
                .checked_add(take.get())
                .ok_or(ConformerScheduleError::Overflow)?;
        }
    }
    if current.conformer_count > 0 {
        batches.push(current.finish(batches.len())?);
    }
    let planned_peak_bytes = batches
        .iter()
        .map(|batch| batch.planned_peak_bytes)
        .max()
        .unwrap_or_else(|| base_batch_bytes(options.resident_engine_bytes).unwrap_or(u64::MAX));
    Ok(ConformerBatchPlan {
        batches,
        molecule_count,
        conformer_count: total_conformers,
        planned_peak_bytes,
    })
}

fn conformer_work_bytes(
    atom_count: NonZeroU32,
    lbfgs_history: NonZeroU32,
) -> Result<u64, ConformerScheduleError> {
    let coordinates = u64::from(atom_count.get())
        .checked_mul(DG_DIMENSIONS)
        .ok_or(ConformerScheduleError::Overflow)?;
    let position_buffers = POSITION_SIZED_BUFFERS
        .checked_add(
            HISTORY_POSITION_SIZED_BUFFERS * u64::from(lbfgs_history.get()),
        )
        .ok_or(ConformerScheduleError::Overflow)?;
    let coordinate_bytes = coordinates
        .checked_mul(size_of::<f32>() as u64)
        .and_then(|bytes| bytes.checked_mul(position_buffers))
        .ok_or(ConformerScheduleError::Overflow)?;
    let history_scalars = HISTORY_SCALAR_SIZED_BUFFERS
        .checked_mul(u64::from(lbfgs_history.get()))
        .and_then(|count| count.checked_mul(size_of::<f32>() as u64))
        .ok_or(ConformerScheduleError::Overflow)?;
    coordinate_bytes
        .checked_add(history_scalars)
        .and_then(|bytes| bytes.checked_add(SCALAR_OUTPUT_BYTES))
        .ok_or(ConformerScheduleError::Overflow)
}

fn base_batch_bytes(resident_engine_bytes: u64) -> Result<u64, ConformerScheduleError> {
    MEMORY_HEADROOM_BYTES
        .checked_add(resident_engine_bytes)
        .ok_or(ConformerScheduleError::Overflow)
}

struct PendingBatch {
    spans: Vec<ConformerSpan>,
    conformer_count: u32,
    planned_bytes: u64,
}

impl PendingBatch {
    fn new(resident_engine_bytes: u64) -> Result<Self, ConformerScheduleError> {
        Ok(Self {
            spans: Vec::new(),
            conformer_count: 0,
            planned_bytes: base_batch_bytes(resident_engine_bytes)?,
        })
    }

    fn push(
        &mut self,
        span: ConformerSpan,
        item_bytes: u64,
    ) -> Result<(), ConformerScheduleError> {
        self.conformer_count = self
            .conformer_count
            .checked_add(span.conformer_count.get())
            .ok_or(ConformerScheduleError::Overflow)?;
        self.planned_bytes = self
            .planned_bytes
            .checked_add(
                item_bytes
                    .checked_mul(u64::from(span.conformer_count.get()))
                    .ok_or(ConformerScheduleError::Overflow)?,
            )
            .ok_or(ConformerScheduleError::Overflow)?;
        self.spans.push(span);
        Ok(())
    }

    fn finish(self, batch_index: usize) -> Result<ConformerBatch, ConformerScheduleError> {
        Ok(ConformerBatch {
            batch_index: u32::try_from(batch_index)
                .map_err(|_| invalid("batch count exceeds the u32 scheduler ABI"))?,
            spans: self.spans,
            conformer_count: self.conformer_count,
            planned_peak_bytes: self.planned_bytes,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConformerScheduleError {
    InvalidOptions(String),
    MoleculeExceedsMemory {
        source_record_id: u64,
        required_bytes: u64,
        max_memory_bytes: u64,
    },
    Overflow,
}

impl fmt::Display for ConformerScheduleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOptions(message) => formatter.write_str(message),
            Self::MoleculeExceedsMemory {
                source_record_id,
                required_bytes,
                max_memory_bytes,
            } => write!(
                formatter,
                "molecule {source_record_id} needs {required_bytes} bytes per conformer batch; limit is {max_memory_bytes}"
            ),
            Self::Overflow => formatter.write_str("conformer schedule arithmetic overflowed"),
        }
    }
}

impl Error for ConformerScheduleError {}

fn invalid(message: impl Into<String>) -> ConformerScheduleError {
    ConformerScheduleError::InvalidOptions(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn molecule(id: u64, atoms: u32, conformers: u32) -> ConformerMoleculeWork {
        ConformerMoleculeWork {
            source_record_id: id,
            molecule_content_sha256: [id as u8; 32],
            atom_count: NonZeroU32::new(atoms).expect("nonzero atoms"),
            conformer_count: NonZeroU32::new(conformers).expect("nonzero conformers"),
        }
    }

    fn options(max_memory_bytes: u64, max_batch: u32) -> ConformerSchedulingOptions {
        ConformerSchedulingOptions {
            max_memory_bytes,
            resident_engine_bytes: 128 * 1024,
            max_conformers_per_batch: NonZeroU32::new(max_batch).expect("nonzero batch"),
            lbfgs_history: NonZeroU32::new(8).expect("nonzero history"),
        }
    }

    #[test]
    fn exact_spans_cover_each_molecule_conformer_once() {
        let molecules = [molecule(10, 12, 5), molecule(20, 30, 7)];
        let plan = plan_conformer_batches(&molecules, options(2 * 1024 * 1024, 4))
            .expect("plan conformers");
        assert_eq!(plan.molecule_count, 2);
        assert_eq!(plan.conformer_count, 12);
        assert!(plan
            .batches
            .iter()
            .all(|batch| batch.conformer_count <= 4));
        let covered = plan
            .batches
            .iter()
            .flat_map(|batch| &batch.spans)
            .flat_map(|span| {
                (span.first_conformer..span.first_conformer + span.conformer_count.get())
                    .map(move |conformer| (span.molecule_index, conformer))
            })
            .collect::<Vec<_>>();
        assert_eq!(
            covered,
            vec![
                (0, 0),
                (0, 1),
                (0, 2),
                (0, 3),
                (0, 4),
                (1, 0),
                (1, 1),
                (1, 2),
                (1, 3),
                (1, 4),
                (1, 5),
                (1, 6),
            ]
        );
    }

    #[test]
    fn identity_seed_is_invariant_under_adaptive_rebatching() {
        let molecules = [molecule(10, 40, 6), molecule(20, 80, 5)];
        let small = plan_conformer_batches(&molecules, options(512 * 1024, 2))
            .expect("small batches");
        let large = plan_conformer_batches(&molecules, options(8 * 1024 * 1024, 16))
            .expect("large batches");
        assert_ne!(small.batches.len(), large.batches.len());
        let seeds = |plan: &ConformerBatchPlan| {
            plan.batches
                .iter()
                .flat_map(|batch| &batch.spans)
                .flat_map(|span| {
                    let molecule = molecules[span.molecule_index as usize];
                    (span.first_conformer..span.first_conformer + span.conformer_count.get()).map(
                        move |conformer_index| {
                            (
                                span.molecule_index,
                                conformer_index,
                                ConformerWorkIdentity {
                                    job_id: [7; 16],
                                    source_record_id: molecule.source_record_id,
                                    molecule_content_sha256: molecule.molecule_content_sha256,
                                    variant: ConformerVariant::EtkdgV3,
                                    conformer_index,
                                    retry_index: 0,
                                }
                                .seed_words(),
                            )
                        },
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(seeds(&small), seeds(&large));
    }

    #[test]
    fn seed_changes_for_variant_conformer_and_retry_identity() {
        let base = ConformerWorkIdentity {
            job_id: [1; 16],
            source_record_id: 3,
            molecule_content_sha256: [4; 32],
            variant: ConformerVariant::Dg,
            conformer_index: 5,
            retry_index: 0,
        };
        let mut changed = base;
        changed.variant = ConformerVariant::SrEtkdgV3;
        assert_ne!(base.seed_words(), changed.seed_words());
        changed = base;
        changed.conformer_index += 1;
        assert_ne!(base.seed_words(), changed.seed_words());
        changed = base;
        changed.retry_index += 1;
        assert_ne!(base.seed_words(), changed.seed_words());
    }

    #[test]
    fn rejects_a_single_conformer_that_cannot_fit() {
        let error = plan_conformer_batches(&[molecule(99, 10_000, 1)], options(256 * 1024, 1))
            .expect_err("oversized molecule must fail");
        assert!(matches!(
            error,
            ConformerScheduleError::MoleculeExceedsMemory {
                source_record_id: 99,
                ..
            }
        ));
    }

    #[test]
    fn per_conformer_peak_counts_unified_memory_copies() {
        assert_eq!(
            conformer_work_bytes(
                NonZeroU32::new(1).expect("one atom"),
                NonZeroU32::new(1).expect("one history slot"),
            ),
            Ok(204)
        );
    }
}
