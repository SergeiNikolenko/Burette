use super::{MolfileLayout, ParsedMolfile};

impl ParsedMolfile {
    pub(crate) fn validate_energy_input(&self) -> Result<(), String> {
        self.validate_spatial_input()?;
        // The evaluator consumes nuclei, not a chemical graph. Never silently
        // treat implicit hydrogens as absent nuclei. This is a conservative
        // closed-shell input domain, not a replacement for RDKit sanitization.
        // Reference: RDKit Book, "Valence calculation and allowed valences".
        if self
            .lines
            .iter()
            .any(|line| line.starts_with("M  RAD") || line.contains("RAD="))
        {
            return Err("Radical input is not supported by the closed-shell evaluator".into());
        }
        let mut valences = vec![0_u32; self.atoms.len()];
        for bond in &self.bonds {
            if !(1..=3).contains(&bond.order) {
                return Err("Use a prepared molecule with explicit hydrogens and Kekule bonds for energy calculation".into());
            }
            valences[bond.left] += u32::from(bond.order);
            valences[bond.right] += u32::from(bond.order);
        }
        for (index, ((symbol, charge), valence)) in self
            .symbols
            .iter()
            .zip(&self.formal_charges)
            .zip(valences)
            .enumerate()
        {
            let allowed: &[u32] = match (symbol.as_str(), *charge) {
                ("H", 0) | ("F" | "Cl" | "Br", 0) => &[1],
                ("H" | "F" | "Cl" | "Br" | "I", -1) | ("H", 1) => &[0],
                ("B", 0) | ("C", -1 | 1) | ("N", 0) | ("O", 1) => &[3],
                ("B", -1) | ("C" | "Si", 0) | ("N", 1) => &[4],
                ("N", -1) | ("O", 0) => &[2],
                ("O", -1) => &[1],
                ("P" | "As", 0) => &[3, 5],
                ("S" | "Se", 0) => &[2, 4, 6],
                ("P" | "As", -2) | ("S" | "Se", -1) | ("I", 0) => &[1, 3, 5],
                _ => return Err(format!("Explicit-valence preparation for {symbol} (charge {charge}) is not supported yet")),
            };
            if !allowed.contains(&valence) {
                return Err(format!("Atom {} ({symbol}) has incomplete or unsupported explicit valence; generate 3D with explicit hydrogens before calculating energy", index + 1));
            }
        }
        match &self.layout {
            MolfileLayout::V2000 { atom_start } => {
                for line in &self.lines[*atom_start..*atom_start + self.atoms.len()] {
                    // V2000 charge code 4 encodes a radical; H-count codes >1
                    // request hydrogens not necessarily present in the atom list.
                    if line.get(36..39).unwrap_or("").trim() == "4"
                        || line
                            .get(42..45)
                            .unwrap_or("")
                            .trim()
                            .parse::<u32>()
                            .unwrap_or(0)
                            > 1
                    {
                        return Err("Expand hydrogen counts and remove unsupported radicals before calculating energy".into());
                    }
                }
            }
            MolfileLayout::V3000 { atom_lines } => {
                if atom_lines.iter().any(|&i| {
                    self.lines[i].split_whitespace().any(|token| {
                        token
                            .strip_prefix("HCOUNT=")
                            .is_some_and(|count| count != "0" && count != "-1")
                    })
                }) {
                    return Err(
                        "Expand hydrogen counts into explicit atoms before calculating energy"
                            .into(),
                    );
                }
            }
        }
        Ok(())
    }

    pub(crate) fn validate_spatial_input(&self) -> Result<(), String> {
        super::super::molfile_coordinates::require_spatial_input_header(
            self.lines.get(1).map(String::as_str).unwrap_or(""),
        )?;
        if self
            .atoms
            .iter()
            .any(|atom| atom.position.iter().any(|v| !v.is_finite()))
        {
            return Err("Molecular coordinates must be finite".into());
        }
        // A planar molecule is valid; zero z-coordinates alone do not mean 2D.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::parse_molfile;

    fn molecule(atoms: &[&str], bonds: &[(usize, usize, u8)]) -> String {
        let mut text = format!(
            "test\n  Burette          3D\n\n{:3}{:3}  0  0  0  0            999 V2000\n",
            atoms.len(),
            bonds.len()
        );
        for (i, symbol) in atoms.iter().enumerate() {
            text.push_str(&format!(
                "{:10.4}{:10.4}{:10.4} {:<3} 0  0  0  0  0  0  0  0  0  0  0  0\n",
                i as f32, 0.0, 0.0, symbol
            ));
        }
        for (a, b, order) in bonds {
            text.push_str(&format!("{a:3}{b:3}{order:3}  0  0  0  0\n"));
        }
        text.push_str("M  END\n");
        text
    }

    #[test]
    fn rejects_missing_nuclei_drawings_and_radicals_but_accepts_complete_planar_molecules() {
        let water = molecule(&["O", "H", "H"], &[(1, 2, 1), (1, 3, 1)]);
        for text in [
            water.clone(),
            molecule(&["C", "O", "O"], &[(1, 2, 2), (1, 3, 2)]),
            molecule(
                &["C", "Cl", "Cl", "Cl", "Cl"],
                &[(1, 2, 1), (1, 3, 1), (1, 4, 1), (1, 5, 1)],
            ),
        ] {
            parse_molfile(&text)
                .unwrap()
                .validate_energy_input()
                .unwrap();
        }
        for text in [
            molecule(&["C", "C"], &[(1, 2, 1)]),
            water.replace("3D", "2D"),
            water.replace("M  END", "M  RAD  1   1   2\nM  END"),
        ] {
            assert!(parse_molfile(&text)
                .unwrap()
                .validate_energy_input()
                .is_err());
        }
    }
    #[test]
    fn validates_explicit_atom_metadata_in_both_molfile_versions() {
        let water = molecule(&["O", "H", "H"], &[(1, 2, 1), (1, 3, 1)]);
        for (start, value) in [(36, "  4"), (42, "  2"), (0, "       NaN")] {
            let mut lines = water.lines().map(str::to_owned).collect::<Vec<_>>();
            lines[4].replace_range(start..start + value.len(), value);
            assert!(parse_molfile(&lines.join("\n"))
                .unwrap()
                .validate_energy_input()
                .is_err());
        }
        let v3000 = "water\n  Burette          3D\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 3 2 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 O 0 0 0 0\nM  V30 2 H 1 0 0 0\nM  V30 3 H 0 1 0 0\nM  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 1 1 1 2\nM  V30 2 1 1 3\nM  V30 END BOND\nM  V30 END CTAB\nM  END\n";
        for suffix in ["", " HCOUNT=0", " HCOUNT=-1"] {
            parse_molfile(&v3000.replace("1 O 0 0 0 0", &format!("1 O 0 0 0 0{suffix}")))
                .unwrap()
                .validate_energy_input()
                .unwrap();
        }
        for suffix in [" HCOUNT=2", " RAD=2"] {
            assert!(
                parse_molfile(&v3000.replace("1 O 0 0 0 0", &format!("1 O 0 0 0 0{suffix}")))
                    .unwrap()
                    .validate_energy_input()
                    .is_err()
            );
        }
    }
}
