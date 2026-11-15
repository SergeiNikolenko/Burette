//! The drawing: atoms and bonds in model units (bond length 1, y down).
//! Covalent bond orders are Kekulé (1–3); `arom` marks aromatic display.
use crate::geometry::V2;

/// A pointer target in the drawing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Atom(usize),
    Bond(usize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stereo {
    None,
    /// Solid wedge, narrow at `a`.
    Wedge,
    /// Hashed wedge, narrow at `a`.
    Hash,
    /// Either configuration: a wavy single bond or a crossed double bond.
    Wavy,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Atom {
    /// Atomic number; 0 is an R-group (`rgroup` 1–99) or a bare `*` (0).
    pub el: u8,
    pub pos: V2,
    pub charge: i8,
    pub iso: u16,
    pub rgroup: u8,
    /// V2000 atom alias; retained verbatim for Markush/query structures.
    pub alias: Option<String>,
    /// Fixed total valence (bonds + H, a molfile valence field); `None`
    /// takes hydrogens from the default valences.
    pub total: Option<u8>,
    /// Molfile radical code: 1 singlet, 2 doublet, 3 triplet.
    pub radical: u8,
    /// Atom mapping number, retained across edits and format conversions.
    pub mapping: u32,
}

impl Atom {
    pub fn new(el: u8, pos: V2) -> Atom {
        Atom { el, pos, charge: 0, iso: 0, rgroup: 0, alias: None, total: None, radical: 0, mapping: 0 }
    }

    /// Back to an ordinary atom of `el` after an explicit edit.
    pub fn retype(&mut self, el: u8) {
        self.alias = None;
        (self.el, self.iso, self.rgroup, self.total, self.radical) = (el, 0, 0, None, 0);
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bond {
    pub a: usize,
    pub b: usize,
    pub order: u8,
    /// Coordinate bond, directed from donor `a` to acceptor `b` (V2000 type 9).
    pub dative: bool,
    pub arom: bool,
    pub stereo: Stereo,
}

impl Bond {
    pub fn other(&self, i: usize) -> usize {
        if self.a == i { self.b } else { self.a }
    }
    pub fn has(&self, i: usize) -> bool {
        self.a == i || self.b == i
    }
    /// A coordinate bond contributes only to its acceptor's valence.
    pub fn valence_at(&self, i: usize) -> u32 {
        if self.dative && i == self.a { 0 } else { self.order as u32 }
    }
}

/// A structural repeat unit (SRU polymer brackets) over `atoms`.
#[derive(Clone, Debug, PartialEq)]
pub struct SGroup {
    pub atoms: Vec<usize>,
    /// Subscript beside the closing bracket.
    pub label: String,
    /// Molfile connectivity: "HT" (head-to-tail), "HH" or "EU".
    pub connect: String,
}

impl SGroup {
    pub fn new(atoms: Vec<usize>) -> SGroup {
        SGroup { atoms, label: "n".into(), connect: "HT".into() }
    }

    /// The unit's atoms plus explicit hydrogens on them, flagged per atom.
    pub fn members(&self, mol: &Mol) -> Vec<bool> {
        let mut inside = vec![false; mol.atoms.len()];
        self.atoms.iter().filter(|&&i| i < mol.atoms.len()).for_each(|&i| inside[i] = true);
        let mut degree = vec![0usize; mol.atoms.len()];
        for b in &mol.bonds {
            degree[b.a] += 1;
            degree[b.b] += 1;
        }
        let lone_h: Vec<usize> = (mol.bonds.iter())
            .flat_map(|b| [(b.a, b.b), (b.b, b.a)])
            .filter(|&(h, x)| inside[x] && !inside[h] && mol.atoms[h].el == 1 && degree[h] == 1)
            .map(|(h, _)| h)
            .collect();
        lone_h.into_iter().for_each(|h| inside[h] = true);
        inside
    }

    /// Bonds that leave the unit, as (bond, inner atom, outer atom).
    pub fn crossing(&self, mol: &Mol) -> Vec<(usize, usize, usize)> {
        let inside = self.members(mol);
        (mol.bonds.iter().enumerate())
            .filter(|(_, b)| inside[b.a] != inside[b.b])
            .map(|(i, b)| if inside[b.a] { (i, b.a, b.b) } else { (i, b.b, b.a) })
            .collect()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mol {
    pub atoms: Vec<Atom>,
    pub bonds: Vec<Bond>,
    pub sgroups: Vec<SGroup>,
}

/// Per atom: (bond index, neighbour index).
pub type Adjacency = Vec<Vec<(usize, usize)>>;

impl Mol {
    pub fn is_empty(&self) -> bool {
        self.atoms.is_empty()
    }

    pub fn add_atom(&mut self, el: u8, pos: V2) -> usize {
        self.atoms.push(Atom::new(el, pos));
        self.atoms.len() - 1
    }

    pub fn bond_between(&self, a: usize, b: usize) -> Option<usize> {
        self.bonds.iter().position(|bd| (bd.a == a && bd.b == b) || (bd.a == b && bd.b == a))
    }

    /// Adds a plain bond unless it would duplicate a bond or have zero length.
    pub fn add_bond(&mut self, a: usize, b: usize, order: u8) -> Option<usize> {
        if a == b
            || a >= self.atoms.len()
            || b >= self.atoms.len()
            || self.bond_between(a, b).is_some()
            || self.atoms[a].pos.dist(self.atoms[b].pos) < 0.05
        {
            return None;
        }
        self.bonds.push(Bond { a, b, order, dative: false, arom: false, stereo: Stereo::None });
        Some(self.bonds.len() - 1)
    }

    pub fn adjacency(&self) -> Adjacency {
        let mut adj = vec![Vec::new(); self.atoms.len()];
        for (i, b) in self.bonds.iter().enumerate() {
            adj[b.a].push((i, b.b));
            adj[b.b].push((i, b.a));
        }
        adj
    }

    pub fn neighbors(&self, i: usize) -> impl Iterator<Item = usize> + '_ {
        self.bonds.iter().filter(move |b| b.has(i)).map(move |b| b.other(i))
    }

    /// Bond order sum of atom `i`.
    pub fn valence(&self, i: usize) -> u32 {
        self.bonds.iter().filter(|b| b.has(i)).map(|b| b.valence_at(i)).sum()
    }

    /// Removes flagged atoms (with their bonds) and flagged bonds; repeat
    /// units lose the removed atoms and go when empty.
    pub fn remove(&mut self, atoms: &[bool], bonds: &[bool]) {
        let mut map = vec![usize::MAX; self.atoms.len()];
        let mut kept = Vec::with_capacity(self.atoms.len());
        for (i, a) in self.atoms.drain(..).enumerate() {
            if !atoms.get(i).copied().unwrap_or(false) {
                map[i] = kept.len();
                kept.push(a);
            }
        }
        self.atoms = kept;
        for g in &mut self.sgroups {
            g.atoms = g.atoms.iter().filter_map(|&i| map.get(i).copied().filter(|&j| j != usize::MAX)).collect();
        }
        self.sgroups.retain(|g| !g.atoms.is_empty());
        let old = std::mem::take(&mut self.bonds);
        for (i, mut b) in old.into_iter().enumerate() {
            if bonds.get(i).copied().unwrap_or(false) || map[b.a] == usize::MAX || map[b.b] == usize::MAX {
                continue;
            }
            b.a = map[b.a];
            b.b = map[b.b];
            self.bonds.push(b);
        }
    }

    /// Connected component containing atom `start`.
    pub fn fragment(&self, start: usize) -> Vec<bool> {
        let adj = self.adjacency();
        let mut seen = vec![false; self.atoms.len()];
        let mut stack = vec![start];
        while let Some(i) = stack.pop() {
            if i >= seen.len() || seen[i] {
                continue;
            }
            seen[i] = true;
            stack.extend(adj[i].iter().map(|&(_, n)| n));
        }
        seen
    }

    pub fn bounds(&self) -> Option<(V2, V2)> {
        let first = self.atoms.first()?.pos;
        Some(self.atoms.iter().fold((first, first), |(lo, hi), a| {
            (
                V2 { x: lo.x.min(a.pos.x), y: lo.y.min(a.pos.y) },
                V2 { x: hi.x.max(a.pos.x), y: hi.y.max(a.pos.y) },
            )
        }))
    }

    pub fn nearest_atom(&self, p: V2, radius: f64) -> Option<usize> {
        self.atoms
            .iter()
            .enumerate()
            .map(|(i, a)| (i, a.pos.dist(p)))
            .filter(|&(_, d)| d <= radius)
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(i, _)| i)
    }

    pub fn nearest_bond(&self, p: V2, radius: f64) -> Option<usize> {
        self.bonds
            .iter()
            .enumerate()
            .filter_map(|(i, b)| {
                let (a, z) = (self.atoms[b.a].pos, self.atoms[b.b].pos);
                let d = z - a;
                let t = ((p - a).dot(d) / d.dot(d).max(1e-12)).clamp(0., 1.);
                // Ends belong to atoms; only the middle of a bond picks it.
                (t > 0.12 && t < 0.88).then(|| (i, a.lerp(z, t).dist(p)))
            })
            .filter(|&(_, d)| d <= radius)
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(i, _)| i)
    }

    /// Appends a copy of `other`, returning the index of its first atom.
    pub fn append(&mut self, other: &Mol, offset: V2) -> usize {
        let base = self.atoms.len();
        self.atoms.extend(other.atoms.iter().map(|a| Atom { pos: a.pos + offset, ..a.clone() }));
        self.bonds.extend(other.bonds.iter().map(|b| Bond { a: b.a + base, b: b.b + base, ..b.clone() }));
        let shift = |g: &SGroup| SGroup { atoms: g.atoms.iter().map(|i| i + base).collect(), ..g.clone() };
        self.sgroups.extend(other.sgroups.iter().map(shift));
        base
    }

    /// Atoms and bonds of `atoms` (bonds with both ends selected), with the
    /// repeat units that lie wholly inside.
    pub fn subset(&self, atoms: &[bool]) -> Mol {
        let mut keep = atoms.to_vec();
        keep.resize(self.atoms.len(), false);
        let drop: Vec<bool> = keep.iter().map(|k| !k).collect();
        let mut m = self.clone();
        m.sgroups.retain(|g| g.atoms.iter().all(|&i| keep.get(i).copied().unwrap_or(false)));
        m.remove(&drop, &[]);
        m
    }
}
