#!/usr/bin/env python3
"""ChimeraX-independent trajectory analysis runner for Burette.

Reads one JSON request from stdin and writes one JSON response to stdout. The
runner deliberately keeps MDAnalysis I/O outside the upstream-derived numerical
core in ``scripts/mdsmooth_core``.
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


DEFAULT_SELECTION = "not (resname HOH WAT SOL TIP3 TIP4 NA CL K MG CA ZN)"
SIGNALS = ("rmsd", "pc1", "ic1", "dpca", "deeptica")


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
    for _ in universe.trajectory:
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
    output = np.empty_like(frames)
    keys = np.asarray(keyframes, dtype=int)
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
        for offset in range(count + 1):
            t = 0.0 if count == 0 else offset / count
            t2 = t * t
            t3 = t2 * t
            output[start + offset] = 0.5 * (
                2.0 * p1
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
    return output


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


def write_pdb(path: Path, universe, frames: np.ndarray):
    import MDAnalysis as mda

    with mda.Writer(str(path), n_atoms=universe.atoms.n_atoms, multiframe=True) as writer:
        for frame in frames:
            universe.atoms.positions = frame
            writer.write(universe.atoms)


def write_xyz(path: Path, universe, frames: np.ndarray):
    elements = []
    for atom in universe.atoms:
        element = str(getattr(atom, "element", "") or "").strip()
        if not element:
            element = "".join(ch for ch in str(atom.name) if ch.isalpha())[:2].title() or "X"
        elements.append(element)
    with path.open("w", encoding="utf-8") as handle:
        for index, frame in enumerate(frames):
            handle.write(f"{len(elements)}\nBurette MDSmooth frame {index + 1}\n")
            for element, (x, y, z) in zip(elements, frame):
                handle.write(f"{element} {x:.6f} {y:.6f} {z:.6f}\n")


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
    universe = load_universe(topology, trajectory)
    all_frames, selected_frames, selected = read_frames(universe, selection)
    reference_index = max(0, min(len(all_frames) - 1, int(request.get("referenceFrame") or 1) - 1))
    if request.get("align") is False:
        aligned_all, aligned_selected = all_frames, selected_frames
    else:
        aligned_all, aligned_selected = align_frames(all_frames, selected_frames, reference_index)

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

    smoothed = interpolate(aligned_all, np.sort(keyframes))
    keeps_topology = has_residue_topology(universe)
    output_format = "pdb" if keeps_topology else "xyz"
    requested_output = str(request.get("outputPath") or "").strip()
    output_path = Path(requested_output) if requested_output else Path(trajectory).with_name(
        f"{Path(trajectory).stem}.mdsmooth.{output_format}"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if keeps_topology:
        write_pdb(output_path, universe, smoothed)
    else:
        write_xyz(output_path, universe, smoothed)
    return {
        "ok": True,
        "trajectoryPath": str(Path(trajectory).resolve()),
        "topologyPath": str(Path(topology).resolve()) if topology else None,
        "outputPath": str(output_path.resolve()),
        "outputFormat": output_format,
        "signal": signal,
        "selection": selection,
        "selectedAtomCount": int(selected.n_atoms),
        "frameCount": int(len(all_frames)),
        "keyframes": [int(frame) for frame in keyframes],
        "keyframeKinds": list(kinds),
        "rawSignal": np.asarray(raw).tolist(),
        "filteredSignal": np.asarray(filtered).tolist(),
        "cutoffFrequency": cutoff,
        "spectrum": spectrum_payload(np.asarray(raw)),
        "diagnostics": diagnostics,
        "interpolation": "catmull-rom",
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
