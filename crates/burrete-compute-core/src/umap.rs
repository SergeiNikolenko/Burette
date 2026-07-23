//! CPU reference for the native chemical-space UMAP graph contract.
//!
//! The fuzzy-graph and curve-fitting flow is adapted from `hanxiao/mlx-vis`
//! commit `06c8a75ad007820b35185937f83c03e09ab6bd5b` (Apache-2.0).
//! Production optimization is implemented independently in Metal.

use std::{
    collections::{BTreeMap, HashMap},
    num::NonZeroUsize,
};

const MAX_UMAP_EPOCHS: u32 = 2_000;
const MAX_NEGATIVE_SAMPLE_RATE: u32 = 64;

/// Native chemical-space objectives adapted from mlx-vis 0.7.0.
///
/// Every objective consumes the same exact Tanimoto k-nearest-neighbor graph.
/// This is intentional: mlx-vis normally constructs Euclidean neighbors, which
/// would change the requested chemical similarity metric.
#[repr(u32)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChemicalSpaceMethod {
    Umap = 0,
    Tsne = 1,
    Pacmap = 2,
    Localmap = 3,
    Trimap = 4,
    Dreams = 5,
    Cne = 6,
    Mmae = 7,
}

impl ChemicalSpaceMethod {
    pub const fn metal_discriminant(self) -> u32 {
        self as u32
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UmapOptions {
    n_components: u32,
    n_epochs: u32,
    min_dist: f32,
    spread: f32,
    learning_rate: f32,
    negative_sample_rate: u32,
    random_seed: u64,
}

impl UmapOptions {
    pub fn try_new(
        n_components: u32,
        n_epochs: u32,
        min_dist: f32,
        spread: f32,
        learning_rate: f32,
        negative_sample_rate: u32,
        random_seed: u64,
    ) -> Result<Self, UmapError> {
        if !matches!(n_components, 2 | 3) {
            return Err(UmapError::InvalidOptions(
                "n_components must be 2 or 3".into(),
            ));
        }
        if !(1..=MAX_UMAP_EPOCHS).contains(&n_epochs) {
            return Err(UmapError::InvalidOptions(format!(
                "n_epochs must be in 1..={MAX_UMAP_EPOCHS}"
            )));
        }
        if !min_dist.is_finite() || min_dist < 0.0 {
            return Err(UmapError::InvalidOptions(
                "min_dist must be finite and non-negative".into(),
            ));
        }
        if !spread.is_finite() || spread <= 0.0 || min_dist > spread {
            return Err(UmapError::InvalidOptions(
                "spread must be positive and at least min_dist".into(),
            ));
        }
        if !learning_rate.is_finite() || learning_rate <= 0.0 {
            return Err(UmapError::InvalidOptions(
                "learning_rate must be finite and positive".into(),
            ));
        }
        if !(1..=MAX_NEGATIVE_SAMPLE_RATE).contains(&negative_sample_rate) {
            return Err(UmapError::InvalidOptions(format!(
                "negative_sample_rate must be in 1..={MAX_NEGATIVE_SAMPLE_RATE}"
            )));
        }
        Ok(Self {
            n_components,
            n_epochs,
            min_dist,
            spread,
            learning_rate,
            negative_sample_rate,
            random_seed,
        })
    }

    pub fn standard_2d() -> Self {
        Self::try_new(2, 500, 0.1, 1.0, 1.0, 5, 42).expect("valid defaults")
    }

    pub const fn n_components(self) -> u32 {
        self.n_components
    }

    pub const fn n_epochs(self) -> u32 {
        self.n_epochs
    }

    pub const fn min_dist(self) -> f32 {
        self.min_dist
    }

    pub const fn spread(self) -> f32 {
        self.spread
    }

    pub const fn learning_rate(self) -> f32 {
        self.learning_rate
    }

    pub const fn negative_sample_rate(self) -> u32 {
        self.negative_sample_rate
    }

    pub const fn random_seed(self) -> u64 {
        self.random_seed
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TanimotoUmapGraph {
    vertex_count: usize,
    row_offsets: Vec<u64>,
    column_indices: Vec<u32>,
    weights: Vec<f32>,
}

impl TanimotoUmapGraph {
    pub const fn vertex_count(&self) -> usize {
        self.vertex_count
    }

    pub fn row_offsets(&self) -> &[u64] {
        &self.row_offsets
    }

    pub fn column_indices(&self) -> &[u32] {
        &self.column_indices
    }

    pub fn weights(&self) -> &[f32] {
        &self.weights
    }

    pub fn edge_count(&self) -> usize {
        self.column_indices.len()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum UmapError {
    InvalidOptions(String),
    InvalidKnn(String),
    NumericFailure(String),
}

impl std::fmt::Display for UmapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidOptions(message) => write!(formatter, "invalid UMAP options: {message}"),
            Self::InvalidKnn(message) => write!(formatter, "invalid Tanimoto kNN: {message}"),
            Self::NumericFailure(message) => write!(formatter, "UMAP numeric failure: {message}"),
        }
    }
}

impl std::error::Error for UmapError {}

pub fn build_tanimoto_umap_graph(
    vertex_count: usize,
    neighbors_per_vertex: NonZeroUsize,
    source_indices: &[u32],
    similarities: &[f32],
    options: UmapOptions,
) -> Result<TanimotoUmapGraph, UmapError> {
    let k = neighbors_per_vertex.get();
    let expected = vertex_count
        .checked_mul(k)
        .ok_or_else(|| UmapError::InvalidKnn("matrix size overflow".into()))?;
    if source_indices.len() != expected || similarities.len() != expected {
        return Err(UmapError::InvalidKnn(format!(
            "expected {expected} indices and similarities"
        )));
    }
    if vertex_count > u32::MAX as usize {
        return Err(UmapError::InvalidKnn(
            "vertex count exceeds UInt32 capacity".into(),
        ));
    }

    let mut directed = HashMap::with_capacity(expected);
    for row in 0..vertex_count {
        let start = row * k;
        let end = start + k;
        let indices = &source_indices[start..end];
        let scores = &similarities[start..end];
        validate_knn_row(row, vertex_count, indices, scores)?;
        let distances = scores.iter().map(|score| 1.0 - score).collect::<Vec<_>>();
        let rho = distances
            .iter()
            .copied()
            .filter(|distance| *distance > 0.0)
            .reduce(f32::min)
            .unwrap_or(f32::INFINITY)
            .max(1e-8);
        let shifted = distances
            .iter()
            .map(|distance| (distance - rho).max(0.0))
            .collect::<Vec<_>>();
        let sigma = solve_sigma(&shifted, k);
        for (&column, shifted_distance) in indices.iter().zip(shifted) {
            let weight = (-shifted_distance / sigma.max(1e-10)).exp();
            directed.insert(pair_key(row as u32, column), weight);
        }
    }

    let mut symmetric_rows = vec![BTreeMap::new(); vertex_count];
    for (&key, &forward) in &directed {
        let row = (key >> 32) as u32;
        let column = key as u32;
        let reverse = directed.get(&pair_key(column, row)).copied().unwrap_or(0.0);
        let symmetric = forward + reverse - forward * reverse;
        symmetric_rows[row as usize].insert(column, symmetric);
        symmetric_rows[column as usize].insert(row, symmetric);
    }
    let max_weight = symmetric_rows
        .iter()
        .flat_map(|row| row.values())
        .copied()
        .reduce(f32::max)
        .unwrap_or(0.0);
    let threshold = max_weight / options.n_epochs() as f32;
    let mut row_offsets = Vec::with_capacity(vertex_count + 1);
    let mut column_indices = Vec::with_capacity(expected);
    let mut weights = Vec::with_capacity(expected);
    row_offsets.push(0);
    for row_weights in symmetric_rows {
        for (column, symmetric) in row_weights {
            if symmetric >= threshold {
                column_indices.push(column);
                weights.push(symmetric);
            }
        }
        row_offsets.push(column_indices.len() as u64);
    }
    if weights.iter().any(|weight| !weight.is_finite()) {
        return Err(UmapError::NumericFailure(
            "fuzzy graph contains non-finite weights".into(),
        ));
    }
    Ok(TanimotoUmapGraph {
        vertex_count,
        row_offsets,
        column_indices,
        weights,
    })
}

pub fn fit_umap_curve(spread: f32, min_dist: f32) -> Result<(f32, f32), UmapError> {
    if !spread.is_finite() || spread <= 0.0 || !min_dist.is_finite() || min_dist < 0.0 {
        return Err(UmapError::InvalidOptions(
            "curve spread and min_dist must be finite and non-negative".into(),
        ));
    }
    let mut a = 1.0_f64;
    let mut b = 1.0_f64;
    for _ in 0..100 {
        let mut normal = [[0.0_f64; 2]; 2];
        let mut rhs = [0.0_f64; 2];
        for index in 0..300 {
            let x = f64::from(spread) * 3.0 * index as f64 / 299.0;
            let target = if x < f64::from(min_dist) {
                1.0
            } else {
                (-(x - f64::from(min_dist)) / f64::from(spread)).exp()
            };
            let x2b = x.powf(2.0 * b);
            let denominator = 1.0 + a * x2b;
            let residual = denominator.recip() - target;
            let da = -x2b / denominator.powi(2);
            let db = -a * 2.0 * x.max(1e-20).ln() * x2b / denominator.powi(2);
            normal[0][0] += da * da;
            normal[0][1] += da * db;
            normal[1][1] += db * db;
            rhs[0] -= da * residual;
            rhs[1] -= db * residual;
        }
        normal[1][0] = normal[0][1];
        let determinant = normal[0][0] * normal[1][1] - normal[0][1] * normal[1][0];
        if determinant.abs() < 1e-20 {
            return Err(UmapError::NumericFailure(
                "curve fit normal matrix is singular".into(),
            ));
        }
        let step_a = (rhs[0] * normal[1][1] - normal[0][1] * rhs[1]) / determinant;
        let step_b = (normal[0][0] * rhs[1] - rhs[0] * normal[1][0]) / determinant;
        a += step_a;
        b += step_b;
        if step_a * step_a + step_b * step_b < 1e-12 {
            break;
        }
    }
    if !a.is_finite() || !b.is_finite() || a <= 0.0 || b <= 0.0 {
        return Err(UmapError::NumericFailure(
            "curve fit produced invalid parameters".into(),
        ));
    }
    Ok((a as f32, b as f32))
}

fn validate_knn_row(
    row: usize,
    vertex_count: usize,
    indices: &[u32],
    similarities: &[f32],
) -> Result<(), UmapError> {
    let mut seen = std::collections::HashSet::with_capacity(indices.len());
    for (&index, &similarity) in indices.iter().zip(similarities) {
        if index as usize >= vertex_count || index as usize == row || !seen.insert(index) {
            return Err(UmapError::InvalidKnn(format!(
                "row {row} contains an invalid or duplicate neighbor"
            )));
        }
        if !similarity.is_finite() || !(0.0..=1.0).contains(&similarity) {
            return Err(UmapError::InvalidKnn(format!(
                "row {row} contains an invalid similarity"
            )));
        }
    }
    Ok(())
}

fn solve_sigma(shifted: &[f32], k: usize) -> f32 {
    let target = (k as f32).log2();
    let tail = shifted.get(1..).unwrap_or_default();
    let mut low = 1e-20_f32;
    let mut high = 1e3_f32;
    let mut sigma = 1.0_f32;
    for _ in 0..64 {
        let sum = tail
            .iter()
            .map(|distance| (-distance / sigma).exp())
            .sum::<f32>();
        if (sum - target).abs() < 1e-5 {
            break;
        }
        if sum > target {
            high = sigma;
            sigma = (low + sigma) * 0.5;
        } else {
            low = sigma;
            sigma = if high >= 1e3 {
                sigma * 2.0
            } else {
                (sigma + high) * 0.5
            };
        }
    }
    sigma
}

const fn pair_key(row: u32, column: u32) -> u64 {
    (row as u64) << 32 | column as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_2d_and_3d_options() {
        assert!(UmapOptions::try_new(2, 500, 0.1, 1.0, 1.0, 5, 42).is_ok());
        assert!(UmapOptions::try_new(3, 200, 0.0, 1.0, 0.5, 10, 7).is_ok());
        assert!(UmapOptions::try_new(4, 500, 0.1, 1.0, 1.0, 5, 42).is_err());
    }

    #[test]
    fn fits_the_upstream_default_umap_curve() {
        let (a, b) = fit_umap_curve(1.0, 0.1).expect("curve fit");
        assert!((a - 1.576_94).abs() < 1e-3, "a={a}");
        assert!((b - 0.895_061).abs() < 1e-3, "b={b}");
    }

    #[test]
    fn builds_a_bounded_fuzzy_graph_from_tanimoto_neighbors() {
        let options = UmapOptions::standard_2d();
        let graph = build_tanimoto_umap_graph(
            3,
            NonZeroUsize::new(2).expect("nonzero k"),
            &[1, 2, 0, 2, 1, 0],
            &[0.8, 0.2, 0.8, 0.5, 0.5, 0.2],
            options,
        )
        .expect("fuzzy graph");
        assert_eq!(graph.vertex_count(), 3);
        assert_eq!(graph.row_offsets(), &[0, 2, 4, 6]);
        assert_eq!(graph.column_indices(), &[1, 2, 0, 2, 0, 1]);
        assert!(graph
            .weights()
            .iter()
            .all(|weight| (0.0..=1.0).contains(weight)));
    }
}
