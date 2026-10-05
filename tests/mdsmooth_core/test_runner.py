import importlib.util
from pathlib import Path

import numpy as np


RUNNER_PATH = Path(__file__).parents[2] / "scripts" / "mdsmooth_runner.py"
SPEC = importlib.util.spec_from_file_location("mdsmooth_runner", RUNNER_PATH)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def test_ic1_signal_reports_scalar_lag_robustness():
    time = np.linspace(0.0, 4.0 * np.pi, 80)
    frames = np.zeros((len(time), 4, 3), dtype=float)
    frames[:, 0, 0] = np.sin(time)
    frames[:, 1, 1] = np.cos(time * 0.4)
    frames[:, 2, 2] = np.sin(time * 0.2)
    frames[:, 3, 0] = np.cos(time * 0.7)

    values, diagnostics = runner.signal_series("ic1", frames, 0, 8, None, "")

    assert values.shape == (80,)
    assert isinstance(diagnostics["lagRobustness"], float)
    assert diagnostics["testedLags"] == [4, 8, 16]
    assert len(diagnostics["lagCorrelations"]) == 3


def test_paired_smoothing_keeps_topology_separate_and_writes_dcd(tmp_path):
    import MDAnalysis as mda

    universe = mda.Universe.empty(4, n_residues=2,
                                  atom_resindex=[0, 0, 1, 1], trajectory=True)
    universe.add_TopologyAttr("names", ["N", "CA", "N", "CA"])
    universe.add_TopologyAttr("resnames", ["ALA", "GLY"])
    universe.add_TopologyAttr("resids", [1, 2])
    universe.add_TopologyAttr("chainIDs", ["A"] * 4)
    universe.add_TopologyAttr("elements", ["N", "C", "N", "C"])
    frames = np.zeros((40, 4, 3), dtype=np.float32)
    frames[:, :, 0] = np.arange(4)
    frames[:, 3, 1] = np.sin(np.linspace(0, 3 * np.pi, 40))
    topology = tmp_path / "topology.pdb"
    coordinates = tmp_path / "coordinates.dcd"
    universe.atoms.positions = frames[0]
    universe.atoms.write(str(topology))
    runner.write_dcd(coordinates, universe, frames)
    result = runner.analyze({"trajectoryPath": str(coordinates),
                             "topologyPath": str(topology), "selection": "all",
                             "signal": "rmsd", "align": False, "targetFrames": 8})
    assert result["outputFormat"] == "dcd"
    restored = mda.Universe(str(topology), result["outputPath"])
    assert len(restored.trajectory) == 40
    assert restored.atoms.n_atoms == 4
    assert list(restored.residues.resnames) == ["ALA", "GLY"]
    np.testing.assert_allclose(restored.trajectory[0].positions, frames[0], atol=1e-5)
    np.testing.assert_allclose(restored.trajectory[-1].positions, frames[-1], atol=1e-5)


def test_single_file_input_can_write_dcd_over_its_first_model(tmp_path):
    import MDAnalysis as mda

    universe = mda.Universe.empty(4, n_residues=2,
                                  atom_resindex=[0, 0, 1, 1], trajectory=True)
    universe.add_TopologyAttr("names", ["N", "CA", "N", "CA"])
    universe.add_TopologyAttr("resnames", ["ALA", "GLY"])
    universe.add_TopologyAttr("resids", [1, 2])
    universe.add_TopologyAttr("chainIDs", ["A"] * 4)
    universe.add_TopologyAttr("elements", ["N", "C", "N", "C"])
    frames = np.zeros((40, 4, 3))
    frames[:, :, 0] = np.arange(4) * 1.5
    frames[:, 3, 1] = np.sin(np.linspace(0, 3 * np.pi, 40))
    source = tmp_path / "run.pdb"
    runner.write_pdb(source, universe, frames)
    result = runner.analyze({"trajectoryPath": str(source), "outputFormat": "dcd", "targetFrames": 8})
    assert result["outputFormat"] == "dcd"
    assert result["outputPath"] == str((tmp_path / "run.mdsmooth.dcd").resolve())
    assert result["atomCount"] == 4
    restored = mda.Universe(str(source), result["outputPath"])
    assert len(restored.trajectory) == 40
    restored.trajectory.close()


def test_partial_keys_preserve_uncovered_frames():
    frames = np.arange(90, dtype=float).reshape(10, 3, 3)
    result = runner.interpolate(frames, np.array([7, 2, 2]))
    np.testing.assert_array_equal(result[:3], frames[:3])
    np.testing.assert_array_equal(result[7:], frames[7:])
    assert np.isfinite(result).all()


def test_solvent_geometry_and_ions_survive_every_frame_and_alignment():
    import MDAnalysis as mda

    universe = mda.Universe.empty(7, n_residues=3,
                                  atom_resindex=[0, 0, 0, 1, 1, 1, 2], trajectory=True)
    universe.add_TopologyAttr('resnames', ['ALA', 'T3P', 'NA'])
    # Rigid water rotates substantially between keys: atomwise spline would
    # shrink the O-H bonds. Also verify a translating ion is not interpolated.
    base = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0],
                     [5, 0, 0], [5.9572, 0, 0], [4.760013, .926627, 0], [8, 0, 0]])
    frames = []
    for i in range(20):
        a = i * .31
        rotation = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        frame = base.copy()
        frame[3:6] = (base[3:6] - base[3]) @ rotation.T + base[3]
        frame[6, 2] = np.sin(i)
        frames.append(frame @ rotation.T + [i * .4, i * .2, 0])
    frames = np.array(frames)
    for align in [False, True]:
        aligned = runner.align_frames(frames, frames[:, :3], 0)[0] if align else frames
        result = runner.smooth_solute(universe, aligned, np.array([0, 9, 19]))
        np.testing.assert_array_equal(result[:, 3:], aligned[:, 3:])
        np.testing.assert_allclose(np.linalg.norm(result[:, 4] - result[:, 3], axis=1), .9572, atol=1e-6)
        np.testing.assert_allclose(result[[0, 9, 19]], aligned[[0, 9, 19]], atol=1e-12)


def test_dcd_preserves_changing_box_or_omits_rotated_box(tmp_path):
    import MDAnalysis as mda
    universe = mda.Universe.empty(2, trajectory=True)
    frames = np.zeros((3, 2, 3), dtype=np.float32)
    universe.load_new(frames)
    boxes = np.array([[10 + i, 20 + i, 30 + i, 90, 90, 90] for i in range(3)])
    for i, ts in enumerate(universe.trajectory):
        ts.dimensions = boxes[i]
    for aligned in [False, True]:
        path = tmp_path / f'box-{aligned}.dcd'
        runner.write_dcd(path, universe, frames, aligned=aligned)
        restored = mda.coordinates.DCD.DCDReader(str(path))
        for i, ts in enumerate(restored):
            if aligned:
                assert ts.dimensions is None
            else:
                np.testing.assert_allclose(ts.dimensions, boxes[i], atol=1e-5)
        restored.close()


def test_xyz_without_residues_still_smooths():
    import MDAnalysis as mda
    universe = mda.Universe.empty(3, trajectory=True)
    frames = np.arange(180, dtype=float).reshape(20, 3, 3)
    keys = np.array([0, 19])
    np.testing.assert_array_equal(runner.smooth_solute(universe, frames, keys), runner.interpolate(frames, keys))


def test_uneven_keys_have_continuous_velocity_in_frame_time():
    frames = np.zeros((41, 1, 3))
    frames[:, 0, 0] = np.sin(np.arange(41) * .2)
    output = runner.interpolate(frames, np.array([0, 8, 20, 40]))[:, 0, 0]
    for key in [8, 20]:
        left = np.polyfit(np.arange(key - 3, key + 1) - key, output[key-3:key+1], 3)
        right = np.polyfit(np.arange(key, key + 4) - key, output[key:key+4], 3)
        np.testing.assert_allclose(left[-2], right[-2], atol=1e-12)


def test_standard_dcd_time_agrees_with_molstar(tmp_path):
    import MDAnalysis as mda
    import subprocess
    universe = mda.Universe.empty(2, trajectory=True)
    path = tmp_path / 'independent-writer.dcd'
    with mda.coordinates.DCD.DCDWriter(str(path), n_atoms=2, dt=2.5, nsavc=3, istart=12) as writer:
        for _ in range(3):
            universe.atoms.positions = np.zeros((2, 3))
            writer.write(universe.atoms)
    reader = mda.coordinates.DCD.DCDReader(str(path))
    np.testing.assert_allclose([ts.time for ts in reader], [10, 12.5, 15], atol=1e-5)
    reader.close()
    subprocess.run(['bun', str(RUNNER_PATH.parent.parent / 'tests/test-dcd-time.mjs'), str(path)], check=True)


def test_fast_text_writers_match_the_per_atom_reference(tmp_path):
    import MDAnalysis as mda

    universe = mda.Universe.empty(6, n_residues=3, n_segments=2, atom_resindex=[0, 0, 1, 1, 2, 2],
                                  residue_segindex=[0, 0, 1], trajectory=True)
    universe.add_TopologyAttr("names", ["N", "CA", "N", "CA", "O", "H1"])
    universe.add_TopologyAttr("resnames", ["ALA", "GLY", "HOH"])
    universe.add_TopologyAttr("resids", [1, 2, 3])
    universe.add_TopologyAttr("chainIDs", ["A"] * 4 + ["B"] * 2)
    universe.add_TopologyAttr("elements", ["N", "C", "N", "C", "O", "H"])
    # Values that round differently in float32 and float64, and negative ones.
    frames = np.random.default_rng(7).uniform(-900.0, 9000.0, (5, 6, 3))
    runner.write_pdb(tmp_path / "fast.pdb", universe, frames)
    runner.write_pdb_reference(tmp_path / "reference.pdb", universe, frames)
    assert (tmp_path / "fast.pdb").read_text() == (tmp_path / "reference.pdb").read_text()
    assert len(mda.Universe(str(tmp_path / "fast.pdb")).trajectory) == 5

    runner.write_xyz(tmp_path / "fast.xyz", universe, frames)
    expected = "".join(
        f"6\nBurette MDSmooth frame {index + 1}\n" + "".join(
            f"{element} {x:.6f} {y:.6f} {z:.6f}\n" for element, (x, y, z) in zip("NCNCOH", frame))
        for index, frame in enumerate(frames))
    assert (tmp_path / "fast.xyz").read_text() == expected

    # A coordinate too wide for the fixed columns still fails as it always did.
    frames[2, 1, 0] = 123456.0
    try:
        runner.write_pdb(tmp_path / "wide.pdb", universe, frames)
    except ValueError:
        pass
    else:
        raise AssertionError("out-of-range PDB coordinates must be rejected")
