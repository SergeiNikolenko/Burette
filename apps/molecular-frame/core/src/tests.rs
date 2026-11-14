use crate::chem;
use crate::editor::Editor;
use crate::geometry::{box_gap, box_segment_gap, v2};
use crate::model::{Item, Mol, Stereo};
use crate::render;
use crate::tools::{self, BondKind, RingKind};
use crate::valence::{Valence, valence};

/// NAD⁺ as the tests write it and as the page loads it.
const NAD: &str = "NC(=O)c1ccc[n+](c1)[C@@H]1O[C@H](COP([O-])(=O)OP(=O)(O)OC[C@H]2O[C@@H](n3cnc4c(N)ncnc43)[C@H](O)[C@@H]2O)[C@@H](O)[C@H]1O";
const NAD_PAGE: &str = "NC(=O)c1ccc[n+]([C@@H]2O[C@H](COP(=O)([O-])OP(=O)(O)OC[C@H]3O[C@@H](n4cnc5c(N)ncnc54)[C@H](O)[C@@H]3O)[C@@H](O)[C@H]2O)c1";

#[test]
fn host_selection_is_exact_and_invalid_indices_preserve_it() {
    let mut e = editor();
    e.load("CCO").unwrap();
    let graph = e.molfile();
    e.set_selection(&[0, 2], &[]).unwrap();
    assert!(e.state().contains("\"selectedAtoms\":[0, 2]"));
    assert!(e.state().contains("\"selectedBonds\":[]"));
    e.set_selection(&[0, 1], &[]).unwrap();
    let fragment = chem::parse(&e.selection_molfile()).unwrap();
    assert_eq!(fragment.atoms.len(), 2);
    assert!(fragment.bonds.is_empty());
    e.set_selection(&[0, 2], &[]).unwrap();
    assert!(e.set_selection(&[0], &[99]).is_err());
    assert!(e.state().contains("\"selectedAtoms\":[0, 2]"));
    e.set_selection(&[], &[1]).unwrap();
    assert!(e.state().contains("\"selectedBonds\":[1]"));
    assert_eq!(e.molfile(), graph);
    assert_eq!(chem::parse(&e.selection_molfile()).unwrap().atoms.len(), 2);
}

#[test]
fn programmatic_zoom_reaches_requested_scale_without_wheel_clamping() {
    let mut e = editor();
    e.load("CCO").unwrap();
    let before = e.molfile();
    e.zoom_by(150. / e.zoom() as f64);
    assert_eq!(e.zoom(), 150);
    assert_eq!(e.molfile(), before);
    assert!(!e.zoom_by(f64::NAN));
    assert!(!e.zoom_by(-1.));
    assert_eq!(e.zoom(), 150);
}

#[test]
fn atom_mapping_and_absolute_stereochemistry_survive_edits() {
    let mut e = editor();
    e.load("F[C@H:7](Cl)Br").unwrap();
    let expected = canonical("F[C@H:7](Cl)Br");
    assert_eq!(e.smiles(), expected);
    assert_eq!(&e.molfile().lines().nth(3).unwrap()[12..15], "  1");
    let saved = e.molfile();
    e.load(&saved).unwrap();
    e.command("clean");
    assert_eq!(e.smiles(), expected);
    let maps: Vec<_> = e.mol().atoms.iter().map(|a| a.mapping).collect();
    assert_eq!(maps.iter().filter(|&&n| n == 7).count(), 1);
}

#[test]
fn unsupported_chemistry_preserves_the_current_drawing() {
    let mut e = editor();
    e.load("CO").unwrap();
    let original = e.molfile();
    for input in ["F[C@H](Cl)Br |&1:1|", "F[C@H](Cl)Br |o2:1|", "[CH3:1000]O"] {
        assert!(e.load(input).is_err(), "accepted {input}");
        assert_eq!(e.molfile(), original);
    }
    let absolute = chem::write_v2000(&chem::parse("F[C@H](Cl)Br").unwrap());
    let relative = absolute.replacen("  0  0  1  0", "  0  0  0  0", 1);
    assert!(e.load(&relative).is_err());
    let query = original.replace("  1  2  1  0", "  1  2  5  0");
    assert_ne!(query, original);
    assert!(e.load(&query).is_err());
    assert_eq!(e.molfile(), original);
}

fn editor() -> Editor {
    let mut e = Editor::new();
    e.resize(800., 600.);
    e
}

/// Screen position of model point `p`.
fn at(e: &Editor, x: f64, y: f64) -> (f64, f64) {
    let p = e.view().screen(v2(x, y));
    (p.x, p.y)
}

fn click(e: &mut Editor, x: f64, y: f64) {
    let (sx, sy) = at(e, x, y);
    e.pointer_down(sx, sy, 0, false, false);
    e.pointer_up(sx, sy);
}

fn drag(e: &mut Editor, from: (f64, f64), to: (f64, f64)) {
    let (a, b) = (at(e, from.0, from.1), at(e, to.0, to.1));
    e.pointer_down(a.0, a.1, 0, false, false);
    for k in 1..=8 {
        let t = k as f64 / 8.;
        e.pointer_move(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, 1, false, false);
    }
    e.pointer_up(b.0, b.1);
}

fn state(e: &Editor, key: &str) -> String {
    let s = e.state();
    let start = s.find(&format!("\"{key}\":")).map(|i| i + key.len() + 3).unwrap_or(0);
    s[start..].split([',', '}']).next().unwrap_or("").trim_matches('"').to_string()
}

fn canonical(smiles: &str) -> String {
    cosmolkit_core::Molecule::from_smiles(smiles).unwrap().to_smiles(true).unwrap()
}

fn valences(mol: &Mol, adj: &crate::model::Adjacency) -> Vec<Valence> {
    (0..mol.atoms.len()).map(|i| valence(mol, adj, i)).collect()
}

fn h_counts(mol: &Mol) -> Vec<u8> {
    valences(mol, &mol.adjacency()).iter().map(|v| v.h).collect()
}

/// A V2000 molfile with plain atoms (symbol, x, y) and bonds (from, to, order).
fn molfile(atoms: &[(&str, f64, f64)], bonds: &[(usize, usize, u8)], props: &str) -> String {
    let mut s = format!("\n  test\n\n{:>3}{:>3}  0  0  0  0  0  0  0  0999 V2000\n", atoms.len(), bonds.len());
    for (sym, x, y) in atoms {
        s += &format!("{x:>10.4}{y:>10.4}    0.0000 {sym:<3} 0  0  0  0  0  0  0  0  0  0  0  0\n");
    }
    for (a, b, order) in bonds {
        s += &format!("{a:>3}{b:>3}{order:>3}  0\n");
    }
    s + props + "M  END\n"
}

/// Smallest distance between two labelled atoms that share no bond.
fn closest_labels(m: &Mol) -> f64 {
    let adj = m.adjacency();
    let labelled: Vec<usize> = (0..m.atoms.len()).filter(|&i| !render::label_boxes(m, &adj, i).is_empty()).collect();
    let mut min = f64::INFINITY;
    for (k, &i) in labelled.iter().enumerate() {
        for &j in &labelled[k + 1..] {
            if m.bond_between(i, j).is_none() {
                min = min.min(m.atoms[i].pos.dist(m.atoms[j].pos));
            }
        }
    }
    min
}

#[test]
fn bond_tool_draws_and_cycles() {
    let mut e = editor();
    click(&mut e, 0., 0.);
    assert_eq!((e.mol().atoms.len(), e.mol().bonds.len()), (2, 1));
    let (a, b) = (e.mol().atoms[0].pos, e.mol().atoms[1].pos);
    assert!((a.dist(b) - 1.).abs() < 1e-9);
    assert!(((b - a).angle() + std::f64::consts::PI / 6.).abs() < 1e-9, "first bond rises at 30°");
    // Clicking the end atom continues the zigzag at 120°.
    click(&mut e, b.x, b.y);
    let c = e.mol().atoms[2].pos;
    assert!(((a - b).unit().dot((c - b).unit()) + 0.5).abs() < 1e-6);
    assert!(c.y > b.y, "zigzag goes back down");
    // Clicking a bond cycles single → double → triple → single.
    let mid = a.lerp(b, 0.5);
    for order in [2, 3, 1] {
        click(&mut e, mid.x, mid.y);
        assert_eq!(e.mol().bonds[0].order, order);
    }
    // Wedge on a wedge flips it.
    e.set_tool("bond:wedge");
    click(&mut e, mid.x, mid.y);
    assert_eq!(e.mol().bonds[0].stereo, Stereo::Wedge);
    let first = (e.mol().bonds[0].a, e.mol().bonds[0].b);
    click(&mut e, mid.x, mid.y);
    assert_eq!((e.mol().bonds[0].b, e.mol().bonds[0].a), first);
    assert_eq!(state(&e, "tool"), "bond:wedge");
}

#[test]
fn bond_drag_snaps_and_connects() {
    let mut e = editor();
    drag(&mut e, (0., 0.), (2.0, 0.3));
    let m = e.mol();
    assert_eq!(m.bonds.len(), 1);
    let d = m.atoms[1].pos - m.atoms[0].pos;
    assert!((d.len() - 1.).abs() < 1e-9 && (d.angle() - 15f64.to_radians()).abs() < 1e-9);
    // Dragging from the new atom back onto the first never duplicates the bond.
    let p = m.atoms[1].pos;
    drag(&mut e, (p.x, p.y), (0.05, 0.05));
    assert_eq!(e.mol().bonds.len(), 1);
    assert_eq!(e.mol().bonds[0].order, 2, "an existing bond takes the new kind instead");
    // A drag that ends on another atom connects to it.
    click(&mut e, p.x, p.y);
    let q = e.mol().atoms[2].pos;
    drag(&mut e, (q.x, q.y), (0., 0.));
    assert_eq!(e.mol().bonds.len(), 3);
    assert_eq!(e.mol().atoms.len(), 3);
}

#[test]
fn chain_tool_counts_zigzag() {
    let mut e = editor();
    e.set_tool("chain");
    let (a, b) = (at(&e, 0., 0.), at(&e, 4. * 0.866, 0.));
    e.pointer_down(a.0, a.1, 0, false, false);
    e.pointer_move(b.0, b.1, 1, false, false);
    assert!(e.svg().contains(">4</text>"), "preview shows the bond count");
    e.pointer_up(b.0, b.1);
    assert_eq!((e.mol().atoms.len(), e.mol().bonds.len()), (5, 4));
    assert_eq!(state(&e, "canUndo"), "true");
    e.command("undo");
    assert!(e.mol().is_empty());
}

#[test]
fn rings_place_fuse_and_spiro() {
    let mut e = editor();
    e.set_tool("ring:benzene");
    click(&mut e, 0., 0.);
    let m = e.mol().clone();
    assert_eq!((m.atoms.len(), m.bonds.len()), (6, 6));
    assert_eq!(m.bonds.iter().filter(|b| b.order == 2).count(), 3);
    let bottom: Vec<f64> = m.atoms.iter().map(|a| a.pos.y).collect();
    let max = bottom.iter().cloned().fold(f64::MIN, f64::max);
    assert_eq!(bottom.iter().filter(|&&y| (y - max).abs() < 1e-9).count(), 2, "flat side down");
    // Fuse a second benzene on a single bond: naphthalene with a valid Kekulé structure.
    let single = m.bonds.iter().position(|b| b.order == 1).unwrap();
    let mid = m.atoms[m.bonds[single].a].pos.lerp(m.atoms[m.bonds[single].b].pos, 0.5);
    click(&mut e, mid.x, mid.y);
    let m = e.mol().clone();
    assert_eq!((m.atoms.len(), m.bonds.len()), (10, 11));
    assert_eq!(m.bonds.iter().filter(|b| b.order == 2).count(), 5);
    assert!(valences(&m, &m.adjacency()).iter().all(|v| !v.error));
    assert_eq!(chem::smiles(&m), canonical("c1ccc2ccccc2c1"));
    // Spiro cyclopentane on a ring-fusion-free sp3 atom of a new cyclohexane.
    let mut e = editor();
    e.set_tool("ring:cyclohexane");
    click(&mut e, 0., 0.);
    e.set_tool("ring:cyclopentane");
    let p = e.mol().atoms[0].pos;
    click(&mut e, p.x, p.y);
    assert_eq!((e.mol().atoms.len(), e.mol().bonds.len()), (10, 11));
    assert_eq!(chem::smiles(e.mol()), canonical("C1CCC2(CC1)CCCC2"));
    // Benzene on a saturated ring atom attaches as phenyl instead.
    e.set_tool("ring:benzene");
    let p = e.mol().atoms[2].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.mol().atoms.len(), 16);
    assert!(valences(e.mol(), &e.mol().adjacency()).iter().all(|v| !v.error));
}

#[test]
fn ring_fusion_merges_coinciding_atoms() {
    let mut m = Mol::default();
    let r = tools::ring(&m, RingKind::Cyclohexane, v2(0., 0.), None).unwrap();
    m = r;
    // Fusing on two adjacent bonds of a ring closes a third ring without duplicate atoms.
    let b0 = m.bond_between(0, 1).unwrap();
    m = tools::ring(&m, RingKind::Cyclohexane, v2(0., 0.), Some(Item::Bond(b0))).unwrap();
    let b1 = m.bond_between(1, 2).unwrap();
    m = tools::ring(&m, RingKind::Cyclohexane, v2(0., 0.), Some(Item::Bond(b1))).unwrap();
    assert_eq!(m.atoms.len(), 13, "phenalene skeleton shares the coinciding atom");
    assert_eq!(m.bonds.len(), 15);
}

#[test]
fn erase_and_charge() {
    let mut e = editor();
    e.load("CCO").unwrap();
    let m = e.mol().clone();
    // Erasing the C–O bond keeps the oxygen (water) and drops nothing else.
    let co = m.bonds.iter().position(|b| m.atoms[b.a].el == 8 || m.atoms[b.b].el == 8).unwrap();
    let m2 = tools::erase(&m, &[], &[co == 0, co == 1]).unwrap();
    assert_eq!(m2.atoms.len(), 3);
    // Erasing the C–C bond drops the orphaned carbon.
    let cc = 1 - co;
    let m3 = tools::erase(&m, &[], &[cc == 0, cc == 1]).unwrap();
    assert_eq!((m3.atoms.len(), m3.bonds.len()), (2, 1));
    // Charge: O⁻ has no hydrogen, N⁺ gains one.
    let o = m.atoms.iter().position(|a| a.el == 8).unwrap();
    let neg = tools::add_charge(&m, o, -1).unwrap();
    assert_eq!(valence(&neg, &neg.adjacency(), o).h, 0);
    let mut big = neg.clone();
    for _ in 0..10 {
        big = tools::add_charge(&big, o, -1).unwrap_or(big);
    }
    assert_eq!(big.atoms[o].charge, -4);
    e.set_tool("erase");
    let p = e.mol().atoms[o].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.mol().atoms.len(), 2);
}

#[test]
fn implicit_hydrogens_and_valence() {
    let m = chem::parse("C[N+](C)(C)C.[O-]C(=O)c1cc[nH]c1.OS(=O)(=O)O.P(Cl)(Cl)(Cl)(Cl)Cl.B").unwrap();
    let h = h_counts(&m);
    let find = |el: u8, charge: i8| m.atoms.iter().position(|a| a.el == el && a.charge == charge).unwrap();
    assert_eq!(h[find(7, 1)], 0);
    assert_eq!(h[find(8, -1)], 0);
    let n_h = m.atoms.iter().position(|a| a.el == 7 && a.charge == 0).unwrap();
    assert_eq!(h[n_h], 1, "pyrrole NH is kept by the Kekulé drawing");
    assert_eq!(h[find(16, 0)], 0);
    assert_eq!(h[find(15, 0)], 0);
    assert_eq!(h[find(5, 0)], 3);
    let mut five = Mol::default();
    let c = five.add_atom(6, v2(0., 0.));
    for k in 0..5 {
        let n = five.add_atom(6, crate::geometry::V2::polar(k as f64) * 1.);
        five.add_bond(c, n, 1);
    }
    assert!(valence(&five, &five.adjacency(), c).error);
}

#[test]
fn v2000_round_trip() {
    let m = chem::parse("[13CH3][C@H](N)C(=O)[O-].[NH4+].[2*]CC").unwrap();
    let text = chem::write_v2000(&m);
    assert!(text.contains("M  CHG") && text.contains("M  ISO") && text.contains("M  RGP"));
    let back = chem::read_v2000(&text, Some(1. / chem::ANGSTROM)).unwrap();
    assert_eq!(back.atoms.len(), m.atoms.len());
    for (a, b) in m.atoms.iter().zip(&back.atoms) {
        assert_eq!((a.el, a.charge, a.iso, a.rgroup), (b.el, b.charge, b.iso, b.rgroup));
        assert!(a.pos.dist(b.pos) < 1e-3);
    }
    assert_eq!(m.bonds, back.bonds);
    assert_eq!(chem::smiles(&back), chem::smiles(&m));
}

#[test]
fn smiles_round_trips() {
    for s in [
        "CCO",
        "Oc1ccccc1",
        "CC(=O)Oc1ccccc1C(=O)O",
        "C[C@H](N)C(=O)O",
        "N[C@@H](C)C(=O)O",
        NAD,
        "F/C=C/Cl",
        "C1CC[C@H]2CCCC[C@@H]2C1",
    ] {
        let m = chem::parse(s).unwrap();
        assert_eq!(chem::smiles(&m), canonical(s), "{s}");
        // Through our own molfile and back.
        let back = chem::parse(&chem::write_v2000(&m)).unwrap();
        assert_eq!(chem::smiles(&back), canonical(s), "{s} via molfile");
        // Layout and clean keep stereochemistry.
        for keep in [false, true] {
            let laid = chem::relayout(&m, keep).unwrap();
            assert_eq!(chem::smiles(&laid), canonical(s), "{s} layout keep={keep}");
        }
    }
    let m = chem::parse("C[C@H](N)C(=O)O").unwrap();
    assert_eq!(m.bonds.iter().filter(|b| b.stereo != Stereo::None).count(), 1);
}

#[test]
fn clean_keeps_orientation() {
    let mut m = chem::parse("c1ccccc1CCO").unwrap();
    for a in &mut m.atoms {
        a.pos = v2(-a.pos.x, a.pos.y) + v2(10., 3.);
    }
    let cleaned = chem::relayout(&m, true).unwrap();
    let rms = (m.atoms.iter().zip(&cleaned.atoms).map(|(a, b)| a.pos.dist(b.pos).powi(2)).sum::<f64>() / m.atoms.len() as f64).sqrt();
    assert!(rms < 0.2, "clean aligns the fresh depiction onto the drawing (rms {rms})");
}

#[test]
fn aromatic_toggle_both_ways() {
    let mut e = editor();
    e.load("c1ccccc1-c1ccncc1").unwrap();
    let before = e.mol().clone();
    assert_eq!(state(&e, "aromatic"), "false");
    assert!(e.command("aromatic"));
    assert_eq!(state(&e, "aromatic"), "true");
    assert_eq!(e.mol().bonds.iter().filter(|b| b.arom).count(), 12);
    assert_eq!(e.svg().matches("me-ring-circle").count(), 2);
    assert_eq!(e.smiles(), chem::smiles(&before));
    assert!(e.command("aromatic"));
    assert_eq!(state(&e, "aromatic"), "false");
    assert_eq!(e.mol(), &before);
}

#[test]
fn hydrogens_toggle_both_ways() {
    let mut e = editor();
    e.load("C[C@H](N)C(=O)O").unwrap();
    let smiles = e.smiles();
    assert!(e.command("hydrogens"));
    assert_eq!(state(&e, "hydrogens"), "true");
    assert_eq!(e.mol().atoms.iter().filter(|a| a.el == 1).count(), 7);
    assert_eq!(e.smiles(), smiles);
    assert!(e.command("hydrogens"));
    assert_eq!(state(&e, "hydrogens"), "false");
    assert_eq!(e.mol().atoms.len(), 6);
    assert_eq!(e.smiles(), smiles);
}

#[test]
fn undo_redo_and_revision() {
    let mut e = editor();
    assert_eq!(state(&e, "revision"), "0");
    click(&mut e, 0., 0.);
    click(&mut e, 3., 0.);
    assert_eq!(e.mol().atoms.len(), 4);
    assert_eq!(state(&e, "revision"), "2");
    assert!(e.key("z", false, true, false));
    assert_eq!(e.mol().atoms.len(), 2);
    assert!(e.key("z", true, true, false));
    assert_eq!(e.mol().atoms.len(), 4);
    assert!(e.key("z", false, true, false));
    assert!(e.key("y", false, true, false));
    assert_eq!(state(&e, "revision"), "6");
    // A drag is one step.
    e.set_tool("select");
    let p = e.mol().atoms[0].pos;
    drag(&mut e, (p.x, p.y), (p.x - 1., p.y + 1.));
    assert!(e.mol().atoms[0].pos.dist(p) > 1.);
    e.command("undo");
    assert!(e.mol().atoms[0].pos.dist(p) < 1e-9);
    for _ in 0..300 {
        e.command("clear");
        e.load("C").unwrap();
    }
    assert!(!e.key("q", false, false, false));
}

#[test]
fn keys_edit_hovered_items() {
    let mut e = editor();
    click(&mut e, 0., 0.);
    let p = e.mol().atoms[1].pos;
    let (sx, sy) = at(&e, p.x, p.y);
    e.pointer_move(sx, sy, 0, false, false);
    assert!(e.key("o", false, false, false));
    assert_eq!(e.mol().atoms[1].el, 8);
    assert!(e.key("+", false, false, false));
    assert_eq!(e.mol().atoms[1].charge, 1);
    assert!(e.key("l", false, false, false));
    assert_eq!(e.mol().atoms[1].el, 17);
    let mid = e.mol().atoms[0].pos.lerp(p, 0.5);
    let (mx, my) = at(&e, mid.x, mid.y);
    e.pointer_move(mx, my, 0, false, false);
    assert!(e.key("2", false, false, false));
    assert_eq!(e.mol().bonds[0].order, 2);
    e.pointer_leave();
    assert!(e.key("n", false, false, false));
    assert_eq!(state(&e, "tool"), "atom:N");
    assert!(e.key("3", false, false, false));
    assert_eq!(state(&e, "tool"), "bond:triple");
    assert!(e.key("a", false, true, false));
    assert_eq!(state(&e, "selection"), "3");
    assert!(e.key("Delete", false, false, false));
    assert_eq!(state(&e, "empty"), "true");
}

#[test]
fn select_marquee_and_fragment() {
    let mut e = editor();
    e.load("CCO.CCN").unwrap();
    e.set_tool("select");
    let (lo, hi) = crate::render::extent(e.mol()).unwrap();
    drag(&mut e, (lo.x - 0.5, lo.y - 0.5), (hi.x + 0.5, hi.y + 0.5));
    assert_eq!(state(&e, "selection"), "10");
    e.command("cancel");
    assert_eq!(state(&e, "selection"), "0");
    let p = e.mol().atoms[0].pos;
    let (sx, sy) = at(&e, p.x, p.y);
    assert!(e.double_click(sx, sy));
    assert_eq!(state(&e, "selection"), "5");
    let block = e.selection_molfile();
    assert_eq!(chem::read_v2000(&block, None).unwrap().atoms.len(), 3);
}

#[test]
fn cip_labels_follow_edits() {
    let mut e = editor();
    e.load("C[C@H](N)C(=O)O").unwrap();
    assert!(e.command("cip"));
    assert!(e.svg().contains("(S)"));
    assert_eq!(state(&e, "cip"), "true");
    // Wedge ↔ hash inverts the centre: the label goes live to (R).
    let b = e.mol().bonds.iter().position(|b| b.stereo != Stereo::None).unwrap();
    let kind = if e.mol().bonds[b].stereo == Stereo::Wedge { "bond:hash" } else { "bond:wedge" };
    e.set_tool(kind);
    let m = e.mol();
    let mid = m.atoms[m.bonds[b].a].pos.lerp(m.atoms[m.bonds[b].b].pos, 0.5);
    click(&mut e, mid.x, mid.y);
    assert!(e.svg().contains("(R)"));
    assert!(e.command("cip"));
    assert!(!e.svg().contains("(R)"));
}

#[test]
fn molfile_3d_has_hydrogens_and_depth() {
    let mut e = editor();
    e.load("C[C@H](N)C(=O)O").unwrap();
    let block = e.molfile_3d().unwrap();
    let m = cosmolkit_core::Molecule::from_mol_block_with_params(
        &block,
        cosmolkit_core::SdfReadParams { remove_hs: false, ..Default::default() },
    )
    .unwrap();
    assert_eq!(m.num_atoms(), 13);
    let z: Vec<f64> = block.lines().skip(4).take(13).map(|l| l[20..30].trim().parse().unwrap()).collect();
    assert!(z.iter().any(|v| v.abs() > 0.3), "non-planar");
    assert!(Editor::new().molfile_3d().is_err());
}

#[test]
fn svg_is_well_formed_and_fast() {
    let mut e = editor();
    e.load(NAD).unwrap();
    e.command("cip");
    e.command("select-all");
    let svg = e.svg();
    assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"600\" viewBox=\"0 0 800 600\" class=\"me-canvas\""));
    assert!(svg.ends_with("</svg>"));
    // Tags balance and no colours are inlined.
    let opens = svg.matches("<text").count() + svg.matches("<tspan").count() + svg.matches("<g").count();
    let closes = svg.matches("</text>").count() + svg.matches("</tspan>").count() + svg.matches("</g>").count();
    assert_eq!(opens, closes);
    assert!(!svg.contains("NaN") && !svg.contains("inf") && !svg.contains("#"));
    assert!(svg.contains("me-el-P") && svg.contains("me-charge") && svg.contains("me-selected"));
    // About 100 atoms, including hydrogens.
    e.command("hydrogens");
    assert!(e.mol().atoms.len() > 70);
    let t = std::time::Instant::now();
    for _ in 0..20 {
        std::hint::black_box(e.svg());
    }
    let per = t.elapsed().as_secs_f64() / 20.;
    eprintln!("svg() for {} atoms: {:.3} ms", e.mol().atoms.len(), per * 1e3);
    assert!(per < 0.01, "svg() too slow: {per}");
}

#[test]
fn labels_follow_acs_rules() {
    let mut e = editor();
    e.load("OCC(N)=O").unwrap();
    let svg = e.svg();
    assert!(svg.contains(">HO</text>") || svg.contains(">OH</text>"));
    assert!(svg.contains("me-el-N"));
    assert!(!svg.contains("me-el-C\""), "skeletal carbons are unlabeled");
    let mut e = editor();
    e.load("[NH4+]").unwrap();
    let svg = e.svg();
    assert!(svg.contains("class=\"me-charge\""), "{svg}");
    let mut e = editor();
    e.load("C").unwrap();
    assert!(e.svg().contains(">CH<tspan"), "isolated carbon reads CH4");
    // Invalid molfile text is an error, not a panic.
    assert!(e.load("not a molecule ((").is_err());
    assert!(e.insert("").is_err());
    assert!(e.load("").is_ok() && e.mol().is_empty());
}

#[test]
fn bond_kinds_are_drawn() {
    let mut m = Mol::default();
    for (k, kind) in [BondKind::Wedge, BondKind::Hash, BondKind::Wavy, BondKind::Triple].into_iter().enumerate() {
        let y = k as f64 * 2.;
        m = tools::add_bond(&m, None, v2(0., y), v2(1., y), None, kind, 6).unwrap();
    }
    let view = crate::render::View { scale: 32., offset: v2(10., 10.), width: 100., height: 100. };
    let svg = crate::render::svg(&m, &view, &Default::default());
    assert!(svg.contains("me-wedge") && svg.contains(" C") || svg.contains("C"));
    assert!(svg.matches("<path").count() >= 2);
}

#[test]
fn imported_layouts_use_unit_bonds_and_never_overlap() {
    let m = chem::parse(NAD).unwrap();
    let mut lengths: Vec<f64> = m.bonds.iter().map(|b| m.atoms[b.a].pos.dist(m.atoms[b.b].pos)).collect();
    lengths.sort_by(f64::total_cmp);
    assert!((lengths[lengths.len() / 2] - 1.).abs() < 1e-6, "RDKit 1.5 Å bonds become 1");
    // Generated fragments are packed apart, labels included.
    let m = chem::parse("[NH4+].[13CH4].[O-]C(=O)C.*CC#N.F/C=C/Cl").unwrap();
    let boxes: Vec<_> = (0..m.atoms.len())
        .filter(|&i| m.fragment(i).iter().position(|&x| x) == Some(i))
        .map(|i| crate::render::extent(&m.subset(&m.fragment(i))).unwrap())
        .collect();
    assert_eq!(boxes.len(), 5);
    for (k, a) in boxes.iter().enumerate() {
        for b in &boxes[k + 1..] {
            let apart = a.1.x + 0.5 < b.0.x || b.1.x + 0.5 < a.0.x || a.1.y + 0.5 < b.0.y || b.1.y + 0.5 < a.0.y;
            assert!(apart, "{a:?} {b:?}");
        }
    }
    // Clean keeps each fragment where it was drawn.
    let mut moved = m.clone();
    for a in moved.atoms.iter_mut().filter(|a| a.el == 7 && a.charge == 1) {
        a.pos = a.pos + v2(0., 30.);
    }
    let cleaned = chem::relayout(&moved, true).unwrap();
    let n = moved.atoms.iter().position(|a| a.el == 7 && a.charge == 1).unwrap();
    let d = cleaned.atoms[n].pos.dist(moved.atoms[n].pos);
    assert!(d < 1e-3, "{d}");
}

#[test]
fn fit_clears_floating_panels() {
    // Load and fit shrink large drawings into the area between the floating
    // panels and centre them within the supported zoom range.
    for (w, h, desktop, pending) in [(1000., 560., true, false), (520., 340., false, false), (1000., 560., true, true)] {
        let mut e = Editor::new();
        if !pending {
            e.resize(w, h);
        }
        e.load(NAD).unwrap();
        if pending {
            assert_eq!(state(&e, "zoom"), "25", "zero-size canvas defers fitting");
            e.resize(w, h);
        }
        let zoom: i64 = state(&e, "zoom").parse().unwrap();
        if desktop {
            assert!(zoom > 100, "{w}x{h}: zoom {zoom}");
        }
        assert!(zoom <= 400);
        let (lo, hi) = render::extent(e.mol()).unwrap();
        let (lo, hi) = (e.view().screen(lo), e.view().screen(hi));
        let horizontal_padding: f64 = if w <= 600. { 16. } else { 60. };
        let pad = v2(horizontal_padding.min(0.3 * w), 60_f64.min(0.3 * h));
        assert!(lo.x >= pad.x - 0.1 && hi.x <= w - pad.x + 0.1 && lo.y >= pad.y - 0.1 && hi.y <= h - pad.y + 0.1, "{w}x{h}: {lo:?} {hi:?}");
        let c = (lo + hi) * 0.5;
        assert!((c.x - w / 2.).abs() < 0.5 && (c.y - h / 2.).abs() < 0.5, "{w}x{h}: centred, {c:?}");
        // Fit after zooming returns to the same view.
        e.command("zoom-in");
        e.command("fit");
        assert_eq!(state(&e, "zoom"), zoom.to_string());
    }
    let mut e = editor();
    e.resize(1400., 900.);
    e.load("c1ccccc1").unwrap();
    assert_eq!(state(&e, "zoom"), "400", "small drawings stop at the maximum supported zoom");
    e.load("").unwrap();
    assert_eq!(state(&e, "zoom"), "100", "empty drawings keep the natural scale");
}

#[test]
fn natural_scale_and_zoom_steps() {
    let mut e = editor();
    e.load("CCO").unwrap();
    while state(&e, "zoom") != "100" {
        e.command("zoom-out");
    }
    // At 100 % a bond is 22.5 px and labels are 15.6 px, like the interface text.
    let m = e.mol();
    let (a, b) = (e.view().screen(m.atoms[m.bonds[0].a].pos), e.view().screen(m.atoms[m.bonds[0].b].pos));
    assert!((a.dist(b) - 22.5).abs() < 1e-6);
    assert!(e.svg().contains("font-size=\"15.63\""), "{}", e.svg());
    let mut stops = vec![];
    while e.command("zoom-in") {
        stops.push(state(&e, "zoom"));
    }
    assert_eq!(stops, ["110", "125", "150", "175", "200", "250", "300", "400"]);
    let mut stops = vec![];
    while e.command("zoom-out") {
        stops.push(state(&e, "zoom"));
    }
    assert_eq!(stops.last().map(String::as_str), Some("25"));
    assert!(stops.contains(&"100".to_string()) && stops.contains(&"50".to_string()));
    // Wheel zoom stays within 25-400 %.
    for _ in 0..50 {
        e.wheel(400., 300., 0., -200., true);
    }
    assert_eq!(state(&e, "zoom"), "400");
    for _ in 0..80 {
        e.wheel(400., 300., 0., 200., true);
    }
    assert_eq!(state(&e, "zoom"), "25");
}

#[test]
fn agent_highlights_preserve_selection_and_structure() {
    let mut e = editor();
    e.load("CCO").unwrap();
    let original = e.svg();
    let before = e.state();
    let molfile = e.molfile();
    e.highlight_atoms(&[1]).unwrap();
    assert_ne!(e.svg(), original);
    assert_eq!(e.state(), before);
    assert_eq!(e.molfile(), molfile);
    let marked = e.svg();
    assert!(e.highlight_atoms(&[999]).is_err());
    assert_eq!(e.svg(), marked);
    e.highlight_atoms(&[]).unwrap();
    assert_eq!(e.svg(), original);
}

#[test]
fn hit_targets_have_a_pixel_floor() {
    let mut e = editor();
    e.load("CCC").unwrap();
    let m = e.mol().clone();
    let mid = (0..3).find(|&i| m.neighbors(i).count() == 2).unwrap();
    let p = e.view().screen(m.atoms[mid].pos);
    // Away from both bonds: the open side of the middle carbon.
    let out = (m.atoms[mid].pos * 2. - (m.atoms[0].pos + m.atoms[2].pos) * 0.5 - m.atoms[mid].pos).unit();
    for zoom in ["100", "50"] {
        while state(&e, "zoom") != zoom {
            e.command("zoom-out");
        }
        let p = e.view().screen(m.atoms[mid].pos);
        let q = p + out * 9.;
        e.pointer_move(q.x, q.y, 0, false, false);
        assert_eq!(state(&e, "cursor"), "pointer", "{zoom} %: 9 px from an atom still targets it");
        // The middle of a bond stays a bond.
        let b = &m.bonds[0];
        let c = e.view().screen(m.atoms[b.a].pos.lerp(m.atoms[b.b].pos, 0.5));
        e.set_tool("bond:single");
        e.pointer_down(c.x, c.y, 0, false, false);
        e.pointer_up(c.x, c.y);
        assert_eq!(e.mol().bonds[0].order, 2, "{zoom} %: the bond middle cycles the bond");
        e.command("undo");
    }
    let _ = p;
}

#[test]
fn r_group_clicks_on_labels_never_stack_atoms() {
    let mut e = editor();
    e.load(NAD_PAGE).unwrap();
    e.set_tool("rgroup");
    let n = e.mol().atoms.len();
    let adj = e.mol().adjacency();
    // A hydroxyl oxygen; click on the far glyph of its OH label (the H).
    let o = (0..n).find(|&i| e.mol().atoms[i].el == 8 && adj[i].len() == 1 && h_counts(e.mol())[i] == 1).unwrap();
    let far = |e: &Editor, i: usize| {
        let boxes = render::label_boxes(e.mol(), &e.mol().adjacency(), i);
        let p = e.mol().atoms[i].pos;
        boxes.iter().map(|(lo, hi)| (*lo + *hi) * 0.5).max_by(|a, b| a.dist(p).total_cmp(&b.dist(p))).unwrap()
    };
    let h = far(&e, o);
    assert!(h.dist(e.mol().atoms[o].pos) > 0.45, "the H glyph lies outside the old atom radius");
    click(&mut e, h.x, h.y);
    assert_eq!(e.mol().atoms.len(), n, "the click relabels the oxygen");
    assert_eq!((e.mol().atoms[o].el, e.mol().atoms[o].rgroup), (0, 1));
    // Clicking the digit of R1, again and again, renumbers that atom.
    for k in [2, 3, 4] {
        let d = far(&e, o);
        click(&mut e, d.x, d.y);
        assert_eq!(e.mol().atoms.len(), n);
        assert_eq!(e.mol().atoms[o].rgroup, k);
    }
    // A near miss beside an unlabeled carbon targets it too.
    let c = (0..n).find(|&i| e.mol().atoms[i].el == 6 && render::label_boxes(e.mol(), &adj, i).is_empty()).unwrap();
    let p = e.mol().atoms[c].pos + v2(0.6, 0.);
    if e.mol().nearest_atom(p, 0.59).is_none() {
        click(&mut e, p.x, p.y);
        assert_eq!(e.mol().atoms.len(), n);
    }
}

#[test]
fn valence_errors_and_explicit_hydrogens_render() {
    let mut e = editor();
    e.load("CC(C)(C)C").unwrap();
    let i = (0..e.mol().atoms.len()).find(|&i| e.mol().neighbors(i).count() == 4).unwrap();
    let p = e.mol().atoms[i].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.mol().neighbors(i).count(), 5);
    assert!(e.svg().contains("me-el-C me-error"), "a pentavalent carbon shows a red C");
    e.load("CO").unwrap();
    e.command("hydrogens");
    let m = e.mol();
    for b in &m.bonds {
        assert!((m.atoms[b.a].pos.dist(m.atoms[b.b].pos) - 1.).abs() < 1e-6);
    }
}

#[test]
fn crowded_terminal_atoms_turn_aside() {
    for s in [NAD, NAD_PAGE] {
        let m = chem::parse(s).unwrap();
        let h = chem::add_hydrogens(&m).unwrap();
        let mut e = editor();
        e.load(s).unwrap();
        assert!(e.command("hydrogens"));
        let mut cases = vec![("parsed", m.clone()), ("explicit H", h.clone()), ("editor H", e.mol().clone())];
        for keep in [false, true] {
            cases.push((if keep { "clean" } else { "layout" }, chem::relayout(&m, keep).unwrap()));
            cases.push((if keep { "clean with H" } else { "layout with H" }, chem::relayout(&h, keep).unwrap()));
        }
        for (what, x) in &cases {
            let d = closest_labels(x);
            assert!(d >= 0.6, "{what}: labelled atoms {d:.2} apart");
            assert_eq!(chem::smiles(x), canonical(s), "{what}");
            // cosmolkit shortens some bonds to hydrogens in its own layout.
            if !what.ends_with("with H") {
                for b in &x.bonds {
                    assert!((x.atoms[b.a].pos.dist(x.atoms[b.b].pos) - 1.).abs() < 1e-3, "{what}: bond lengths stay");
                }
            }
        }
    }
    // Uncrowded depictions keep cosmolkit's coordinates.
    for s in ["CCO", "CC(=O)Oc1ccccc1C(=O)O", "OC(=O)CCC(N)C(=O)O"] {
        let m = chem::parse(s).unwrap();
        let raw = cosmolkit_core::Molecule::from_smiles(s).unwrap().with_2d_coordinates().unwrap();
        for (a, c) in m.atoms.iter().zip(raw.coordinates_2d().unwrap()) {
            assert!(a.pos.dist(v2(c[0], -c[1]) * (1. / chem::ANGSTROM)) < 1e-3, "{s}");
        }
    }
    let mut m = chem::parse(NAD).unwrap();
    assert!(!crate::layout::declash(&mut m, 0), "nothing left to turn");
}

#[test]
fn cip_marks_clear_bonds_and_labels() {
    for s in [NAD, NAD_PAGE] {
        let heavy = chem::parse(s).unwrap();
        for m in [heavy.clone(), chem::add_hydrogens(&heavy).unwrap()] {
            let cip = chem::cip_labels(&m).unwrap();
            let marks = render::cip_boxes(&m, &cip);
            assert_eq!(marks.len(), 8);
            let adj = m.adjacency();
            for (k, &bx) in marks.iter().enumerate() {
                for b in &m.bonds {
                    let gap = box_segment_gap(bx, m.atoms[b.a].pos, m.atoms[b.b].pos);
                    assert!(gap > 0.05, "{} atoms: mark {k} on bond {}-{} ({gap:.3})", m.atoms.len(), b.a, b.b);
                }
                for i in 0..m.atoms.len() {
                    for l in render::label_boxes(&m, &adj, i) {
                        assert!(box_gap(bx, l) > 0., "{} atoms: mark {k} on label {i}", m.atoms.len());
                    }
                }
                for &other in &marks[k + 1..] {
                    assert!(box_gap(bx, other) > 0.);
                }
            }
        }
    }
}

#[test]
fn repeated_bonds_and_stacked_atoms_never_panic() {
    let laid = [("C", 0., 0.), ("C", 1.299, 0.75), ("O", 2.598, 0.)];
    let flat = [("C", 0., 0.), ("C", 0., 0.), ("O", 0., 0.)];
    for atoms in [laid, flat] {
        for extra in [(2, 3, 1), (3, 2, 2), (2, 2, 1)] {
            let mut e = editor();
            e.load(&molfile(&atoms, &[(1, 2, 1), (2, 3, 1), extra], "")).unwrap();
            assert_eq!(e.mol().bonds.len(), 2);
            assert_eq!(e.smiles(), "CCO");
            e.command("clean");
            assert!(e.command("layout"));
            assert_eq!(e.smiles(), "CCO");
        }
    }
    // States the editor can reach: atoms on one spot and zero-length wedges.
    let mut m = Mol::default();
    for (k, el) in [6, 6, 8, 7, 6].into_iter().enumerate() {
        m.add_atom(el, v2(k as f64, 0.));
    }
    m.add_bond(0, 1, 1);
    m.add_bond(1, 2, 1);
    m.add_bond(1, 3, 1);
    m.bonds[0].stereo = Stereo::Wedge;
    // Everything dragged onto one spot.
    m.atoms.iter_mut().for_each(|a| a.pos = v2(0., 0.));
    let mut double = m.clone();
    double.bonds[1].order = 2;
    double.bonds[2].stereo = Stereo::Hash;
    let view = render::View { scale: 32., offset: v2(10., 10.), width: 100., height: 100. };
    for m in [m, double] {
        let _ = chem::smiles(&m);
        for keep in [false, true] {
            let _ = chem::relayout(&m, keep);
        }
        let marks = render::cip_marks(&m, &chem::cip_labels(&m).unwrap_or_default());
        let _ = chem::aromatic_bonds(&m);
        if let Ok(h) = chem::add_hydrogens(&m) {
            let _ = chem::remove_hydrogens(&h);
        }
        let _ = chem::molfile_3d(&m);
        let overlay = render::Overlay { cip: Some(&marks), ..Default::default() };
        assert!(!render::svg(&m, &view, &overlay).contains("NaN"));
    }
}

#[test]
fn unspecified_double_bonds_stay_unspecified() {
    for s in ["CC=CC", "OC(=O)C=CC(=O)O", "CC=NO", "C/C=C/C", "C/C=C\\C"] {
        let m = chem::parse(s).unwrap();
        assert_eq!(chem::smiles(&m), canonical(s), "{s}");
        let back = chem::parse(&chem::write_v2000(&m)).unwrap();
        assert_eq!(chem::smiles(&back), canonical(s), "{s} via molfile");
        for keep in [false, true] {
            assert_eq!(chem::smiles(&chem::relayout(&m, keep).unwrap()), canonical(s), "{s} layout");
        }
        assert_eq!(chem::smiles(&chem::add_hydrogens(&m).unwrap()), canonical(s), "{s} with H");
    }
    assert!(!canonical("CC=CC").contains('/'));
    // A double bond the user draws takes its configuration from the drawing.
    let mut e = editor();
    e.set_tool("chain");
    let (a, b) = (at(&e, 0., 0.), at(&e, 3. * 0.866, 0.));
    e.pointer_down(a.0, a.1, 0, false, false);
    e.pointer_move(b.0, b.1, 1, false, false);
    e.pointer_up(b.0, b.1);
    e.set_tool("bond:double");
    let m = e.mol().clone();
    let mid = m.atoms[m.bonds[1].a].pos.lerp(m.atoms[m.bonds[1].b].pos, 0.5);
    click(&mut e, mid.x, mid.y);
    assert_eq!(e.smiles(), canonical("C/C=C/C"));
}

#[test]
fn v3000_with_enhanced_stereo_loads() {
    let atoms = ["C 0 0", "C 1.299 0.75", "N 1.299 2.25", "C 2.598 0", "O 3.897 0.75", "O 2.598 -1.5"];
    let bonds = ["1 2 1 CFG=1", "1 2 3", "1 2 4", "1 4 5", "2 4 6"];
    let mut text = String::from("\n  test\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 6 5 0 0 0\n");
    text += "M  V30 BEGIN ATOM\n";
    for (k, a) in atoms.iter().enumerate() {
        text += &format!("M  V30 {} {a} 0 0\n", k + 1);
    }
    text += "M  V30 END ATOM\nM  V30 BEGIN BOND\n";
    for (k, b) in bonds.iter().enumerate() {
        text += &format!("M  V30 {} {}\n", k + 1, if k == 0 { "1 2 1 CFG=1".to_string() } else { b.to_string() });
    }
    text += "M  V30 END BOND\nM  V30 BEGIN COLLECTION\nM  V30 MDLV30/STEABS ATOMS=(1 2)\nM  V30 END COLLECTION\nM  V30 END CTAB\nM  END\n";
    let mut e = editor();
    e.load(&text).unwrap();
    let alanines = [canonical("C[C@H](N)C(=O)O"), canonical("C[C@@H](N)C(=O)O")];
    assert!(alanines.contains(&e.smiles()), "{}", e.smiles());
    assert!(e.molfile().contains("V2000"));
    let saved = e.molfile();
    for kind in ["STERAC1", "STEREL2"] {
        assert!(e.load(&text.replace("STEABS", kind)).is_err());
        assert_eq!(e.molfile(), saved);
    }
    // Too big for V2000: a clean error.
    assert!(e.load(&"C".repeat(1000)).is_err());
}

#[test]
fn unsupported_molfile_sgroups_preserve_the_drawing() {
    let v2000 = molfile(
        &[("C", 0., 0.), ("C", 1.5, 0.), ("O", 2.5, 1.)],
        &[(1, 2, 1), (2, 3, 1)],
        "M  STY  1   1 SRU\nM  SAL   1  1   2\nM  SMT   1 n\n",
    );
    let v3000 = "\n  test\n\n  0  0  0     0  0            999 V3000\n\
        M  V30 BEGIN CTAB\nM  V30 COUNTS 3 2 1 0 0\nM  V30 BEGIN ATOM\n\
        M  V30 1 C 0 0 0 0\nM  V30 2 C 1.5 0 0 0\nM  V30 3 O 2.5 1 0 0\n\
        M  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 1 1 1 2\nM  V30 2 1 2 3\nM  V30 END BOND\n\
        M  V30 BEGIN SGROUP\nM  V30 1 SRU 0 ATOMS=(1 2) LABEL=n\nM  V30 END SGROUP\n\
        M  V30 END CTAB\nM  END\n";
    let mut e = editor();
    for (text, label_prefix) in [(v2000.as_str(), "SMT   1 "), (v3000, "LABEL=")] {
        e.load(text).unwrap();
        assert!(e.molfile().contains("M  SMT   1 n"));
        let saved = e.molfile();
        for unsupported in [
            text.replace("SRU", "SUP"),
            text.replace(&format!("{label_prefix}n"), &format!("{label_prefix}123456789012345678901")),
        ] {
            assert!(e.load(&unsupported).unwrap_err().contains("S-groups"));
            assert_eq!(e.molfile(), saved);
        }
    }
}

#[test]
fn spiro_cyclopentadiene_keeps_valence() {
    let mut e = editor();
    e.load("CCC").unwrap();
    e.set_tool("ring:cyclopentadiene");
    let mid = (0..3).find(|&i| e.mol().neighbors(i).count() == 2).unwrap();
    let p = e.mol().atoms[mid].pos;
    click(&mut e, p.x, p.y);
    assert!(valences(e.mol(), &e.mol().adjacency()).iter().all(|v| !v.error));
    assert_eq!(e.smiles(), canonical("CC1(C)C=CC=C1"));
    let mut e = editor();
    e.set_tool("ring:cyclohexane");
    click(&mut e, 0., 0.);
    e.set_tool("ring:cyclopentadiene");
    let p = e.mol().atoms[0].pos;
    click(&mut e, p.x, p.y);
    assert!(valences(e.mol(), &e.mol().adjacency()).iter().all(|v| !v.error));
    assert_eq!(e.smiles(), canonical("C1CCC2(CC1)C=CC=C2"));
}

#[test]
fn radicals_and_hydrogen_counts_round_trip() {
    for s in ["[O][O]", "[N]=O", "[CH3]", "CC(=O)O.[Na]", "[Si]", "[CH2]C", "[SiH2]", "O=[Cr](=O)=O"] {
        let m = chem::parse(s).unwrap();
        assert_eq!(chem::smiles(&m), canonical(s), "{s}");
        let back = chem::parse(&chem::write_v2000(&m)).unwrap();
        assert_eq!(chem::smiles(&back), canonical(s), "{s} via molfile");
        for keep in [false, true] {
            assert_eq!(chem::smiles(&chem::relayout(&m, keep).unwrap()), canonical(s), "{s} layout");
        }
        let mut e = editor();
        e.load(s).unwrap();
        assert!(e.command("hydrogens") || !s.contains('H') && !s.starts_with("CC"), "{s}");
        assert_eq!(e.smiles(), canonical(s), "{s} with H");
    }
    // M  RAD from a molfile.
    let m = chem::parse(&molfile(&[("C", 0., 0.), ("C", 1.299, 0.75)], &[(1, 2, 1)], "M  RAD  1   1   2\n")).unwrap();
    assert_eq!(m.atoms[0].radical, 2);
    assert_eq!(chem::smiles(&m), canonical("[CH2]C"));
    assert!(chem::write_v2000(&m).contains("M  RAD  1   1   2"));
    // Labels show the stored hydrogen count and the radical.
    let mut e = editor();
    e.load("[Si]").unwrap();
    assert!(e.svg().contains(">Si</text>"));
    e.load("[CH2]C").unwrap();
    let svg = e.svg();
    assert!(svg.contains("me-el-C") && svg.contains(">\u{2022}</tspan>"), "{svg}");
}

#[test]
fn r_groups_keep_their_numbers() {
    let m = chem::parse("[1*]CC[2*]").unwrap();
    let groups: Vec<u8> = m.atoms.iter().filter(|a| a.el == 0).map(|a| a.rgroup).collect();
    assert_eq!(groups, [1, 2]);
    for s in ["[1*]CC[2*]", "*CC*", "[3*]C.*O"] {
        let m = chem::parse(s).unwrap();
        assert_eq!(chem::smiles(&m), canonical(s), "{s}");
        let back = chem::parse(&chem::write_v2000(&m)).unwrap();
        assert_eq!(chem::smiles(&back), canonical(s), "{s} via molfile");
        assert_eq!(chem::smiles(&chem::relayout(&m, true).unwrap()), canonical(s), "{s} clean");
    }
    let mut e = editor();
    e.load("[1*]CC[2*]").unwrap();
    let svg = e.svg();
    assert!(svg.contains(">R1</text>") && svg.contains(">R2</text>"));
    e.load("*CC*").unwrap();
    let svg = e.svg();
    assert!(!svg.contains(">R</text>") && !svg.contains(">*</text>"), "terminal attachment points have no label");
    assert_eq!(svg.matches("class=\"me-attach\"").count(), 1, "one path holds both wavy lines");
    // Plain "R" and "*" atoms from other programs load as attachment points.
    for sym in ["R", "*"] {
        let text = molfile(&[(sym, 0., 0.), ("C", 1.299, 0.75), ("C", 2.598, 0.)], &[(1, 2, 1), (2, 3, 1)], "");
        assert_eq!(chem::smiles(&chem::parse(&text).unwrap()), "*CC", "{sym}");
    }
    // The R-group tool numbers a bare attachment point.
    e.set_tool("rgroup");
    let p = e.mol().atoms[0].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.smiles(), canonical("*CC[1*]"));
}

#[test]
fn hydrogens_toggle_beside_deuterium() {
    let mut e = editor();
    e.load("[2H]C(C)C").unwrap();
    let smiles = e.smiles();
    assert_eq!(state(&e, "hydrogens"), "false");
    assert!(e.command("hydrogens"));
    assert_eq!(state(&e, "hydrogens"), "true");
    assert_eq!(e.mol().atoms.len(), 11);
    assert_eq!(e.smiles(), smiles);
    assert!(e.command("hydrogens"));
    assert_eq!(state(&e, "hydrogens"), "false");
    assert_eq!(e.mol().atoms.len(), 4);
    assert!(e.mol().atoms.iter().any(|a| a.el == 1 && a.iso == 2));
    assert_eq!(e.smiles(), smiles);
}

/// NAD⁺ as the page loads it with two more bonds on a pyridinium carbon,
/// which makes it pentavalent (the user's report), and that carbon.
fn broken_nad() -> (Editor, usize) {
    let mut e = editor();
    e.load(NAD_PAGE).unwrap();
    let m = e.mol();
    let adj = m.adjacency();
    let c = (0..m.atoms.len())
        .find(|&i| m.atoms[i].el == 6 && adj[i].len() == 2 && adj[i].iter().any(|&(_, n)| m.atoms[n].el == 7 && m.atoms[n].charge == 1))
        .unwrap();
    let p = m.atoms[c].pos;
    click(&mut e, p.x, p.y);
    click(&mut e, p.x, p.y);
    assert_eq!(e.mol().neighbors(c).count(), 4);
    assert_eq!(chem::invalid_atoms(e.mol()), [c]);
    (e, c)
}

#[test]
fn toolbar_commands_work_with_valence_errors() {
    let (mut e, c) = broken_nad();
    assert!(e.svg().contains("me-el-C me-error"));
    // Layout and clean are geometric.
    let before = e.mol().clone();
    assert!(e.command("layout"));
    let moved = |a: &Mol, b: &Mol| a.atoms.iter().zip(&b.atoms).filter(|(x, y)| x.pos.dist(y.pos) > 1e-3).count();
    assert!(moved(&before, e.mol()) > 10, "layout moves atoms");
    assert_eq!(e.mol().bonds.len(), before.bonds.len());
    let mut shifted = e.mol().clone();
    shifted.atoms[c].pos = shifted.atoms[c].pos + v2(0.4, 0.3);
    e.load(&chem::write_v2000(&shifted)).unwrap();
    assert_eq!(chem::invalid_atoms(e.mol()), [c], "an invalid drawing loads back as drawn");
    assert!(e.command("clean"));
    assert!(e.mol().atoms[c].pos.dist(shifted.atoms[c].pos) > 0.1, "clean tidies the moved atom");
    // Aromatic perception still finds adenine.
    assert!(e.command("aromatic"));
    assert_eq!(state(&e, "aromatic"), "true");
    assert_eq!(e.svg().matches("me-ring-circle").count(), 2);
    assert!(e.command("aromatic"));
    assert_eq!(state(&e, "aromatic"), "false");
    // Every stereocentre of NAD⁺ keeps its label.
    let reference = {
        let mut ok = editor();
        ok.load(NAD_PAGE).unwrap();
        ok.command("cip");
        let svg = ok.svg();
        (svg.matches(">(R)<").count(), svg.matches(">(S)<").count())
    };
    assert!(e.command("cip"));
    let svg = e.svg();
    assert_eq!((svg.matches(">(R)<").count(), svg.matches(">(S)<").count()), reference);
    assert_eq!(reference.0 + reference.1, 8);
    let valid = chem::cip_labels(&chem::parse(NAD_PAGE).unwrap()).unwrap();
    let broken = chem::cip_labels(e.mol()).unwrap();
    assert_eq!(broken.0[..valid.0.len()], valid.0[..], "the same atoms get the same labels");
    assert!(e.command("cip"));
    // Hydrogens go on and off for the valid atoms.
    let atoms = e.mol().atoms.len();
    assert!(e.command("hydrogens"));
    assert_eq!(state(&e, "hydrogens"), "true");
    assert!(e.mol().atoms.len() > atoms + 20);
    assert_eq!(e.mol().neighbors(c).count(), 4, "the invalid carbon gets no hydrogen");
    assert!(e.command("hydrogens"));
    assert_eq!(e.mol().atoms.len(), atoms);
    // SMILES still describes the drawing; 3D says what to fix.
    assert!(e.smiles().contains("[N+]"), "{}", e.smiles());
    assert_eq!(e.molfile_3d().unwrap_err(), "Fix the highlighted atoms to build 3D");
}

/// Text of each label in `svg`, tags stripped.
fn label_texts(svg: &str) -> Vec<String> {
    (svg.split("<text class=\"me-label").skip(1))
        .map(|t| {
            let body = &t[t.find('>').unwrap() + 1..t.find("</text>").unwrap()];
            let mut tag = false;
            body.chars()
                .filter(|&c| {
                    tag = (tag || c == '<') && c != '>';
                    !tag && c != '>'
                })
                .collect()
        })
        .collect()
}

/// Value of attribute `name` in the first element of `svg` with class `class`.
fn attr_of(svg: &str, class: &str, name: &str) -> f64 {
    let el = &svg[svg.find(&format!("class=\"{class}\"")).unwrap()..];
    let v = &el[el.find(&format!(" {name}=\"")).unwrap() + name.len() + 3..];
    v[..v.find('"').unwrap()].parse().unwrap()
}

#[test]
fn every_element_is_an_atom_tool() {
    for z in 1..=118u8 {
        let id = format!("atom:{}", crate::valence::symbol(z));
        let tool = tools::Tool::parse(&id);
        assert_eq!(tool, Some(tools::Tool::Atom(z)), "{id}");
        assert_eq!(tool.unwrap().id(), id);
    }
    assert_eq!(tools::Tool::parse("atom:Xx"), None);
    assert_eq!(tools::Tool::parse("atom:R"), None);
    // A lone atom drawn with its tool gets main-group hydrogens; metals and
    // noble gases get none. Nothing is flagged, and SMILES and the molfile
    // keep the count.
    let expect = [
        ("Te", 2, "H2Te"),
        ("Ge", 4, "GeH4"),
        ("Sb", 3, "SbH3"),
        ("At", 1, "HAt"),
        ("B", 3, "BH3"),
        ("Si", 4, "SiH4"),
        ("Se", 2, "H2Se"),
        ("I", 1, "HI"),
        ("Fe", 0, "Fe"),
        ("Na", 0, "Na"),
        ("Pt", 0, "Pt"),
        ("Gd", 0, "Gd"),
        ("Al", 0, "Al"),
        ("Sn", 0, "Sn"),
        ("Bi", 0, "Bi"),
        ("Xe", 0, "Xe"),
        ("He", 0, "He"),
        ("U", 0, "U"),
        ("Og", 0, "Og"),
    ];
    for (sym, h, text) in expect {
        let mut e = editor();
        e.set_tool(&format!("atom:{sym}"));
        click(&mut e, 0., 0.);
        let m = e.mol();
        assert_eq!(m.atoms.len(), 1, "{sym}");
        let v = valence(m, &m.adjacency(), 0);
        assert_eq!((v.h, v.error), (h, false), "{sym}");
        let svg = e.svg();
        assert!(svg.contains(&format!("me-el-{sym}\"")) && !svg.contains("me-error"), "{sym}");
        assert_eq!(label_texts(&svg), [text], "{sym}");
        let smiles = match h {
            0 => format!("[{sym}]"),
            1 => format!("[{sym}H]"),
            _ => format!("[{sym}H{h}]"),
        };
        assert_eq!(e.smiles(), canonical(&smiles), "{sym}");
        let mf = e.molfile();
        e.load(&mf).unwrap();
        assert_eq!(e.smiles(), canonical(&smiles), "{sym} via molfile");
    }
    // Main-group valences: no error on hypervalent iodine, an error past them.
    let mut e = editor();
    e.load("CI(C)C").unwrap();
    assert!(!e.svg().contains("me-error"));
    e.load("C[Te](C)(C)(C)(C)(C)C").unwrap();
    assert!(e.svg().contains("me-error"));
    e.load("C[Fe](C)(C)(C)(C)(C)(C)C").unwrap();
    assert!(!e.svg().contains("me-error"), "metals are never flagged");
}

#[test]
fn bracket_atoms_round_trip() {
    for s in ["[Na+].[Cl-]", "[Se]", "[Fe]", "[Pt]", "[Xe]", "[Gd]", "[Si]", "[B]", "[Te]"] {
        let mut e = editor();
        e.load(s).unwrap();
        assert_eq!(e.smiles(), canonical(s), "{s}");
        let m = e.mol();
        assert!(valences(m, &m.adjacency()).iter().all(|v| v.h == 0 && !v.error), "{s}");
        assert!(label_texts(&e.svg()).iter().all(|t| !t.contains('H')), "{s}");
        let mut back = editor();
        back.load(&e.molfile()).unwrap();
        assert_eq!(back.smiles(), canonical(s), "{s} via molfile");
        assert_eq!(label_texts(&back.svg()), label_texts(&e.svg()), "{s} via molfile");
    }
    let mut e = editor();
    e.load("[Na+].[Cl-]").unwrap();
    let mut labels = label_texts(&e.svg());
    labels.sort();
    assert_eq!(labels, ["Cl−", "Na+"]);
}

#[test]
fn attachment_points_draw_as_wavy_lines() {
    let mut e = editor();
    e.load("CC").unwrap();
    e.set_tool("attach");
    let m = e.mol().clone();
    let p = m.atoms[1].pos;
    // Hovering an atom previews the attachment point.
    let (sx, sy) = at(&e, p.x, p.y);
    e.pointer_move(sx, sy, 0, false, false);
    let svg = e.svg();
    assert!(svg[svg.find("me-preview").unwrap()..].contains("me-attach"));
    click(&mut e, p.x, p.y);
    let m = e.mol().clone();
    assert_eq!((m.atoms.len(), m.bonds.len()), (3, 2));
    assert_eq!((m.atoms[2].el, m.atoms[2].rgroup), (0, 0));
    assert!((m.atoms[2].pos.dist(p) - 1.).abs() < 1e-9);
    let svg = e.svg();
    let drawing = &svg[..svg.find("me-preview").unwrap_or(svg.len())];
    assert_eq!(drawing.matches("class=\"me-attach\"").count(), 1);
    assert!(label_texts(&svg).is_empty(), "the attachment point has no label");
    assert_eq!(e.smiles(), canonical("*CC"));
    // Clicking the attachment point adds nothing; the molfile keeps it.
    let star = m.atoms[2].pos;
    click(&mut e, star.x, star.y);
    assert_eq!(e.mol().atoms.len(), 3);
    let mut back = editor();
    back.load(&e.molfile()).unwrap();
    assert_eq!(back.smiles(), canonical("*CC"));
    assert!(back.svg().contains("me-attach"));
    // A drag from an atom sets the direction (15° steps).
    let q = m.atoms[0].pos;
    drag(&mut e, (q.x, q.y), (q.x, q.y + 2.));
    let d = e.mol().atoms[3].pos - q;
    assert!((d.angle() - std::f64::consts::FRAC_PI_2).abs() < 1e-9, "{d:?}");
    e.command("undo");
    // It erases like any atom.
    e.set_tool("erase");
    click(&mut e, star.x, star.y);
    assert_eq!(e.smiles(), "CC");
    assert!(!e.svg().contains("me-attach"));
    // A bare * inside a chain is a labelled atom.
    e.load("C*C").unwrap();
    assert_eq!(label_texts(&e.svg()), ["*"]);
    assert!(!e.svg().contains("me-attach"));
}

#[test]
fn polymer_brackets_wrap_a_repeat_unit() {
    let mut e = editor();
    e.load("CCCC").unwrap();
    let m = e.mol().clone();
    let (p1, p2) = (m.atoms[1].pos, m.atoms[2].pos);
    let (lo, hi) = (v2(p1.x.min(p2.x) - 0.25, p1.y.min(p2.y) - 0.25), v2(p1.x.max(p2.x) + 0.25, p1.y.max(p2.y) + 0.25));
    e.set_tool("polymer");
    click(&mut e, lo.x - 3., lo.y);
    assert_eq!(state(&e, "message"), "Drag around the atoms of the repeat unit");
    // While dragging: the marquee and the brackets to be.
    let (a, b) = (at(&e, lo.x, lo.y), at(&e, hi.x, hi.y));
    e.pointer_down(a.0, a.1, 0, false, false);
    e.pointer_move(b.0, b.1, 1, false, false);
    let svg = e.svg();
    assert!(svg.contains("me-marquee") && svg[svg.find("me-preview").unwrap()..].contains("me-bracket"));
    e.pointer_up(b.0, b.1);
    assert_eq!(e.mol().sgroups.len(), 1);
    assert_eq!(e.mol().sgroups[0].atoms, [1, 2]);
    assert_eq!(state(&e, "message"), "");
    assert_eq!(state(&e, "canUndo"), "true");
    // ACS style: each bracket crosses a leaving bond square at its middle,
    // serifs towards the unit; "n" at the lower right of the closing bracket.
    let brs = render::brackets(e.mol(), &e.mol().sgroups[0]);
    assert_eq!(brs.len(), 2);
    for (br, (inner, outer)) in brs.iter().zip([(1, 0), (2, 3)]) {
        let (pi, po) = (m.atoms[inner].pos, m.atoms[outer].pos);
        let mid = pi.lerp(po, 0.5);
        assert!(br.a.lerp(br.b, 0.5).dist(mid) < 1e-9);
        assert!((br.b - br.a).unit().dot((po - pi).unit()).abs() < 1e-9);
        assert!(br.inward.dot(pi - mid) > 0.);
    }
    let svg = e.svg();
    assert_eq!(svg.matches("class=\"me-bracket\"").count(), 1);
    assert!(label_texts(&svg).contains(&"n".to_string()));
    let close = brs.iter().max_by(|x, y| (x.a.x + x.b.x).total_cmp(&(y.a.x + y.b.x))).unwrap();
    let (low, view) = (if close.a.y > close.b.y { close.a } else { close.b }, e.view());
    let corner = view.screen(low);
    let (nx, ny) = (attr_of(&svg, "me-label me-bracket-label", "x"), attr_of(&svg, "me-label me-bracket-label", "y"));
    let zoom = view.scale / NATURAL;
    assert!(nx >= corner.x - 0.5 && nx < corner.x + 6. * zoom && ny > corner.y && ny < corner.y + 15. * zoom, "{nx} {ny} {corner:?}");
    // Molfile (V2000 SRU lines) and CXSMILES round trips.
    let mf = e.molfile();
    for line in ["M  STY  1   1 SRU", "M  SCN  1   1 HT ", "M  SAL   1  2   2   3", "M  SBL   1  2   1   3", "M  SMT   1 n"] {
        assert!(mf.contains(line), "{line}\n{mf}");
    }
    assert_eq!(mf.matches("M  SDI   1  4").count(), 2);
    let smiles = e.smiles();
    assert!(smiles.starts_with("CCCC |Sg:n:"), "{smiles}");
    for text in [mf.as_str(), smiles.as_str()] {
        let mut back = editor();
        back.load(text).unwrap();
        assert_eq!(back.mol().sgroups.len(), 1, "{text}");
        assert_eq!(back.mol().sgroups[0].atoms.len(), 2);
        assert_eq!(back.smiles(), smiles);
    }
    // Copy and paste keep whole units.
    e.set_tool("select");
    e.command("select-all");
    let copied = e.selection_molfile();
    assert!(copied.contains("SRU"));
    e.insert(&copied).unwrap();
    assert_eq!(e.mol().sgroups.len(), 2);
    assert_eq!(e.mol().sgroups[1].atoms, [5, 6]);
    e.command("undo");
    assert_eq!(e.mol().sgroups.len(), 1);
    click(&mut e, p1.x, p1.y);
    let part = e.selection_molfile();
    assert!(!part.is_empty() && !part.contains("SRU"), "a part of a unit copies without brackets");
    // Brackets follow moved atoms, and undo.
    let before = render::brackets(e.mol(), &e.mol().sgroups[0]);
    let p3 = m.atoms[3].pos;
    drag(&mut e, (p3.x, p3.y), (p3.x + 0.5, p3.y + 0.5));
    let after = render::brackets(e.mol(), &e.mol().sgroups[0]);
    assert_eq!(before[0], after[0]);
    assert_ne!(before[1], after[1]);
    e.command("undo");
    assert_eq!(render::brackets(e.mol(), &e.mol().sgroups[0]), before);
    // The eraser removes the brackets it is on, not the atoms; erased atoms
    // leave their units.
    e.set_tool("erase");
    let end = before[0].a.lerp(before[0].b, 0.9);
    let (sx, sy) = at(&e, end.x, end.y);
    e.pointer_move(sx, sy, 0, false, false);
    assert!(e.svg().contains("me-hover"));
    assert_eq!(state(&e, "cursor"), "pointer");
    click(&mut e, end.x, end.y);
    assert!(e.mol().sgroups.is_empty());
    assert_eq!(e.mol().atoms.len(), 4);
    e.command("undo");
    click(&mut e, p1.x, p1.y);
    assert_eq!(e.mol().sgroups.len(), 1);
    assert_eq!(e.mol().sgroups[0].atoms.len(), 1);
    e.command("undo");
    // A click on a bracket with the polymer tool removes it.
    e.set_tool("polymer");
    let end = before[1].a.lerp(before[1].b, 0.9);
    click(&mut e, end.x, end.y);
    assert!(e.mol().sgroups.is_empty());
    e.command("undo");
    assert_eq!(e.mol().sgroups.len(), 1);
}

#[test]
fn polymer_brackets_from_other_programs() {
    // Ketcher's polyethylene: *-[CH2-CH2]n-* with SRU lines.
    let text = molfile(
        &[("*", -1.299, 0.75), ("C", 0., 0.), ("C", 1.299, 0.75), ("*", 2.598, 0.)],
        &[(1, 2, 1), (2, 3, 1), (3, 4, 1)],
        "M  STY  1   1 SRU\nM  SLB  1   1   1\nM  SCN  1   1 HT \nM  SAL   1  2   2   3\nM  SBL   1  2   1   3\n\
         M  SDI   1  4   -0.6495    0.0000   -0.6495    0.7500\nM  SDI   1  4    1.9486    0.7500    1.9486    0.0000\nM  SMT   1 n\n",
    );
    let mut e = editor();
    e.load(&text).unwrap();
    assert_eq!(e.mol().sgroups.len(), 1);
    assert_eq!(e.mol().sgroups[0].atoms, [1, 2]);
    let svg = e.svg();
    assert!(svg.contains("me-bracket") && !svg.contains("me-attach"), "ends inside brackets stay open");
    assert_eq!(e.smiles(), "*CC* |Sg:n:1,2:n:ht:::|");
    // A unit with no leaving bonds gets upright brackets beside its ink.
    e.load("CC").unwrap();
    e.set_tool("polymer");
    let m = e.mol().clone();
    let (lo, hi) = m.bounds().unwrap();
    drag(&mut e, (lo.x - 0.3, lo.y - 0.3), (hi.x + 0.3, hi.y + 0.3));
    let brs = render::brackets(e.mol(), &e.mol().sgroups[0]);
    assert!(brs.iter().all(|b| (b.a.x - b.b.x).abs() < 1e-9));
    assert!(brs[0].a.x < lo.x && brs[1].a.x > hi.x);
    assert!(render::extent(e.mol()).unwrap().1.x > brs[1].a.x, "the extent holds the subscript");
}

#[test]
fn r_group_tools_number_atoms() {
    let mut e = editor();
    e.set_tool("rgroup:3");
    assert_eq!(state(&e, "tool"), "rgroup:3");
    click(&mut e, 0., 0.);
    assert_eq!((e.mol().atoms[0].el, e.mol().atoms[0].rgroup), (0, 3));
    for bad in ["rgroup:33", "rgroup:0", "rgroup:x"] {
        e.set_tool(bad);
        assert_eq!(state(&e, "tool"), "rgroup:3", "{bad}");
    }
    // The plain tool takes the next free number; a click on an R group
    // advances it past the numbers in use.
    e.set_tool("rgroup");
    click(&mut e, 3., 0.);
    click(&mut e, 6., 0.);
    let numbers: Vec<u8> = e.mol().atoms.iter().map(|a| a.rgroup).collect();
    assert_eq!(numbers, [3, 1, 2]);
    click(&mut e, 6., 0.);
    assert_eq!(e.mol().atoms[2].rgroup, 4);
    // A fixed number retypes an atom and keeps its bonds.
    e.load("CCO").unwrap();
    e.set_tool("rgroup:7");
    let p = e.mol().atoms[0].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.smiles(), canonical("[7*]CO"));
    assert!(label_texts(&e.svg()).contains(&"R7".to_string()));
    assert!(e.molfile().contains("M  RGP  1   1   7"));
}

#[test]
fn chain_tool_only_drags() {
    let mut e = editor();
    e.set_tool("chain");
    click(&mut e, 0., 0.);
    assert!(e.mol().is_empty(), "a click adds nothing");
    e.load("CC").unwrap();
    e.set_tool("chain");
    let p = e.mol().atoms[1].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.mol().atoms.len(), 2, "no stub on a clicked atom");
    drag(&mut e, (p.x, p.y), (p.x + 4. * 0.866, p.y));
    assert_eq!((e.mol().atoms.len(), e.mol().bonds.len()), (6, 5));
    assert_eq!(e.mol().neighbors(1).count(), 2, "the chain grows from the pressed atom");
}

fn benzene_template() -> String {
    let atoms: Vec<(&str, f64, f64)> = (0..6)
        .map(|k| {
            let a = (30. + 60. * k as f64).to_radians();
            ("C", a.cos(), a.sin())
        })
        .collect();
    molfile(&atoms, &[(1, 2, 2), (2, 3, 1), (3, 4, 2), (4, 5, 1), (5, 6, 2), (6, 1, 1)], "")
}

#[test]
fn template_tool_places_attaches_and_fuses() {
    let mut e = editor();
    e.set_tool("template");
    assert_eq!(state(&e, "tool"), "template");
    click(&mut e, 0., 0.);
    assert!(e.mol().is_empty());
    assert_eq!(state(&e, "message"), "Choose a template first");
    assert!(e.set_template("not a molfile", 1, 1).is_err());
    let t = benzene_template();
    e.set_template(&t, 1, 1).unwrap();
    // Hover previews; a click centres the template on the click.
    let (sx, sy) = at(&e, 0., 0.);
    e.pointer_move(sx, sy, 0, false, false);
    assert!(e.svg().contains("me-preview"));
    click(&mut e, 0., 0.);
    assert_eq!((e.mol().atoms.len(), e.mol().bonds.len()), (6, 6));
    let c = e.mol().atoms.iter().fold(v2(0., 0.), |s, a| s + a.pos) * (1. / 6.);
    assert!(c.len() < 1e-6);
    assert_eq!(state(&e, "message"), "");
    // A click on a bond fuses on it.
    let m = e.mol().clone();
    let single = m.bonds.iter().position(|b| b.order == 1).unwrap();
    let mid = m.atoms[m.bonds[single].a].pos.lerp(m.atoms[m.bonds[single].b].pos, 0.5);
    click(&mut e, mid.x, mid.y);
    assert_eq!((e.mol().atoms.len(), e.mol().bonds.len()), (10, 11));
    assert_eq!(e.smiles(), canonical("c1ccc2ccccc2c1"));
    // A drag on the canvas turns it in 15° steps about the press.
    let mut e = editor();
    e.set_tool("template");
    e.set_template(&t, 1, 1).unwrap();
    drag(&mut e, (0., 0.), (0.1, 2.));
    let first = e.mol().atoms[0].pos;
    assert!(((first.angle() - 60f64.to_radians()).abs()) < 1e-4, "{first:?}");
    // On an atom: shared, or through a new bond when dragged out further than a bond.
    for (far, smiles, atoms) in [(false, "Cc1ccccc1", 7), (true, "CCc1ccccc1", 8)] {
        let mut e = editor();
        e.load("CC").unwrap();
        e.set_tool("template");
        e.set_template(&t, 1, 1).unwrap();
        let p = e.mol().atoms[1].pos;
        if far {
            drag(&mut e, (p.x, p.y), (p.x + 2., p.y));
        } else {
            click(&mut e, p.x, p.y);
        }
        assert_eq!(e.mol().atoms.len(), atoms);
        assert_eq!(e.smiles(), canonical(smiles));
        assert!(valences(e.mol(), &e.mol().adjacency()).iter().all(|v| !v.error));
    }
    // A functional group replaces the clicked atom with its attachment atom.
    let acid = molfile(
        &[("C", 0., 0.), ("O", 0.866, 0.5), ("O", 0.866, -0.5)],
        &[(1, 2, 2), (1, 3, 1)],
        "M  STY  1   1 SUP\nM  SAL   1  3   1   2   3\nM  SMT   1 CO2H\n",
    );
    let mut e = editor();
    e.load("CCO").unwrap();
    e.set_tool("template");
    e.set_template(&acid, 1, 0).unwrap();
    let o = e.mol().atoms[2].pos;
    click(&mut e, o.x, o.y);
    assert_eq!(e.smiles(), canonical("CCC(=O)O"));
    // Salts have no attachment point: placed beside, never merged.
    let salt = molfile(&[("Na", 0., 0.), ("Cl", 2., 0.)], &[], "M  CHG  2   1   1   2  -1\n");
    e.set_template(&salt, 0, 0).unwrap();
    let p = e.mol().atoms[0].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.smiles(), canonical("CCC(=O)O.[Na+].[Cl-]"));
}

#[test]
fn ring_templates_merge_coinciding_atoms() {
    // A benzene placed on the free bond of a biphenyl-like layout shares the
    // atoms it falls on, like the ring tool.
    let mut e = editor();
    e.set_tool("ring:benzene");
    click(&mut e, 0., 0.);
    e.set_tool("template");
    e.set_template(&benzene_template(), 1, 1).unwrap();
    let m = e.mol().clone();
    let single = m.bonds.iter().position(|b| b.order == 1).unwrap();
    let mid = m.atoms[m.bonds[single].a].pos.lerp(m.atoms[m.bonds[single].b].pos, 0.5);
    click(&mut e, mid.x, mid.y);
    let mid2 = mid + (mid - v2(0., 0.)) * 2.;
    e.set_tool("ring:benzene");
    click(&mut e, mid2.x, mid2.y);
    let m = e.mol();
    for i in 0..m.atoms.len() {
        for j in i + 1..m.atoms.len() {
            assert!(m.atoms[i].pos.dist(m.atoms[j].pos) > 0.3, "atoms {i} and {j} coincide");
        }
    }
}

#[test]
fn thumbnails_fit_without_overlays() {
    let small = chem::read_template(&benzene_template()).unwrap();
    let svg = render::thumbnail(&small, 160., 120.);
    assert!(svg.starts_with("<svg") && svg.contains("width=\"160\"") && svg.contains("height=\"120\""));
    for class in ["me-hover", "me-selected", "me-preview", "me-marquee"] {
        assert!(!svg.contains(class), "{class}");
    }
    // Small drawings stay at the natural scale; large ones shrink inside a
    // small padding, centred.
    let bond = |svg: &str| {
        let d = &svg[svg.find("class=\"me-bond\" d=\"").unwrap() + 19..];
        let nums: Vec<f64> = d[..d.find('"').unwrap()].split(|c: char| c == 'M' || c == 'L' || c == ' ').filter_map(|x| x.parse().ok()).collect();
        ((nums[2] - nums[0]).powi(2) + (nums[3] - nums[1]).powi(2)).sqrt()
    };
    assert!((bond(&svg) - NATURAL).abs() < 0.05, "{}", bond(&svg));
    let big = chem::parse(NAD).unwrap();
    let svg = render::thumbnail(&big, 160., 120.);
    // Labels are 10/14.4 of a bond.
    let scale = attr_of(&svg, "me-label me-el-N", "font-size") * 1.44;
    assert!(scale < 8., "{scale}");
    let (lo, hi) = render::extent(&big).unwrap();
    let w = (hi.x - lo.x) * scale;
    let h = (hi.y - lo.y) * scale;
    assert!(w <= 160. - 2. * 2. + 0.5 && h <= 120. - 2. * 2. + 0.5, "{w} {h}");
    assert!(w > 150. - 24. || h > 120. - 24., "fills the box: {w} {h}");
    // Hundreds stay fast.
    let start = std::time::Instant::now();
    for _ in 0..300 {
        render::thumbnail(&chem::read_template(&benzene_template()).unwrap(), 96., 72.);
    }
    assert!(start.elapsed().as_secs_f64() < 1.5, "{:?}", start.elapsed());
    assert!(chem::read_template("garbage").is_err());
}

const NATURAL: f64 = render::NATURAL_SCALE;

#[test]
fn commands_explain_why_nothing_changed() {
    let mut e = editor();
    for name in ["layout", "clean", "aromatic", "hydrogens", "cip"] {
        assert!(e.command(name), "{name}");
        assert_eq!(state(&e, "message"), "Draw a structure first", "{name}");
    }
    e.load("CCCC").unwrap();
    assert_eq!(state(&e, "message"), "");
    assert!(e.command("aromatic"));
    assert_eq!(state(&e, "message"), "No aromatic rings found");
    assert_eq!(state(&e, "aromatic"), "false");
    assert!(e.command("cip"));
    assert_eq!(state(&e, "message"), "No stereocenters found");
    assert_eq!(state(&e, "cip"), "true");
    assert!(e.command("cip"));
    assert_eq!(state(&e, "message"), "");
    e.load("[Fe]").unwrap();
    assert!(e.command("hydrogens"));
    assert_eq!(state(&e, "message"), "No implicit hydrogens to show");
    // The next successful change clears it.
    e.set_tool("bond:single");
    click(&mut e, 3., 0.);
    assert_eq!(state(&e, "message"), "");
}

#[test]
fn library_templates_render_and_place_without_new_valence_errors() {
    // Exercise the shipped library, not files from the developer's /tmp.
    let library: serde_json::Value = serde_json::from_str(include_str!("../../public/templates.json")).unwrap();
    let entries = library["templates"].as_array().unwrap();
    assert!(entries.len() >= 473);
    for entry in entries {
        let name = entry["name"].as_str().unwrap();
        let block = entry["molfile"].as_str().unwrap();
        let (atom, bond) = (entry["atom"].as_u64().unwrap() as u32, entry["bond"].as_u64().unwrap() as u32);
        let source = chem::read_template(block).unwrap_or_else(|err| panic!("{name}: {err}"));
        let original_errors = chem::invalid_atoms(&source).len();
        let svg = render::thumbnail(&source, 96., 72.);
        assert!(svg.contains("<svg") && !svg.contains("NaN"), "{name}");
        let mut e = editor();
        e.set_tool("template");
        e.set_template(block, atom, bond).unwrap_or_else(|err| panic!("{name}: {err}"));
        click(&mut e, 0., 0.);
        assert_eq!(e.mol().atoms.len(), source.atoms.len(), "{name}: canvas placement");
        // Fusion and attachment either preserve valid valences or explain
        // why the target is incompatible, leaving the drawing unchanged.
        for target in ["bond", "atom"] {
            let mut e = editor();
            e.load("c1ccccc1CC").unwrap();
            e.set_tool("template");
            e.set_template(block, atom, bond).unwrap();
            let m = e.mol().clone();
            let p = if target == "bond" {
                m.atoms[m.bonds[0].a].pos.lerp(m.atoms[m.bonds[0].b].pos, 0.5)
            } else {
                m.atoms[7].pos
            };
            click(&mut e, p.x, p.y);
            assert!(chem::invalid_atoms(e.mol()).len() <= original_errors, "{name}: {target}");
            if state(&e, "message") != "" {
                assert_eq!(e.mol(), &m, "{name}: rejected placement changed the drawing");
            } else if e.mol() != &m {
                assert!(e.command("undo"), "{name}: placement is undoable");
                assert_eq!(e.mol(), &m, "{name}: undo {target} placement");
            }
        }
    }
}

#[test]
fn template_preserves_polymer_groups_and_rejects_invalid_attachment() {
    let mut e = editor();
    let source = molfile(
        &[("C", 0., 0.), ("C", 1., 0.)], &[(1, 2, 1)],
        "M  STY  1   1 SRU\nM  SAL   1  2   1   2\nM  SMT   1 n\n",
    );
    assert!(e.set_template(&source, 3, 0).is_err());
    assert!(e.set_template(&source, 1, 2).is_err());
    e.set_template(&source, 1, 1).unwrap();
    e.set_tool("template");
    click(&mut e, 0., 0.);
    assert_eq!(e.mol().sgroups.len(), 1);
    assert_eq!(e.mol().sgroups[0].atoms, [0, 1]);
    assert!(e.command("undo"));
    assert!(e.mol().is_empty());
    assert!(e.command("redo"));
    assert_eq!(e.mol().sgroups.len(), 1);
    // A hydrogen attachment must not acquire a second bond.
    let h = molfile(&[("H", 0., 0.), ("C", 1., 0.)], &[(1, 2, 1)], "");
    e.load("CC").unwrap();
    let before = e.mol().clone();
    e.set_template(&h, 1, 0).unwrap();
    let p = before.atoms[1].pos;
    click(&mut e, p.x, p.y);
    assert_eq!(e.mol(), &before);
    assert_eq!(state(&e, "message"), "This template does not fit here");
}

#[test]
fn dative_templates_keep_bond_direction_through_import_export_and_undo() {
    let library: serde_json::Value = serde_json::from_str(include_str!("../../public/templates.json")).unwrap();
    let entries = library["templates"].as_array().unwrap();
    let pairs = |mol: &Mol| mol.bonds.iter().filter(|b| b.dative).map(|b| (b.a, b.b)).collect::<Vec<_>>();
    let mut checked = 0;
    for t in entries {
        let source = chem::read_template(t["molfile"].as_str().unwrap()).unwrap();
        let expected = pairs(&source);
        if expected.is_empty() {
            continue;
        }
        checked += 1;
        let name = t["name"].as_str().unwrap();
        assert!(render::thumbnail(&source, 180., 120.).contains("me-bond me-dative"), "{name}: arrow rendering");
        let mut e = editor();
        e.load(t["molfile"].as_str().unwrap()).unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(pairs(e.mol()), expected, "{name}: import direction");
        let mf = e.molfile();
        assert_eq!(pairs(&chem::read_v2000(&mf, None).unwrap()), expected, "{name}: molfile direction");
        let smiles = e.smiles();
        assert!(smiles.contains("->") || smiles.contains("<-"), "{name}: coordinate bonds lost in SMILES: {smiles}");
        e.command("clear");
        e.set_template(t["molfile"].as_str().unwrap(), t["atom"].as_u64().unwrap() as u32, t["bond"].as_u64().unwrap() as u32).unwrap();
        e.set_tool("template");
        click(&mut e, 0., 0.);
        assert_eq!(pairs(e.mol()), expected, "{name}: template placement");
        e.command("undo");
        assert!(e.mol().is_empty());
        e.command("redo");
        assert_eq!(pairs(e.mol()), expected, "{name}: redo");
    }
    assert_eq!(checked, 4, "the four shipped coordinate-bond templates were checked");
    // Donor N has three hydrogens; its donated electron pair is not a fourth
    // covalent bond. Editing the arrow explicitly replaces it with a normal bond.
    let mut e = editor();
    e.load("[NH3]->[Cu+2]").unwrap();
    assert_eq!(e.mol().valence(0), 0);
    assert_eq!(valence(e.mol(), &e.mol().adjacency(), 0), Valence { h: 3, error: false });
    let smiles = e.smiles();
    e.load(&e.molfile()).unwrap();
    assert_eq!(e.smiles(), smiles);
    let next = tools::set_order(e.mol(), 0, 1).unwrap();
    assert!(!next.bonds[0].dative);
}

#[test]
fn wildcard_tool_replaces_numbered_r_groups_and_places_bare_stars() {
    let mut e = editor();
    e.set_tool("rgroup:3");
    click(&mut e, 0., 0.);
    e.set_tool("atom:*");
    assert_eq!(state(&e, "tool"), "atom:*");
    click(&mut e, 0., 0.);
    assert_eq!((e.mol().atoms.len(), e.mol().atoms[0].el, e.mol().atoms[0].rgroup), (1, 0, 0));
    assert_eq!(e.smiles(), "*");
    click(&mut e, 3., 0.);
    assert_eq!(e.mol().atoms.len(), 2);
    assert!(e.mol().atoms.iter().all(|a| a.el == 0 && a.rgroup == 0));
    assert_eq!(e.smiles(), "*.*");
    e.command("undo");
    assert_eq!(e.smiles(), "*");
}

#[test]
fn dragging_an_sru_member_onto_another_atom_preserves_the_group() {
    let mut e = editor();
    e.load(&molfile(
        &[("C", 0., 0.), ("C", 1., 0.), ("C", 2., 0.)], &[(1, 2, 1), (2, 3, 1)],
        "M  STY  1   1 SRU\nM  SAL   1  1   1\nM  SMT   1 n\n",
    )).unwrap();
    let before = e.mol().clone();
    e.set_tool("select");
    drag(&mut e, (0., 0.), (1., 0.));
    assert_eq!(e.mol().atoms.len(), 2);
    assert_eq!(e.mol().sgroups.len(), 1);
    assert_eq!(e.mol().sgroups[0].atoms, [0]);
    assert!(e.molfile().contains("M  STY  1   1 SRU"));
    e.command("undo");
    assert_eq!(e.mol(), &before);
    e.command("redo");
    assert_eq!(e.mol().sgroups[0].atoms, [0]);
    let mut group = before.clone();
    group.sgroups[0].atoms = vec![0, 1];
    let merged = tools::merge(&group, 0, 1).unwrap();
    assert_eq!(merged.sgroups[0].atoms, [0], "members deduplicate after merging");
}
#[test]
fn fit_follows_resize_until_the_view_is_manually_changed() {
    let mut e = editor();
    e.load("CC(=O)Oc1ccccc1C(=O)O").unwrap();
    let original = e.molfile();
    e.resize(390., 500.);
    let fitted = e.zoom();
    e.command("fit");
    assert_eq!(e.zoom(), fitted);
    e.zoom_by(0.5);
    let manual = e.zoom();
    e.resize(900., 600.);
    assert_eq!(e.zoom(), manual);
    e.command("fit");
    e.resize(390., 500.);
    assert_eq!(e.zoom(), fitted);
    assert_eq!(e.molfile(), original);
}
