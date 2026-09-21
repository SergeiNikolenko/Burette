use std::{
    collections::{HashMap, VecDeque},
    num::NonZeroUsize,
};

#[derive(Clone, Debug, PartialEq)]
pub struct TmapLayout {
    positions: Vec<[f32; 3]>,
    tree_edges: Vec<[u32; 2]>,
}

impl TmapLayout {
    pub fn positions(&self) -> &[[f32; 3]] {
        &self.positions
    }

    pub fn into_positions(self) -> Vec<[f32; 3]> {
        self.positions
    }

    pub fn tree_edges(&self) -> &[[u32; 2]] {
        &self.tree_edges
    }

    pub fn into_parts(self) -> (Vec<[f32; 3]>, Vec<[u32; 2]>) {
        (self.positions, self.tree_edges)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TmapError {
    InvalidOptions(String),
    InvalidKnn(String),
}

impl std::fmt::Display for TmapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidOptions(message) => write!(formatter, "invalid TMAP options: {message}"),
            Self::InvalidKnn(message) => write!(formatter, "invalid TMAP kNN: {message}"),
        }
    }
}

impl std::error::Error for TmapError {}

#[derive(Clone, Copy, Debug)]
struct CandidateEdge {
    left: u32,
    right: u32,
    distance: f32,
}

pub fn build_tmap_layout(
    vertex_count: usize,
    neighbors_per_vertex: NonZeroUsize,
    source_indices: &[u32],
    similarities: &[f32],
    component_count: u32,
) -> Result<TmapLayout, TmapError> {
    if !matches!(component_count, 2 | 3) {
        return Err(TmapError::InvalidOptions(
            "component_count must be 2 or 3".into(),
        ));
    }
    if vertex_count > u32::MAX as usize {
        return Err(TmapError::InvalidKnn(
            "vertex count exceeds UInt32 capacity".into(),
        ));
    }
    let neighbors = neighbors_per_vertex.get();
    let expected = vertex_count
        .checked_mul(neighbors)
        .ok_or_else(|| TmapError::InvalidKnn("matrix size overflow".into()))?;
    if source_indices.len() != expected || similarities.len() != expected {
        return Err(TmapError::InvalidKnn(format!(
            "expected {expected} indices and similarities"
        )));
    }

    let mut best_similarities = HashMap::<(u32, u32), f32>::with_capacity(expected);
    for row in 0..vertex_count {
        let start = row * neighbors;
        for edge in start..start + neighbors {
            let column = source_indices[edge] as usize;
            let similarity = similarities[edge];
            if column >= vertex_count {
                return Err(TmapError::InvalidKnn(format!(
                    "row {row} references vertex {column} outside {vertex_count}"
                )));
            }
            if column == row {
                continue;
            }
            if !similarity.is_finite() || !(0.0..=1.0).contains(&similarity) {
                return Err(TmapError::InvalidKnn(format!(
                    "row {row} contains a similarity outside [0, 1]"
                )));
            }
            let pair = if row < column {
                (row as u32, column as u32)
            } else {
                (column as u32, row as u32)
            };
            best_similarities
                .entry(pair)
                .and_modify(|best| *best = best.max(similarity))
                .or_insert(similarity);
        }
    }

    let mut candidates = best_similarities
        .into_iter()
        .map(|((left, right), similarity)| CandidateEdge {
            left,
            right,
            distance: 1.0 - similarity,
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.distance
            .total_cmp(&right.distance)
            .then_with(|| left.left.cmp(&right.left))
            .then_with(|| left.right.cmp(&right.right))
    });

    let mut components = UnionFind::new(vertex_count);
    let mut tree = Vec::with_capacity(vertex_count.saturating_sub(1));
    for edge in candidates {
        if components.union(edge.left as usize, edge.right as usize) {
            tree.push(edge);
        }
    }

    let positions = layout_forest(vertex_count, &tree, component_count);
    let tree_edges = tree
        .into_iter()
        .map(|edge| [edge.left, edge.right])
        .collect();
    Ok(TmapLayout {
        positions,
        tree_edges,
    })
}

fn layout_forest(
    vertex_count: usize,
    tree: &[CandidateEdge],
    component_count: u32,
) -> Vec<[f32; 3]> {
    let mut adjacency = vec![Vec::<(usize, f32)>::new(); vertex_count];
    for edge in tree {
        adjacency[edge.left as usize].push((edge.right as usize, edge.distance));
        adjacency[edge.right as usize].push((edge.left as usize, edge.distance));
    }
    for neighbors in &mut adjacency {
        neighbors.sort_by_key(|(vertex, _)| *vertex);
    }

    let mut visited = vec![false; vertex_count];
    let mut forest = Vec::<Vec<usize>>::new();
    for start in 0..vertex_count {
        if visited[start] {
            continue;
        }
        let mut vertices = Vec::new();
        let mut stack = vec![start];
        visited[start] = true;
        while let Some(vertex) = stack.pop() {
            vertices.push(vertex);
            for &(neighbor, _) in &adjacency[vertex] {
                if !visited[neighbor] {
                    visited[neighbor] = true;
                    stack.push(neighbor);
                }
            }
        }
        vertices.sort_unstable();
        forest.push(vertices);
    }
    forest.sort_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left[0].cmp(&right[0]))
    });

    let mut positions = vec![[0.0_f32; 3]; vertex_count];
    let mut cursor_x = 0.0_f32;
    for vertices in forest {
        let root = vertices
            .iter()
            .copied()
            .max_by_key(|vertex| (adjacency[*vertex].len(), std::cmp::Reverse(*vertex)))
            .expect("forest component is non-empty");
        let mut parent = vec![usize::MAX; vertex_count];
        let mut parent_distance = vec![0.0_f32; vertex_count];
        let mut order = Vec::with_capacity(vertices.len());
        let mut queue = VecDeque::from([root]);
        parent[root] = root;
        while let Some(vertex) = queue.pop_front() {
            order.push(vertex);
            for &(neighbor, distance) in &adjacency[vertex] {
                if parent[neighbor] != usize::MAX {
                    continue;
                }
                parent[neighbor] = vertex;
                parent_distance[neighbor] = distance;
                queue.push_back(neighbor);
            }
        }

        let mut children = vec![Vec::<usize>::new(); vertex_count];
        for &vertex in order.iter().skip(1) {
            children[parent[vertex]].push(vertex);
        }
        let mut leaf_weight = vec![1_usize; vertex_count];
        for &vertex in order.iter().rev() {
            if !children[vertex].is_empty() {
                leaf_weight[vertex] = children[vertex]
                    .iter()
                    .map(|child| leaf_weight[*child])
                    .sum();
            }
            children[vertex].sort_by_key(|child| (std::cmp::Reverse(leaf_weight[*child]), *child));
        }

        let full_turn = std::f32::consts::TAU;
        let mut placement = vec![(root, 0.0_f32, full_turn, 0.0_f32, 0_usize)];
        while let Some((vertex, angle_start, angle_end, radius, depth)) = placement.pop() {
            if vertex != root {
                let angle = (angle_start + angle_end) * 0.5;
                positions[vertex][0] = angle.cos() * radius;
                positions[vertex][1] = angle.sin() * radius;
                if component_count == 3 {
                    let phase = angle + depth as f32 * 2.399_963_1;
                    positions[vertex][2] = phase.sin() * radius * 0.28;
                }
            }
            let total_weight = children[vertex]
                .iter()
                .map(|child| leaf_weight[*child])
                .sum::<usize>()
                .max(1) as f32;
            let mut next_angle = angle_start;
            for &child in &children[vertex] {
                let span =
                    (angle_end - angle_start) * leaf_weight[child] as f32 / total_weight;
                let child_radius = radius + 0.65 + parent_distance[child] * 1.7;
                placement.push((
                    child,
                    next_angle,
                    next_angle + span,
                    child_radius,
                    depth + 1,
                ));
                next_angle += span;
            }
        }

        let (mut min_x, mut max_x, mut min_y, mut max_y) =
            (f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY);
        for &vertex in &vertices {
            min_x = min_x.min(positions[vertex][0]);
            max_x = max_x.max(positions[vertex][0]);
            min_y = min_y.min(positions[vertex][1]);
            max_y = max_y.max(positions[vertex][1]);
        }
        let width = (max_x - min_x).max(0.5);
        let center_y = (min_y + max_y) * 0.5;
        for &vertex in &vertices {
            positions[vertex][0] += cursor_x - min_x;
            positions[vertex][1] -= center_y;
        }
        cursor_x += width + 1.0;
    }

    center_positions(&mut positions);
    positions
}

fn center_positions(positions: &mut [[f32; 3]]) {
    if positions.is_empty() {
        return;
    }
    let mut minimum = [f32::INFINITY; 3];
    let mut maximum = [f32::NEG_INFINITY; 3];
    for position in positions.iter() {
        for component in 0..3 {
            minimum[component] = minimum[component].min(position[component]);
            maximum[component] = maximum[component].max(position[component]);
        }
    }
    let center = [
        (minimum[0] + maximum[0]) * 0.5,
        (minimum[1] + maximum[1]) * 0.5,
        (minimum[2] + maximum[2]) * 0.5,
    ];
    for position in positions {
        for component in 0..3 {
            position[component] -= center[component];
        }
    }
}

struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl UnionFind {
    fn new(vertex_count: usize) -> Self {
        Self {
            parent: (0..vertex_count).collect(),
            rank: vec![0; vertex_count],
        }
    }

    fn find(&mut self, vertex: usize) -> usize {
        let mut root = vertex;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut current = vertex;
        while self.parent[current] != current {
            let next = self.parent[current];
            self.parent[current] = root;
            current = next;
        }
        root
    }

    fn union(&mut self, left: usize, right: usize) -> bool {
        let mut left_root = self.find(left);
        let mut right_root = self.find(right);
        if left_root == right_root {
            return false;
        }
        if self.rank[left_root] < self.rank[right_root] {
            std::mem::swap(&mut left_root, &mut right_root);
        }
        self.parent[right_root] = left_root;
        if self.rank[left_root] == self.rank[right_root] {
            self.rank[left_root] += 1;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tmap_builds_a_minimum_spanning_tree_and_finite_2d_layout() {
        let layout = build_tmap_layout(
            4,
            NonZeroUsize::new(2).unwrap(),
            &[1, 2, 0, 2, 1, 3, 2, 1],
            &[0.9, 0.2, 0.9, 0.8, 0.8, 0.7, 0.7, 0.1],
            2,
        )
        .unwrap();
        assert_eq!(layout.tree_edges(), &[[0, 1], [1, 2], [2, 3]]);
        assert_eq!(layout.positions().len(), 4);
        assert!(layout
            .positions()
            .iter()
            .flatten()
            .all(|value| value.is_finite()));
        assert!(layout.positions().iter().all(|position| position[2] == 0.0));
    }

    #[test]
    fn tmap_three_dimensional_layout_has_depth() {
        let layout = build_tmap_layout(
            4,
            NonZeroUsize::new(2).unwrap(),
            &[1, 2, 0, 3, 0, 3, 1, 2],
            &[0.9, 0.8, 0.9, 0.7, 0.8, 0.6, 0.7, 0.6],
            3,
        )
        .unwrap();
        assert!(layout
            .positions()
            .iter()
            .any(|position| position[2].abs() > f32::EPSILON));
    }

    #[test]
    fn tmap_rejects_invalid_similarity_values() {
        let error = build_tmap_layout(
            2,
            NonZeroUsize::new(1).unwrap(),
            &[1, 0],
            &[1.1, 0.5],
            2,
        )
        .unwrap_err();
        assert!(matches!(error, TmapError::InvalidKnn(_)));
    }
}
