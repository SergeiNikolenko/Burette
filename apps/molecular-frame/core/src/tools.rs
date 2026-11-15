//! Tools and the edits they make. Every edit returns an edited copy of the
//! drawing (`None` when nothing would change), so previews and commits share
//! one code path.
use crate::geometry::{V2, bond_angles, circumradius, open_angle, polygon, snap, apothem, zigzag};
use crate::model::{Item, Mol, Stereo};
use crate::valence::{element, max_valence, symbol};
use std::f64::consts::PI;

/// Atoms closer than this (in bond lengths) are merged when placing new ones.
pub const MERGE: f64 = 0.3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BondKind {
    Single,
    Double,
    Triple,
    Wedge,
    Hash,
    Wavy,
}

impl BondKind {
    const ALL: [(BondKind, &'static str); 6] = [
        (BondKind::Single, "single"),
        (BondKind::Double, "double"),
        (BondKind::Triple, "triple"),
        (BondKind::Wedge, "wedge"),
        (BondKind::Hash, "hash"),
        (BondKind::Wavy, "wavy"),
    ];
    fn order(self) -> u8 {
        match self {
            BondKind::Double => 2,
            BondKind::Triple => 3,
            _ => 1,
        }
    }
    fn stereo(self) -> Stereo {
        match self {
            BondKind::Wedge => Stereo::Wedge,
            BondKind::Hash => Stereo::Hash,
            BondKind::Wavy => Stereo::Wavy,
            _ => Stereo::None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RingKind {
    Benzene,
    Cyclopentadiene,
    Cyclohexane,
    Cyclopentane,
    Cyclopropane,
    Cyclobutane,
    Cycloheptane,
    Cyclooctane,
}

impl RingKind {
    const ALL: [(RingKind, &'static str); 8] = [
        (RingKind::Benzene, "benzene"),
        (RingKind::Cyclopentadiene, "cyclopentadiene"),
        (RingKind::Cyclohexane, "cyclohexane"),
        (RingKind::Cyclopentane, "cyclopentane"),
        (RingKind::Cyclopropane, "cyclopropane"),
        (RingKind::Cyclobutane, "cyclobutane"),
        (RingKind::Cycloheptane, "cycloheptane"),
        (RingKind::Cyclooctane, "cyclooctane"),
    ];
    fn size(self) -> usize {
        match self {
            RingKind::Cyclopropane => 3,
            RingKind::Cyclobutane => 4,
            RingKind::Cyclopentadiene | RingKind::Cyclopentane => 5,
            RingKind::Benzene | RingKind::Cyclohexane => 6,
            RingKind::Cycloheptane => 7,
            RingKind::Cyclooctane => 8,
        }
    }
    /// Alternative double-bond placements, as indices of ring edges (k, k+1).
    fn patterns(self) -> Vec<Vec<usize>> {
        match self {
            RingKind::Benzene => vec![vec![0, 2, 4], vec![1, 3, 5]],
            RingKind::Cyclopentadiene => (0..5).map(|p| vec![p, (p + 2) % 5]).collect(),
            _ => vec![vec![]],
        }
    }
}

/// Highest R-group number the tools offer.
pub const MAX_RGROUP: u8 = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Hand,
    Select,
    Erase,
    Bond(BondKind),
    Chain,
    Charge(i8),
    /// A fixed R-group number, or `None` for the next free one.
    RGroup(Option<u8>),
    /// Attachment point: a terminal `*` drawn as a wavy line.
    Attach,
    /// SRU polymer brackets around a marquee.
    Polymer,
    /// The template set with `set_template`.
    Template,
    Atom(u8),
    Ring(RingKind),
}

impl Tool {
    pub fn parse(id: &str) -> Option<Tool> {
        Some(match id {
            "hand" => Tool::Hand,
            "select" => Tool::Select,
            "erase" => Tool::Erase,
            "chain" => Tool::Chain,
            "charge:plus" => Tool::Charge(1),
            "charge:minus" => Tool::Charge(-1),
            "rgroup" => Tool::RGroup(None),
            "attach" => Tool::Attach,
            "polymer" => Tool::Polymer,
            "template" => Tool::Template,
            "atom:*" => Tool::Atom(0),
            _ => {
                if let Some(n) = id.strip_prefix("rgroup:") {
                    Tool::RGroup(Some(n.parse::<u8>().ok().filter(|n| (1..=MAX_RGROUP).contains(n))?))
                } else if let Some(k) = id.strip_prefix("bond:") {
                    Tool::Bond(BondKind::ALL.iter().find(|x| x.1 == k)?.0)
                } else if let Some(k) = id.strip_prefix("ring:") {
                    Tool::Ring(RingKind::ALL.iter().find(|x| x.1 == k)?.0)
                } else {
                    Tool::Atom(id.strip_prefix("atom:").and_then(element).filter(|&z| z > 0)?)
                }
            }
        })
    }

    pub fn id(self) -> String {
        match self {
            Tool::Hand => "hand".into(),
            Tool::Select => "select".into(),
            Tool::Erase => "erase".into(),
            Tool::Chain => "chain".into(),
            Tool::Charge(d) => if d > 0 { "charge:plus" } else { "charge:minus" }.into(),
            Tool::RGroup(None) => "rgroup".into(),
            Tool::RGroup(Some(n)) => format!("rgroup:{n}"),
            Tool::Attach => "attach".into(),
            Tool::Polymer => "polymer".into(),
            Tool::Template => "template".into(),
            Tool::Bond(k) => format!("bond:{}", BondKind::ALL.iter().find(|x| x.0 == k).map_or("single", |x| x.1)),
            Tool::Ring(k) => format!("ring:{}", RingKind::ALL.iter().find(|x| x.0 == k).map_or("benzene", |x| x.1)),
            Tool::Atom(0) => "atom:*".into(),
            Tool::Atom(el) => format!("atom:{}", symbol(el)),
        }
    }
}

/// An existing atom at `p`, or a new atom of `el` there.
fn atom_at(m: &mut Mol, p: V2, el: u8) -> usize {
    m.nearest_atom(p, MERGE).unwrap_or_else(|| m.add_atom(el, p))
}

/// A bond from atom `from` (or a new carbon at `start`) to atom `target`, or
/// to `end` where an existing atom is reused or a new `el` atom is created.
/// An already existing bond takes the new kind instead.
pub fn add_bond(mol: &Mol, from: Option<usize>, start: V2, end: V2, target: Option<usize>, kind: BondKind, el: u8) -> Option<Mol> {
    let mut m = mol.clone();
    let a = from.unwrap_or_else(|| atom_at(&mut m, start, 6));
    let b = target.unwrap_or_else(|| atom_at(&mut m, end, el));
    if let Some(bi) = m.bond_between(a, b) {
        return set_bond(&m, bi, kind);
    }
    let bi = m.add_bond(a, b, kind.order())?;
    m.bonds[bi].stereo = kind.stereo();
    Some(m)
}

/// Clicking a bond: the single tool cycles 1→2→3→1, stereo tools flip a
/// bond already of their kind, other tools set their kind.
pub fn set_bond(mol: &Mol, bi: usize, kind: BondKind) -> Option<Mol> {
    let degree = |i: usize| mol.bonds.iter().filter(|b| b.has(i)).count();
    let mut m = mol.clone();
    let b = m.bonds.get_mut(bi)?;
    let before = b.clone();
    let wedge = matches!(kind, BondKind::Wedge | BondKind::Hash);
    match kind {
        _ if b.dative => {
            (b.order, b.stereo, b.dative) = (kind.order(), kind.stereo(), false);
        }
        BondKind::Single if b.stereo != Stereo::None => b.stereo = Stereo::None,
        BondKind::Single => b.order = b.order % 3 + 1,
        _ if wedge && b.stereo == kind.stereo() => std::mem::swap(&mut b.a, &mut b.b),
        _ => {
            // A new wedge starts narrow at the more substituted end.
            if wedge && !matches!(b.stereo, Stereo::Wedge | Stereo::Hash) && degree(b.b) > degree(b.a) {
                std::mem::swap(&mut b.a, &mut b.b);
            }
            b.order = kind.order();
            b.stereo = kind.stereo();
        }
    }
    if *b == before {
        return None;
    }
    b.arom = false;
    Some(m)
}

pub fn set_order(mol: &Mol, bi: usize, order: u8) -> Option<Mol> {
    let mut m = mol.clone();
    let b = m.bonds.get_mut(bi)?;
    if b.order == order && b.stereo == Stereo::None && !b.arom && !b.dative {
        return None;
    }
    (b.order, b.stereo, b.arom, b.dative) = (order, Stereo::None, false, false);
    Some(m)
}

pub fn set_element(mol: &Mol, i: usize, el: u8) -> Option<Mol> {
    let mut m = mol.clone();
    let a = m.atoms.get_mut(i)?;
    if a.alias.is_none() && a.el == el && (el != 0 || a.rgroup == 0) {
        return None;
    }
    a.retype(el);
    Some(m)
}

pub fn add_charge(mol: &Mol, i: usize, delta: i8) -> Option<Mol> {
    let mut m = mol.clone();
    let a = m.atoms.get_mut(i)?;
    let charge = (a.charge + delta).clamp(-4, 4);
    if charge == a.charge {
        return None;
    }
    // A recharged atom takes its hydrogens from the default valences.
    (a.charge, a.total, a.radical) = (charge, None, 0);
    Some(m)
}

/// The lowest R-group number after `after` (wrapping) that no atom other
/// than `except` uses.
pub fn free_rgroup(mol: &Mol, except: Option<usize>, after: u8) -> u8 {
    let used = |n: u8| mol.atoms.iter().enumerate().any(|(i, a)| Some(i) != except && a.el == 0 && a.rgroup == n);
    (1..=MAX_RGROUP).map(|k| (after + k - 1) % MAX_RGROUP + 1).find(|&n| !used(n)).unwrap_or(1)
}

/// Turns atom `i` into R`n` (its bonds stay), or with `None` into the next
/// free number: an R group advances to the next free number after its own.
pub fn rgroup(mol: &Mol, i: usize, n: Option<u8>) -> Option<Mol> {
    let a = mol.atoms.get(i)?;
    let number = n.unwrap_or_else(|| free_rgroup(mol, Some(i), if a.el == 0 { a.rgroup } else { 0 }));
    if a.alias.is_none() && a.el == 0 && a.rgroup == number {
        return None;
    }
    let mut m = mol.clone();
    let a = &mut m.atoms[i];
    a.retype(0);
    (a.rgroup, a.charge) = (number, 0);
    Some(m)
}

/// A new atom of `el` at `p`; a dummy with `None` is a bare wildcard,
/// `Some(n)` an R group (0: the next free number).
pub fn add_atom(mol: &Mol, el: u8, p: V2, rgroup: Option<u8>) -> Mol {
    let mut m = mol.clone();
    let i = m.add_atom(el, p);
    if el == 0 && let Some(rgroup) = rgroup {
        m.atoms[i].rgroup = if rgroup > 0 { rgroup } else { free_rgroup(mol, None, 0) };
    }
    m
}

/// A terminal attachment point (a bare `*`) bonded to atom `i` along `dir`.
pub fn attach(mol: &Mol, i: usize, dir: f64) -> Option<Mol> {
    let a = mol.atoms.get(i)?;
    if a.el == 0 && a.rgroup == 0 {
        return None;
    }
    let mut m = mol.clone();
    let j = m.add_atom(0, a.pos + V2::polar(dir));
    m.add_bond(i, j, 1)?;
    Some(m)
}

/// Removes flagged atoms and bonds, plus unlabeled carbons that the removal
/// leaves without bonds (as ChemDraw's eraser does).
pub fn erase(mol: &Mol, atoms: &[bool], bonds: &[bool]) -> Option<Mol> {
    let flag = |v: &[bool], n: usize| (0..n).map(|i| v.get(i).copied().unwrap_or(false)).collect::<Vec<_>>();
    let (mut drop_atoms, mut drop_bonds) = (flag(atoms, mol.atoms.len()), flag(bonds, mol.bonds.len()));
    let mut touched = vec![false; mol.atoms.len()];
    for (bi, b) in mol.bonds.iter().enumerate() {
        if drop_bonds[bi] || drop_atoms[b.a] || drop_atoms[b.b] {
            drop_bonds[bi] = true;
            touched[b.a] = true;
            touched[b.b] = true;
        }
    }
    if !drop_atoms.iter().chain(&drop_bonds).any(|&x| x) {
        return None;
    }
    let mut degree = vec![0usize; mol.atoms.len()];
    for b in mol.bonds.iter().zip(&drop_bonds).filter(|x| !*x.1).map(|x| x.0) {
        degree[b.a] += 1;
        degree[b.b] += 1;
    }
    for (i, a) in mol.atoms.iter().enumerate() {
        if touched[i] && degree[i] == 0 && a.el == 6 && a.charge == 0 && a.iso == 0 {
            drop_atoms[i] = true;
        }
    }
    let mut m = mol.clone();
    m.remove(&drop_atoms, &drop_bonds);
    Some(m)
}

/// Merges atom `from` into atom `into`, keeping the bonds of both.
pub fn merge(mol: &Mol, from: usize, into: usize) -> Option<Mol> {
    if from == into || from >= mol.atoms.len() || into >= mol.atoms.len() {
        return None;
    }
    let mut m = mol.clone();
    let mut drop = vec![false; m.bonds.len()];
    for bi in 0..m.bonds.len() {
        let b = &m.bonds[bi];
        if !b.has(from) {
            continue;
        }
        let other = b.other(from);
        if other == into || m.bond_between(other, into).is_some() {
            drop[bi] = true;
        } else if m.bonds[bi].a == from {
            m.bonds[bi].a = into;
        } else {
            m.bonds[bi].b = into;
        }
    }
    let mut atoms = vec![false; m.atoms.len()];
    for g in &mut m.sgroups {
        g.atoms.iter_mut().filter(|i| **i == from).for_each(|i| *i = into);
        g.atoms.sort_unstable();
        g.atoms.dedup();
    }
    atoms[from] = true;
    m.remove(&atoms, &drop);
    Some(m)
}

/// A zigzag chain from atom `from` (or a new carbon at `start`) towards
/// `cursor`. Returns the drawing and the number of chain bonds.
pub fn chain(mol: &Mol, from: Option<usize>, start: V2, cursor: V2, snap_angle: bool) -> Option<(Mol, usize)> {
    let mut axis = (cursor - start).angle();
    if snap_angle {
        axis = snap(axis, PI / 12.);
    }
    // Start on the side that leaves the most room next to existing bonds.
    let flip = from.is_some_and(|i| {
        let angles = bond_angles(mol, i);
        let clearance = |a: f64| {
            angles.iter().map(|b| (a - b + PI).rem_euclid(2. * PI) - PI).map(f64::abs).fold(PI, f64::min)
        };
        clearance(axis + PI / 6.) > clearance(axis - PI / 6.) + 1e-6
    });
    let points = zigzag(start, cursor, snap_angle, flip);
    let mut m = mol.clone();
    let mut prev = from.unwrap_or_else(|| atom_at(&mut m, start, 6));
    let mut added = 0;
    for &p in &points[1..] {
        let next = atom_at(&mut m, p, 6);
        if next != prev && m.add_bond(prev, next, 1).is_some() {
            added += 1;
        }
        prev = next;
    }
    (added > 0).then_some((m, points.len() - 1))
}

/// Places a ring: centred at `at` with a flat bottom side on empty canvas,
/// sharing a clicked atom (or bonded to it when sharing would exceed its
/// valence), or fused on a clicked bond on its less crowded side. Benzene and
/// cyclopentadiene alternate double bonds without doubling up next to
/// existing double bonds; coinciding atoms are merged.
pub fn ring(mol: &Mol, kind: RingKind, at: V2, hit: Option<Item>) -> Option<Mol> {
    let n = kind.size();
    let patterns = kind.patterns();
    let (points, mut ids, attach) = match hit {
        None => (polygon(n, at, PI / 2. + PI / n as f64, 1., true), vec![], None),
        Some(Item::Bond(bi)) => {
            let b = mol.bonds.get(bi)?;
            let (pa, pb) = (mol.atoms[b.a].pos, mol.atoms[b.b].pos);
            let side = pa.dist(pb).max(0.1);
            let (mid, normal) = ((pa + pb) * 0.5, (pb - pa).unit().perp());
            let crowd = |c: V2| -> f64 {
                let others = mol.atoms.iter().enumerate().filter(|(i, _)| *i != b.a && *i != b.b);
                others.map(|(_, a)| 1. / (0.2 + a.pos.dist(c).powi(2))).sum()
            };
            let (c1, c2) = (mid + normal * (apothem(n) * side), mid - normal * (apothem(n) * side));
            let c = if crowd(c1) <= crowd(c2) { c1 } else { c2 };
            let clockwise = (pa - c).cross(pb - c) > 0.;
            (polygon(n, c, (pa - c).angle(), side, clockwise), vec![b.a, b.b], None)
        }
        Some(Item::Atom(i)) => {
            let a = mol.atoms.get(i)?;
            let nbrs: Vec<usize> = mol.neighbors(i).collect();
            let dir = match nbrs.as_slice() {
                [] => -PI / 2.,
                [k] => (a.pos - mol.atoms[*k].pos).angle(),
                _ => open_angle(&bond_angles(mol, i)),
            };
            // Every benzene Kekulé structure gives the shared atom a double bond.
            let needs_double = patterns.iter().all(|p| p.contains(&0) || p.contains(&(n - 1)));
            let room = max_valence(a.el, a.charge).is_none_or(|v| mol.valence(i) + 2 + needs_double as u32 <= v);
            if room {
                let c = a.pos + V2::polar(dir) * circumradius(n);
                (polygon(n, c, dir + PI, 1., true), vec![i], None)
            } else {
                let c = a.pos + V2::polar(dir) * (1. + circumradius(n));
                (polygon(n, c, dir + PI, 1., true), vec![], Some(i))
            }
        }
    };
    let mut m = mol.clone();
    for &p in &points[ids.len()..] {
        let found = m.nearest_atom(p, MERGE).filter(|j| !ids.contains(j) && Some(*j) != attach);
        ids.push(found.unwrap_or_else(|| m.add_atom(6, p)));
    }
    // Atoms that already have a double bond, or no room for one beside their
    // new ring bonds, get no double bond from the ring.
    let mut doubled = vec![false; m.atoms.len()];
    for b in mol.bonds.iter().filter(|b| b.order >= 2) {
        (doubled[b.a], doubled[b.b]) = (true, true);
    }
    for k in 0..n {
        let x = ids[k];
        let Some(a) = mol.atoms.get(x) else { continue };
        let fresh = [ids[(k + 1) % n], ids[(k + n - 1) % n]].iter().filter(|&&y| m.bond_between(x, y).is_none()).count();
        doubled[x] |= max_valence(a.el, a.charge).is_some_and(|v| mol.valence(x) + fresh as u32 + 1 > v);
    }
    let edge = |k: usize| (ids[k], ids[(k + 1) % n]);
    let pattern = patterns
        .iter()
        .min_by_key(|p| {
            let (mut clashes, mut matches) = (0, 0);
            for k in 0..n {
                let (x, y) = edge(k);
                match m.bond_between(x, y) {
                    Some(bi) => matches += ((m.bonds[bi].order == 2) == p.contains(&k)) as i32,
                    None => clashes += (p.contains(&k) && (doubled[x] || doubled[y])) as i32,
                }
            }
            (clashes, -matches)
        })
        .cloned()
        .unwrap_or_default();
    let mut added = false;
    for k in 0..n {
        let (x, y) = edge(k);
        let double = pattern.contains(&k) && !doubled[x] && !doubled[y];
        added |= m.bond_between(x, y).is_none() && m.add_bond(x, y, if double { 2 } else { 1 }).is_some();
    }
    if let Some(i) = attach {
        added |= m.add_bond(i, ids[0], 1).is_some();
    }
    added.then_some(m)
}
