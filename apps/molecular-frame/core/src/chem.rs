//! Chemistry bridge: V2000 molfiles are the only interchange between the
//! drawing model and cosmolkit (SMILES, CIP, aromaticity, layout, 3D).
use crate::geometry::{V2, align, v2};
use crate::layout::{arrange, declash, fragments, spread_hydrogens};
use crate::model::{Atom, Bond, Mol, SGroup, Stereo};
use crate::render::Cip;
use crate::valence::{element, symbol, tabulated};
use cosmolkit_core::io::molblock::{MolBlockWriteParams, SdfFormat, mol_to_mol_block_with_params, mol_to_v2000_2d_block, mol_to_v2000_3d_block};
use cosmolkit_core::smiles_write::mol_to_cx_smiles;
use cosmolkit_core::{AddHsParams, CxSmilesFields, EmbedParameters, Molecule, RestoreBondDirOption, SanitizeOps, SdfReadParams, SubstanceGroupKind};
use std::collections::HashSet;
use std::fmt::Write;

/// Molfile length of one model bond (RDKit depiction convention).
pub const ANGSTROM: f64 = 1.5;
pub const UNREADABLE: &str = "Could not read this structure.";
const UNSUPPORTED_SGROUP: &str = "This structure contains S-groups the editor cannot preserve yet.";
const MAX_SGROUP_LABEL: usize = 20;

fn fail<E: std::fmt::Debug>(_: E) -> String {
    UNREADABLE.to_string()
}

// ---------------------------------------------------------------- V2000 IO

pub fn write_v2000(mol: &Mol) -> String {
    let mut s = String::with_capacity(96 + mol.atoms.len() * 70 + mol.bonds.len() * 13);
    // Header line 2: the dimension code sits in columns 21–22.
    s.push_str("\n LigandPro          2D\n\n");
    let _ = writeln!(s, "{:>3}{:>3}  0  0  1  0  0  0  0  0999 V2000", mol.atoms.len(), mol.bonds.len());
    let mut used = vec![0u32; mol.atoms.len()];
    for b in &mol.bonds {
        used[b.a] += b.valence_at(b.a);
        used[b.b] += b.valence_at(b.b);
    }
    for (a, &used) in mol.atoms.iter().zip(&used) {
        // R groups and bare attachment points (no M  RGP) alike: a plain "R"
        // reads as a query atom.
        let sym = if a.el == 0 { "R#" } else { symbol(a.el) };
        // The valence field pins H counts the default valences would not give.
        let total = match a.total {
            _ if a.el == 0 => None,
            Some(t) => Some((t as u32).max(used)),
            None if !tabulated(a.el, a.charge) => Some(used),
            None => None,
        };
        let _ = writeln!(
            s,
            "{:>10.4}{:>10.4}{:>10.4} {:<3} 0  0  0  0  0{:>3}  0  0  0{:>3}  0  0",
            a.pos.x * ANGSTROM,
            -a.pos.y * ANGSTROM + 0.0,
            0.0,
            sym,
            total.map_or(0, |t| if t == 0 { 15 } else { t.min(14) }),
            a.mapping
        );
    }
    for b in &mol.bonds {
        let stereo = match (b.stereo, b.order) {
            _ if b.dative => 0,
            (Stereo::None, _) => 0,
            (Stereo::Wedge, _) => 1,
            (Stereo::Wavy, 2) => 3,
            (Stereo::Wavy, _) => 4,
            (Stereo::Hash, _) => 6,
        };
        let kind = if b.dative { 9 } else { b.order.clamp(1, 3) };
        let _ = writeln!(s, "{:>3}{:>3}{:>3}{:>3}", b.a + 1, b.b + 1, kind, stereo);
    }
    let props = |tag: &str, values: Vec<(usize, i32)>, s: &mut String| {
        for chunk in values.chunks(8) {
            let _ = write!(s, "M  {tag}{:>3}", chunk.len());
            for (i, v) in chunk {
                let _ = write!(s, "{:>4}{:>4}", i + 1, v);
            }
            s.push('\n');
        }
    };
    let pick = |f: fn(&Atom) -> i32| mol.atoms.iter().enumerate().map(|(i, a)| (i, f(a))).filter(|x| x.1 != 0).collect();
    props("CHG", pick(|a| a.charge as i32), &mut s);
    props("RAD", pick(|a| a.radical as i32), &mut s);
    props("ISO", pick(|a| a.iso as i32), &mut s);
    props("RGP", pick(|a| if a.el == 0 { a.rgroup as i32 } else { 0 }), &mut s);
    for (i, atom) in mol.atoms.iter().enumerate() {
        if let Some(alias) = &atom.alias { let _ = writeln!(s, "A  {:>3}\n{}", i + 1, alias); }
    }
    write_sgroups(mol, &mut s);
    s.push_str("M  END\n");
    s
}

/// SRU S-group lines: type, label, connectivity, atoms (with their explicit
/// hydrogens), crossing bonds, bracket coordinates (the unit on the right of
/// each bracket, y up) and the subscript.
fn write_sgroups(mol: &Mol, s: &mut String) {
    let list = |s: &mut String, tag: &str, k: usize, items: &[usize]| {
        for chunk in items.chunks(15) {
            let _ = write!(s, "M  {tag}{k:>4}{:>3}", chunk.len());
            chunk.iter().for_each(|i| {
                let _ = write!(s, "{:>4}", i + 1);
            });
            s.push('\n');
        }
    };
    for (k, g) in mol.sgroups.iter().enumerate() {
        let k = k + 1;
        let inside = g.members(mol);
        let atoms: Vec<usize> = (0..mol.atoms.len()).filter(|&i| inside[i]).collect();
        let bonds: Vec<usize> = g.crossing(mol).iter().map(|c| c.0).collect();
        let _ = writeln!(s, "M  STY  1 {k:>3} SRU");
        let _ = writeln!(s, "M  SLB  1 {k:>3} {k:>3}");
        let _ = writeln!(s, "M  SCN  1 {k:>3} {:<3}", g.connect);
        list(s, "SAL", k, &atoms);
        list(s, "SBL", k, &bonds);
        let centre = atoms.iter().fold(V2::default(), |c, &i| c + mol.atoms[i].pos) * (1. / atoms.len().max(1) as f64);
        for br in crate::render::brackets(mol, g) {
            let flip = |p: V2| v2(p.x * ANGSTROM, -p.y * ANGSTROM + 0.0);
            let (mut p, mut q) = (flip(br.a), flip(br.b));
            if (q - p).cross(flip(centre) - p) > 0. {
                std::mem::swap(&mut p, &mut q);
            }
            let _ = writeln!(s, "M  SDI{k:>4}  4{:>10.4}{:>10.4}{:>10.4}{:>10.4}", p.x, p.y, q.x, q.y);
        }
        let _ = writeln!(s, "M  SMT{k:>4} {}", g.label);
    }
}

/// SRU S-groups from V2000 property lines (`M  STY`, `SAL`, `SMT`, `SCN`);
/// crossing bonds and brackets are re-derived from the drawing.
fn read_sgroups(lines: &[&str], atoms: usize) -> Vec<SGroup> {
    let mut groups: Vec<(u32, SGroup)> = Vec::new();
    for line in lines {
        if line.starts_with("M  END") {
            break;
        }
        let Some(tag) = line.get(3..6) else { continue };
        let words: Vec<&str> = line.get(6..).unwrap_or("").split_whitespace().collect();
        let find = |groups: &mut Vec<(u32, SGroup)>, id: &str| id.parse::<u32>().ok().and_then(|id| groups.iter().position(|g| g.0 == id));
        match tag {
            "STY" => {
                for pair in words.get(1..).unwrap_or(&[]).chunks(2) {
                    if let [id, "SRU"] = pair
                        && let Ok(id) = id.parse()
                    {
                        groups.push((id, SGroup::new(Vec::new())));
                    }
                }
            }
            "SAL" => {
                if let Some(k) = words.first().and_then(|id| find(&mut groups, id)) {
                    let ids = words.iter().skip(2).filter_map(|w| w.parse::<usize>().ok());
                    groups[k].1.atoms.extend(ids.filter(|&i| i >= 1 && i <= atoms).map(|i| i - 1));
                }
            }
            "SMT" => {
                if let Some(k) = words.first().and_then(|id| find(&mut groups, id)) {
                    let text = line.get(10..).unwrap_or("").trim();
                    if !text.is_empty() {
                        groups[k].1.label = text.chars().take(MAX_SGROUP_LABEL).collect();
                    }
                }
            }
            "SCN" => {
                for pair in words.get(1..).unwrap_or(&[]).chunks(2) {
                    if let [id, kind] = pair
                        && let Some(k) = find(&mut groups, id)
                        && matches!(kind.to_ascii_uppercase().as_str(), "HT" | "HH" | "EU")
                    {
                        groups[k].1.connect = kind.to_ascii_uppercase();
                    }
                }
            }
            _ => {}
        }
    }
    let mut out: Vec<SGroup> = groups.into_iter().map(|g| g.1).filter(|g| !g.atoms.is_empty()).collect();
    out.iter_mut().for_each(|g| {
        g.atoms.sort_unstable();
        g.atoms.dedup();
    });
    out
}

fn field(line: &str, start: usize, end: usize) -> &str {
    line.get(start..end.min(line.len())).unwrap_or("").trim()
}

fn int(line: &str, start: usize, end: usize) -> i64 {
    field(line, start, end).parse().unwrap_or(0)
}

/// Reads a V2000 molfile. `scale` converts molfile units to bond lengths;
/// `None` normalises the median bond length to 1.
pub fn read_v2000(text: &str, scale: Option<f64>) -> Result<Mol, String> {
    let lines: Vec<&str> = text.lines().collect();
    let counts = *lines.get(3).ok_or(UNREADABLE)?;
    if counts.contains("V3000") {
        return Err(UNREADABLE.into());
    }
    let (na, nb) = (int(counts, 0, 3) as usize, int(counts, 3, 6) as usize);
    if lines.len() < 4 + na + nb {
        return Err(UNREADABLE.into());
    }
    let mut mol = Mol::default();
    for line in &lines[4..4 + na] {
        let num = |a, b| field(line, a, b).parse::<f64>().map_err(fail);
        let (x, y) = (num(0, 10)?, num(10, 20)?);
        let sym = field(line, 31, 34);
        let el = element(sym).ok_or(UNREADABLE)?;
        let mut atom = Atom::new(el, v2(x, -y));
        atom.mapping = int(line, 60, 63) as u32;
        match int(line, 36, 39) {
            4 => atom.radical = 2,
            c @ 1..=7 => atom.charge = 4 - c as i8,
            _ => {}
        }
        atom.total = match int(line, 48, 51) {
            _ if el == 0 => None,
            15 => Some(0),
            v @ 1..=14 => Some(v as u8),
            _ => None,
        };
        if sym == "D" || sym == "T" {
            atom.iso = if sym == "D" { 2 } else { 3 };
        }
        mol.atoms.push(atom);
    }
    let mut seen = HashSet::new();
    for line in &lines[4 + na..4 + na + nb] {
        let (a, b) = (int(line, 0, 3) as usize, int(line, 3, 6) as usize);
        if a == 0 || b == 0 || a > na || b > na {
            return Err(UNREADABLE.into());
        }
        // Self-bonds and repeats (the first is kept) are dropped.
        if a == b || !seen.insert((a.min(b), a.max(b))) {
            continue;
        }
        let kind = int(line, 6, 9);
        let stereo = match (kind, int(line, 9, 12)) {
            (1, 1) => Stereo::Wedge,
            (1, 6) => Stereo::Hash,
            (1, 4) | (2, 3) => Stereo::Wavy,
            _ => Stereo::None,
        };
        let order = match kind {
            2 => 2,
            3 => 3,
            _ => 1,
        };
        mol.bonds.push(Bond { a: a - 1, b: b - 1, order, dative: kind == 9, arom: kind == 4, stereo });
    }
    let (mut charges, mut radicals) = (false, false);
    for line in &lines[4 + na + nb..] {
        if line.starts_with("M  END") {
            break;
        }
        let tag = field(line, 3, 6);
        if !matches!(tag, "CHG" | "ISO" | "RAD" | "RGP") {
            continue;
        }
        // M  CHG and M  RAD supersede the atom-block values.
        if tag == "CHG" && !std::mem::replace(&mut charges, true) {
            mol.atoms.iter_mut().for_each(|a| a.charge = 0);
        }
        if tag == "RAD" && !std::mem::replace(&mut radicals, true) {
            mol.atoms.iter_mut().for_each(|a| a.radical = 0);
        }
        for k in 0..(int(line, 6, 9) as usize).min(8) {
            let at = int(line, 9 + 8 * k, 13 + 8 * k) as usize;
            let v = int(line, 13 + 8 * k, 17 + 8 * k);
            let Some(atom) = at.checked_sub(1).and_then(|i| mol.atoms.get_mut(i)) else { continue };
            match tag {
                "CHG" => atom.charge = v.clamp(-8, 8) as i8,
                "ISO" => atom.iso = v.clamp(0, 999) as u16,
                "RAD" => atom.radical = v.clamp(0, 3) as u8,
                _ => atom.rgroup = v.clamp(0, 99) as u8,
            }
        }
    }
    for pair in lines[4 + na + nb..].windows(2) {
        if pair[0].starts_with("A  ") {
            let at = pair[0][3..].trim().parse::<usize>().map_err(fail)?;
            let atom = at.checked_sub(1).and_then(|i| mol.atoms.get_mut(i)).ok_or(UNREADABLE)?;
            let label = pair[1].trim();
            if label.is_empty() || label.len() > 80 || !label.chars().all(|c| c.is_ascii_alphanumeric() || "_-'.".contains(c)) { return Err(UNREADABLE.into()); }
            atom.alias = Some(label.to_owned());
        }
    }
    mol.sgroups = read_sgroups(&lines[4 + na + nb..], na);
    for a in mol.atoms.iter_mut().filter(|a| a.el == 0) {
        // cosmolkit numbers R groups by isotope ([2*]); M  RGP comes first.
        if a.rgroup == 0 && a.iso <= 99 {
            a.rgroup = a.iso as u8;
        }
        if a.rgroup > 0 {
            a.iso = 0;
        }
    }
    let scale = scale.unwrap_or_else(|| {
        let mut lengths: Vec<f64> = mol
            .bonds
            .iter()
            .map(|b| mol.atoms[b.a].pos.dist(mol.atoms[b.b].pos))
            .filter(|l| *l > 1e-4)
            .collect();
        lengths.sort_by(f64::total_cmp);
        lengths.get(lengths.len() / 2).map_or(1. / ANGSTROM, |m| 1. / m)
    });
    for a in &mut mol.atoms {
        a.pos = a.pos * scale;
        if !a.pos.finite() {
            return Err(UNREADABLE.into());
        }
    }
    Ok(mol)
}

// ------------------------------------------------------------ cosmolkit

/// `m` with every sanitization step but the valence check (RDKit's
/// `SANITIZE_ALL ^ SANITIZE_PROPERTIES`), so drawings with a pentavalent
/// carbon still get rings, conjugation and stereo cleanup. Aromaticity only
/// on request: kekulizing again for output would check valences.
fn lenient(m: Molecule, aromatic: bool) -> Result<Molecule, String> {
    use SanitizeOps as S;
    let mut ops = S::CLEANUP
        | S::CLEANUP_ORGANOMETALLICS
        | S::SYMMRINGS
        | S::FIND_RADICALS
        | S::SET_CONJUGATION
        | S::SET_HYBRIDIZATION
        | S::CLEANUP_ATROPISOMERS
        | S::CLEANUP_CHIRALITY
        | S::ADJUST_HYDROGENS;
    if aromatic {
        ops |= S::KEKULIZE | S::SET_AROMATICITY;
    }
    m.sanitize_with_ops(ops).map_err(fail)
}

/// A molfile as a sanitized cosmolkit molecule or, when some valences are
/// off, a partially sanitized one (aromatic on request).
fn read_block(block: &str, keep_h: bool, aromatic: bool) -> Result<Molecule, String> {
    Molecule::from_mol_block_with_params(block, SdfReadParams { remove_hs: !keep_h, ..Default::default() }).or_else(|_| {
        let raw = Molecule::from_mol_block_with_params(block, SdfReadParams { remove_hs: false, sanitize: false, ..Default::default() });
        let m = lenient(raw.map_err(fail)?, aromatic)?;
        if keep_h { Ok(m) } else { m.without_hydrogens_with_sanitize(false).map_err(fail) }
    })
}

fn parse_block(block: &str, keep_h: bool) -> Result<Molecule, String> {
    read_block(block, keep_h, false)
}

fn block_2d(m: &Molecule) -> Result<String, String> {
    // The generic writer auto-upgrades coordinate bonds to V3000 even with
    // format=V2000; use the explicit writer to preserve type 9 in our model.
    if m.bonds().iter().any(|b| b.order() == cosmolkit_core::BondOrder::Dative) {
        return mol_to_v2000_2d_block(m).map_err(fail);
    }
    let params = MolBlockWriteParams {
        format: SdfFormat::V2000,
        force_2d: true,
        include_stereo: true,
        // Kekulé input that was not aromatized needs (and passes) no check.
        kekulize: m.bonds().iter().any(|b| b.is_aromatic()),
        precision: 4,
    };
    mol_to_mol_block_with_params(m, &params).map_err(fail)
}

/// The drawing as a cosmolkit molecule, atom and bond order kept: sanitized,
/// or partially when valences are off so the valid parts still get
/// aromaticity, stereo and hydrogens.
pub fn to_cosmol(mol: &Mol) -> Result<Molecule, String> {
    parse_block(&write_v2000(mol), true)
}

/// Atoms whose valence breaks the drawing's rules (drawn red).
pub fn invalid_atoms(mol: &Mol) -> Vec<usize> {
    let adj = mol.adjacency();
    (0..mol.atoms.len()).filter(|&i| crate::valence::valence(mol, &adj, i).error).collect()
}

/// Input fixes for cosmolkit: validated absolute V3000 collections are encoded
/// by the V2000 chiral flag. In V2000, self-bonds and
/// repeated bonds (the first is kept), which break its layout, go too, and
/// "R" and "*" atoms, which it reads as queries it cannot write, become "R#".
fn tidy(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut skip = false;
    for line in text.lines() {
        let words = line.strip_prefix("M  V30").map(|r| r.split_whitespace().collect::<Vec<_>>().join(" "));
        match words.map(|w| w.to_ascii_uppercase()).as_deref() {
            Some("BEGIN COLLECTION") => skip = true,
            Some("END COLLECTION") if skip => {
                skip = false;
                continue;
            }
            _ => {}
        }
        if !skip {
            lines.push(line.to_string());
        }
    }
    if let Some(c) = lines.get(3).filter(|c| !c.contains("V3000")).cloned() {
        let (na, nb) = (int(&c, 0, 3) as usize, int(&c, 3, 6) as usize);
        if lines.len() >= 4 + na + nb {
            for line in &mut lines[4..4 + na] {
                if matches!(field(line, 31, 34), "R" | "*") {
                    line.replace_range(31..line.len().min(34), "R# ");
                }
            }
            let mut seen = HashSet::new();
            let keep: Vec<bool> = (lines[4 + na..4 + na + nb].iter())
                .map(|l| (int(l, 0, 3), int(l, 3, 6)))
                .map(|(a, b)| a != b && seen.insert((a.min(b), a.max(b))))
                .collect();
            let kept = keep.iter().filter(|&&k| k).count();
            if kept < nb {
                lines[3] = format!("{}{kept:>3}{}", c.get(..3).unwrap_or(""), c.get(6..).unwrap_or(""));
                let mut k = 0;
                lines.retain(|_| {
                    k += 1;
                    k <= 4 + na || k > 4 + na + nb || keep[k - 5 - na]
                });
            }
        }
    }
    lines.join("\n") + "\n"
}

/// Parses SMILES or a molfile (V2000/V3000) into a Kekulé drawing with
/// 2D coordinates and RDKit-style wedges.
fn validate_input(text: &str) -> Result<(), String> {
    let unsupported = || "This structure contains relative stereochemistry or query features the editor cannot preserve yet.".to_string();
    let lines: Vec<_> = text.lines().collect();
    if let Some(counts) = lines.get(3).filter(|line| line.contains("V2000")) {
        let na = int(counts, 0, 3) as usize;
        let nb = int(counts, 3, 6) as usize;
        if lines.len() < 4 + na + nb { return Err(UNREADABLE.into()); }
        let atoms = &lines[4..4 + na];
        let bonds = &lines[4 + na..4 + na + nb];
        let relative = int(counts, 12, 15) == 0
            && (atoms.iter().any(|line| matches!(int(line, 39, 42), 1 | 2))
                || bonds.iter().any(|line| matches!(int(line, 9, 12), 1 | 6)));
        let query = atoms.iter().any(|line| int(line, 42, 45) != 0 || int(line, 45, 48) != 0
            || int(line, 54, 57) != 0 || int(line, 63, 66) != 0 || int(line, 66, 69) != 0)
            || bonds.iter().any(|line| !matches!(int(line, 6, 9), 1..=4 | 9)
                || int(line, 15, 18) != 0 || int(line, 18, 21) != 0)
            || lines.iter().any(|line| ["M  ALS", "M  SUB", "M  UNS", "M  RBC", "M  APO", "M  RLOG"].iter().any(|tag| line.starts_with(tag)));
        if relative || query { return Err(unsupported()); }
        // The alias import path reads V2000 directly and would discard these groups.
        for line in lines[4 + na + nb..].iter().take_while(|line| !line.starts_with("M  END")) {
            if let Some(types) = line.strip_prefix("M  STY")
                && types.split_whitespace().skip(2).step_by(2).any(|kind| kind != "SRU")
            {
                return Err(UNSUPPORTED_SGROUP.into());
            }
            if line.starts_with("M  SMT") && line.get(10..).unwrap_or("").trim().chars().count() > MAX_SGROUP_LABEL {
                return Err(UNSUPPORTED_SGROUP.into());
            }
        }
    }
    if text.contains("MDLV30/STERAC") || text.contains("MDLV30/STEREL") { return Err(unsupported()); }
    Ok(())
}

pub fn parse(text: &str) -> Result<Mol, String> {
    let text = text.trim_start_matches('\u{feff}');
    validate_input(text)?;
    // Keep alias labels exactly as recorded. These V2000 query graphs must
    // not pass through a sanitizer that expands or discards atom aliases.
    if text.lines().nth(3).is_some_and(|l| l.contains("V2000")) && text.lines().any(|l| l.starts_with("A  ")) {
        return read_v2000(text, None);
    }
    let block = text.contains("M  END") || text.lines().nth(3).is_some_and(|l| l.contains("V2000") || l.contains("V3000"));
    let (m, generated) = if block {
        let m = parse_block(&tidy(text), true)?;
        let usable = m.coordinates_2d().is_some_and(|c| {
            let first = c.first().copied().unwrap_or([0., 0.]);
            c.len() < 2 || c.iter().any(|p| (p[0] - first[0]).abs() + (p[1] - first[1]).abs() > 1e-3)
        });
        if usable { (m, false) } else { (m.with_2d_coordinates().map_err(fail)?, true) }
    } else {
        let token = smiles_token(text).ok_or(UNREADABLE)?;
        let m = match Molecule::from_smiles(token) {
            Ok(m) => m,
            Err(_) => lenient(Molecule::from_smiles_with_sanitize(token, false).map_err(fail)?, false)?,
        };
        (m.with_2d_coordinates().map_err(fail)?, true)
    };
    if m.num_atoms() == 0 {
        return Err(UNREADABLE.into());
    }
    if m.substance_groups().iter().any(|group| {
        *group.kind() != SubstanceGroupKind::StructuralRepeatUnit
            || group.label().is_some_and(|label| label.trim().chars().count() > MAX_SGROUP_LABEL)
    }) {
        return Err(UNSUPPORTED_SGROUP.into());
    }
    let unsupported_atom = |a: &cosmolkit_core::Atom| {
        let supported_query = match a.query() {
            None => true,
            Some(cosmolkit_core::QueryNode::Predicate(cosmolkit_core::AtomQueryPredicate::Any)) => a.atomic_number() == 0,
            Some(cosmolkit_core::QueryNode::Predicate(cosmolkit_core::AtomQueryPredicate::MolFileAlias(alias))) => a.atomic_number() == 0 && alias == "R#",
            Some(cosmolkit_core::QueryNode::Predicate(cosmolkit_core::AtomQueryPredicate::RGroupLabel(label))) => a.atomic_number() == 0 && (1..=99).contains(label),
            _ => false,
        };
        !supported_query || a.atom_map().is_some_and(|n| n > 999)
    };
    if m.atoms().iter().any(unsupported_atom)
        || m.bonds().iter().any(|b| b.query().is_some())
        || m.stereo_groups().iter().any(|g| g.kind() != cosmolkit_core::StereoGroupKind::Absolute)
    {
        return Err("This structure contains query features or mapping numbers the editor cannot preserve yet.".into());
    }
    let mut mol = read_v2000(&block_2d(&m)?, None)?;
    if generated {
        arrange(&mut mol);
        if declash(&mut mol, 0) && has_wedges(&mol) {
            mol = settle(&m, &mol)?;
        }
    }
    Ok(mol)
}

/// The SMILES in `text`: its first word, so "CCO ethanol" and SMILES files
/// work, with a CXSMILES extension (`|…|`) right after it. Impossible
/// valences are kept as written.
fn smiles_token(text: &str) -> Option<&str> {
    let text = text.trim_start();
    let end = text.find(char::is_whitespace).unwrap_or(text.len());
    if end == 0 {
        return None;
    }
    let rest = &text[end..];
    let ext = rest.trim_start();
    if let Some(close) = ext.strip_prefix('|').and_then(|e| e.find('|')) {
        return Some(&text[..end + (rest.len() - ext.len()) + close + 2]);
    }
    Some(&text[..end])
}

/// A template or thumbnail molfile exactly as drawn: Kekulé V2000 is read
/// directly (fast, x and y kept, z ignored); anything else goes through
/// [`parse`].
pub fn read_template(text: &str) -> Result<Mol, String> {
    let text = text.trim_start_matches('\u{feff}');
    if text.lines().nth(3).is_some_and(|l| l.contains("V2000"))
        && let Ok(m) = read_v2000(text, None)
        && !m.bonds.iter().any(|b| b.arom)
    {
        return Ok(m);
    }
    parse(text)
}

/// Canonical isomeric SMILES, or "" when empty or not representable.
/// Polymers are CXSMILES with their repeat units (`*CC* |Sg:n:1,2:n:ht:::|`).
pub fn smiles(mol: &Mol) -> String {
    if mol.is_empty() || mol.atoms.iter().any(|a| a.alias.is_some()) {
        return String::new();
    }
    if mol.sgroups.is_empty() {
        return read_block(&write_v2000(mol), false, true).ok().and_then(|m| m.to_smiles(true).ok()).unwrap_or_default();
    }
    // Units list their explicit hydrogens, which would stay explicit.
    let plain = remove_hydrogens(mol);
    let cx = |m: Molecule| mol_to_cx_smiles(&m, &Default::default(), CxSmilesFields::POLYMER, RestoreBondDirOption::None).ok();
    read_block(&write_v2000(&plain), false, true).ok().and_then(cx).unwrap_or_default()
}

/// Reads back cosmolkit's re-wedged 2D block for `m`, checking that atoms and
/// bonds still correspond to `mol` one-to-one (bond ends may be swapped).
fn reread(m: &Molecule, mol: &Mol) -> Result<Mol, String> {
    let fresh = read_v2000(&block_2d(m)?, Some(1. / ANGSTROM))?;
    let same = fresh.atoms.len() >= mol.atoms.len()
        && fresh.bonds.len() >= mol.bonds.len()
        && mol.atoms.iter().zip(&fresh.atoms).all(|(a, f)| a.el == f.el)
        && mol.bonds.iter().zip(&fresh.bonds).all(|(b, f)| (b.a, b.b) == (f.a, f.b) || (b.a, b.b) == (f.b, f.a));
    if same { Ok(fresh) } else { Err(UNREADABLE.into()) }
}

/// Copies re-derived wedges from `fresh` (wavy bonds are kept as drawn).
fn take_stereo(out: &mut Mol, fresh: &Mol) {
    for (b, f) in out.bonds.iter_mut().zip(&fresh.bonds) {
        if b.stereo == Stereo::Wavy {
            continue;
        }
        b.stereo = f.stereo;
        if f.stereo != Stereo::None {
            b.a = f.a;
            b.b = f.b;
        }
    }
}

/// `mol` where it stands, with wedges re-derived for those positions by `m`
/// (the same atoms and bonds) so stereo is kept.
fn settle(m: &Molecule, mol: &Mol) -> Result<Mol, String> {
    let block: Vec<[f64; 2]> = mol.atoms.iter().map(|a| [a.pos.x * ANGSTROM, -a.pos.y * ANGSTROM]).collect();
    let fresh = reread(&m.with_2d_coordinate_block(block).map_err(fail)?, mol)?;
    let mut out = mol.clone();
    take_stereo(&mut out, &fresh);
    Ok(out)
}

/// Fresh 2D depiction. With `keep_place` each fragment is rigidly fitted onto
/// where it was drawn; otherwise fragments are arranged around the drawing's
/// centre. Crowded terminal atoms turn aside, and wedges are re-derived for
/// the new geometry so stereo is kept.
pub fn relayout(mol: &Mol, keep_place: bool) -> Result<Mol, String> {
    let laid = to_cosmol(mol)?.with_2d_coordinates().map_err(fail)?;
    let coords = laid.coordinates_2d().ok_or(UNREADABLE)?;
    let mut placed = mol.clone();
    for (a, c) in placed.atoms.iter_mut().zip(coords) {
        a.pos = v2(c[0] / ANGSTROM, -c[1] / ANGSTROM);
    }
    if keep_place {
        for frag in fragments(mol) {
            let from: Vec<V2> = frag.iter().map(|&i| placed.atoms[i].pos).collect();
            let to: Vec<V2> = frag.iter().map(|&i| mol.atoms[i].pos).collect();
            for (&i, p) in frag.iter().zip(align(&from, &to)) {
                placed.atoms[i].pos = p;
            }
        }
    } else if let (Some((lo, hi)), Some((a, b))) = (mol.bounds(), placed.bounds()) {
        let shift = (lo + hi - a - b) * 0.5;
        placed.atoms.iter_mut().for_each(|x| x.pos = x.pos + shift);
        arrange(&mut placed);
    }
    declash(&mut placed, 0);
    settle(&laid, &placed)
}

/// Aromatic flags as perceived by cosmolkit (RDKit model) for every bond.
pub fn aromatic_bonds(mol: &Mol) -> Result<Vec<bool>, String> {
    Ok(read_block(&write_v2000(mol), true, true)?.bonds().iter().map(|b| b.is_aromatic()).collect())
}

fn labels(m: &Molecule) -> Result<Cip, String> {
    let m = m.with_cip_labels().map_err(fail)?;
    let atoms = m.atoms().iter().map(|a| a.cip_descriptor().ok().flatten().map(|d| d.as_str())).collect();
    let bonds = m.bonds().iter().map(|b| b.cip_descriptor().ok().flatten().map(|d| d.as_str())).collect();
    Ok((atoms, bonds))
}

/// CIP descriptors for atoms and bonds. The labeler needs valid valences:
/// when some atoms break them, it runs with those atoms as the lightest
/// (a dummy) and as a heavy atom of any valence (uranium), and keeps the
/// labels both agree on, which are the ones those atoms cannot change.
pub fn cip_labels(mol: &Mol) -> Result<Cip, String> {
    let m = to_cosmol(mol)?;
    let first = labels(&m);
    if first.is_ok() {
        return first;
    }
    let mut bad: Vec<usize> = (0..m.num_atoms())
        .filter(|&i| cosmolkit_core::atom_has_valence_violation(&m, cosmolkit_core::AtomId::new(i)).unwrap_or(true))
        .collect();
    bad.extend(invalid_atoms(mol));
    if bad.is_empty() {
        return first;
    }
    let swapped = |z: u8| {
        let mut x = mol.clone();
        for &i in &bad {
            let a = &mut x.atoms[i];
            a.retype(z);
            a.charge = 0;
        }
        to_cosmol(&x).and_then(|m| labels(&m))
    };
    let (low, high) = (swapped(0)?, swapped(92)?);
    let agree = |a: Vec<Option<&'static str>>, b: Vec<Option<&'static str>>| a.into_iter().zip(b).map(|(x, y)| if x == y { x } else { None }).collect::<Vec<_>>();
    let mut atoms = agree(low.0, high.0);
    bad.iter().for_each(|&i| atoms[i] = None);
    Ok((atoms, agree(low.1, high.1)))
}

pub fn has_wedges(mol: &Mol) -> bool {
    mol.bonds.iter().any(|b| matches!(b.stereo, Stereo::Wedge | Stereo::Hash))
}

/// Adds explicit hydrogens with 2D coordinates to every atom with implicit H.
pub fn add_hydrogens(mol: &Mol) -> Result<Mol, String> {
    let params = AddHsParams { add_coords: true, ..Default::default() };
    let with_h = to_cosmol(mol)?.with_hydrogens_with_params(params).map_err(fail)?;
    let fresh = reread(&with_h, mol)?;
    let mut out = mol.clone();
    out.atoms.extend(fresh.atoms[mol.atoms.len()..].iter().cloned());
    out.bonds.extend(fresh.bonds[mol.bonds.len()..].iter().cloned());
    // Explicit H bonds are drawn at the full bond length, spread around their
    // atoms; those that still crowd others turn aside. Wedges follow them.
    for b in &out.bonds[mol.bonds.len()..] {
        let (h, heavy) = if b.a >= mol.atoms.len() { (b.a, b.b) } else { (b.b, b.a) };
        let p = out.atoms[heavy].pos;
        out.atoms[h].pos = p + (out.atoms[h].pos - p).unit();
    }
    spread_hydrogens(&mut out, mol.atoms.len());
    declash(&mut out, mol.atoms.len());
    if has_wedges(&out) {
        out = settle(&with_h, &out)?;
    }
    Ok(out)
}

/// Plain explicit H atoms singly bonded to one heavy atom: what the
/// hydrogens command removes, and whether it shows as on.
pub fn removable_hydrogens(mol: &Mol) -> Vec<bool> {
    let adj = mol.adjacency();
    (mol.atoms.iter().zip(&adj))
        .map(|(a, nbrs)| {
            a.el == 1
                && (a.charge, a.iso, a.radical) == (0, 0, 0)
                && matches!(nbrs[..], [(b, n)] if mol.atoms[n].el != 1 && mol.bonds[b].order == 1 && !mol.bonds[b].dative)
        })
        .collect()
}

/// Removes explicit hydrogens on heavy atoms, re-deriving wedges if any
/// stereo bonds are involved so configurations survive.
pub fn remove_hydrogens(mol: &Mol) -> Mol {
    let drop = removable_hydrogens(mol);
    let mut out = mol.clone();
    out.remove(&drop, &[]);
    let strip = |m: Molecule| m.without_hydrogens().or_else(|_| m.without_hydrogens_with_sanitize(false)).map_err(fail);
    if has_wedges(mol)
        && let Ok(stripped) = to_cosmol(mol).and_then(strip)
        && stripped.num_atoms() == out.atoms.len()
        && let Ok(fresh) = reread(&stripped, &out)
    {
        take_stereo(&mut out, &fresh);
    }
    out
}

/// Explicit-H 3D structure: ETKDGv3 conformer, MMFF94 (UFF fallback).
pub fn molfile_3d(mol: &Mol) -> Result<String, String> {
    const NO_3D: &str = "Could not build 3D coordinates for this structure";
    if mol.atoms.iter().any(|a| a.alias.is_some()) { return Err("Replace variable atoms before building 3D".into()); }
    if mol.is_empty() {
        return Err("Draw a structure first".into());
    }
    if !invalid_atoms(mol).is_empty() {
        return Err("Fix the highlighted atoms to build 3D".into());
    }
    let with_h = to_cosmol(mol)?.with_hydrogens().map_err(|_| NO_3D)?;
    let mut params = EmbedParameters::etkdg_v3();
    params.random_seed = 0x5eed;
    let embedded = with_h.with_3d_conformer_with_params(params).map_err(|_| NO_3D)?;
    if embedded.conformers_3d().is_empty() {
        return Err(NO_3D.into());
    }
    let optimized = match cosmolkit_core::mmff_optimize_molecule(&embedded, "MMFF94", 2000, 100.0, -1, true) {
        Ok(r) if r.needs_more >= 0 => r.molecule,
        _ => cosmolkit_core::uff_optimize_molecule(&embedded, 2000, 10.0, -1, true)
            .map(|r| r.molecule)
            .unwrap_or(embedded),
    };
    mol_to_v2000_3d_block(&optimized).map_err(|_| NO_3D.into())
}
