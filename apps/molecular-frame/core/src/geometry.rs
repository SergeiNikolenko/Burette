//! Plane geometry in model units (one bond length), y pointing down like the screen.
use crate::model::Mol;
use std::f64::consts::{PI, TAU};
use std::ops::{Add, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V2 {
    pub x: f64,
    pub y: f64,
}

pub const fn v2(x: f64, y: f64) -> V2 {
    V2 { x, y }
}

impl V2 {
    pub fn polar(angle: f64) -> V2 {
        v2(angle.cos(), angle.sin())
    }
    pub fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    pub fn dist(self, o: V2) -> f64 {
        (self - o).len()
    }
    pub fn dot(self, o: V2) -> f64 {
        self.x * o.x + self.y * o.y
    }
    pub fn cross(self, o: V2) -> f64 {
        self.x * o.y - self.y * o.x
    }
    pub fn angle(self) -> f64 {
        self.y.atan2(self.x)
    }
    /// Rotated by +90° (towards positive `cross`).
    pub fn perp(self) -> V2 {
        v2(-self.y, self.x)
    }
    pub fn unit(self) -> V2 {
        let l = self.len();
        if l > 1e-9 { self * (1. / l) } else { v2(1., 0.) }
    }
    pub fn lerp(self, o: V2, t: f64) -> V2 {
        self + (o - self) * t
    }
    pub fn finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
    /// Rotated by `angle` radians (clockwise on screen, towards positive `cross`).
    pub fn rotate(self, angle: f64) -> V2 {
        let (s, c) = angle.sin_cos();
        v2(self.x * c - self.y * s, self.x * s + self.y * c)
    }
}

impl Add for V2 {
    type Output = V2;
    fn add(self, o: V2) -> V2 {
        v2(self.x + o.x, self.y + o.y)
    }
}
impl Sub for V2 {
    type Output = V2;
    fn sub(self, o: V2) -> V2 {
        v2(self.x - o.x, self.y - o.y)
    }
}
impl Mul<f64> for V2 {
    type Output = V2;
    fn mul(self, k: f64) -> V2 {
        v2(self.x * k, self.y * k)
    }
}
impl Neg for V2 {
    type Output = V2;
    fn neg(self) -> V2 {
        v2(-self.x, -self.y)
    }
}

/// Default direction of a new bond: 30° above the horizontal, to the right.
pub const DEFAULT_ANGLE: f64 = -PI / 6.;

pub fn snap(angle: f64, step: f64) -> f64 {
    (angle / step).round() * step
}

/// Start and size of the widest angular gap between directions.
pub fn widest_gap(angles: &[f64]) -> (f64, f64) {
    let mut a: Vec<f64> = angles.iter().map(|x| x.rem_euclid(TAU)).collect();
    a.sort_by(f64::total_cmp);
    let mut best = (0., TAU);
    for i in 0..a.len() {
        let next = if i + 1 < a.len() { a[i + 1] } else { a[0] + TAU };
        if i == 0 || next - a[i] > best.1 + 1e-9 {
            best = (a[i], next - a[i]);
        }
    }
    best
}

/// Angular gaps (start, size) between directions, widest first.
pub fn sectors(angles: &[f64]) -> Vec<(f64, f64)> {
    let mut a: Vec<f64> = angles.iter().map(|x| x.rem_euclid(TAU)).collect();
    a.sort_by(f64::total_cmp);
    if a.is_empty() {
        return vec![(DEFAULT_ANGLE - PI, TAU)];
    }
    let mut gaps: Vec<(f64, f64)> =
        (0..a.len()).map(|i| (a[i], a.get(i + 1).copied().unwrap_or(a[0] + TAU) - a[i])).collect();
    gaps.sort_by(|x, y| y.1.total_cmp(&x.1));
    gaps
}

/// Distance from `p` to segment `a`–`b`.
pub fn segment_distance(p: V2, a: V2, b: V2) -> f64 {
    let d = b - a;
    let t = ((p - a).dot(d) / d.dot(d).max(1e-12)).clamp(0., 1.);
    p.dist(a + d * t)
}

/// Distance between segments `a`–`b` and `c`–`d`, 0 when they cross.
pub fn segments_gap(a: V2, b: V2, c: V2, d: V2) -> f64 {
    let (r, s) = (b - a, d - c);
    let den = r.cross(s);
    if den.abs() > 1e-12 {
        let (t, u) = ((c - a).cross(s) / den, (c - a).cross(r) / den);
        if (0. ..=1.).contains(&t) && (0. ..=1.).contains(&u) {
            return 0.;
        }
    }
    let ends = [segment_distance(a, c, d), segment_distance(b, c, d), segment_distance(c, a, b), segment_distance(d, a, b)];
    ends.into_iter().fold(f64::INFINITY, f64::min)
}

/// An axis-aligned box (min, max).
pub type Box2 = (V2, V2);

/// Gap between two boxes, 0 when they overlap.
pub fn box_gap(a: Box2, b: Box2) -> f64 {
    let dx = (a.0.x - b.1.x).max(b.0.x - a.1.x).max(0.);
    let dy = (a.0.y - b.1.y).max(b.0.y - a.1.y).max(0.);
    dx.hypot(dy)
}

/// Gap between a box and segment `a`–`b`, 0 when they meet.
pub fn box_segment_gap(bx: Box2, a: V2, b: V2) -> f64 {
    let (lo, hi) = bx;
    let d = b - a;
    let (mut t0, mut t1, mut meets) = (0f64, 1f64, true);
    for (p, dp, l, h) in [(a.x, d.x, lo.x, hi.x), (a.y, d.y, lo.y, hi.y)] {
        if dp.abs() < 1e-12 {
            meets &= p >= l && p <= h;
        } else {
            let (u, v) = ((l - p) / dp, (h - p) / dp);
            t0 = t0.max(u.min(v));
            t1 = t1.min(u.max(v));
        }
    }
    if meets && t0 <= t1 {
        return 0.;
    }
    let corners = [lo, v2(hi.x, lo.y), hi, v2(lo.x, hi.y)];
    let ends = [a, b].map(|p| box_gap((p, p), bx));
    corners.iter().map(|&c| segment_distance(c, a, b)).chain(ends).fold(f64::INFINITY, f64::min)
}

/// Bisector of the widest gap between bonds around an atom.
pub fn open_angle(angles: &[f64]) -> f64 {
    if angles.is_empty() {
        return DEFAULT_ANGLE;
    }
    let (start, gap) = widest_gap(angles);
    start + gap / 2.
}

/// Directions from atom `i` to its neighbours.
pub fn bond_angles(mol: &Mol, i: usize) -> Vec<f64> {
    let p = mol.atoms[i].pos;
    mol.neighbors(i)
        .map(|n| mol.atoms[n].pos - p)
        .filter(|d| d.len() > 1e-6)
        .map(V2::angle)
        .collect()
}

/// Preferred direction for a new bond from atom `i`: zigzag continuation for
/// chain ends, otherwise the bisector of the widest free sector. Directions that
/// would land on an existing atom are skipped when an alternative exists.
pub fn new_bond_angle(mol: &Mol, i: usize) -> f64 {
    let p = mol.atoms[i].pos;
    let nbrs: Vec<usize> = mol.neighbors(i).collect();
    let mut candidates = Vec::new();
    match nbrs.as_slice() {
        [] => candidates.push(DEFAULT_ANGLE),
        [n] => {
            let u = p - mol.atoms[*n].pos;
            let base = (-u).angle();
            let (c1, c2) = (base + TAU / 3., base - TAU / 3.);
            let side = |c: f64| u.cross(V2::polar(c));
            let far = mol.neighbors(*n).find(|&m| m != i);
            let first = match far {
                // Trans zigzag: the new atom goes to the other side of n→i than m.
                Some(m) => {
                    let sm = u.cross(mol.atoms[m].pos - mol.atoms[*n].pos);
                    if side(c1) * sm < 0. { c1 } else { c2 }
                }
                // A rising bond continues downwards and vice versa.
                None => {
                    let down = |c: f64| V2::polar(c).y;
                    if u.y < -1e-6 {
                        if down(c1) > down(c2) { c1 } else { c2 }
                    } else if down(c1) < down(c2) {
                        c1
                    } else {
                        c2
                    }
                }
            };
            candidates.push(first);
            candidates.push(if first == c1 { c2 } else { c1 });
        }
        _ => {
            let angles = bond_angles(mol, i);
            let (start, gap) = widest_gap(&angles);
            candidates.push(start + gap / 2.);
            if gap > PI {
                candidates.push(start + gap / 3.);
                candidates.push(start + gap * 2. / 3.);
            }
        }
    }
    for k in 1..12 {
        let step = PI / 12. * k as f64;
        candidates.push(candidates[0] + step);
        candidates.push(candidates[0] - step);
    }
    let free = |a: f64| {
        let q = p + V2::polar(a);
        mol.atoms.iter().all(|o| o.pos.dist(q) > 0.45)
    };
    candidates.iter().copied().find(|&a| free(a)).unwrap_or(candidates[0])
}

/// Regular polygon with sides of `side`, first vertex at `start` radians.
pub fn polygon(n: usize, center: V2, start: f64, side: f64, clockwise: bool) -> Vec<V2> {
    let r = side * 0.5 / (PI / n as f64).sin();
    let dir = if clockwise { 1. } else { -1. };
    (0..n)
        .map(|k| center + V2::polar(start + dir * TAU * k as f64 / n as f64) * r)
        .collect()
}

pub fn circumradius(n: usize) -> f64 {
    0.5 / (PI / n as f64).sin()
}

pub fn apothem(n: usize) -> f64 {
    0.5 / (PI / n as f64).tan()
}

/// Zigzag chain from `start` toward `cursor`, 120° angles, unit bonds.
pub fn zigzag(start: V2, cursor: V2, snap_angles: bool, flip: bool) -> Vec<V2> {
    let half = PI / 6.;
    let d = start.dist(cursor);
    let count = ((d / half.cos()).round() as usize).clamp(1, 60);
    let mut axis = (cursor - start).angle();
    if snap_angles {
        axis = snap(axis, PI / 12.);
    }
    let side = if flip { 1. } else { -1. };
    let mut points = vec![start];
    for i in 0..count {
        let a = axis + if i % 2 == 0 { side * half } else { -side * half };
        let last = points[points.len() - 1];
        points.push(last + V2::polar(a));
    }
    points
}

/// Least-squares rigid alignment of `from` onto `to` (rotation, optional
/// reflection, translation). Returns the transformed points.
pub fn align(from: &[V2], to: &[V2]) -> Vec<V2> {
    let n = from.len().min(to.len());
    if n == 0 {
        return from.to_vec();
    }
    let mean = |pts: &[V2]| pts[..n].iter().fold(V2::default(), |s, p| s + *p) * (1. / n as f64);
    let (cf, ct) = (mean(from), mean(to));
    let fit = |mirror: bool| {
        let pts: Vec<V2> = from
            .iter()
            .map(|p| {
                let d = *p - cf;
                if mirror { v2(d.x, -d.y) } else { d }
            })
            .collect();
        let (mut s, mut c) = (0., 0.);
        for k in 0..n {
            let q = to[k] - ct;
            s += pts[k].cross(q);
            c += pts[k].dot(q);
        }
        let (sin, cos) = s.atan2(c).sin_cos();
        let out: Vec<V2> = pts.iter().map(|d| v2(d.x * cos - d.y * sin, d.x * sin + d.y * cos) + ct).collect();
        let err: f64 = (0..n).map(|k| out[k].dist(to[k]).powi(2)).sum();
        (err, out)
    };
    let (e1, a) = fit(false);
    let (e2, b) = fit(true);
    if e2 + 1e-6 < e1 { b } else { a }
}

/// Smallest ring through each bond (as an ordered atom cycle), deduplicated.
/// Returns the rings and, per bond, the indices of rings containing it.
pub fn rings(mol: &Mol, adj: &[Vec<(usize, usize)>]) -> (Vec<Vec<usize>>, Vec<Vec<usize>>) {
    let mut rings: Vec<Vec<usize>> = Vec::new();
    let mut keys: Vec<Vec<usize>> = Vec::new();
    let mut prev = vec![usize::MAX; mol.atoms.len()];
    let mut queue = std::collections::VecDeque::new();
    for (bi, bond) in mol.bonds.iter().enumerate() {
        // Breadth-first search from a to b avoiding this bond.
        prev.iter_mut().for_each(|p| *p = usize::MAX);
        queue.clear();
        prev[bond.a] = bond.a;
        queue.push_back(bond.a);
        let mut found = false;
        while let Some(i) = queue.pop_front() {
            for &(bj, n) in &adj[i] {
                if bj == bi || prev[n] != usize::MAX {
                    continue;
                }
                prev[n] = i;
                if n == bond.b {
                    found = true;
                    break;
                }
                queue.push_back(n);
            }
            if found {
                break;
            }
        }
        if !found {
            continue;
        }
        let mut cycle = vec![bond.b];
        let mut cur = bond.b;
        while cur != bond.a {
            cur = prev[cur];
            cycle.push(cur);
        }
        let mut key = cycle.clone();
        key.sort_unstable();
        if !keys.contains(&key) {
            keys.push(key);
            rings.push(cycle);
        }
    }
    let mut of_bond = vec![Vec::new(); mol.bonds.len()];
    for (ri, ring) in rings.iter().enumerate() {
        for k in 0..ring.len() {
            if let Some(bi) = mol.bond_between(ring[k], ring[(k + 1) % ring.len()]) {
                of_bond[bi].push(ri);
            }
        }
    }
    (rings, of_bond)
}

pub fn centroid(mol: &Mol, atoms: &[usize]) -> V2 {
    let sum = atoms.iter().fold(V2::default(), |s, &i| s + mol.atoms[i].pos);
    sum * (1. / atoms.len().max(1) as f64)
}

/// Smooth sine-like wave from `a` to `b` as cubic Bézier segments
/// (control1, control2, end), after ReShiki's wavy bond.
pub fn wave(a: V2, b: V2, wavelength: f64, amplitude: f64) -> Vec<(V2, V2, V2)> {
    let length = a.dist(b);
    if length < 1e-6 {
        return vec![];
    }
    let quarters = ((length / wavelength).round().clamp(1., 64.) as usize) * 4;
    let step = length / quarters as f64;
    let amplitude = amplitude.min(length / 6.);
    let tangent = amplitude * std::f64::consts::FRAC_PI_2 / 3.;
    let u = (b - a) * (1. / length);
    let at = |x: f64, y: f64| a + u * x + u.perp() * y;
    let phase = |i: usize| match i % 4 {
        0 => (0., tangent),
        1 => (amplitude, 0.),
        2 => (0., -tangent),
        _ => (-amplitude, 0.),
    };
    (0..quarters)
        .map(|i| {
            let (y0, d0) = phase(i);
            let (y1, d1) = phase(i + 1);
            let x = i as f64 * step;
            let end = if i + 1 == quarters { b } else { at(x + step, y1) };
            (at(x + step / 3., y0 + d0), at(x + step * 2. / 3., y1 - d1), end)
        })
        .collect()
}
