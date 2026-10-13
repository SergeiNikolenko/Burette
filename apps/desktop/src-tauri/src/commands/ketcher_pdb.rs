use std::process::Command;
use std::time::Duration;

#[tauri::command]
pub(crate) async fn prepare_ketcher_pdb(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(&text))
        .await
        .map_err(|error| error.to_string())?
}

fn convert(text: &str) -> Result<String, String> {
    let atoms = text
        .lines()
        .filter(|line| line.starts_with("ATOM  ") || line.starts_with("HETATM"))
        .count();
    if text.len() > 512 * 1024 || !(1..=300).contains(&atoms) {
        return Err("Select a molecule with 1–300 atoms.".into());
    }
    let executable = super::conformer::resolve_executable("obabel")
        .ok_or("Install Open Babel to reconstruct bonds from PDB, or open the original SDF.")?;
    let output = super::conformer_process::run(
        Command::new(executable).args(["-ipdb", "-osdf"]),
        text.as_bytes(),
        Duration::from_secs(15),
    )
    .map_err(|_| "Could not reconstruct molecule bonds. Open the original SDF.")?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if !output.status.success()
        || ["failed", "error", "cannot", "could not"]
            .iter()
            .any(|word| stderr.contains(word))
        || output.stdout.len() > 1024 * 1024
    {
        return Err("Could not reconstruct molecule bonds. Open the original SDF.".into());
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "Molecule conversion returned invalid text.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires Open Babel installed on the test host"]
    fn reconstructs_carbonyl_without_flattening_coordinates() {
        let pdb = "HETATM    1  C   LIG L   1       0.000   0.000   2.000  1.00  0.00           C\nHETATM    2  O   LIG L   1       1.220   0.000   2.000  1.00  0.00           O\nEND\n";
        let sdf = convert(pdb).expect("PDB conversion");
        let lines: Vec<_> = sdf.lines().collect();
        assert_eq!(&lines[3][..6], "  2  1");
        assert_eq!(&lines[4][..30], "    0.0000    0.0000    2.0000");
        assert_eq!(&lines[5][..30], "    1.2200    0.0000    2.0000");
        assert_eq!(&lines[6][..9], "  1  2  2");
    }

    #[test]
    fn rejects_empty_and_oversized_inputs_before_starting_a_process() {
        assert!(convert("END\n").is_err());
        assert!(convert(&"HETATM\n".repeat(301)).is_err());
        assert!(convert(&" ".repeat(512 * 1024 + 1)).is_err());
    }
}
