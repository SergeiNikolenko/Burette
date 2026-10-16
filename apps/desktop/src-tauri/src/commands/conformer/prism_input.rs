//! PRISM Pruner reads only a multi-frame XYZ file. With `-e` it also takes a
//! decimal energy from every comment line and crashes (StopIteration) when one
//! is missing. Burette hands it SDF records and XYZ ensembles from any source,
//! so the ensemble is normalized to `input.xyz` here and energy sorting is
//! requested only when every conformer carries an energy.

use std::fs;
use std::path::{Path, PathBuf};

pub(super) struct PrismInput {
    pub(super) path: PathBuf,
    pub(super) has_energies: bool,
}

struct Frame {
    atoms: Vec<(String, [f64; 3])>,
    energy: Option<f64>,
}

pub(super) fn prepare_prism_input(
    input_text: &str,
    extension: &str,
    work_dir: &Path,
) -> Result<PrismInput, String> {
    let frames = match extension
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "xyz" => parse_xyz_frames(input_text)?,
        "sdf" | "sd" | "mol" => parse_sdf_frames(input_text)?,
        other => {
            return Err(format!(
            "PRISM Prune reads XYZ or SDF conformer ensembles; .{other} files are not supported."
        ))
        }
    };
    if frames.len() < 2 {
        return Err(format!(
            "PRISM Prune needs an ensemble of at least two conformers; this input has {}. Generate conformers first (for example with CREST), then prune the ensemble.",
            frames.len()
        ));
    }
    let first = &frames[0].atoms;
    if frames.iter().any(|frame| {
        frame.atoms.len() != first.len()
            || frame
                .atoms
                .iter()
                .zip(first)
                .any(|((element, _), (expected, _))| !element.eq_ignore_ascii_case(expected))
    }) {
        return Err(
            "PRISM Prune needs conformers of one molecule: every frame must list the same atoms in the same order.".into(),
        );
    }
    let has_energies = frames.iter().all(|frame| frame.energy.is_some());
    let mut xyz = String::new();
    for frame in &frames {
        xyz.push_str(&format!("{}\n", frame.atoms.len()));
        if let Some(energy) = frame.energy.filter(|_| has_energies) {
            xyz.push_str(&format!("{energy:.10}"));
        }
        xyz.push('\n');
        for (element, [x, y, z]) in &frame.atoms {
            xyz.push_str(&format!("{element} {x:.8} {y:.8} {z:.8}\n"));
        }
    }
    let path = work_dir.join("input.xyz");
    fs::write(&path, xyz).map_err(|err| format!("{}: {err}", path.display()))?;
    Ok(PrismInput { path, has_energies })
}

fn leading_energy(comment: &str) -> Option<f64> {
    comment
        .split_whitespace()
        .next()
        .and_then(|token| token.parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

fn parse_xyz_frames(text: &str) -> Result<Vec<Frame>, String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut frames = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        if lines[index].trim().is_empty() {
            index += 1;
            continue;
        }
        let count: usize = lines[index]
            .trim()
            .parse()
            .map_err(|_| format!("XYZ frame {} has no atom count line.", frames.len() + 1))?;
        let comment = lines.get(index + 1).copied().unwrap_or_default();
        let atom_lines = lines
            .get(index + 2..index + 2 + count)
            .ok_or_else(|| format!("XYZ frame {} is truncated.", frames.len() + 1))?;
        let atoms = atom_lines
            .iter()
            .map(|line| {
                let mut fields = line.split_whitespace();
                let element = fields.next().unwrap_or_default().to_string();
                let coords: Vec<f64> = fields
                    .take(3)
                    .filter_map(|value| value.parse().ok())
                    .collect();
                match coords.as_slice() {
                    [x, y, z] if !element.is_empty() => Ok((element, [*x, *y, *z])),
                    _ => Err(format!(
                        "XYZ frame {} has an unreadable atom line.",
                        frames.len() + 1
                    )),
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        frames.push(Frame {
            atoms,
            energy: leading_energy(comment),
        });
        index += count + 2;
    }
    Ok(frames)
}

fn parse_sdf_frames(text: &str) -> Result<Vec<Frame>, String> {
    let normalized = text.replace("\r\n", "\n");
    normalized
        .split("$$$$")
        .filter(|record| record.lines().any(|line| !line.trim().is_empty()))
        .enumerate()
        .map(|(index, record)| parse_sdf_record(record.trim_start_matches('\n'), index + 1))
        .collect()
}

fn parse_sdf_record(record: &str, number: usize) -> Result<Frame, String> {
    let lines: Vec<&str> = record.lines().collect();
    let counts = lines
        .get(3)
        .ok_or_else(|| format!("SDF record {number} has no counts line."))?;
    let atoms = if counts.contains("V3000") {
        parse_v3000_atoms(&lines)
    } else {
        let count: usize = counts
            .get(0..3)
            .unwrap_or(counts)
            .trim()
            .parse()
            .map_err(|_| format!("SDF record {number} has an unreadable counts line."))?;
        lines
            .get(4..4 + count)
            .ok_or_else(|| format!("SDF record {number} is truncated."))?
            .iter()
            .map(|line| {
                let fields: Vec<&str> = line.split_whitespace().collect();
                match fields.as_slice() {
                    [x, y, z, element, ..] => Some((
                        element.to_string(),
                        [x.parse().ok()?, y.parse().ok()?, z.parse().ok()?],
                    )),
                    _ => None,
                }
            })
            .collect::<Option<Vec<_>>>()
    }
    .ok_or_else(|| format!("SDF record {number} has an unreadable atom block."))?;
    Ok(Frame {
        atoms,
        energy: sdf_energy(&lines),
    })
}

fn parse_v3000_atoms(lines: &[&str]) -> Option<Vec<(String, [f64; 3])>> {
    let start = lines
        .iter()
        .position(|line| line.trim() == "M  V30 BEGIN ATOM")?;
    lines[start + 1..]
        .iter()
        .take_while(|line| line.trim() != "M  V30 END ATOM")
        .map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            match fields.as_slice() {
                ["M", "V30", _, element, x, y, z, ..] => Some((
                    element.to_string(),
                    [x.parse().ok()?, y.parse().ok()?, z.parse().ok()?],
                )),
                _ => None,
            }
        })
        .collect()
}

/// The first data item whose name mentions energy, as written by CREST, xTB
/// and RDKit pipelines (`> <energy>`, `> <Energy (Eh)>`, `> <E>`).
fn sdf_energy(lines: &[&str]) -> Option<f64> {
    lines.iter().enumerate().find_map(|(index, line)| {
        let name = line.trim().strip_prefix('>')?;
        let name = name
            .split('<')
            .nth(1)?
            .split('>')
            .next()?
            .trim()
            .to_ascii_lowercase();
        if name != "e" && !name.contains("energy") {
            return None;
        }
        leading_energy(lines.get(index + 1)?)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("burette-prism-input-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const MOLFILE: &str = "water\n  RDKit          3D\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.1000 O   0  0\n    0.7500    0.0000   -0.4000 H   0  0\n   -0.7500    0.0000   -0.4000 H   0  0\n  1  2  1  0\n  1  3  1  0\nM  END\n";

    #[test]
    fn sdf_ensemble_becomes_xyz_with_energies_only_when_every_record_has_one() {
        let dir = temp_dir();
        let with_energies =
            format!("{MOLFILE}> <energy>\n-5.07\n\n$$$$\n{MOLFILE}> <energy>\n-5.01\n\n$$$$\n");
        let input = prepare_prism_input(&with_energies, "sdf", &dir).unwrap();
        assert!(input.has_energies);
        let xyz = fs::read_to_string(&input.path).unwrap();
        assert_eq!(
            xyz.lines().take(3).collect::<Vec<_>>(),
            ["3", "-5.0700000000", "O 0.00000000 0.00000000 0.10000000"]
        );

        let without = format!("{MOLFILE}$$$$\n{MOLFILE}> <energy>\n-5.01\n\n$$$$\n");
        let input = prepare_prism_input(&without, "sdf", &dir).unwrap();
        assert!(!input.has_energies);
        assert_eq!(
            fs::read_to_string(&input.path).unwrap().lines().nth(1),
            Some("")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn single_structures_and_mixed_molecules_are_rejected_with_a_reason() {
        let dir = temp_dir();
        let single = prepare_prism_input(&format!("{MOLFILE}$$$$\n"), "sdf", &dir)
            .err()
            .unwrap();
        assert!(single.contains("at least two conformers"), "{single}");
        let mixed = "1\n-1.0\nC 0 0 0\n1\n-2.0\nN 0 0 0\n";
        let mixed = prepare_prism_input(mixed, "xyz", &dir).err().unwrap();
        assert!(mixed.contains("same atoms"), "{mixed}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn crest_xyz_energies_are_kept() {
        let dir = temp_dir();
        let crest =
            "2\n  -10.12345678\nH 0 0 0\nH 0 0 0.74\n2\n  -10.10000000\nH 0 0 0\nH 0 0 0.75\n";
        let input = prepare_prism_input(crest, "xyz", &dir).unwrap();
        assert!(input.has_energies);
        fs::remove_dir_all(dir).unwrap();
    }
}
