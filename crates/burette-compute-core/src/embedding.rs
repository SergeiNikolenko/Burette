//! CPU reference for the chemical-space embedding optimizer.
//!
//! This is a step-for-step port of `compute/metal/umap.v1.metal`: the same
//! seeded initialization, the same epoch-sampled Jacobi update over the
//! symmetric fuzzy graph, the same hashed negative samples and the same
//! per-method coefficients. Every vertex update in an epoch reads only the
//! previous epoch's positions, so splitting vertices across threads cannot
//! change the result.

use std::{num::NonZeroUsize, thread};

use crate::umap::{fit_umap_curve, ChemicalSpaceMethod, TanimotoUmapGraph, UmapError, UmapOptions};

const GOLDEN_GAMMA: u64 = 0x9e37_79b9_7f4a_7c15;
/// Below this many vertices per worker, thread start-up costs more than the
/// epoch itself.
const MIN_VERTICES_PER_WORKER: usize = 512;

/// Optimizes a chemical-space embedding on the CPU.
///
/// Returns one `[x, y, z, 0]` row per vertex, matching the Metal `float4`
/// layout; `z` is exactly zero for a 2D embedding.
pub fn optimize_embedding(
    graph: &TanimotoUmapGraph,
    options: UmapOptions,
    method: ChemicalSpaceMethod,
) -> Result<Vec<[f32; 4]>, UmapError> {
    let workers = thread::available_parallelism().map_or(1, NonZeroUsize::get);
    optimize_embedding_with_workers(graph, options, method, workers)
}

fn optimize_embedding_with_workers(
    graph: &TanimotoUmapGraph,
    options: UmapOptions,
    method: ChemicalSpaceMethod,
    workers: usize,
) -> Result<Vec<[f32; 4]>, UmapError> {
    let vertex_count = graph.vertex_count();
    if vertex_count == 0 {
        return Ok(Vec::new());
    }
    if vertex_count > u32::MAX as usize || graph.edge_count() > u32::MAX as usize {
        return Err(UmapError::InvalidKnn(
            "UMAP graph exceeds the UInt32 vertex or edge limit".into(),
        ));
    }
    let (curve_a, curve_b) = fit_umap_curve(options.spread(), options.min_dist())?;
    let mut input = (0..vertex_count)
        .map(|vertex| initial_position(options, vertex))
        .collect::<Vec<_>>();
    let mut output = vec![[0.0_f32; 4]; vertex_count];
    let chunk_size = vertex_count
        .div_ceil(workers.clamp(1, vertex_count.div_ceil(MIN_VERTICES_PER_WORKER)))
        .max(1);
    for epoch in 0..options.n_epochs() {
        let config = EpochConfig {
            options,
            method,
            curve_a,
            curve_b,
            epoch,
            alpha: options.learning_rate() * (1.0 - epoch as f32 / options.n_epochs() as f32),
        };
        let positions = input.as_slice();
        if chunk_size >= vertex_count {
            for (vertex, row) in output.iter_mut().enumerate() {
                *row = config.update(graph, positions, vertex);
            }
        } else {
            thread::scope(|scope| {
                for (chunk_index, chunk) in output.chunks_mut(chunk_size).enumerate() {
                    let config = &config;
                    scope.spawn(move || {
                        let first = chunk_index * chunk_size;
                        for (offset, row) in chunk.iter_mut().enumerate() {
                            *row = config.update(graph, positions, first + offset);
                        }
                    });
                }
            });
        }
        std::mem::swap(&mut input, &mut output);
    }
    if input.iter().flatten().any(|value| !value.is_finite())
        || (options.n_components() == 2 && input.iter().any(|position| position[2] != 0.0))
    {
        return Err(UmapError::NumericFailure(
            "CPU embedding produced invalid positions".into(),
        ));
    }
    Ok(input)
}

fn initial_position(options: UmapOptions, vertex: usize) -> [f32; 4] {
    let base = options.random_seed() ^ (vertex as u64).wrapping_mul(GOLDEN_GAMMA);
    let x = (unit(base) * 2.0 - 1.0) * 0.01;
    let y = (unit(base.wrapping_add(1)) * 2.0 - 1.0) * 0.01;
    let z = if options.n_components() == 3 {
        (unit(base.wrapping_add(2)) * 2.0 - 1.0) * 0.01
    } else {
        0.0
    };
    [x, y, z, 0.0]
}

struct EpochConfig {
    options: UmapOptions,
    method: ChemicalSpaceMethod,
    curve_a: f32,
    curve_b: f32,
    epoch: u32,
    alpha: f32,
}

impl EpochConfig {
    fn update(&self, graph: &TanimotoUmapGraph, input: &[[f32; 4]], vertex: usize) -> [f32; 4] {
        let vertex_count = input.len();
        let planar = self.options.n_components() == 2;
        let source = [input[vertex][0], input[vertex][1], input[vertex][2]];
        let start = graph.row_offsets()[vertex];
        let end = graph.row_offsets()[vertex + 1];
        if start > end || end > graph.edge_count() as u64 {
            return input[vertex];
        }
        let (a, b) = (self.curve_a, self.curve_b);
        let progress = self.epoch as f32 / (self.options.n_epochs() as f32).max(1.0);
        let mut delta = [0.0_f32; 3];
        for edge in start..end {
            let weight = graph.weights()[edge as usize].clamp(0.0, 1.0);
            let previous_samples = (self.epoch as f32 * weight).floor();
            let current_samples = ((self.epoch + 1) as f32 * weight).floor();
            if current_samples <= previous_samples {
                continue;
            }
            let target = graph.column_indices()[edge as usize] as usize;
            if target >= vertex_count || target == vertex {
                continue;
            }
            let difference = difference(source, input[target], planar);
            let distance_squared = dot(difference).max(1e-6);
            let student = 1.0 / (1.0 + distance_squared);
            let coefficient = match self.method {
                ChemicalSpaceMethod::Umap | ChemicalSpaceMethod::Tmap => {
                    -2.0 * a * b * distance_squared.powf(b - 1.0)
                        / (1.0 + a * distance_squared.powf(b))
                }
                ChemicalSpaceMethod::Tsne => -4.0 * weight * student,
                ChemicalSpaceMethod::Pacmap => {
                    let phase_weight = if progress < 0.2 {
                        2.0
                    } else if progress < 0.6 {
                        3.0
                    } else {
                        1.0
                    };
                    -phase_weight * weight * 20.0 / (10.0 + distance_squared).powf(2.0)
                }
                ChemicalSpaceMethod::Localmap => {
                    let local_scale = if progress < 0.6 { 3.0 } else { 6.0 };
                    -local_scale * weight / (1.0 + distance_squared)
                }
                ChemicalSpaceMethod::Trimap => -2.0 * weight * student * student,
                ChemicalSpaceMethod::Dreams => -4.0 * weight * student * 0.85,
                ChemicalSpaceMethod::Cne => -2.0 * weight * student,
                ChemicalSpaceMethod::Mmae => {
                    let target_distance = (1.0 - weight).max(0.02);
                    let distance = distance_squared.sqrt();
                    -2.0 * (distance - target_distance) / distance.max(1e-3)
                }
            };
            accumulate(&mut delta, coefficient, difference, self.alpha);

            for sample in 0..self.options.negative_sample_rate() {
                let random = self.options.random_seed()
                    ^ (u64::from(self.epoch) << 48)
                    ^ ((vertex as u64) << 24)
                    ^ edge.wrapping_mul(GOLDEN_GAMMA)
                    ^ u64::from(sample);
                let negative = (mix(random) % vertex_count as u64) as usize;
                if negative == vertex {
                    continue;
                }
                let difference = self::difference(source, input[negative], planar);
                let distance_squared = dot(difference).max(1e-6);
                let student = 1.0 / (1.0 + distance_squared);
                let coefficient = match self.method {
                    ChemicalSpaceMethod::Umap | ChemicalSpaceMethod::Tmap => {
                        2.0 * b
                            / ((0.001 + distance_squared) * (1.0 + a * distance_squared.powf(b)))
                    }
                    ChemicalSpaceMethod::Tsne => 4.0 * student * student,
                    ChemicalSpaceMethod::Pacmap => 2.0 / (1.0 + distance_squared).powf(2.0),
                    ChemicalSpaceMethod::Localmap => {
                        if progress < 0.6 {
                            2.0 * student * student
                        } else {
                            4.0 * student * student
                        }
                    }
                    ChemicalSpaceMethod::Trimap => 2.0 * weight * student * student,
                    ChemicalSpaceMethod::Dreams => 3.4 * student * student,
                    ChemicalSpaceMethod::Cne => 2.0 * student * student,
                    ChemicalSpaceMethod::Mmae => 0.25 * student,
                };
                accumulate(&mut delta, coefficient, difference, self.alpha);
            }
        }
        let z = if planar { 0.0 } else { source[2] + delta[2] };
        [source[0] + delta[0], source[1] + delta[1], z, 0.0]
    }
}

fn difference(source: [f32; 3], other: [f32; 4], planar: bool) -> [f32; 3] {
    [
        source[0] - other[0],
        source[1] - other[1],
        if planar { 0.0 } else { source[2] - other[2] },
    ]
}

fn dot(vector: [f32; 3]) -> f32 {
    vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]
}

fn accumulate(delta: &mut [f32; 3], coefficient: f32, difference: [f32; 3], alpha: f32) {
    for (delta, component) in delta.iter_mut().zip(difference) {
        *delta += (coefficient * component).clamp(-4.0, 4.0) * alpha;
    }
}

fn mix(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn unit(value: u64) -> f32 {
    (mix(value) >> 40) as f32 * (1.0 / 16_777_216.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::umap::build_tanimoto_umap_graph;

    const METHODS: [ChemicalSpaceMethod; 8] = [
        ChemicalSpaceMethod::Umap,
        ChemicalSpaceMethod::Tsne,
        ChemicalSpaceMethod::Pacmap,
        ChemicalSpaceMethod::Localmap,
        ChemicalSpaceMethod::Trimap,
        ChemicalSpaceMethod::Dreams,
        ChemicalSpaceMethod::Cne,
        ChemicalSpaceMethod::Mmae,
    ];

    /// Two families of `size` vertices; each vertex's neighbors are the next
    /// `k` family members on a ring, and one weak edge links the families.
    fn two_family_graph(size: usize, k: usize, options: UmapOptions) -> TanimotoUmapGraph {
        let mut indices = Vec::new();
        let mut similarities = Vec::new();
        for vertex in 0..2 * size {
            let family = vertex / size;
            for offset in 1..=k {
                let neighbor = family * size + (vertex % size + offset) % size;
                let bridge = offset == k && vertex % size == size - 1;
                indices.push(if bridge {
                    ((1 - family) * size) as u32
                } else {
                    neighbor as u32
                });
                similarities.push(if bridge {
                    0.05
                } else {
                    0.9 - 0.02 * offset as f32
                });
            }
        }
        build_tanimoto_umap_graph(
            2 * size,
            NonZeroUsize::new(k).expect("nonzero k"),
            &indices,
            &similarities,
            options,
        )
        .expect("two-family fuzzy graph")
    }

    /// First four positions after three epochs on a 12-vertex ring, recorded
    /// from the Metal kernel (runtime v22, Apple M2 Pro). The CPU port agreed
    /// to within 2e-7 of these values on macOS; the bound leaves room for
    /// another platform's `powf` and `sqrt` rounding.
    #[test]
    fn matches_known_metal_embeddings_on_a_small_ring() {
        let vertex_count = 12_u32;
        let mut indices = Vec::new();
        let mut similarities = Vec::new();
        for vertex in 0..vertex_count {
            for (offset, similarity) in [(1, 0.8), (2, 0.6), (vertex_count - 1, 0.8)] {
                indices.push((vertex + offset) % vertex_count);
                similarities.push(similarity);
            }
        }
        let cases: [(u32, ChemicalSpaceMethod, [[f32; 3]; 4]); 3] = [
            (
                2,
                ChemicalSpaceMethod::Umap,
                [
                    [-17.82496, -15.51187, 0.0],
                    [9.521948, 13.452747, 0.0],
                    [27.01677, -39.715183, 0.0],
                    [4.2791224, 39.74453, 0.0],
                ],
            ),
            (
                3,
                ChemicalSpaceMethod::Mmae,
                [
                    [0.17574802, -0.26392272, 0.4089962],
                    [0.44138354, -0.29032278, 0.05073139],
                    [0.35235193, 0.4279737, 0.4419557],
                    [-0.08486368, 0.025320888, 0.08457908],
                ],
            ),
            (
                2,
                ChemicalSpaceMethod::Pacmap,
                [
                    [-0.7850414, -1.7667941, 0.0],
                    [1.9867283, 0.86375475, 0.0],
                    [2.906846, -4.2229724, 0.0],
                    [-0.5773686, 5.319914, 0.0],
                ],
            ),
        ];
        for (components, method, expected) in cases {
            let options =
                UmapOptions::try_new(components, 3, 0.1, 1.0, 1.0, 5, 42).expect("options");
            let graph = build_tanimoto_umap_graph(
                vertex_count as usize,
                NonZeroUsize::new(3).expect("nonzero k"),
                &indices,
                &similarities,
                options,
            )
            .expect("ring fuzzy graph");
            let positions = optimize_embedding(&graph, options, method).expect("CPU embedding");
            for (observed, expected) in positions.iter().zip(expected) {
                assert!(
                    observed
                        .iter()
                        .zip(expected)
                        .all(|(observed, expected)| (observed - expected).abs()
                            <= 1.0e-5 * expected.abs().max(1.0)),
                    "{method:?}: {observed:?} vs Metal {expected:?}"
                );
            }
        }
    }

    #[test]
    fn threaded_epochs_match_the_single_threaded_reference_bit_for_bit() {
        let options = UmapOptions::try_new(3, 40, 0.1, 1.0, 1.0, 5, 7).expect("options");
        // A 1,100-vertex ring spans three worker chunks.
        let vertex_count = 1_100_u32;
        let mut indices = Vec::new();
        let mut similarities = Vec::new();
        for vertex in 0..vertex_count {
            for (offset, similarity) in [(1, 0.8), (2, 0.6), (vertex_count - 1, 0.8)] {
                indices.push((vertex + offset) % vertex_count);
                similarities.push(similarity);
            }
        }
        let graph = build_tanimoto_umap_graph(
            vertex_count as usize,
            NonZeroUsize::new(3).expect("nonzero k"),
            &indices,
            &similarities,
            options,
        )
        .expect("ring fuzzy graph");
        for method in [ChemicalSpaceMethod::Umap, ChemicalSpaceMethod::Pacmap] {
            let single = optimize_embedding_with_workers(&graph, options, method, 1)
                .expect("single-threaded embedding");
            let threaded = optimize_embedding_with_workers(&graph, options, method, 4)
                .expect("threaded embedding");
            assert_eq!(single, threaded, "{method:?}");
        }
    }

    #[test]
    fn every_objective_separates_two_tanimoto_cliques() {
        const SIZE: usize = 60;
        for components in [2, 3] {
            let options =
                UmapOptions::try_new(components, 200, 0.1, 1.0, 1.0, 5, 42).expect("options");
            let graph = two_family_graph(SIZE, 10, options);
            for method in METHODS {
                let positions = optimize_embedding(&graph, options, method).expect("CPU embedding");
                assert_eq!(positions.len(), 2 * SIZE);
                assert!(positions.iter().flatten().all(|value| value.is_finite()));
                assert_eq!(
                    positions.iter().all(|position| position[2] == 0.0),
                    components == 2,
                    "{method:?} {components}D"
                );
                let distance = |left: usize, right: usize| {
                    (0..3)
                        .map(|axis| (positions[left][axis] - positions[right][axis]).powi(2))
                        .sum::<f32>()
                        .sqrt()
                };
                let mean = |pairs: &[(usize, usize)]| {
                    pairs.iter().map(|&(l, r)| distance(l, r)).sum::<f32>() / pairs.len() as f32
                };
                let mut within = Vec::new();
                let mut across = Vec::new();
                for left in 0..2 * SIZE {
                    for right in left + 1..2 * SIZE {
                        if left / SIZE == right / SIZE {
                            within.push((left, right));
                        } else {
                            across.push((left, right));
                        }
                    }
                }
                assert!(
                    mean(&within) < mean(&across),
                    "{method:?} {components}D: within {} across {}",
                    mean(&within),
                    mean(&across)
                );
            }
        }
    }
}
