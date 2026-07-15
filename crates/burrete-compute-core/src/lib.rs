//! Deterministic CPU reference primitives for `cluster.v1`.
//!
//! This implementation is derived independently from Burrete's published
//! mathematical and behavioral contracts. It does not copy or adapt source
//! code from `mlxmolkit` or another clustering package. The CPU path is the
//! parity oracle for native Metal neighbor generation.

use std::{fmt, num::NonZeroUsize};

use burrete_compute_protocol::{ProtocolError, SimilarityCutoff};

pub const FINGERPRINT_BITS: usize = 2_048;
pub const FINGERPRINT_WORDS: usize = FINGERPRINT_BITS / u64::BITS as usize;

/// One fixed-width Morgan fingerprint in increasing bit/word order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Fingerprint2048 {
    words: [u64; FINGERPRINT_WORDS],
}

impl Fingerprint2048 {
    pub const ZERO: Self = Self {
        words: [0; FINGERPRINT_WORDS],
    };

    pub const fn from_words(words: [u64; FINGERPRINT_WORDS]) -> Self {
        Self { words }
    }

    pub const fn words(&self) -> &[u64; FINGERPRINT_WORDS] {
        &self.words
    }

    pub fn tanimoto_counts(&self, other: &Self) -> TanimotoCounts {
        let mut intersection = 0_u64;
        let mut union = 0_u64;
        for (left, right) in self.words.iter().zip(other.words.iter()) {
            intersection += u64::from((left & right).count_ones());
            union += u64::from((left | right).count_ones());
        }
        TanimotoCounts {
            intersection,
            union,
        }
    }
}

impl Default for Fingerprint2048 {
    fn default() -> Self {
        Self::ZERO
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TanimotoCounts {
    pub intersection: u64,
    pub union: u64,
}

impl TanimotoCounts {
    pub fn matches_cutoff(self, cutoff: SimilarityCutoff) -> Result<bool, ProtocolError> {
        cutoff.matches_counts(self.intersection, self.union)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GraphBuildOptions {
    pub tile_size: NonZeroUsize,
    pub max_undirected_edges: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClusterCoreError {
    InvalidCutoff(String),
    EdgeBudgetExceeded { limit: u64, observed_at_least: u64 },
    CsrOverflow,
    InvalidCsr(&'static str),
}

impl fmt::Display for ClusterCoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCutoff(message) => write!(formatter, "invalid similarity cutoff: {message}"),
            Self::EdgeBudgetExceeded {
                limit,
                observed_at_least,
            } => write!(
                formatter,
                "Tanimoto graph exceeds the undirected edge budget {limit} (observed at least {observed_at_least})"
            ),
            Self::CsrOverflow => formatter.write_str("CSR size exceeds integer or address limits"),
            Self::InvalidCsr(message) => write!(formatter, "invalid symmetric CSR: {message}"),
        }
    }
}

impl std::error::Error for ClusterCoreError {}

/// Validated, loop-free symmetric CSR with sorted, unique neighbors per row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SymmetricCsr {
    row_offsets: Vec<u64>,
    column_indices: Vec<u64>,
}

impl SymmetricCsr {
    pub fn try_new(
        row_offsets: Vec<u64>,
        column_indices: Vec<u64>,
    ) -> Result<Self, ClusterCoreError> {
        validate_csr(&row_offsets, &column_indices)?;
        Ok(Self {
            row_offsets,
            column_indices,
        })
    }

    pub fn vertex_count(&self) -> usize {
        self.row_offsets.len() - 1
    }

    pub fn undirected_edge_count(&self) -> u64 {
        self.column_indices.len() as u64 / 2
    }

    pub fn row_offsets(&self) -> &[u64] {
        &self.row_offsets
    }

    pub fn column_indices(&self) -> &[u64] {
        &self.column_indices
    }

    pub fn neighbors(&self, vertex: usize) -> Option<&[u64]> {
        (vertex < self.vertex_count()).then(|| self.neighbors_unchecked(vertex))
    }

    fn neighbors_unchecked(&self, vertex: usize) -> &[u64] {
        let start = self.row_offsets[vertex] as usize;
        let end = self.row_offsets[vertex + 1] as usize;
        &self.column_indices[start..end]
    }
}

/// Builds the exact threshold graph without materializing an `N x N` matrix.
pub fn build_tanimoto_graph(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    options: GraphBuildOptions,
) -> Result<SymmetricCsr, ClusterCoreError> {
    let cutoff = cutoff
        .normalized()
        .map_err(|error| ClusterCoreError::InvalidCutoff(error.to_string()))?;
    let pairs = enumerate_matching_pairs(fingerprints, cutoff, options)?;
    csr_from_pairs(fingerprints.len(), &pairs)
}

/// Dynamic-count Butina clustering. Every cluster stores its representative
/// first, followed by its ascending live neighbors at selection time.
pub fn butina_clusters(graph: &SymmetricCsr) -> Vec<Vec<u64>> {
    let vertex_count = graph.vertex_count();
    let mut alive = vec![true; vertex_count];
    let mut live_degrees: Vec<u64> = graph
        .row_offsets
        .windows(2)
        .map(|window| window[1] - window[0])
        .collect();
    let mut remaining = vertex_count;
    let mut clusters = Vec::new();

    while remaining > 0 {
        let mut representative = None;
        for vertex in 0..vertex_count {
            if alive[vertex]
                && representative
                    .map(|current| live_degrees[vertex] > live_degrees[current])
                    .unwrap_or(true)
            {
                representative = Some(vertex);
            }
        }
        let representative = representative.expect("remaining vertices include one live vertex");

        let mut removed = Vec::new();
        removed.push(representative);
        removed.extend(
            graph
                .neighbors_unchecked(representative)
                .iter()
                .map(|neighbor| *neighbor as usize)
                .filter(|neighbor| alive[*neighbor]),
        );

        for &vertex in &removed {
            alive[vertex] = false;
        }
        remaining -= removed.len();

        for &vertex in &removed {
            for &neighbor in graph.neighbors_unchecked(vertex) {
                let neighbor = neighbor as usize;
                if alive[neighbor] {
                    live_degrees[neighbor] -= 1;
                }
            }
        }

        clusters.push(removed.into_iter().map(|vertex| vertex as u64).collect());
    }

    clusters
}

fn enumerate_matching_pairs(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    options: GraphBuildOptions,
) -> Result<Vec<(usize, usize)>, ClusterCoreError> {
    let tile_size = options.tile_size.get();
    let mut pairs = Vec::new();

    for row_start in (0..fingerprints.len()).step_by(tile_size) {
        let row_end = row_start.saturating_add(tile_size).min(fingerprints.len());
        for column_start in (row_start..fingerprints.len()).step_by(tile_size) {
            let column_end = column_start
                .saturating_add(tile_size)
                .min(fingerprints.len());
            for left in row_start..row_end {
                let right_start = if column_start == row_start {
                    left + 1
                } else {
                    column_start
                };
                for right in right_start..column_end {
                    let counts = fingerprints[left].tanimoto_counts(&fingerprints[right]);
                    if exact_match(counts, cutoff) {
                        let observed = (pairs.len() as u64)
                            .checked_add(1)
                            .ok_or(ClusterCoreError::CsrOverflow)?;
                        if observed > options.max_undirected_edges {
                            return Err(ClusterCoreError::EdgeBudgetExceeded {
                                limit: options.max_undirected_edges,
                                observed_at_least: observed,
                            });
                        }
                        pairs.push((left, right));
                    }
                }
            }
        }
    }

    Ok(pairs)
}

fn exact_match(counts: TanimotoCounts, cutoff: SimilarityCutoff) -> bool {
    if counts.union == 0 {
        return cutoff.numerator == 0;
    }
    u128::from(counts.intersection) * u128::from(cutoff.denominator)
        >= u128::from(counts.union) * u128::from(cutoff.numerator)
}

fn csr_from_pairs(
    vertex_count: usize,
    pairs: &[(usize, usize)],
) -> Result<SymmetricCsr, ClusterCoreError> {
    let mut degrees = vec![0_u64; vertex_count];
    for &(left, right) in pairs {
        degrees[left] = degrees[left]
            .checked_add(1)
            .ok_or(ClusterCoreError::CsrOverflow)?;
        degrees[right] = degrees[right]
            .checked_add(1)
            .ok_or(ClusterCoreError::CsrOverflow)?;
    }

    let row_offsets = prefix_offsets(&degrees)?;
    let entry_count = usize::try_from(*row_offsets.last().expect("offsets include zero"))
        .map_err(|_| ClusterCoreError::CsrOverflow)?;
    let mut column_indices = vec![0_u64; entry_count];
    let mut cursors = row_offsets[..vertex_count].to_vec();

    for &(left, right) in pairs {
        let left_cursor =
            usize::try_from(cursors[left]).map_err(|_| ClusterCoreError::CsrOverflow)?;
        let right_cursor =
            usize::try_from(cursors[right]).map_err(|_| ClusterCoreError::CsrOverflow)?;
        column_indices[left_cursor] = right as u64;
        column_indices[right_cursor] = left as u64;
        cursors[left] += 1;
        cursors[right] += 1;
    }

    for window in row_offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        column_indices[start..end].sort_unstable();
    }

    Ok(SymmetricCsr {
        row_offsets,
        column_indices,
    })
}

fn prefix_offsets(degrees: &[u64]) -> Result<Vec<u64>, ClusterCoreError> {
    let mut offsets = Vec::with_capacity(degrees.len() + 1);
    offsets.push(0_u64);
    for degree in degrees {
        offsets.push(
            offsets
                .last()
                .expect("offsets include zero")
                .checked_add(*degree)
                .ok_or(ClusterCoreError::CsrOverflow)?,
        );
    }
    Ok(offsets)
}

fn validate_csr(row_offsets: &[u64], column_indices: &[u64]) -> Result<(), ClusterCoreError> {
    if row_offsets.is_empty() || row_offsets[0] != 0 {
        return Err(ClusterCoreError::InvalidCsr(
            "row offsets must begin with zero",
        ));
    }
    if row_offsets.windows(2).any(|window| window[0] > window[1]) {
        return Err(ClusterCoreError::InvalidCsr(
            "row offsets must be nondecreasing",
        ));
    }
    if row_offsets.last().copied() != Some(column_indices.len() as u64) {
        return Err(ClusterCoreError::InvalidCsr(
            "final row offset must equal the column-index count",
        ));
    }

    let vertex_count = row_offsets.len() - 1;
    for row in 0..vertex_count {
        let start = row_offsets[row] as usize;
        let end = row_offsets[row + 1] as usize;
        let neighbors = &column_indices[start..end];
        if neighbors.windows(2).any(|window| window[0] >= window[1]) {
            return Err(ClusterCoreError::InvalidCsr(
                "neighbors must be strictly increasing",
            ));
        }
        for &neighbor in neighbors {
            if neighbor >= vertex_count as u64 || neighbor == row as u64 {
                return Err(ClusterCoreError::InvalidCsr(
                    "neighbors must be in range and cannot be self edges",
                ));
            }
            let neighbor = neighbor as usize;
            let reverse_start = row_offsets[neighbor] as usize;
            let reverse_end = row_offsets[neighbor + 1] as usize;
            if column_indices[reverse_start..reverse_end]
                .binary_search(&(row as u64))
                .is_err()
            {
                return Err(ClusterCoreError::InvalidCsr(
                    "every edge must have a reverse edge",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
