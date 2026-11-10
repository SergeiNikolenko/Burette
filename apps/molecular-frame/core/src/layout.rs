//! Placement after a fresh depiction: fragments in reading order, added
//! hydrogens spread out, and terminal atoms turned away from the atoms and
//! labels they crowd.
use crate::geometry::{Box2, V2, box_gap, box_segment_gap, centroid, rings, sectors, segment_distance, segments_gap, v2};
use crate::model::{Adjacency, Mol};
use crate::render::{extent, label_boxes};
use std::f64::consts::TAU;

/// Room (bond lengths) under which a terminal atom is turned.
const CLASH: f64 = 0.6;
/// Added to label gaps so they compare with centre distances: labels 0.12
/// apart crowd like atoms 0.6 apart.
const SHIFT: f64 = 0.48;
/// Room from which the smallest turn wins over more room.
const ENOUGH: f64 = 0.9;
/// Atoms and bonds farther than this from the pivot are ignored.
const REACH: f64 = 3.;
const STEP: f64 = TAU / 72.;

/// Atoms of each connected fragment, in order of their first atom.
pub fn fragments(mol: &Mol) -> Vec<Vec<usize>> {
    let mut seen = vec![false; mol.atoms.len()];
    let mut out = Vec::new();
    for i in 0..mol.atoms.len() {
        if !seen[i] {
            let frag = mol.fragment(i);
            let atoms: Vec<usize> = (0..frag.len()).filter(|&k| frag[k]).collect();
            atoms.iter().for_each(|&k| seen[k] = true);
            out.push(atoms);
        }
    }
    out
}

/// Lays fragments out in reading order: centred rows of label-aware boxes one
/// bond apart, wrapping after 12 bonds, around the drawing's centre.
pub fn arrange(mol: &mut Mol) {
    const GAP: f64 = 1.;
    let frags = fragments(mol);
    let Some((lo, hi)) = mol.bounds() else { return };
    if frags.len() < 2 {
        return;
    }
    let boxes: Vec<Box2> = frags
        .iter()
        .map(|f| {
            let mut keep = vec![false; mol.atoms.len()];
            f.iter().for_each(|&i| keep[i] = true);
            extent(&mol.subset(&keep)).unwrap_or_default()
        })
        .collect();
    let limit = boxes.iter().map(|(a, b)| b.x - a.x).fold(12., f64::max);
    let mut rows: Vec<(Vec<usize>, f64)> = Vec::new();
    for (k, (a, b)) in boxes.iter().enumerate() {
        let w = b.x - a.x;
        match rows.last_mut() {
            Some((members, width)) if *width + GAP + w <= limit => {
                members.push(k);
                *width += GAP + w;
            }
            _ => rows.push((vec![k], w)),
        }
    }
    let mut shifts = vec![V2::default(); frags.len()];
    let mut y = 0.;
    for (members, width) in &rows {
        let height = members.iter().map(|&k| boxes[k].1.y - boxes[k].0.y).fold(0., f64::max);
        let mut x = -width / 2.;
        for &k in members {
            let (a, b) = boxes[k];
            shifts[k] = v2(x - a.x, y + height / 2. - (a.y + b.y) / 2.);
            x += b.x - a.x + GAP;
        }
        y += height + GAP;
    }
    let offset = (lo + hi) * 0.5 - v2(0., (y - GAP) / 2.);
    for (frag, shift) in frags.iter().zip(shifts) {
        for &i in frag {
            mol.atoms[i].pos = mol.atoms[i].pos + shift + offset;
        }
    }
}

/// Spreads the hydrogens from index `from` on evenly over the free sectors
/// around their atoms, one bond length out; wider sectors take more. A lone
/// hydrogen beside a single other bond, or on an atom with no other bonds,
/// keeps its place.
pub fn spread_hydrogens(mol: &mut Mol, from: usize) {
    let adj = mol.adjacency();
    for p in 0..from.min(mol.atoms.len()) {
        let o = mol.atoms[p].pos;
        let (new, old): (Vec<usize>, Vec<usize>) = adj[p].iter().map(|&(_, n)| n).partition(|&n| n >= from);
        let angles: Vec<f64> = old.iter().map(|&n| mol.atoms[n].pos - o).filter(|d| d.len() > 1e-6).map(V2::angle).collect();
        if new.is_empty() || angles.is_empty() || (new.len() == 1 && angles.len() == 1) {
            continue;
        }
        // Each hydrogen goes where the spacing stays widest; ties go to the wider sector.
        let gaps = sectors(&angles);
        let mut count = vec![0usize; gaps.len()];
        for _ in &new {
            let spacing = |k: usize| gaps[k].1 / (count[k] + 2) as f64;
            let k = (1..gaps.len()).fold(0, |best, k| if spacing(k) > spacing(best) + 1e-9 { k } else { best });
            count[k] += 1;
        }
        let spots = gaps.iter().zip(&count).flat_map(|(&(start, size), &c)| (1..=c).map(move |j| start + size * j as f64 / (c + 1) as f64));
        for (&h, angle) in new.iter().zip(spots) {
            mol.atoms[h].pos = o + V2::polar(angle);
        }
    }
}

/// Turns terminal non-carbon atoms (index `from` on) about their only
/// neighbour when they crowd other atoms or labels, by the smallest turn
/// that gives enough room. Bond lengths and the side of the neighbour's
/// stereo double bonds are kept, atoms other than hydrogen stay between the
/// same two bonds, and no other atom moves. Returns whether anything moved.
pub fn declash(mol: &mut Mol, from: usize) -> bool {
    let adj = mol.adjacency();
    let rings = rings(mol, &adj).0;
    let mut boxes: Vec<Vec<Box2>> = (0..mol.atoms.len()).map(|i| label_boxes(mol, &adj, i)).collect();
    let mut moved = false;
    for _ in 0..3 {
        let mut turned = false;
        for i in from..mol.atoms.len() {
            let Some((p, turns)) = turns(mol, &adj, &rings, i) else { continue };
            let here = mol.atoms[i].pos;
            if room(mol, &boxes, i, p, here, &boxes[i], false) >= CLASH {
                continue;
            }
            let now = room(mol, &boxes, i, p, here, &boxes[i], true).min(ENOUGH);
            let mut best: Option<(f64, V2, Vec<Box2>)> = None;
            for x in turns {
                mol.atoms[i].pos = x;
                let bx = label_boxes(mol, &adj, i);
                let r = room(mol, &boxes, i, p, x, &bx, true).min(ENOUGH);
                if best.as_ref().is_none_or(|b| r > b.0 + 1e-9) {
                    best = Some((r, x, bx));
                }
            }
            mol.atoms[i].pos = here;
            if let Some((_, x, bx)) = best.filter(|b| b.0 > now + 0.01) {
                mol.atoms[i].pos = x;
                boxes[i] = bx;
                boxes[p] = label_boxes(mol, &adj, p);
                turned = true;
            }
        }
        moved |= turned;
        if !turned {
            break;
        }
    }
    moved
}

/// Positions terminal atom `i` may turn to about its neighbour: 5° steps
/// inside the free sector it sits in (any sector outside the neighbour's
/// rings for hydrogens), nearest first, on its side of the neighbour's
/// double bonds to substituted atoms. `None` for carbons, atoms without
/// exactly one bond, and linear arrangements.
fn turns(mol: &Mol, adj: &Adjacency, rings: &[Vec<usize>], i: usize) -> Option<(usize, Vec<V2>)> {
    let [(bond, p)] = adj[i][..] else { return None };
    let (o, here) = (mol.atoms[p].pos, mol.atoms[i].pos);
    let (r, angle) = ((here - o).len(), (here - o).angle());
    let others: Vec<V2> = adj[p].iter().filter(|&&(_, n)| n != i).map(|&(_, n)| (mol.atoms[n].pos - o).unit()).collect();
    let linear = matches!(others[..], [d] if d.dot(V2::polar(angle)) < -0.98);
    let triple = adj[p].iter().any(|&(b, _)| mol.bonds[b].order == 3);
    if mol.atoms[i].el == 6 || mol.bonds[bond].order == 3 || r < 1e-6 || linear || triple {
        return None;
    }
    let ccw = others.iter().map(|d| (d.angle() - angle).rem_euclid(TAU)).fold(TAU, f64::min);
    let cw = others.iter().map(|d| (angle - d.angle()).rem_euclid(TAU)).fold(TAU, f64::min);
    // Whether directions `a` and `b` lie between the same two bonds.
    let across = |a: f64, b: f64| others.iter().any(|d| (d.angle() - a).rem_euclid(TAU) < (b - a).rem_euclid(TAU));
    let same = |a: f64, b: f64| !across(a, b) || !across(b, a);
    let inside: Vec<f64> = rings.iter().filter(|r| r.contains(&p)).map(|r| (centroid(mol, r) - o).angle()).collect();
    let free = mol.atoms[i].el == 1;
    let sides: Vec<(V2, f64)> = adj[p]
        .iter()
        .filter(|&&(b, n)| n != i && mol.bonds[b].order == 2 && adj[n].len() > 1)
        .map(|&(_, n)| {
            let q = mol.atoms[n].pos - o;
            (q, q.cross(here - o))
        })
        .collect();
    let mut out = Vec::new();
    for k in 1..72 {
        for t in [k as f64 * STEP, -(k as f64) * STEP] {
            let home = t < ccw - 1e-6 && -t < cw - 1e-6;
            if !home && !(free && inside.iter().all(|&c| !same(angle + t, c))) {
                continue;
            }
            let x = o + V2::polar(angle + t) * r;
            if sides.iter().all(|&(q, s)| s.abs() < 1e-9 || q.cross(x - o) * s > 0.) {
                out.push(x);
            }
        }
    }
    Some((p, out))
}

/// Room around terminal atom `i` hanging from `p`, placed at `x` with label
/// boxes `bx`: the distance to the nearest other atom or bond, where gaps
/// between label boxes count `SHIFT` more. `own` adds the room around the
/// bond from `p` to `x`.
fn room(mol: &Mol, boxes: &[Vec<Box2>], i: usize, p: usize, x: V2, bx: &[Box2], own: bool) -> f64 {
    let o = mol.atoms[p].pos;
    let dot = [(x, x)];
    let mine = if bx.is_empty() { &dot[..] } else { bx };
    let gap = |a: &[Box2], b: &[Box2]| a.iter().flat_map(|&s| b.iter().map(move |&t| box_gap(s, t))).fold(f64::INFINITY, f64::min);
    let line = |a: &[Box2], s: V2, t: V2| a.iter().map(|&q| box_segment_gap(q, s, t)).fold(f64::INFINITY, f64::min);
    let mut room = f64::INFINITY;
    for (j, atom) in mol.atoms.iter().enumerate() {
        let at = atom.pos;
        if j == i || j == p || at.dist(o) > REACH {
            continue;
        }
        let point = [(at, at)];
        let theirs = if boxes[j].is_empty() { &point[..] } else { &boxes[j][..] };
        room = room.min(x.dist(at).min(gap(mine, theirs) + SHIFT));
        if own {
            room = room.min(segment_distance(at, o, x).min(line(theirs, o, x) + SHIFT));
        }
    }
    for b in &mol.bonds {
        let (s, t) = (mol.atoms[b.a].pos, mol.atoms[b.b].pos);
        if b.has(i) || s.dist(o).min(t.dist(o)) > REACH {
            continue;
        }
        room = room.min(segment_distance(x, s, t).min(line(mine, s, t) + SHIFT));
        if own && !b.has(p) {
            room = room.min(segments_gap(o, x, s, t));
        }
    }
    room
}
