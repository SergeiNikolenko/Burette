//! Library templates (Ketcher's template library, functional groups and
//! salts): placed on the canvas, attached to an atom or fused on a bond the
//! way Ketcher's template tool does it.
use crate::chem;
use crate::geometry::{V2, bond_angles, open_angle, snap};
use crate::model::{Atom, Mol, SGroup, Stereo};
use crate::tools::MERGE;
use crate::valence::{max_valence, valence};
use std::f64::consts::PI;

#[derive(Clone, Debug, PartialEq)]
pub struct Template {
    /// The drawing in model units (median bond length 1).
    pub mol: Mol,
    /// Attachment atom; without one the template is always placed freely
    /// and never merges (salts and solvents).
    pub atom: Option<usize>,
    /// Attachment bond for fusing; without one bonds are not fused on.
    pub bond: Option<usize>,
    /// A functional group (an abbreviation S-group): the group is inserted
    /// expanded, and a clicked atom is replaced by its attachment atom.
    pub group: bool,
}

impl Template {
    /// Reads a template molfile; `atom` and `bond` are 1-based, 0 for none.
    pub fn parse(text: &str, atom: u32, bond: u32) -> Result<Template, String> {
        let mol = chem::read_template(text)?;
        if mol.is_empty() {
            return Err("Choose a non-empty template".into());
        }
        if atom as usize > mol.atoms.len() || bond as usize > mol.bonds.len() {
            return Err("Template attachment point is missing".into());
        }
        let pick = |k: u32, n: usize| (k as usize).checked_sub(1).filter(|&i| i < n);
        let group = text.lines().any(|l| l.starts_with("M  STY") && l.contains("SUP"));
        let atom = pick(atom, mol.atoms.len());
        let bond = pick(bond, mol.bonds.len());
        Ok(Template { mol, atom, bond, group })
    }

    fn centre(&self) -> V2 {
        let n = self.mol.atoms.len().max(1) as f64;
        self.mol.atoms.iter().fold(V2::default(), |s, a| s + a.pos) * (1. / n)
    }
}

/// Whether `a` is a carbon without charge, isotope, radical or fixed valence.
fn plain_carbon(a: &Atom) -> bool {
    a.el == 6 && (a.charge, a.iso, a.radical, a.rgroup) == (0, 0, 0, 0) && a.total.is_none()
}

/// The template copied into `mol` with its atom positions mapped by `to`.
/// Template atoms in `fixed` land on the given existing atoms; with `merge`
/// the others reuse existing atoms they fall on. A shared atom takes the
/// template atom's element unless that is a plain carbon (a `replace`d atom
/// takes it in any case); shared bonds keep the higher order.
fn place(mol: &Mol, t: &Template, fixed: &[(usize, usize)], to: impl Fn(V2) -> V2, merge: bool, replace: Option<usize>) -> Option<Mol> {
    let mut m = mol.clone();
    let existing = mol.atoms.len();
    let mut map: Vec<usize> = Vec::with_capacity(t.mol.atoms.len());
    for (k, a) in t.mol.atoms.iter().enumerate() {
        let p = to(a.pos);
        let found = fixed.iter().find(|f| f.0 == k).map(|f| f.1).or_else(|| {
            let free = |j: &usize| *j < existing && !map.contains(j) && !fixed.iter().any(|f| f.1 == *j);
            merge.then(|| m.nearest_atom(p, MERGE).filter(free)).flatten()
        });
        match found {
            Some(j) => {
                if replace == Some(k) || !plain_carbon(a) {
                    let pos = m.atoms[j].pos;
                    m.atoms[j] = Atom { pos, ..a.clone() };
                }
                map.push(j);
            }
            None => {
                m.atoms.push(Atom { pos: p, ..a.clone() });
                map.push(m.atoms.len() - 1);
            }
        }
    }
    let mut bonds = Vec::with_capacity(t.mol.bonds.len());
    for b in &t.mol.bonds {
        let (x, y) = (map[b.a], map[b.b]);
        match m.bond_between(x, y) {
            Some(bi) => {
                let e = &mut m.bonds[bi];
                if b.dative {
                    (e.a, e.b, e.order, e.dative, e.arom) = (x, y, 1, true, false);
                }
                if b.order > e.order {
                    (e.order, e.arom) = (b.order, false);
                }
                if e.stereo == Stereo::None && b.stereo != Stereo::None {
                    (e.a, e.b, e.stereo) = (x, y, b.stereo);
                }
                bonds.push(Some(bi));
            }
            None => {
                let bi = m.add_bond(x, y, b.order);
                if let Some(bi) = bi {
                    m.bonds[bi].stereo = b.stereo;
                    m.bonds[bi].dative = b.dative;
                }
                bonds.push(bi);
            }
        }
    }
    let shared: Vec<usize> = map.iter().copied().filter(|&j| j < existing).collect();
    let adj = m.adjacency();
    if shared.iter().any(|&j| valence(&m, &adj, j).error) {
        rekekulize(&mut m, t, &map, &bonds);
    }
    // Never silently turn a valid attachment atom into an impossible one.
    // Templates that already contain unusual valences remain drawable.
    let (before, source, after) = (mol.adjacency(), t.mol.adjacency(), m.adjacency());
    if map.iter().enumerate().any(|(k, &j)| {
        valence(&m, &after, j).error
            && !valence(&t.mol, &source, k).error
            && (j >= existing || !valence(mol, &before, j).error)
    }) {
        return None;
    }
    for g in &t.mol.sgroups {
        let mut atoms: Vec<usize> = g.atoms.iter().map(|&i| map[i]).collect();
        atoms.sort_unstable();
        atoms.dedup();
        m.sgroups.push(SGroup { atoms, label: g.label.clone(), connect: g.connect.clone() });
    }
    Some(m)
}

/// When fusing gave shared atoms too many bonds (a ring-fusion atom with two
/// double bonds), re-places the double bonds of the template's conjugated
/// part as a Kekulé structure in which atoms that keep a double bond outside
/// it take none, preferring the template's own pattern. Unchanged when there
/// is no such structure.
fn rekekulize(m: &mut Mol, t: &Template, map: &[usize], bonds: &[Option<usize>]) {
    const STEPS: usize = 20_000;
    let mut wants = vec![false; t.mol.atoms.len()];
    for b in t.mol.bonds.iter().filter(|b| b.order == 2) {
        (wants[b.a], wants[b.b]) = (true, true);
    }
    // Conjugated template bonds in the drawing, with their template order.
    let mut cand: Vec<(usize, usize, usize, bool)> = Vec::new();
    for (tb, bi) in t.mol.bonds.iter().zip(bonds) {
        if let Some(bi) = *bi
            && tb.order <= 2
            && !tb.dative
            && tb.stereo == Stereo::None
            && wants[tb.a]
            && wants[tb.b]
            && !cand.iter().any(|c| c.0 == bi)
        {
            cand.push((bi, map[tb.a], map[tb.b], tb.order == 2));
        }
    }
    // Template double bonds first, so its pattern wins ties.
    cand.sort_by_key(|c| !c.3);
    let free: Vec<bool> = (0..m.bonds.len()).map(|bi| !cand.iter().any(|c| c.0 == bi)).collect();
    let atoms: Vec<usize> = (0..t.mol.atoms.len()).filter(|&k| wants[k]).map(|k| map[k]).collect();
    let mut need = vec![false; m.atoms.len()];
    for &a in &atoms {
        need[a] = !m.bonds.iter().enumerate().any(|(bi, b)| free[bi] && b.has(a) && b.order >= 2);
    }
    let mut chosen = vec![false; cand.len()];
    let mut steps = 0;
    fn solve(cand: &[(usize, usize, usize, bool)], need: &mut [bool], chosen: &mut [bool], steps: &mut usize) -> bool {
        let Some(a) = need.iter().position(|&n| n) else { return true };
        for k in 0..cand.len() {
            let (_, x, y, _) = cand[k];
            let other = if x == a { y } else if y == a { x } else { continue };
            *steps += 1;
            if chosen[k] || !need[other] || *steps > STEPS {
                continue;
            }
            (need[a], need[other], chosen[k]) = (false, false, true);
            if solve(cand, need, chosen, steps) {
                return true;
            }
            (need[a], need[other], chosen[k]) = (true, true, false);
        }
        false
    }
    if solve(&cand, &mut need, &mut chosen, &mut steps) {
        for (c, &on) in cand.iter().zip(&chosen) {
            m.bonds[c.0].order = if on { 2 } else { 1 };
            m.bonds[c.0].arom = false;
        }
    }
}

/// The template centred at `at` and turned by `angle`.
pub fn on_canvas(mol: &Mol, t: &Template, at: V2, angle: f64) -> Option<Mol> {
    if t.mol.is_empty() {
        return None;
    }
    let (lo, hi) = t.mol.bounds()?;
    let c = (lo + hi) * 0.5;
    place(mol, t, &[], |p| at + (p - c).rotate(angle), t.atom.is_some(), None)
}

/// Direction a template on atom `i` points to by default: away from a single
/// neighbour (15° steps), into the widest gap, or to the right.
fn default_direction(mol: &Mol, i: usize) -> f64 {
    let nbrs: Vec<usize> = mol.neighbors(i).collect();
    match nbrs.as_slice() {
        [] => 0.,
        [k] => snap((mol.atoms[i].pos - mol.atoms[*k].pos).angle(), PI / 12.),
        _ => open_angle(&bond_angles(mol, i)),
    }
}

/// The template on atom `i`, pointing along `angle` (`None`: the default
/// direction). Its attachment atom becomes atom `i`, or with `extra` (or when
/// sharing would overfill the atom) a new atom bonded to it.
pub fn on_atom(mol: &Mol, t: &Template, i: usize, angle: Option<f64>, extra: bool) -> Option<Mol> {
    let k = t.atom?;
    let target = mol.atoms.get(i)?;
    let dir = angle.unwrap_or_else(|| default_direction(mol, i));
    let xa = t.mol.atoms[k].pos;
    let c = t.centre();
    let angle0 = if c.dist(xa) > 1e-6 { (c - xa).angle() } else { 0. };
    let shared = if t.group || !plain_carbon(&t.mol.atoms[k]) { &t.mol.atoms[k] } else { target };
    let room = max_valence(shared.el, shared.charge).is_none_or(|v| mol.valence(i) + t.mol.valence(k) <= v);
    if !extra && room {
        let at = target.pos;
        let replace = t.group.then_some(k);
        return place(mol, t, &[(k, i)], |p| at + (p - xa).rotate(dir - angle0), true, replace);
    }
    let mut m = mol.clone();
    let at = target.pos + V2::polar(dir);
    let n = m.add_atom(6, at);
    m.add_bond(i, n, 1)?;
    // Check the original target too: it is outside the template's atom map.
    let adj = m.adjacency();
    if valence(&m, &adj, i).error && !valence(mol, &mol.adjacency(), i).error {
        return None;
    }
    place(&m, t, &[(k, n)], |p| at + (p - xa).rotate(dir - angle0), true, Some(k))
}

/// The template fused on bond `bi` through its attachment bond: on the side
/// of `towards` when given, else on the less crowded side.
pub fn on_bond(mol: &Mol, t: &Template, bi: usize, towards: Option<V2>) -> Option<Mol> {
    let tb = &t.mol.bonds[t.bond?];
    let b = mol.bonds.get(bi)?;
    if tb.dative || b.dative {
        return None;
    }
    let (pa, pb) = (mol.atoms[b.a].pos, mol.atoms[b.b].pos);
    let c = t.centre();
    let fit = |flip: bool| {
        let (begin, end) = if flip { (tb.b, tb.a) } else { (tb.a, tb.b) };
        let (qa, qb) = (t.mol.atoms[begin].pos, t.mol.atoms[end].pos);
        let angle = (pb - pa).angle() - (qb - qa).angle();
        let scale = pa.dist(pb) / qa.dist(qb).max(1e-6);
        let to = move |p: V2| pa + (p - qa).rotate(angle) * scale;
        (begin, end, to, to(c))
    };
    let crowd = |x: V2| -> f64 {
        let others = mol.atoms.iter().enumerate().filter(|(i, _)| *i != b.a && *i != b.b);
        others.map(|(_, a)| 1. / (0.2 + a.pos.dist(x).powi(2))).sum()
    };
    let side = |x: V2| (pb - pa).cross(x - pa);
    let (f0, f1) = (fit(false), fit(true));
    let flip = match towards {
        Some(p) => side(f1.3) * side(p) > side(f0.3) * side(p),
        None => crowd(f1.3) < crowd(f0.3),
    };
    let (begin, end, to, _) = if flip { f1 } else { f0 };
    place(mol, t, &[(begin, b.a), (end, b.b)], to, true, None)
}
