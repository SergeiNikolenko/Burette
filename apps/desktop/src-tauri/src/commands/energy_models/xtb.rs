//! xTB as an energy model: each evaluation runs `xtb input.xyz --grad` in the
//! session's private folder and reads the ORCA-style `input.engrad` it writes
//! (atom count, energy in Eh, gradient in Eh/bohr). The folder keeps
//! `xtbrestart` and the GFN-FF topology between evaluations, so later SCF and
//! force-field set-up start from the previous geometry.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use burette_core::bounded_process::{run_cancellable, Limits};
use serde::Deserialize;

use super::{Evaluation, CANCELLED};

/// CODATA 2018: kcal/mol per hartree and Å per bohr.
const HARTREE_KCAL_MOL: f64 = 627.509_474_063_1;
const BOHR_ANGSTROM: f64 = 0.529_177_210_903;
const EVALUATION_SECONDS: u64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum XtbMethod {
    Gfn2,
    Gfn1,
    Gfnff,
}

impl XtbMethod {
    pub(crate) const ALL: [Self; 3] = [Self::Gfn2, Self::Gfn1, Self::Gfnff];

    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Gfn2 => "gfn2",
            Self::Gfn1 => "gfn1",
            Self::Gfnff => "gfnff",
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Gfn2 => "GFN2-xTB",
            Self::Gfn1 => "GFN1-xTB",
            Self::Gfnff => "GFN-FF",
        }
    }

    fn arguments(self) -> &'static [&'static str] {
        match self {
            Self::Gfn2 => &["--gfn", "2"],
            Self::Gfn1 => &["--gfn", "1"],
            Self::Gfnff => &["--gfnff"],
        }
    }
}

pub(crate) struct XtbSession {
    executable: PathBuf,
    dir: PathBuf,
    method: XtbMethod,
    elements: Vec<String>,
    charge: i32,
    unpaired: u32,
}

impl Drop for XtbSession {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

impl XtbSession {
    pub(crate) fn new(
        executable: PathBuf,
        method: XtbMethod,
        elements: Vec<String>,
        charge: i32,
        multiplicity: u32,
    ) -> Result<Self, String> {
        use std::os::unix::fs::DirBuilderExt;
        let dir = std::env::temp_dir().join(format!("burette-xtb-energy-{}", uuid::Uuid::new_v4()));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&dir)
            .map_err(|error| format!("The xTB folder could not be created: {error}"))?;
        Ok(Self {
            executable,
            dir,
            method,
            elements,
            charge,
            unpaired: multiplicity - 1,
        })
    }

    pub(crate) fn evaluate(
        &mut self,
        coordinates: &[f64],
        cancel: &AtomicBool,
    ) -> Result<Evaluation, String> {
        let mut xyz = format!("{}\nBurette energy model\n", self.elements.len());
        for (element, p) in self.elements.iter().zip(coordinates.chunks(3)) {
            xyz.push_str(&format!("{element} {:?} {:?} {:?}\n", p[0], p[1], p[2]));
        }
        let input = self.dir.join("input.xyz");
        let engrad = self.dir.join("input.engrad");
        let _ = fs::remove_file(&engrad);
        fs::write(&input, xyz)
            .map_err(|error| format!("xTB input could not be written: {error}"))?;
        let mut command = Command::new(&self.executable);
        command
            .arg("input.xyz")
            .args(self.method.arguments())
            .args([
                "--grad",
                "--chrg",
                &self.charge.to_string(),
                "--uhf",
                &self.unpaired.to_string(),
            ])
            .current_dir(&self.dir)
            .env("OMP_NUM_THREADS", "1")
            .env("NO_COLOR", "1");
        let output = run_cancellable(
            &mut command,
            b"",
            Limits {
                stdout_bytes: 16 * 1024 * 1024,
                stderr_bytes: 1024 * 1024,
                deadline: Instant::now() + Duration::from_secs(EVALUATION_SECONDS),
            },
            cancel,
        )
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::Interrupted => CANCELLED.to_string(),
            std::io::ErrorKind::TimedOut => "xTB did not finish in time".to_string(),
            _ => format!("xTB failed: {error}"),
        })?;
        if !output.status.success() {
            return Err(failure(&output.stdout, &output.stderr));
        }
        read_engrad(&engrad, self.elements.len())
    }
}

fn failure(stdout: &[u8], stderr: &[u8]) -> String {
    let text = [
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr),
    ]
    .concat();
    let errors: Vec<_> = text
        .lines()
        .filter(|line| {
            line.contains("[ERROR]") || line.contains("error") || line.contains("abnormal")
        })
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(6)
        .collect();
    if errors.is_empty() {
        "xTB failed".to_string()
    } else {
        format!("xTB failed:\n{}", errors.join("\n"))
    }
}

fn read_engrad(path: &Path, atoms: usize) -> Result<Evaluation, String> {
    let unreadable = || "xTB wrote no readable gradient".to_string();
    let text = fs::read_to_string(path).map_err(|_| unreadable())?;
    parse_engrad(&text, atoms).ok_or_else(unreadable)
}

/// ORCA `.engrad`: `#` comment lines around the atom count, the energy (Eh)
/// and 3N gradient components (Eh/bohr), then coordinates that are ignored.
fn parse_engrad(text: &str, atoms: usize) -> Option<Evaluation> {
    let mut numbers = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'));
    if numbers.next()?.parse::<usize>().ok()? != atoms {
        return None;
    }
    let energy: f64 = numbers.next()?.parse().ok()?;
    let gradient: Vec<f64> = numbers
        .by_ref()
        .take(3 * atoms)
        .map(|line| {
            line.parse::<f64>()
                .map(|g| g * HARTREE_KCAL_MOL / BOHR_ANGSTROM)
        })
        .collect::<Result<_, _>>()
        .ok()?;
    (gradient.len() == 3 * atoms).then_some(Evaluation {
        energy: energy * HARTREE_KCAL_MOL,
        gradient: Some(gradient),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Recorded from xtb 6.7.1 (`xtb input.xyz --gfn 2 --grad`) for water.
    const WATER_ENGRAD: &str = "#\n# Number of atoms\n#\n         3\n#\n# The current total energy in Eh\n#\n     -5.070370761845\n#\n# The current gradient in Eh/bohr\n#\n      -0.000000000000\n       0.000000000000\n       0.002940222116\n       0.000000000000\n      -0.004426281290\n      -0.001470111058\n       0.000000000000\n       0.004426281290\n      -0.001470111058\n#\n# The atomic numbers and current coordinates in Bohr\n#\n   8     0.0000000    0.0000000    0.2216649\n   1     0.0000000    1.4309006   -0.8866595\n   1     0.0000000   -1.4309006   -0.8866595\n";
    const WATER: [f64; 9] = [
        0.0, 0.0, 0.1173, 0.0, 0.7572, -0.4692, 0.0, -0.7572, -0.4692,
    ];

    #[test]
    fn engrad_energies_and_gradients_become_kcal_per_mol_and_angstrom() {
        let parsed = parse_engrad(WATER_ENGRAD, 3).unwrap();
        assert!((parsed.energy - -3181.70569).abs() < 1e-5);
        let gradient = parsed.gradient.unwrap();
        // 0.002940222116 Eh/bohr = 3.4866 kcal/(mol·Å).
        assert!((gradient[2] - 3.486_577).abs() < 1e-5);
        assert!((gradient[4] + gradient[7]).abs() < 1e-12);
        assert!(parse_engrad(WATER_ENGRAD, 4).is_none());
        assert!(parse_engrad("3\n-5.0\n0\n0\n", 3).is_none());
    }

    fn installed_xtb() -> Option<PathBuf> {
        let home = PathBuf::from(std::env::var_os("HOME")?);
        [
            home.join(".pixi/bin/xtb"),
            PathBuf::from("/opt/homebrew/bin/xtb"),
        ]
        .into_iter()
        .find(|path| path.is_file())
    }

    /// Runs only where an xtb executable is installed.
    #[test]
    fn real_xtb_matches_the_recorded_water_gradient_and_keeps_its_folder_private() {
        let Some(executable) = installed_xtb() else {
            eprintln!("skipped: no xtb executable");
            return;
        };
        let mut session = XtbSession::new(
            executable,
            XtbMethod::Gfn2,
            vec!["O".into(), "H".into(), "H".into()],
            0,
            1,
        )
        .unwrap();
        let dir = session.dir.clone();
        let first = session.evaluate(&WATER, &AtomicBool::new(false)).unwrap();
        let recorded = parse_engrad(WATER_ENGRAD, 3).unwrap();
        assert!((first.energy - recorded.energy).abs() < 1e-6);
        for (a, b) in first
            .gradient
            .unwrap()
            .iter()
            .zip(recorded.gradient.unwrap())
        {
            assert!((a - b).abs() < 1e-4, "{a} vs {b}");
        }
        // Moving an H along +y changes the energy and the next run reads fresh output.
        let mut moved = WATER;
        moved[4] += 0.05;
        let second = session.evaluate(&moved, &AtomicBool::new(false)).unwrap();
        assert!(second.energy != first.energy);
        assert_eq!(
            session
                .evaluate(&moved, &AtomicBool::new(true))
                .unwrap_err(),
            CANCELLED
        );
        let mut ff = XtbSession::new(
            installed_xtb().unwrap(),
            XtbMethod::Gfnff,
            vec!["O".into(), "H".into(), "H".into()],
            0,
            1,
        )
        .unwrap();
        assert!(ff
            .evaluate(&WATER, &AtomicBool::new(false))
            .unwrap()
            .energy
            .is_finite());
        drop(session);
        assert!(!dir.exists());
    }
}
