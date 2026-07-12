"""Unit tests for the kinetic (MSM/PCCA+) keyframe selection.

These need the optional ``deeptime`` package; the whole module is skipped when it
is not installed, so the default test run (numpy/scipy only) still passes.

    pip install deeptime pytest
    pytest ChimeraX-MDSmooth/tests/test_kinetic.py
"""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "mdsmooth_core"))

pytest.importorskip("deeptime")

import kinetic as kn  # noqa: E402


def _three_basin_2d(n=6000, seed=0):
    """A 2-D hopping trajectory between three basins along x = -3, 0, +3."""
    rng = np.random.default_rng(seed)
    centers = np.array([[-3.0, 0.0], [0.0, 0.0], [3.0, 0.0]])
    s = 1
    out = []
    states = []
    for _ in range(n):
        if rng.random() < 0.01:
            s = min(2, max(0, s + rng.choice([-1, 1])))
        out.append(centers[s] + 0.3 * rng.standard_normal(2))
        states.append(s)
    return np.array(out), np.array(states)


def test_kinetic_recovers_three_basins():
    data, _ = _three_basin_2d()
    result = kn.kinetic_keyframes(data, n_states=3, n_microstates=40, lag=10)
    assert result.n_states == 3
    assert result.frames.size == 3
    # The three representative frames should sit in the three different basins,
    # i.e. their x-coordinates are well separated and span the range.
    xs = np.sort(data[result.frames, 0])
    assert xs[0] < -1.5 and xs[-1] > 1.5           # spans both outer basins
    assert np.all(np.diff(xs) > 1.0)               # three distinct basins


def test_kinetic_states_ordered_into_a_smooth_tour():
    data, _ = _three_basin_2d()
    result = kn.kinetic_keyframes(data, n_states=3, n_microstates=40, lag=10)
    # Ordered by a nearest-neighbour path through tICA space, starting from the
    # most extreme state. For the three basins on a line that means the tour runs
    # end-to-end (-3 -> 0 -> +3), so the representatives are monotonic in x.
    xs = data[result.frames, 0]
    assert np.all(np.diff(xs) > 0)
    # Consecutive states are near neighbours: each hop is no bigger than the full
    # span (a crushed/jumping order would violate this on the 3-basin line).
    hops = np.abs(np.diff(xs))
    assert hops.max() <= (xs.max() - xs.min()) * 0.75


def test_kinetic_reproducible_with_seed():
    data, _ = _three_basin_2d()
    a = kn.kinetic_keyframes(data, n_states=3, n_microstates=40, lag=10, seed=1)
    b = kn.kinetic_keyframes(data, n_states=3, n_microstates=40, lag=10, seed=1)
    assert np.array_equal(a.frames, b.frames)


def test_kinetic_rejects_bad_args():
    data, _ = _three_basin_2d(n=500)
    with pytest.raises(ValueError):
        kn.kinetic_keyframes(data, n_states=1)          # need >= 2 states
    with pytest.raises(ValueError):
        kn.kinetic_keyframes(data, n_states=3, lag=0)   # lag out of range
    with pytest.raises(ValueError):
        kn.kinetic_keyframes(np.zeros(10), n_states=3)  # not 2-D


def test_kinetic_rejects_more_states_than_frames():
    # Asking for at least as many states as frames must fail with a clear error
    # up front, not crash inside k-means with more clusters than samples.
    data, _ = _three_basin_2d(n=30)
    with pytest.raises(ValueError):
        kn.kinetic_keyframes(data, n_states=50, lag=5)


def test_kinetic_feeds_from_tica_components():
    # End-to-end with the real signal front-end: a slow-under-fast trajectory,
    # reduced by tICA, then kinetically clustered.
    import filter as rf
    rng = np.random.default_rng(3)
    n_atoms, n = 20, 3000
    base = rng.standard_normal((n_atoms, 3))
    a = rng.standard_normal((n_atoms, 3)); a /= np.linalg.norm(a)
    # A slow two-state hop along direction a.
    s = 0
    amp = []
    for _ in range(n):
        if rng.random() < 0.01:
            s = 1 - s
        amp.append(s)
    amp = np.array(amp, dtype=float)
    frames = [base + amp[i] * 4.0 * a + 0.05 * rng.standard_normal((n_atoms, 3))
              for i in range(n)]
    comps = rf.tica_series(frames, lag=10, n_components=2)
    result = kn.kinetic_keyframes(comps, n_states=2, n_microstates=30, lag=10)
    assert result.frames.size == 2
    # The two representatives come from the two different amplitude states.
    assert abs(amp[result.frames[0]] - amp[result.frames[1]]) == 1.0
