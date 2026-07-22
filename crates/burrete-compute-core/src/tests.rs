use std::num::NonZeroUsize;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use burrete_compute_protocol::{ResourceLimits, SimilarityCutoff};
use serde::Deserialize;

use super::*;

fn fingerprint(bits: &[usize]) -> Fingerprint2048 {
    let mut words = [0_u64; FINGERPRINT_WORDS];
    for bit in bits {
        words[bit / 64] |= 1_u64 << (bit % 64);
    }
    Fingerprint2048::from_words(words)
}

#[test]
fn canonical_fingerprint_bytes_and_metal_view_are_identical() {
    assert_eq!(std::mem::size_of::<Fingerprint2048>(), FINGERPRINT_BYTES);
    assert_eq!(std::mem::align_of::<Fingerprint2048>(), 8);
    let value = fingerprint(&[0, 31, 32, 63, 64, 2047]);
    let bytes = value.to_le_bytes();
    assert_eq!(Fingerprint2048::from_le_bytes(bytes), value);

    let metal = value.to_metal_words();
    assert_eq!(
        [metal[0], metal[1], metal[2], metal[63]],
        [0x8000_0001, 0x8000_0001, 1, 0x8000_0000]
    );
    let metal_bytes: Vec<u8> = metal.into_iter().flat_map(u32::to_le_bytes).collect();
    assert_eq!(metal_bytes, bytes);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MorganFixture {
    schema_version: String,
    rdkit_version: String,
    settings: MorganFixtureSettings,
    records: Vec<MorganFixtureRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MorganFixtureSettings {
    radius: u32,
    bit_count: usize,
    use_chirality: bool,
    use_features: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MorganFixtureRecord {
    smiles: String,
    popcount: u32,
    fingerprint_base64: String,
}

#[test]
fn pinned_rdkit_fixture_decodes_into_the_canonical_fingerprint_abi() {
    let fixture: MorganFixture = serde_json::from_str(include_str!(
        "../../../schemas/compute/fixtures/rdkit-morgan-known-answer.v1.json"
    ))
    .expect("parse pinned RDKit fixture");
    assert_eq!(
        fixture.schema_version,
        "burrete.rdkit-morgan-known-answer.v1"
    );
    assert_eq!(fixture.rdkit_version, "2025.03.4");
    assert_eq!(fixture.settings.radius, 2);
    assert_eq!(fixture.settings.bit_count, FINGERPRINT_BITS);
    assert!(fixture.settings.use_chirality);
    assert!(!fixture.settings.use_features);
    assert_eq!(fixture.records.len(), 4);

    for record in fixture.records {
        let bytes = STANDARD
            .decode(record.fingerprint_base64)
            .expect("decode fixture fingerprint");
        let bytes: [u8; FINGERPRINT_BYTES] = bytes
            .try_into()
            .expect("fixture fingerprint has the canonical byte width");
        let fingerprint = Fingerprint2048::from_le_bytes(bytes);
        let observed = fingerprint
            .words()
            .iter()
            .map(|word| word.count_ones())
            .sum::<u32>();
        assert_eq!(observed, record.popcount, "{}", record.smiles);
        assert_eq!(fingerprint.to_le_bytes(), bytes, "{}", record.smiles);
    }
}

fn options(tile_size: usize, max_undirected_edges: u64) -> GraphBuildOptions {
    options_with_memory(tile_size, max_undirected_edges, 1024 * 1024)
}

fn options_with_memory(
    tile_size: usize,
    max_undirected_edges: u64,
    max_memory_bytes: u64,
) -> GraphBuildOptions {
    GraphBuildOptions::try_new(
        NonZeroUsize::new(tile_size).expect("nonzero tile"),
        max_undirected_edges,
        max_memory_bytes,
    )
    .expect("valid graph options")
}

fn butina_options(max_memory_bytes: u64) -> ButinaOptions {
    butina_options_with_edges(MAX_UNDIRECTED_SIMILARITY_EDGES, max_memory_bytes)
}

fn butina_options_with_edges(max_undirected_edges: u64, max_memory_bytes: u64) -> ButinaOptions {
    ButinaOptions::try_new(max_undirected_edges, max_memory_bytes).expect("valid Butina options")
}

#[test]
fn empty_and_zero_fingerprints_follow_explicit_cutoff_semantics() {
    let empty = build_tanimoto_graph(
        &[],
        SimilarityCutoff {
            numerator: 1,
            denominator: 2,
        },
        options(4, 1),
    )
    .expect("empty graph");
    assert_eq!(empty.row_offsets(), &[0]);
    assert!(butina_clusters(&empty, butina_options(1024 * 1024))
        .expect("cluster empty graph")
        .is_empty());

    let zeros = [Fingerprint2048::ZERO, Fingerprint2048::ZERO];
    let positive = build_tanimoto_graph(
        &zeros,
        SimilarityCutoff {
            numerator: 1,
            denominator: 2,
        },
        options(1, 1),
    )
    .expect("positive cutoff graph");
    assert_eq!(positive.row_offsets(), &[0, 0, 0]);
    assert_eq!(
        butina_clusters(&positive, butina_options(1024 * 1024))
            .expect("cluster disconnected graph"),
        vec![vec![0], vec![1]]
    );

    let zero = build_tanimoto_graph(
        &zeros,
        SimilarityCutoff {
            numerator: 0,
            denominator: 1,
        },
        options(1, 1),
    )
    .expect("zero cutoff graph");
    assert_eq!(zero.row_offsets(), &[0, 1, 2]);
    assert_eq!(zero.column_indices(), &[1, 0]);
    assert_eq!(
        butina_clusters(&zero, butina_options(1024 * 1024)).expect("cluster zero fingerprints"),
        vec![vec![0, 1]]
    );
}

#[test]
fn duplicates_and_exact_rational_boundary_are_included() {
    let left = fingerprint(&[0, 1, 2, 3, 4, 5, 6, 7]);
    let right = fingerprint(&[0, 1, 2, 3, 4, 5, 6, 8, 9]);
    assert_eq!(
        left.tanimoto_counts(&right),
        TanimotoCounts {
            intersection: 7,
            union: 10,
        }
    );

    let boundary = build_tanimoto_graph(
        &[left, right, left],
        SimilarityCutoff {
            numerator: 7,
            denominator: 10,
        },
        options(2, 3),
    )
    .expect("boundary graph");
    assert_eq!(boundary.undirected_edge_count(), 3);

    let above = build_tanimoto_graph(
        &[left, right],
        SimilarityCutoff {
            numerator: 701,
            denominator: 1_000,
        },
        options(2, 1),
    )
    .expect("above-boundary graph");
    assert_eq!(above.undirected_edge_count(), 0);
}

#[test]
fn query_scoring_preserves_exact_counts_order_and_zero_semantics() {
    let query = fingerprint(&[0, 1, 2, 3]);
    let library = [
        fingerprint(&[0, 1, 2, 3]),
        fingerprint(&[0, 1]),
        fingerprint(&[0, 4]),
        Fingerprint2048::ZERO,
    ];
    let options = TanimotoQueryOptions::new(1024 * 1024).expect("query options");
    let counts = score_tanimoto_query(&query, &library, options).expect("query scores");
    assert_eq!(
        counts,
        vec![
            TanimotoCounts {
                intersection: 4,
                union: 4,
            },
            TanimotoCounts {
                intersection: 2,
                union: 4,
            },
            TanimotoCounts {
                intersection: 1,
                union: 5,
            },
            TanimotoCounts {
                intersection: 0,
                union: 4,
            },
        ]
    );
    assert_eq!(counts[0].similarity(), 1.0);
    assert_eq!(counts[1].similarity(), 0.5);
    assert_eq!(counts[3].similarity(), 0.0);
    assert_eq!(
        TanimotoCounts {
            intersection: 0,
            union: 0,
        }
        .compare_similarity(counts[3]),
        std::cmp::Ordering::Equal
    );
    assert_eq!(
        counts[2].compare_similarity(counts[1]),
        std::cmp::Ordering::Less
    );
}

#[test]
fn query_scoring_enforces_the_exact_output_memory_boundary() {
    let library = [Fingerprint2048::ZERO; 4];
    let required = accounted_tanimoto_query_bytes(library.len()).expect("query memory account");
    let exact = TanimotoQueryOptions::new(required).expect("exact query options");
    assert_eq!(
        score_tanimoto_query(&Fingerprint2048::ZERO, &library, exact)
            .expect("score at exact query memory boundary")
            .len(),
        library.len()
    );
    let below = TanimotoQueryOptions::new(required - 1).expect("below-boundary options");
    assert_eq!(
        score_tanimoto_query(&Fingerprint2048::ZERO, &library, below)
            .expect_err("query memory must fail one byte below the account"),
        ClusterCoreError::MemoryBudgetExceeded {
            required_bytes: required,
            limit_bytes: required - 1,
        }
    );
}

fn knn_options(neighbor_count: usize, max_memory_bytes: u64) -> TanimotoKnnOptions {
    TanimotoKnnOptions::try_new(
        NonZeroUsize::new(neighbor_count).expect("nonzero neighbor count"),
        max_memory_bytes,
    )
    .expect("valid kNN options")
}

#[test]
fn exact_tanimoto_knn_orders_by_ratio_then_source_index() {
    let fingerprints = [
        fingerprint(&[0, 1, 2, 3]),
        fingerprint(&[0, 1, 2, 3]),
        fingerprint(&[0, 1]),
        fingerprint(&[0, 4]),
        Fingerprint2048::ZERO,
    ];
    let graph =
        build_tanimoto_knn(&fingerprints, knn_options(3, 1024 * 1024)).expect("exact Tanimoto kNN");

    assert_eq!(graph.vertex_count(), fingerprints.len());
    assert_eq!(graph.neighbors_per_vertex(), 3);
    assert_eq!(
        graph
            .neighbors(0)
            .expect("first row")
            .map(|(index, counts)| (index, counts.intersection, counts.union))
            .collect::<Vec<_>>(),
        vec![(1, 4, 4), (2, 2, 4), (3, 1, 5)]
    );
    assert_eq!(
        graph
            .neighbors(4)
            .expect("zero row")
            .map(|(index, _)| index)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert!(graph.neighbors(fingerprints.len()).is_none());
}

#[test]
fn exact_tanimoto_knn_clamps_k_and_handles_empty_input() {
    let fingerprints = [fingerprint(&[0]), fingerprint(&[1]), fingerprint(&[2])];
    let graph =
        build_tanimoto_knn(&fingerprints, knn_options(64, 1024 * 1024)).expect("clamped kNN");
    assert_eq!(graph.neighbors_per_vertex(), 2);
    assert_eq!(graph.source_indices().len(), 6);
    assert_eq!(graph.counts().len(), 6);

    let empty = build_tanimoto_knn(&[], knn_options(64, 1024 * 1024)).expect("empty kNN");
    assert_eq!(empty.vertex_count(), 0);
    assert_eq!(empty.neighbors_per_vertex(), 0);
    assert!(empty.source_indices().is_empty());
    assert!(empty.counts().is_empty());
}

#[test]
fn exact_tanimoto_knn_enforces_the_accounted_memory_boundary() {
    let fingerprints = [fingerprint(&[0]); 4];
    let required = accounted_tanimoto_knn_bytes(fingerprints.len(), 2).expect("kNN account");
    assert!(build_tanimoto_knn(&fingerprints, knn_options(2, required)).is_ok());
    assert_eq!(
        build_tanimoto_knn(&fingerprints, knn_options(2, required - 1))
            .expect_err("one byte below kNN account"),
        ClusterCoreError::MemoryBudgetExceeded {
            required_bytes: required,
            limit_bytes: required - 1,
        }
    );
}

#[test]
fn integer_threshold_has_full_protocol_parity_for_2048_bit_counts() {
    let cutoffs = [
        SimilarityCutoff {
            numerator: 0,
            denominator: 7,
        },
        SimilarityCutoff {
            numerator: 1,
            denominator: 3,
        },
        SimilarityCutoff {
            numerator: 7,
            denominator: 10,
        },
        SimilarityCutoff {
            numerator: 1,
            denominator: 1,
        },
    ];

    for cutoff in cutoffs {
        let normalized = cutoff.normalized().expect("valid cutoff");
        for union in 0..=FINGERPRINT_BITS as u64 {
            for intersection in 0..=union {
                let counts = TanimotoCounts {
                    intersection,
                    union,
                };
                assert_eq!(
                    exact_match(counts, normalized),
                    cutoff
                        .matches_counts(intersection, union)
                        .expect("valid counts")
                );
            }
        }
    }
}

#[test]
fn tiled_enumeration_is_tile_size_invariant() {
    let fingerprints = [
        fingerprint(&[0, 1, 2]),
        fingerprint(&[0, 1]),
        fingerprint(&[2, 3]),
        fingerprint(&[0, 1, 2]),
        Fingerprint2048::ZERO,
    ];
    let cutoff = SimilarityCutoff {
        numerator: 1,
        denominator: 2,
    };
    let reference =
        build_tanimoto_graph(&fingerprints, cutoff, options(1, 10)).expect("unit-tile graph");

    for tile_size in [2, 3, 4, 8] {
        assert_eq!(
            build_tanimoto_graph(&fingerprints, cutoff, options(tile_size, 10))
                .expect("alternate-tile graph"),
            reference
        );
    }
}

#[test]
fn dense_graph_fails_at_the_first_edge_beyond_budget() {
    let duplicate = fingerprint(&[7, 20]);
    let error = build_tanimoto_graph(
        &[duplicate; 4],
        SimilarityCutoff {
            numerator: 1,
            denominator: 1,
        },
        options(3, 5),
    )
    .expect_err("six-edge graph exceeds budget five");
    assert_eq!(
        error,
        ClusterCoreError::EdgeBudgetExceeded {
            limit: 5,
            observed_at_least: 6,
        }
    );
}

#[test]
fn dense_graph_memory_admission_accepts_exact_boundary_and_rejects_one_byte_less() {
    let duplicate = fingerprint(&[7, 20]);
    let fingerprints = [duplicate; 4];
    let cutoff = SimilarityCutoff {
        numerator: 1,
        denominator: 1,
    };
    let required_bytes =
        accounted_working_set_bytes(fingerprints.len(), 6).expect("dense graph memory accounting");

    let graph = build_tanimoto_graph(
        &fingerprints,
        cutoff,
        options_with_memory(2, 6, required_bytes),
    )
    .expect("exact memory boundary");
    assert_eq!(graph.undirected_edge_count(), 6);

    let error = build_tanimoto_graph(
        &fingerprints,
        cutoff,
        options_with_memory(2, 6, required_bytes - 1),
    )
    .expect_err("one byte below accounted memory");
    assert_eq!(
        error,
        ClusterCoreError::MemoryBudgetExceeded {
            required_bytes,
            limit_bytes: required_bytes - 1,
        }
    );
}

#[test]
fn resource_limits_map_max_edges_to_undirected_graph_options() {
    let limits = ResourceLimits {
        max_edges: 42,
        max_memory_bytes: 16 * 1024 * 1024,
        max_dispatch_ms: 250,
    };
    let options = GraphBuildOptions::from_resource_limits(
        NonZeroUsize::new(8).expect("nonzero tile"),
        &limits,
    )
    .expect("resource-backed graph options");
    assert_eq!(options.max_undirected_edges(), 42);
    assert_eq!(options.max_memory_bytes(), 16 * 1024 * 1024);
    assert_eq!(
        ButinaOptions::from_resource_limits(&limits)
            .expect("resource-backed Butina options")
            .max_memory_bytes(),
        16 * 1024 * 1024
    );
    assert_eq!(
        ButinaOptions::from_resource_limits(&limits)
            .expect("resource-backed Butina options")
            .max_undirected_edges(),
        42
    );
    assert_eq!(
        TanimotoQueryOptions::from_resource_limits(&limits)
            .expect("resource-backed query options")
            .max_memory_bytes(),
        16 * 1024 * 1024
    );
    assert_eq!(
        TanimotoKnnOptions::from_resource_limits(
            NonZeroUsize::new(15).expect("nonzero k"),
            &limits,
        )
        .expect("resource-backed kNN options")
        .neighbor_count()
        .get(),
        15
    );
}

#[test]
fn graph_options_enforce_the_protocol_undirected_edge_ceiling() {
    let tile = NonZeroUsize::new(1).expect("nonzero tile");
    assert!(GraphBuildOptions::try_new(tile, MAX_UNDIRECTED_SIMILARITY_EDGES, 1).is_ok());
    assert!(GraphBuildOptions::try_new(tile, 0, 1).is_err());
    assert!(GraphBuildOptions::try_new(tile, MAX_UNDIRECTED_SIMILARITY_EDGES + 1, 1).is_err());
}

#[test]
fn invalid_cutoff_is_rejected_before_pair_enumeration() {
    let error = build_tanimoto_graph(
        &[Fingerprint2048::ZERO],
        SimilarityCutoff {
            numerator: 2,
            denominator: 1,
        },
        options(1, 1),
    )
    .expect_err("invalid cutoff");
    assert!(matches!(error, ClusterCoreError::InvalidCutoff(_)));
}

#[test]
fn butina_ties_choose_the_lowest_live_index() {
    let cycle = SymmetricCsr::try_new(vec![0, 2, 4, 6, 8], vec![1, 3, 0, 2, 1, 3, 0, 2])
        .expect("symmetric cycle");
    assert_eq!(
        butina_clusters(&cycle, butina_options(1024 * 1024)).expect("cluster cycle"),
        vec![vec![0, 1, 3], vec![2]]
    );
}

#[test]
fn butina_recomputes_live_neighbor_counts_after_removal() {
    let graph = SymmetricCsr::try_new(
        vec![0, 3, 5, 7, 8, 10, 11, 12],
        vec![1, 2, 3, 0, 4, 0, 4, 0, 1, 2, 6, 5],
    )
    .expect("dynamic-count fixture");

    assert_eq!(
        butina_clusters(&graph, butina_options(1024 * 1024))
            .expect("cluster dynamic-count fixture"),
        vec![vec![0, 1, 2, 3], vec![5, 6], vec![4]]
    );
}

#[test]
fn imported_csr_butina_enforces_memory_before_allocation() {
    let graph = SymmetricCsr::try_new(vec![0, 1, 2], vec![1, 0]).expect("single-edge graph");
    let required_bytes =
        accounted_butina_working_set_bytes(&graph).expect("Butina memory accounting");
    let error = butina_clusters(&graph, butina_options(required_bytes - 1))
        .expect_err("imported CSR exceeds Butina memory budget");
    assert_eq!(
        error,
        ClusterCoreError::MemoryBudgetExceeded {
            required_bytes,
            limit_bytes: required_bytes - 1,
        }
    );
    assert_eq!(
        butina_clusters(&graph, butina_options(required_bytes)).expect("exact Butina budget"),
        vec![vec![0, 1]]
    );
}

#[test]
fn imported_csr_butina_enforces_undirected_edge_budget_before_allocation() {
    let graph =
        SymmetricCsr::try_new(vec![0, 2, 4, 6], vec![1, 2, 0, 2, 0, 1]).expect("three-edge graph");
    let options = butina_options_with_edges(2, 1024 * 1024);
    assert_eq!(
        butina_clusters(&graph, options).expect_err("imported CSR exceeds edge budget"),
        ClusterCoreError::EdgeBudgetExceeded {
            limit: 2,
            observed_at_least: 3,
        }
    );
}

#[test]
fn isolated_graph_reserves_cluster_headers_once_within_budget() {
    let vertex_count = 2_048;
    let graph =
        SymmetricCsr::try_new(vec![0; vertex_count + 1], Vec::new()).expect("isolated graph");
    let required_bytes =
        accounted_butina_working_set_bytes(&graph).expect("isolated Butina accounting");
    let clusters = butina_clusters(&graph, butina_options(required_bytes))
        .expect("cluster isolated graph at exact budget");
    assert_eq!(clusters.len(), vertex_count);
    assert_eq!(clusters.first(), Some(&vec![0]));
    assert_eq!(clusters.last(), Some(&vec![(vertex_count - 1) as u64]));
}

#[test]
fn csr_offsets_cross_u32_without_truncation_or_large_allocation() {
    let offsets = prefix_offsets(&[u64::from(u32::MAX), 2]).expect("u64 prefix sum");
    assert_eq!(offsets, vec![0, u64::from(u32::MAX), 4_294_967_297]);
}

#[test]
fn imported_csr_must_be_sorted_loop_free_and_symmetric() {
    assert_eq!(
        SymmetricCsr::try_new(vec![0, 1, 1], vec![1]).expect_err("asymmetric graph"),
        ClusterCoreError::InvalidCsr("every edge must have a reverse edge")
    );
    assert_eq!(
        SymmetricCsr::try_new(vec![0, 1], vec![0]).expect_err("self edge"),
        ClusterCoreError::InvalidCsr("neighbors must be in range and cannot be self edges")
    );
}
