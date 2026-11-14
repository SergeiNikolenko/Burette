//! Implicit hydrogens and valence checks with RDKit default valences, so the
//! drawing never depends on sanitization succeeding.
use crate::model::{Adjacency, Mol};
use cosmolkit_core::Element;

/// Allowed valences (RDKit's lists) of the main-group nonmetals and
/// metalloids, the elements that take implicit hydrogens. Metals and noble
/// gases carry none and are never flagged.
fn allowed(z: i32) -> Option<&'static [u32]> {
    Some(match z {
        1 => &[1],
        5 => &[3],
        6 | 14 | 32 => &[4],
        7 => &[3],
        8 => &[2],
        9 | 17 | 35 => &[1],
        53 | 85 => &[1, 3, 5],
        15 | 33 | 51 => &[3, 5],
        16 | 34 | 52 => &[2, 4, 6],
        _ => return None,
    })
}

pub fn symbol(el: u8) -> &'static str {
    if el == 0 {
        return "R";
    }
    Element::from_atomic_number(el).map_or("?", |e| e.symbol())
}

pub fn element(symbol: &str) -> Option<u8> {
    match symbol {
        "R" | "R#" | "*" | "A" | "Q" => Some(0),
        "D" | "T" => Some(1),
        s => Element::from_symbol(s).map(|e| e.atomic_number()).filter(|&z| z > 0),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Valence {
    pub h: u8,
    pub error: bool,
}

/// Valences of `el` with `charge`, after the isoelectronic neighbour
/// element (N⁺ → C, O⁻ → F, ...); `None` outside the table.
fn valences(el: u8, charge: i8) -> Option<&'static [u32]> {
    allowed(el as i32).and(allowed(el as i32 - charge as i32))
}

/// Whether the table gives the atom's hydrogens; other atoms carry none
/// unless they store a fixed valence.
pub fn tabulated(el: u8, charge: i8) -> bool {
    valences(el, charge).is_some()
}

/// Implicit H count and valence error of atom `i`. A stored total valence
/// fixes the H count; radical electrons take valence before hydrogens.
pub fn valence(mol: &Mol, adj: &Adjacency, i: usize) -> Valence {
    let atom = &mol.atoms[i];
    let bonds: u32 = adj[i].iter().map(|&(b, _)| mol.bonds[b].valence_at(i)).sum();
    let electrons = match atom.radical {
        0 => 0,
        2 => 1,
        _ => 2,
    };
    let list = valences(atom.el, atom.charge);
    if let Some(total) = atom.total {
        let h = (total as u32).saturating_sub(bonds);
        let error = list.and_then(|l| l.last()).is_some_and(|&max| bonds + h + electrons > max);
        return Valence { h: h as u8, error };
    }
    let Some(list) = list else { return Valence::default() };
    let used = bonds + electrons;
    match list.iter().find(|&&v| v >= used) {
        Some(v) => Valence { h: (v - used) as u8, error: false },
        None => Valence { h: 0, error: true },
    }
}

/// Largest allowed valence, for edits that must not overfill an atom.
pub fn max_valence(el: u8, charge: i8) -> Option<u32> {
    valences(el, charge).and_then(|l| l.last().copied())
}
