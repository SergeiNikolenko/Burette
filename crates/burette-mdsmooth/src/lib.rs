//! Native default path of Burette's trajectory smoothing.
//!
//! Handles the request the Info dock sends by default: the RMSD signal, key
//! frames at its extrema, and DCD output, for a multi-model PDB, an XYZ file, or
//! a PDB topology paired with a DCD trajectory. It answers with the same JSON as
//! `scripts/mdsmooth_runner.py`, which stays the reference and still serves
//! every other signal, mode, selection and file format: [`run`] returns
//! `Ok(None)` for those so the caller can start the Python runner instead.

mod filter;
mod geometry;
mod io;

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use filter::Cutoff;

/// The runner's default selection; a request naming any other one is not handled here.
const DEFAULT_SELECTION: &str =
    "not (resname HOH WAT SOL TIP3 TIP4 TIP5 TIP3P TIP4P TIP5P T3P T4P T5P NA CL K MG CA ZN)";
/// Overall fraction where each stage starts, as in the runner.
const STAGES: [(&str, f64); 5] = [
    ("read", 0.0),
    ("analyze", 0.35),
    ("smooth", 0.6),
    ("write", 0.7),
    ("done", 0.97),
];

#[derive(Clone, Copy, PartialEq)]
enum Source {
    Pdb,
    Xyz,
    /// A DCD trajectory over a separate PDB topology.
    PairedDcd,
}

struct Plan {
    source: Source,
    trajectory: PathBuf,
    topology: Option<PathBuf>,
    output: PathBuf,
    reference_frame: usize,
    align: bool,
    cutoff: Cutoff,
    order: usize,
    include_ends: bool,
    extra_frames: Vec<usize>,
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn text<'a>(request: &'a Value, key: &str) -> &'a str {
    request
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
}

/// A JSON number as the runner reads it: `int(value or default)`.
fn integer(request: &Value, key: &str, default: i64) -> i64 {
    match request.get(key).and_then(Value::as_f64) {
        Some(value) if value != 0.0 => value as i64,
        _ => default,
    }
}

impl Plan {
    /// `None` when the request needs something only the Python runner has.
    fn from_request(request: &Value) -> Option<Plan> {
        let operation = text(request, "operation");
        let signal = text(request, "signal");
        let mode = text(request, "mode");
        let selection = text(request, "selection");
        if !(operation.is_empty() || operation == "analyze")
            || !(signal.is_empty() || signal.eq_ignore_ascii_case("rmsd"))
            || !(mode.is_empty() || mode.eq_ignore_ascii_case("extrema"))
            || !(selection.is_empty() || selection == DEFAULT_SELECTION)
        {
            return None;
        }
        let trajectory = PathBuf::from(text(request, "trajectoryPath"));
        let topology = Some(text(request, "topologyPath"))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.canonicalize().ok() != trajectory.canonicalize().ok());
        let align = request.get("align").and_then(Value::as_bool) != Some(false);
        let source = match (extension(&trajectory).as_str(), &topology) {
            // An unaligned PDB keeps its CRYST1 box, which only the runner writes.
            ("pdb" | "ent", None) if align => Source::Pdb,
            ("xyz", None) => Source::Xyz,
            ("dcd", Some(topology)) if matches!(extension(topology).as_str(), "pdb" | "ent") => {
                Source::PairedDcd
            }
            _ => return None,
        };
        let requested_output = text(request, "outputPath");
        let output = if !requested_output.is_empty() {
            PathBuf::from(requested_output)
        } else if source == Source::PairedDcd
            || text(request, "outputFormat").eq_ignore_ascii_case("dcd")
        {
            let stem = trajectory.file_stem()?.to_str()?;
            trajectory.with_file_name(format!("{stem}.mdsmooth.dcd"))
        } else {
            return None;
        };
        if extension(&output) != "dcd" {
            return None;
        }
        let number = |key: &str| request.get(key).and_then(Value::as_f64);
        let cutoff = if let Some(frequency) = number("cutoffFrequency") {
            Cutoff::Frequency(frequency)
        } else if let Some(fraction) = number("powerCutoff") {
            Cutoff::PowerFraction(fraction)
        } else {
            Cutoff::TargetFrames(integer(request, "targetFrames", 50).max(2) as usize)
        };
        let extra_frames = request
            .get("extraFrames")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_f64)
                    .map(|value| (value as i64 - 1).max(0) as usize)
                    .collect()
            })
            .unwrap_or_default();
        Some(Plan {
            source,
            trajectory,
            topology,
            output,
            reference_frame: (integer(request, "referenceFrame", 1) - 1).max(0) as usize,
            align,
            cutoff,
            order: integer(request, "order", 5).max(1) as usize,
            include_ends: request.get("includeEnds").and_then(Value::as_bool) != Some(false),
            extra_frames,
        })
    }
}

/// Reports stage progress in the runner's shape, at most once per 0.5%.
struct Reporter<'a> {
    sink: &'a mut dyn FnMut(Value),
    last: Option<(usize, i64)>,
}

impl Reporter<'_> {
    fn report(&mut self, stage: usize, done: usize, total: usize) {
        let start = STAGES[stage].1;
        let end = STAGES.get(stage + 1).map_or(start, |next| next.1);
        let fraction = start
            + (end - start)
                * if total > 0 {
                    done as f64 / total as f64
                } else {
                    0.0
                };
        let key = (stage, (fraction * 200.0).round() as i64);
        if self.last == Some(key) {
            return;
        }
        self.last = Some(key);
        let mut payload =
            json!({ "stage": STAGES[stage].0, "fraction": (fraction * 1e4).round() / 1e4 });
        if total > 0 {
            payload["done"] = json!(done);
            payload["total"] = json!(total);
        }
        (self.sink)(payload);
    }
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))
}

fn resolved(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Run a smoothing request natively.
///
/// Returns `Ok(None)` when the request is outside the native path, and `Err`
/// when a supported request cannot be completed. `on_progress` receives the
/// same payloads the Python runner writes after its progress prefix.
pub fn run(request: &Value, on_progress: &mut dyn FnMut(Value)) -> Result<Option<Value>, String> {
    let Some(plan) = Plan::from_request(request) else {
        return Ok(None);
    };
    let mut reporter = Reporter {
        sink: on_progress,
        last: None,
    };
    reporter.report(0, 0, 0);
    let bytes = read(&plan.trajectory)?;
    let mut on_read = |done: usize, total: usize| reporter.report(0, done, total);
    let (mut trajectory, mobile) = match plan.source {
        Source::Pdb => {
            let trajectory = io::read_pdb(&bytes, &mut on_read)?;
            (trajectory, io::pdb_mobile_atoms(&bytes).0)
        }
        Source::Xyz => {
            let trajectory = io::read_xyz(&bytes, &mut on_read)?;
            let atoms = (0..trajectory.atom_count).collect();
            (trajectory, atoms)
        }
        Source::PairedDcd => {
            let trajectory = io::read_dcd(&bytes, &mut on_read)?;
            let topology = read(plan.topology.as_deref().unwrap_or(&plan.trajectory))?;
            let (mobile, atom_count) = io::pdb_mobile_atoms(&topology);
            if atom_count != trajectory.atom_count {
                return Err("The topology and the trajectory have different atom counts.".into());
            }
            (trajectory, mobile)
        }
    };
    drop(bytes);
    let frame_count = trajectory.frames.len();
    if frame_count < 2 {
        return Err("MDSmooth requires at least two trajectory frames.".into());
    }
    if mobile.is_empty() {
        return Err(format!(
            "Atom selection matched no atoms: {DEFAULT_SELECTION:?}"
        ));
    }
    let reference = plan.reference_frame.min(frame_count - 1);
    if plan.align {
        geometry::align_frames(&mut trajectory.frames, &mobile, reference);
    }

    reporter.report(1, 0, 0);
    let raw = geometry::rmsd_signal(&trajectory.frames, &mobile, reference);
    let spectrum = filter::power_spectrum(&raw)?;
    let filtered = filter::filter_signal(
        &raw,
        &spectrum,
        plan.cutoff,
        plan.order,
        plan.include_ends,
        &plan.extra_frames,
    )?;

    reporter.report(2, 0, 0);
    geometry::interpolate(&mut trajectory.frames, &mobile, &filtered.frames);
    if let Some(parent) = plan.output.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    // A rotated box basis cannot be encoded by DCD lengths and angles, so
    // aligned output carries no box; unaligned output keeps each source box.
    let cells = if plan.align {
        None
    } else {
        trajectory.cells.as_deref()
    };
    io::write_dcd(&plan.output, &trajectory, cells, &mut |done, total| {
        reporter.report(3, done, total)
    })?;
    reporter.report(4, 0, 0);

    Ok(Some(json!({
        "ok": true,
        "trajectoryPath": resolved(&plan.trajectory),
        "topologyPath": plan.topology.as_deref().map(resolved),
        "outputPath": resolved(&plan.output),
        "outputFormat": "dcd",
        "signal": "rmsd",
        "selection": DEFAULT_SELECTION,
        "selectedAtomCount": mobile.len(),
        "atomCount": trajectory.atom_count,
        "frameCount": frame_count,
        "keyframes": filtered.frames,
        "keyframeKinds": filtered.kinds,
        "rawSignal": raw,
        "filteredSignal": filtered.filtered,
        "cutoffFrequency": filtered.cutoff_frequency,
        "spectrum": {
            "frequencies": spectrum.frequencies,
            "power": spectrum.power,
            "cumulativePower": spectrum.cumulative,
        },
        "diagnostics": {
            "mode": "extrema",
            "cosineContent": filtered.cosine_content,
            "cosineContentHigh": filtered.cosine_content_high(),
        },
        "interpolation": "catmull-rom",
        "coordinatePolicy": "solute-spline; solvent-and-ions-per-source-frame",
        "periodicCellPolicy": if plan.align { "omitted-after-alignment" } else { "source-per-frame" },
    })))
}
