#!/usr/bin/env python3
"""ChimeraX-independent trajectory analysis runner for Burrete.

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
        robustness = core_filter.tica_lag_robustness(selected_frames, lag=lag, reference_index=reference_index)
        return values, {"lagRobustness": float(robustness)}
    if signal == "dpca":
        return dpca_signal(universe, selection), {}
    if signal == "deeptica":
        features = core_filter.reduced_coordinates(selected_frames, reference_index=reference_index)
        values, agreement = core_learned.run_deeptica(features, lag=lag)
        return values, {"seedAgreement": float(agreement)}
    raise ValueError(f"Unsupported signal {signal!r}; choose one of {', '.join(SIGNALS)}")


def interpolate(frames: np.ndarray, keyframes: np.ndarray):
    output = np.empty_like(frames)
    for start, end in zip(keyframes[:-1], keyframes[1:]):
        count = int(end - start)
        for offset in range(count + 1):
            fraction = 0.0 if count == 0 else offset / count
            output[start + offset] = frames[start] + (frames[end] - frames[start]) * fraction
    return output


def write_xyz(path: Path, universe, frames: np.ndarray):
    elements = []
    for atom in universe.atoms:
        element = str(getattr(atom, "element", "") or "").strip()
        if not element:
            element = "".join(ch for ch in str(atom.name) if ch.isalpha())[:2].title() or "X"
        elements.append(element)
    with path.open("w", encoding="utf-8") as handle:
        for index, frame in enumerate(frames):
            handle.write(f"{len(elements)}\nBurrete MDSmooth frame {index + 1}\n")
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

    output_path = Path(request.get("outputPath") or Path(trajectory).with_name(f"{Path(trajectory).stem}.mdsmooth.xyz"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_xyz(output_path, universe, interpolate(aligned_all, np.sort(keyframes)))
    return {
        "ok": True,
        "trajectoryPath": str(Path(trajectory).resolve()),
        "topologyPath": str(Path(topology).resolve()) if topology else None,
        "outputPath": str(output_path.resolve()),
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
        "interpolation": "linear",
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
