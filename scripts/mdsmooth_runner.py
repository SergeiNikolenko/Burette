#!/usr/bin/env python3
"""ChimeraX-independent trajectory analysis runner for Burette.

Reads one JSON request from stdin and writes one JSON response to stdout. The
runner deliberately keeps MDAnalysis I/O outside the upstream-derived numerical
core in ``scripts/mdsmooth_core``. Progress goes to stderr as
``PROGRESS_PREFIX`` lines so callers can stream it while stdout stays one JSON.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "mdsmooth_core"))

import filter as core_filter  # noqa: E402
import kinetic as core_kinetic  # noqa: E402
import learned as core_learned  # noqa: E402


PRESERVED_SELECTION = "resname HOH WAT SOL TIP3 TIP4 TIP5 TIP3P TIP4P TIP5P T3P T4P T5P NA CL K MG CA ZN"
DEFAULT_SELECTION = f"not ({PRESERVED_SELECTION})"
SIGNALS = ("rmsd", "pc1", "ic1", "dpca", "deeptica")
PROGRESS_PREFIX = "@burette-progress "
# Overall fraction where each stage starts; frame loops advance inside it.
PROGRESS_STAGES = {"read": 0.0, "analyze": 0.35, "smooth": 0.6, "write": 0.7, "done": 0.97}
_last_progress = None


def report_progress(stage: str, done: int = 0, total: int = 0):
    """Emit at most one line per 0.5% so long trajectories stay cheap."""
    global _last_progress
    names = list(PROGRESS_STAGES)
    start = PROGRESS_STAGES[stage]
    end = PROGRESS_STAGES[names[names.index(stage) + 1]] if stage != "done" else start
    fraction = start + (end - start) * (done / total if total else 0)
    key = (stage, round(fraction * 200))
    if key == _last_progress:
        return
    _last_progress = key
    payload = {"stage": stage, "fraction": round(fraction, 4)}
    if total:
        payload.update(done=done, total=total)
    sys.stderr.write(PROGRESS_PREFIX + json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def load_universe(topology: str | None, trajectory: str):
    try:
        import MDAnalysis as mda
    except ImportError as exc:
        raise RuntimeError("MDAnalysis is required for trajectory loading.") from exc
    if topology and Path(topology).resolve() != Path(trajectory).resolve():
        return mda.Universe(topology, trajectory)
    return mda.Universe(trajectory)


def read_frames(universe, selection: str):
    try:
        selected = universe.select_atoms(selection or DEFAULT_SELECTION)
    except (AttributeError, ValueError):
        if selection and selection != DEFAULT_SELECTION:
            raise
        selected = universe.atoms
    if selected.n_atoms == 0:
        raise ValueError(f"Atom selection matched no atoms: {selection!r}")
    all_frames, selected_frames = [], []
    total = len(universe.trajectory)
    for index, _ in enumerate(universe.trajectory):
        report_progress("read", index + 1, total)
        all_frames.append(universe.atoms.positions.astype(float, copy=True))
        selected_frames.append(selected.positions.astype(float, copy=True))
    if len(all_frames) < 2:
        raise ValueError("MDSmooth requires at least two trajectory frames.")
    return np.asarray(all_frames), np.asarray(selected_frames), selected


def alignment_transform(mobile: np.ndarray, reference: np.ndarray):
    mobile_center = mobile.mean(axis=0)
    reference_center = reference.mean(axis=0)
    covariance = (mobile - mobile_center).T @ (reference - reference_center)
    u, _, vt = np.linalg.svd(covariance)
    sign = np.sign(np.linalg.det(vt.T @ u.T))
    rotation = vt.T @ np.diag([1.0, 1.0, sign]) @ u.T
    return mobile_center, reference_center, rotation


def align_frames(all_frames: np.ndarray, selected_frames: np.ndarray, reference_index: int):
    reference = selected_frames[reference_index]
    aligned_all, aligned_selected = [], []
    for full, selected in zip(all_frames, selected_frames):
        mobile_center, reference_center, rotation = alignment_transform(selected, reference)
        aligned_selected.append((selected - mobile_center) @ rotation.T + reference_center)
        aligned_all.append((full - mobile_center) @ rotation.T + reference_center)
    return np.asarray(aligned_all), np.asarray(aligned_selected)


def rmsd_signal(frames: np.ndarray, reference_index: int):
    reference = frames[reference_index]
    return np.sqrt(np.mean(np.sum((frames - reference) ** 2, axis=2), axis=1))


def dpca_signal(universe, selection: str):
    try:
        from MDAnalysis.analysis.dihedrals import Ramachandran
    except ImportError as exc:
        raise RuntimeError("MDAnalysis dihedral analysis is unavailable.") from exc
    atoms = universe.select_atoms(selection or "protein")
    if not atoms.residues:
        raise ValueError("dPCA requires a protein backbone selection.")
    angles = Ramachandran(atoms).run().results.angles
    if angles.ndim != 3 or angles.shape[1] == 0:
        raise ValueError("No backbone phi/psi angles are available for dPCA.")
    return core_filter.dihedral_pca_series(np.deg2rad(angles.reshape(angles.shape[0], -1)))[:, 0]


def signal_series(signal: str, selected_frames: np.ndarray, reference_index: int, lag: int, universe, selection: str):
    if signal == "rmsd":
        return rmsd_signal(selected_frames, reference_index), {}
    if signal == "pc1":
        return core_filter.principal_component_series(selected_frames, reference_index=reference_index)[:, 0], {}
    if signal == "ic1":
        values = core_filter.tica_series(selected_frames, lag=lag, reference_index=reference_index)[:, 0]
        tested_lags, correlations, robustness = core_filter.tica_lag_robustness(
            selected_frames, lag=lag, reference_index=reference_index
        )
        return values, {
            "lagRobustness": float(robustness),
            "testedLags": [int(value) for value in tested_lags],
            "lagCorrelations": [float(value) for value in correlations],
        }
    if signal == "dpca":
        return dpca_signal(universe, selection), {}
    if signal == "deeptica":
        features = core_filter.reduced_coordinates(selected_frames, reference_index=reference_index)
        values, agreement = core_learned.run_deeptica(features, lag=lag)
        return values, {"seedAgreement": float(agreement)}
    raise ValueError(f"Unsupported signal {signal!r}; choose one of {', '.join(SIGNALS)}")


def interpolate(frames: np.ndarray, keyframes: np.ndarray):
    """Rebuild the trajectory from its keyframes with a Catmull-Rom spline.

    Straight lines between keyframes meet at an angle, so velocity flips direction
    at every one of them and the playback reads as a series of jerks -- the fewer
    keyframes a preset keeps, the more often that happens. A Catmull-Rom spline
    still passes exactly through each keyframe but arrives and leaves along the
    same tangent, so the motion carries through them.
    """
    # includeEnds=False and kinetic selection need not include the boundaries.
    # Keep uncovered frames exactly, never expose uninitialised coordinates.
    output = frames.copy()
    keys = np.unique(np.asarray(keyframes, dtype=int))
    if np.any(keys < 0) or np.any(keys >= len(frames)):
        raise ValueError("Interpolation keyframe is outside the trajectory.")
    if len(keys) < 2:
        return frames.copy()
    anchors = frames[keys]
    last = len(keys) - 1
    for index, (start, end) in enumerate(zip(keys[:-1], keys[1:])):
        count = int(end - start)
        # The segment's own ends, plus the neighbours that set the tangents. At the
        # trajectory's ends there is no neighbour, so the end point stands in for it
        # and the spline simply eases out of the first frame and into the last.
        p0 = anchors[max(0, index - 1)]
        p1 = anchors[index]
        p2 = anchors[index + 1]
        p3 = anchors[min(last, index + 2)]
        t0 = keys[index - 1] if index else start - count
        t3 = keys[index + 2] if index + 2 <= last else end + count
        # Keys are not evenly spaced. Scale shared derivatives by each segment's
        # duration; a uniform Catmull-Rom polynomial creates velocity jumps at
        # unequal intervals even though it looks smooth in parameter space.
        m1 = (p2 - p0) * count / (end - t0)
        m2 = (p3 - p1) * count / (t3 - start)
        for offset in range(count + 1):
            t = 0.0 if count == 0 else offset / count
            t2 = t * t
            t3 = t2 * t
            output[start + offset] = ((2*t3 - 3*t2 + 1)*p1
                                      + (t3 - 2*t2 + t)*m1
                                      + (-2*t3 + 3*t2)*p2
                                      + (t3 - t2)*m2)
    return output


def smooth_solute(universe, aligned_frames: np.ndarray, keyframes: np.ndarray):
    """Spline the solute only; solvent/ions retain each aligned source frame.

    This is a visualisation, not an MD integrator or a constrained trajectory.
    The signal atom selection determines keyframes, not which atoms move.
    """
    try:
        mobile = universe.select_atoms(DEFAULT_SELECTION).indices
    except (AttributeError, ValueError):
        # XYZ has no residue identities; retain its established all-atom path.
        mobile = np.arange(aligned_frames.shape[1])
    result = aligned_frames.copy()
    result[:, mobile] = interpolate(aligned_frames[:, mobile], keyframes)
    return result


def has_residue_topology(universe) -> bool:
    """Whether the universe knows more than element and position.

    XYZ carries neither residues nor chains, so a viewer given one can only draw
    atoms and bonds. When the run started from a real topology that information is
    already loaded here, and writing it back out is what lets the viewer recognise
    a protein and draw it as a ribbon.
    """
    try:
        return len(universe.residues) > 1 and hasattr(universe.atoms, "resnames")
    except (AttributeError, TypeError, ValueError):
        return False


def write_pdb_reference(path: Path, universe, frames: np.ndarray):
    import MDAnalysis as mda

    with mda.Writer(str(path), n_atoms=universe.atoms.n_atoms, multiframe=True) as writer:
        for index, frame in enumerate(frames):
            report_progress("write", index + 1, len(frames))
            universe.atoms.positions = frame
            writer.write(universe.atoms)


def pdb_model_template(path: Path, universe, frame: np.ndarray):
    """Split MDAnalysis' own one-model output into header, body format, trailer.

    Only the coordinate columns (31-54) differ between models, so the body keeps
    every other column verbatim and takes the coordinates through one ``%``.
    Returns None when the output is not the single MODEL block this relies on.
    """
    import MDAnalysis as mda

    with mda.Writer(str(path), n_atoms=universe.atoms.n_atoms, multiframe=True) as writer:
        universe.atoms.positions = frame
        writer.write(universe.atoms)
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    starts = [index for index, line in enumerate(lines) if line.startswith("MODEL")]
    ends = [index for index, line in enumerate(lines) if line.startswith("ENDMDL")]
    if len(starts) != 1 or len(ends) != 1 or starts[0] > ends[0]:
        return None
    body, atoms = [], 0
    for line in lines[starts[0] + 1:ends[0]]:
        if line.startswith(("ATOM", "HETATM")):
            atoms += 1
            body.append(line[:30].replace("%", "%%") + "%8.3f%8.3f%8.3f" + line[54:].replace("%", "%%"))
        else:
            body.append(line.replace("%", "%%"))
    if atoms != universe.atoms.n_atoms:
        return None
    return "".join(lines[:starts[0]]), "".join(body), "".join(lines[ends[0] + 1:])


def write_pdb(path: Path, universe, frames: np.ndarray):
    """Write a multi-model PDB with one format call per model.

    MDAnalysis formats every column of every atom on every model, which is most
    of a run's time. It still writes the first model, as the template, and all
    models whenever a coordinate would not fit the fixed PDB columns.
    """
    # float32 is what MDAnalysis stores and prints, so the text stays identical.
    frames32 = np.asarray(frames, dtype=np.float32)
    fits = frames32.size and -999.9995 <= frames32.min() and frames32.max() < 9999.9995
    template = pdb_model_template(path, universe, frames32[0]) if fits and len(frames32) < 10000 else None
    if template is None:
        write_pdb_reference(path, universe, frames)
        return
    header, body, trailer = template
    with path.open("w", encoding="utf-8") as handle:
        handle.write(header)
        for index, frame in enumerate(frames32):
            report_progress("write", index + 1, len(frames32))
            handle.write(f"MODEL     {index + 1:>4d}\n")
            handle.write(body % tuple(frame.ravel().tolist()))
            handle.write("ENDMDL\n")
        handle.write(trailer)


def write_dcd(path: Path, universe, frames: np.ndarray, *, aligned=False):
    """Keep paired MD output as coordinates, not repeated PDB topology."""
    import MDAnalysis as mda

    with mda.Writer(str(path), n_atoms=universe.atoms.n_atoms,
                    dt=float(universe.trajectory.dt)) as writer:
        for index, frame in enumerate(frames):
            report_progress("write", index + 1, len(frames))
            # Reading a frame restores its own box, rather than repeating the
            # last box on every frame. A rotated box basis cannot be encoded by
            # DCD lengths/angles: aligned output is explicitly non-periodic,
            # so it has no box to restore and skips the re-read.
            if aligned:
                universe.dimensions = None
            elif index < len(universe.trajectory):
                universe.trajectory[index]
            universe.atoms.positions = frame
            writer.write(universe.atoms)


def write_xyz(path: Path, universe, frames: np.ndarray):
    elements = []
    for atom in universe.atoms:
        element = str(getattr(atom, "element", "") or "").strip()
        if not element:
            element = "".join(ch for ch in str(atom.name) if ch.isalpha())[:2].title() or "X"
        elements.append(element)
    # One format call per frame instead of one per atom.
    body = "".join(element.replace("%", "%%") + " %.6f %.6f %.6f\n" for element in elements)
    with path.open("w", encoding="utf-8") as handle:
        for index, frame in enumerate(frames):
            report_progress("write", index + 1, len(frames))
            handle.write(f"{len(elements)}\nBurette MDSmooth frame {index + 1}\n")
            handle.write(body % tuple(np.asarray(frame, dtype=float).ravel().tolist()))


def spectrum_payload(raw: np.ndarray):
    frequencies, power, cumulative = core_filter.power_spectrum(raw)
    return {
        "frequencies": frequencies.tolist(),
        "power": power.tolist(),
        "cumulativePower": cumulative.tolist(),
    }


def analyze(request: dict):
    trajectory = str(request.get("trajectoryPath") or "").strip()
    if not trajectory:
        raise ValueError("trajectoryPath is required.")
    topology = str(request.get("topologyPath") or "").strip() or None
    signal = str(request.get("signal") or "rmsd").lower()
    mode = str(request.get("mode") or "extrema").lower()
    selection = str(request.get("selection") or DEFAULT_SELECTION)
    lag = max(1, int(request.get("lag") or 10))
    report_progress("read")
    universe = load_universe(topology, trajectory)
    all_frames, selected_frames, selected = read_frames(universe, selection)
    reference_index = max(0, min(len(all_frames) - 1, int(request.get("referenceFrame") or 1) - 1))
    if request.get("align") is False:
        aligned_all, aligned_selected = all_frames, selected_frames
    else:
        aligned_all, aligned_selected = align_frames(all_frames, selected_frames, reference_index)

    report_progress("analyze")
    if mode == "kinetic":
        dimensions = max(1, int(request.get("ticaDimensions") or 3))
        components = core_filter.tica_series(aligned_selected, lag=lag, n_components=dimensions, reference_index=reference_index)
        kinetic = core_kinetic.kinetic_keyframes(
            components,
            n_states=max(2, int(request.get("states") or 5)),
            n_microstates=max(2, int(request.get("microstates") or 100)),
            lag=lag,
        )
        keyframes = np.asarray(kinetic.frames, dtype=int)
        raw = components[:, 0]
        filtered = raw.copy()
        diagnostics = {"mode": "kinetic", "stateCount": int(kinetic.n_states)}
        cutoff = None
        kinds = ["state"] * len(keyframes)
    else:
        raw, diagnostics = signal_series(signal, aligned_selected, reference_index, lag, universe, selection)
        kwargs = {
            "order": max(1, int(request.get("order") or 5)),
            "include_ends": request.get("includeEnds") is not False,
            "extra_frames": [max(0, int(value) - 1) for value in request.get("extraFrames", [])],
        }
        if request.get("cutoffFrequency") is not None:
            kwargs["cutoff_frequency"] = float(request["cutoffFrequency"])
        elif request.get("powerCutoff") is not None:
            kwargs["power_fraction"] = float(request["powerCutoff"])
        else:
            kwargs["target_frames"] = max(2, int(request.get("targetFrames") or 50))
        filtered_result = core_filter.filter_rmsd(raw, **kwargs)
        keyframes = filtered_result.frames
        filtered = filtered_result.filtered
        cutoff = float(filtered_result.cutoff_frequency)
        kinds = filtered_result.kinds
        diagnostics.update({
            "mode": "extrema",
            "cosineContent": float(filtered_result.cosine_content),
            "cosineContentHigh": bool(filtered_result.cosine_content_high),
        })

    report_progress("smooth")
    smoothed = smooth_solute(universe, aligned_all, np.sort(keyframes))
    keeps_topology = has_residue_topology(universe)
    paired_coordinates = bool(topology and Path(topology).resolve() != Path(trajectory).resolve())
    output_format = "dcd" if paired_coordinates else "pdb" if keeps_topology else "xyz"
    requested_output = str(request.get("outputPath") or "").strip()
    # A caller that already holds the topology (the viewer keeps the first model
    # of a single-file trajectory) can ask for coordinates only.
    requested_format = str(request.get("outputFormat") or "").strip().lower()
    if requested_output:
        requested_format = Path(requested_output).suffix.lower().lstrip(".")
    if requested_format:
        output_format = requested_format
        if output_format not in {"pdb", "xyz", "dcd"}:
            raise ValueError("Smoothing output must be PDB, XYZ or DCD.")
    output_path = Path(requested_output) if requested_output else Path(trajectory).with_name(
        f"{Path(trajectory).stem}.mdsmooth.{output_format}"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "dcd":
        write_dcd(output_path, universe, smoothed, aligned=request.get("align") is not False)
    elif output_format == "pdb":
        write_pdb(output_path, universe, smoothed)
    else:
        write_xyz(output_path, universe, smoothed)
    report_progress("done")
    return {
        "ok": True,
        "trajectoryPath": str(Path(trajectory).resolve()),
        "topologyPath": str(Path(topology).resolve()) if topology else None,
        "outputPath": str(output_path.resolve()),
        "outputFormat": output_format,
        "signal": signal,
        "selection": selection,
        "selectedAtomCount": int(selected.n_atoms),
        "atomCount": int(all_frames.shape[1]),
        "frameCount": int(len(all_frames)),
        "keyframes": [int(frame) for frame in keyframes],
        "keyframeKinds": list(kinds),
        "rawSignal": np.asarray(raw).tolist(),
        "filteredSignal": np.asarray(filtered).tolist(),
        "cutoffFrequency": cutoff,
        "spectrum": spectrum_payload(np.asarray(raw)),
        "diagnostics": diagnostics,
        "interpolation": "catmull-rom",
        "coordinatePolicy": "solute-spline; solvent-and-ions-per-source-frame",
        "periodicCellPolicy": "omitted-after-alignment" if request.get("align") is not False else "source-per-frame",
    }


def capabilities():
    try:
        import MDAnalysis as mda
        formats = sorted(set(mda._PARSERS) | set(mda._READERS))
    except Exception:
        formats = []
    return {
        "ok": True,
        "signals": list(SIGNALS),
        "modes": ["extrema", "kinetic"],
        "formats": formats,
        "deepTicaInstalled": core_learned.venv_ready(),
    }


def install_deeptica(request):
    python_path = core_learned.create_venv(index_url=request.get("indexUrl"))
    return {"ok": True, "deepTicaInstalled": True, "pythonPath": python_path}


def main():
    try:
        request = json.load(sys.stdin)
        operation = str(request.get("operation") or "analyze")
        if operation == "capabilities":
            result = capabilities()
        elif operation == "installDeepTica":
            result = install_deeptica(request)
        else:
            result = analyze(request)
    except Exception as exc:
        result = {"ok": False, "error": str(exc), "errorType": type(exc).__name__}
    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
