//! Rigid alignment, the RMSD signal, and key-frame interpolation.
//!
//! Frames are flat `[x0, y0, z0, x1, ...]` slices; `selected` and `mobile`
//! hold atom indices.

fn centroid(frame: &[f64], atoms: &[usize]) -> [f64; 3] {
    let mut center = [0.0; 3];
    for &atom in atoms {
        for axis in 0..3 {
            center[axis] += frame[3 * atom + axis];
        }
    }
    center.map(|value| value / atoms.len() as f64)
}

/// Eigenvector of the largest eigenvalue of a symmetric 4x4 matrix (cyclic Jacobi).
fn dominant_eigenvector(mut matrix: [[f64; 4]; 4]) -> [f64; 4] {
    let mut vectors = [[0.0; 4]; 4];
    for (index, row) in vectors.iter_mut().enumerate() {
        row[index] = 1.0;
    }
    for _ in 0..64 {
        let off_diagonal: f64 = (0..4)
            .flat_map(|row| (row + 1..4).map(move |column| (row, column)))
            .map(|(row, column)| matrix[row][column].powi(2))
            .sum();
        let diagonal: f64 = (0..4).map(|index| matrix[index][index].powi(2)).sum();
        if off_diagonal <= 1e-30 * diagonal || off_diagonal == 0.0 {
            break;
        }
        for p in 0..3 {
            for q in p + 1..4 {
                if matrix[p][q] == 0.0 {
                    continue;
                }
                let theta = (matrix[q][q] - matrix[p][p]) / (2.0 * matrix[p][q]);
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for row in matrix.iter_mut() {
                    let (kp, kq) = (row[p], row[q]);
                    row[p] = c * kp - s * kq;
                    row[q] = s * kp + c * kq;
                }
                let (row_p, row_q) = (matrix[p], matrix[q]);
                for k in 0..4 {
                    matrix[p][k] = c * row_p[k] - s * row_q[k];
                    matrix[q][k] = s * row_p[k] + c * row_q[k];
                }
                for row in vectors.iter_mut() {
                    let (vp, vq) = (row[p], row[q]);
                    row[p] = c * vp - s * vq;
                    row[q] = s * vp + c * vq;
                }
            }
        }
    }
    let best = (0..4)
        .max_by(|&left, &right| matrix[left][left].total_cmp(&matrix[right][right]))
        .unwrap_or(0);
    [
        vectors[0][best],
        vectors[1][best],
        vectors[2][best],
        vectors[3][best],
    ]
}

/// Proper rotation that best maps the centred `mobile` atoms onto `reference`
/// (Horn's quaternion solution; the same optimum as Kabsch with its sign fix).
fn optimal_rotation(
    mobile: &[f64],
    mobile_center: [f64; 3],
    reference: &[f64],
    reference_center: [f64; 3],
    selected: &[usize],
) -> [[f64; 3]; 3] {
    let mut s = [[0.0; 3]; 3];
    for &atom in selected {
        for row in 0..3 {
            let a = mobile[3 * atom + row] - mobile_center[row];
            for column in 0..3 {
                s[row][column] += a * (reference[3 * atom + column] - reference_center[column]);
            }
        }
    }
    let n = [
        [
            s[0][0] + s[1][1] + s[2][2],
            s[1][2] - s[2][1],
            s[2][0] - s[0][2],
            s[0][1] - s[1][0],
        ],
        [
            s[1][2] - s[2][1],
            s[0][0] - s[1][1] - s[2][2],
            s[0][1] + s[1][0],
            s[2][0] + s[0][2],
        ],
        [
            s[2][0] - s[0][2],
            s[0][1] + s[1][0],
            -s[0][0] + s[1][1] - s[2][2],
            s[1][2] + s[2][1],
        ],
        [
            s[0][1] - s[1][0],
            s[2][0] + s[0][2],
            s[1][2] + s[2][1],
            -s[0][0] - s[1][1] + s[2][2],
        ],
    ];
    let [w, x, y, z] = dominant_eigenvector(n);
    let norm = (w * w + x * x + y * y + z * z).sqrt();
    let (w, x, y, z) = (w / norm, x / norm, y / norm, z / norm);
    [
        [
            w * w + x * x - y * y - z * z,
            2.0 * (x * y - w * z),
            2.0 * (x * z + w * y),
        ],
        [
            2.0 * (x * y + w * z),
            w * w - x * x + y * y - z * z,
            2.0 * (y * z - w * x),
        ],
        [
            2.0 * (x * z - w * y),
            2.0 * (y * z + w * x),
            w * w - x * x - y * y + z * z,
        ],
    ]
}

/// Superpose every frame onto the reference frame using the selected atoms.
pub fn align_frames(frames: &mut [Vec<f64>], selected: &[usize], reference_index: usize) {
    let reference = frames[reference_index].clone();
    let reference_center = centroid(&reference, selected);
    for frame in frames.iter_mut() {
        let center = centroid(frame, selected);
        let rotation = optimal_rotation(frame, center, &reference, reference_center, selected);
        for atom in frame.as_chunks_mut::<3>().0 {
            let local = [
                atom[0] - center[0],
                atom[1] - center[1],
                atom[2] - center[2],
            ];
            for axis in 0..3 {
                atom[axis] = rotation[axis][0] * local[0]
                    + rotation[axis][1] * local[1]
                    + rotation[axis][2] * local[2]
                    + reference_center[axis];
            }
        }
    }
}

/// Per-frame RMSD of the selected atoms from the reference frame.
pub fn rmsd_signal(frames: &[Vec<f64>], selected: &[usize], reference_index: usize) -> Vec<f64> {
    let reference = &frames[reference_index];
    frames
        .iter()
        .map(|frame| {
            let sum: f64 = selected
                .iter()
                .map(|&atom| {
                    (0..3)
                        .map(|axis| (frame[3 * atom + axis] - reference[3 * atom + axis]).powi(2))
                        .sum::<f64>()
                })
                .sum();
            (sum / selected.len() as f64).sqrt()
        })
        .collect()
}

/// Rebuild the mobile atoms from the key frames with a Catmull-Rom spline.
///
/// The spline passes exactly through each key frame and keeps one tangent across
/// it, so playback does not jerk there. Tangents are scaled by each segment's
/// duration because key frames are not evenly spaced. Frames outside the first
/// and last key frame, and all non-mobile atoms, keep their source coordinates.
pub fn interpolate(frames: &mut [Vec<f64>], mobile: &[usize], keyframes: &[usize]) {
    if keyframes.len() < 2 {
        return;
    }
    let anchors: Vec<Vec<f64>> = keyframes.iter().map(|&key| frames[key].clone()).collect();
    let last = keyframes.len() - 1;
    for index in 0..last {
        let (start, end) = (keyframes[index], keyframes[index + 1]);
        let count = (end - start) as f64;
        let p0 = &anchors[index.saturating_sub(1)];
        let p1 = &anchors[index];
        let p2 = &anchors[index + 1];
        let p3 = &anchors[(index + 2).min(last)];
        // At the ends there is no neighbour, so the end point stands in for it.
        let before = if index > 0 {
            keyframes[index - 1] as f64
        } else {
            start as f64 - count
        };
        let after = if index + 2 <= last {
            keyframes[index + 2] as f64
        } else {
            end as f64 + count
        };
        let scale1 = count / (end as f64 - before);
        let scale2 = count / (after - start as f64);
        for offset in 0..=(end - start) {
            let t = offset as f64 / count;
            let (t2, t3) = (t * t, t * t * t);
            let (h1, h2, h3, h4) = (
                2.0 * t3 - 3.0 * t2 + 1.0,
                t3 - 2.0 * t2 + t,
                -2.0 * t3 + 3.0 * t2,
                t3 - t2,
            );
            let frame = &mut frames[start + offset];
            for &atom in mobile {
                for slot in 3 * atom..3 * atom + 3 {
                    frame[slot] = h1 * p1[slot]
                        + h2 * (p2[slot] - p0[slot]) * scale1
                        + h3 * p2[slot]
                        + h4 * (p3[slot] - p1[slot]) * scale2;
                }
            }
        }
    }
}
