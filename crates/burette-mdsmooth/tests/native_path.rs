//! The native path against values produced by `scripts/mdsmooth_runner.py`
//! (scipy and MDAnalysis) for the same synthetic trajectory.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

const FRAMES: usize = 60;
const ATOMS: usize = 8;

fn triangle(frame: usize, period: usize) -> usize {
    let phase = frame % period;
    if phase <= period / 2 {
        phase
    } else {
        period - phase
    }
}

/// Seven CA atoms breathing on two periods plus one water, in exact thousandths
/// of an angstrom so the text is the same wherever it is generated.
fn trajectory_pdb() -> String {
    let mut text = String::new();
    for frame in 0..FRAMES {
        writeln!(text, "MODEL     {:>4}", frame + 1).unwrap();
        for atom in 0..ATOMS {
            let x = atom * 3800
                + triangle(frame, 20) * atom * 150
                + ((frame * 31 + atom * 17) % 7) * 20;
            let y = (atom * atom * 700) % 5000 + triangle(frame, 14) * (8 - atom) * 90;
            let z = (atom * 1300) % 4100 + ((frame * 13 + atom * 5) % 11) * 15;
            let (record, name, residue) = if atom == 7 {
                ("HETATM", "O", "HOH")
            } else {
                ("ATOM  ", "CA", "ALA")
            };
            writeln!(
                text,
                "{record}{:>5}  {name:<3} {residue} A{:>4}    {:8.3}{:8.3}{:8.3}  1.00  0.00",
                atom + 1,
                atom + 1,
                x as f64 / 1000.0,
                y as f64 / 1000.0,
                z as f64 / 1000.0,
            )
            .unwrap();
        }
        text.push_str("ENDMDL\n");
    }
    text.push_str("END\n");
    text
}

fn workspace(name: &str) -> PathBuf {
    let directory =
        std::env::temp_dir().join(format!("burette-mdsmooth-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("traj.pdb"), trajectory_pdb()).unwrap();
    directory
}

fn run(request: Value) -> (Option<Value>, Vec<Value>) {
    let mut progress = Vec::new();
    let response = burette_mdsmooth::run(&request, &mut |payload| progress.push(payload)).unwrap();
    (response, progress)
}

/// X coordinates of one DCD frame: 92-byte header, 252-byte title and 12-byte
/// atom-count records, then a 56-byte cell record and three coordinate records
/// per frame.
fn frame_x(path: &Path, frame: usize) -> Vec<f32> {
    let bytes = std::fs::read(path).unwrap();
    let record = 8 + 4 * ATOMS;
    assert_eq!(bytes.len(), 356 + FRAMES * (56 + 3 * record));
    let start = 356 + frame * (56 + 3 * record) + 56 + 4;
    bytes[start..start + 4 * ATOMS]
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

#[test]
fn smooths_a_multi_model_pdb_like_the_python_runner() {
    let directory = workspace("pdb");
    let output = directory.join("out.dcd");
    let (response, progress) = run(json!({
        "trajectoryPath": directory.join("traj.pdb"),
        "outputPath": output,
        "cutoffFrequency": 0.08,
        "order": 3,
        "includeEnds": false,
    }));
    let response = response.expect("the default request is native");

    assert_eq!(response["keyframes"], json!([10, 20, 30, 40, 50]));
    assert_eq!(
        response["keyframeKinds"],
        json!(["max", "min", "max", "min", "max"])
    );
    assert_eq!(response["selectedAtomCount"], 7);
    assert_eq!(response["atomCount"], ATOMS);
    assert_eq!(response["frameCount"], FRAMES);
    for (signal, expected) in [
        ("rawSignal", [0.0, 0.28362222831301453, 0.5726102445312384]),
        (
            "filteredSignal",
            [
                -0.012968646528092133,
                0.3014584061724745,
                0.6217425078494523,
            ],
        ),
    ] {
        for (index, value) in expected.iter().enumerate() {
            let actual = response[signal][index].as_f64().unwrap();
            assert!(
                (actual - value).abs() < 1e-9,
                "{signal}[{index}] = {actual}, expected {value}"
            );
        }
    }
    assert_eq!(
        frame_x(&output, 0),
        [0.0, 3.86, 7.72, 11.44, 15.3, 19.02, 22.88, 26.6]
    );
    assert_eq!(
        frame_x(&output, 30),
        [-4.2566032, 0.8885617, 6.12326, 11.356265, 16.818573, 21.939781, 27.35016, 32.63915]
    );
    assert_eq!(progress.first().unwrap()["stage"], "read");
    assert_eq!(progress.last().unwrap()["stage"], "done");
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn picks_the_cutoff_for_a_target_frame_count() {
    let directory = workspace("target");
    let (response, _) = run(json!({
        "trajectoryPath": directory.join("traj.pdb"),
        "outputFormat": "dcd",
        "targetFrames": 8,
    }));
    let response = response.expect("the default request is native");

    assert_eq!(response["keyframes"], json!([0, 10, 20, 30, 40, 50, 59]));
    assert_eq!(
        response["keyframeKinds"],
        json!(["end", "max", "min", "max", "min", "max", "end"])
    );
    assert!(response["outputPath"]
        .as_str()
        .unwrap()
        .ends_with("traj.mdsmooth.dcd"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn leaves_other_requests_to_the_python_runner() {
    let directory = workspace("fallback");
    let trajectory = directory.join("traj.pdb");
    for request in [
        json!({ "trajectoryPath": trajectory, "outputFormat": "dcd", "signal": "pca" }),
        json!({ "trajectoryPath": trajectory, "outputFormat": "dcd", "mode": "kmeans" }),
        json!({ "trajectoryPath": trajectory, "outputFormat": "dcd", "selection": "name CA" }),
        json!({ "trajectoryPath": trajectory, "outputFormat": "dcd", "align": false }),
        json!({ "trajectoryPath": trajectory }),
        json!({ "trajectoryPath": directory.join("traj.xtc"), "topologyPath": trajectory }),
        json!({ "operation": "capabilities" }),
    ] {
        assert!(run(request.clone()).0.is_none(), "{request}");
    }
    assert!(!directory.join("traj.mdsmooth.dcd").exists());
    std::fs::remove_dir_all(directory).unwrap();
}
