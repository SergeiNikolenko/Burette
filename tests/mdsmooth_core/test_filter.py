"""Unit tests for the pure-Python MDSmoothing core.

These run without ChimeraX -- only numpy and scipy are needed:

    pip install numpy scipy pytest
    pytest ChimeraX-MDSmooth/tests
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "mdsmooth_core"))

import filter as rf  # noqa: E402


def _synthetic_rmsd(n=1600, seed=0):
    """A slow drifting signal (the 'real' motion) plus fast noise."""
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 1, n)
    slow = 1.5 + 0.6 * np.sin(2 * np.pi * 3 * t) + 0.4 * np.sin(2 * np.pi * 7 * t)
    noise = 0.15 * rng.standard_normal(n)
    return slow + noise, slow


def test_cutoff_is_within_band():
    rmsd, _ = _synthetic_rmsd()
    cutoff = rf.choose_cutoff_frequency(rmsd, sampling_rate=1.0, power_fraction=0.979)
    assert 0.0 < cutoff < 0.5  # strictly inside (0, Nyquist)


def test_filter_reduces_noise():
    rmsd, slow = _synthetic_rmsd()
    result = rf.filter_rmsd(rmsd)
    # Filtered series should track the underlying slow signal better than raw.
    assert np.std(result.filtered - slow) < np.std(rmsd - slow)
    assert result.filtered.shape == rmsd.shape


def test_significant_frames_include_ends():
    rmsd, _ = _synthetic_rmsd()
    result = rf.filter_rmsd(rmsd, include_ends=True)
    assert result.frames[0] == 0
    assert result.frames[-1] == len(rmsd) - 1
    assert result.kinds[0] == "end"
    assert result.kinds[-1] == "end"


def test_steps_reconstruct_frame_positions():
    rmsd, _ = _synthetic_rmsd()
    result = rf.filter_rmsd(rmsd)
    # steps[0] == 0, and a running sum of steps reproduces the frame indices
    # relative to the first frame -- this is what keeps morph timing correct.
    assert result.steps[0] == 0
    reconstructed = result.frames[0] + np.cumsum(result.steps)
    assert np.array_equal(reconstructed, result.frames)


def test_frames_sorted_and_unique():
    rmsd, _ = _synthetic_rmsd()
    result = rf.filter_rmsd(rmsd)
    assert np.all(np.diff(result.frames) > 0)


def test_explicit_cutoff_gives_fewer_frames():
    rmsd, _ = _synthetic_rmsd()
    auto = rf.filter_rmsd(rmsd)
    tight = rf.filter_rmsd(rmsd, cutoff_frequency=0.01)
    # A lower manual cutoff smooths harder -> no more extrema than the auto pick.
    assert len(tight.frames) <= len(auto.frames)


def test_default_is_a_frame_target():
    rmsd, _ = _synthetic_rmsd()
    result = rf.filter_rmsd(rmsd)
    # With no cutoff given at all, the filter defaults to a frame target (not the
    # old power-fraction), and records which target it solved for.
    assert result.target_frames == rf.DEFAULT_TARGET_FRAMES
    assert abs(len(result.frames) - rf.DEFAULT_TARGET_FRAMES) <= 6


def test_target_frames_lands_close():
    rmsd, _ = _synthetic_rmsd()
    for target in (12, 25, 40, 80):
        result = rf.filter_rmsd(rmsd, target_frames=target)
        assert result.target_frames == target
        # Frame count is an integer step function of the cutoff, so allow a
        # small tolerance rather than demanding an exact hit.
        assert abs(len(result.frames) - target) <= max(4, int(0.15 * target))


def test_more_frames_requested_gives_at_least_as_many():
    rmsd, _ = _synthetic_rmsd()
    few = rf.filter_rmsd(rmsd, target_frames=20)
    many = rf.filter_rmsd(rmsd, target_frames=80)
    assert len(many.frames) >= len(few.frames)


def test_huge_target_is_not_capped():
    # Asking for far more frames than the trajectory can support must not error
    # or clamp to a fixed ceiling -- it just returns as many as the signal has.
    rmsd, _ = _synthetic_rmsd(n=400)
    result = rf.filter_rmsd(rmsd, target_frames=100000)
    assert len(result.frames) > 50


def test_target_frames_beats_cutoff_and_power():
    rmsd, _ = _synthetic_rmsd()
    # target_frames has top priority: the explicit cutoff / power_fraction are
    # ignored, and the frame count tracks the target, not the tight cutoff.
    result = rf.filter_rmsd(rmsd, target_frames=45, cutoff_frequency=0.01,
                            power_fraction=0.5)
    assert result.target_frames == 45
    assert abs(len(result.frames) - 45) <= 8


def test_cutoff_beats_power_fraction():
    rmsd, _ = _synthetic_rmsd()
    only_cut = rf.filter_rmsd(rmsd, cutoff_frequency=0.02)
    both = rf.filter_rmsd(rmsd, cutoff_frequency=0.02, power_fraction=0.5)
    # When both are given, the explicit cutoff wins, so the result is identical.
    assert both.cutoff_frequency == only_cut.cutoff_frequency
    assert both.target_frames is None
    assert list(both.frames) == list(only_cut.frames)


def test_kabsch_recovers_rotation_and_translation():
    rng = np.random.default_rng(1)
    ref = rng.standard_normal((40, 3))
    theta = 0.6
    rot = np.array([[np.cos(theta), -np.sin(theta), 0],
                    [np.sin(theta), np.cos(theta), 0],
                    [0, 0, 1]])
    mobile = ref @ rot.T + np.array([3.0, -2.0, 1.0])
    aligned = rf._kabsch_align(mobile, ref)
    rmsd = np.sqrt(((aligned - ref) ** 2).sum(1).mean())
    assert rmsd < 1e-9


def test_pc1_captures_the_dominant_collective_motion():
    rng = np.random.default_rng(2)
    n_atoms, n = 20, 300
    base = rng.standard_normal((n_atoms, 3))
    direction = rng.standard_normal((n_atoms, 3))
    amp = np.sin(np.linspace(0, 4 * np.pi, n))  # one collective motion over time
    frames = [base + a * direction + 0.01 * rng.standard_normal((n_atoms, 3))
              for a in amp]
    pc = rf.principal_component_series(frames)
    assert pc.shape == (n, 1)
    # PC1's time course should track the injected collective amplitude.
    corr = np.corrcoef(pc[:, 0], amp)[0, 1]
    assert abs(corr) > 0.95


def test_pc1_series_feeds_filter_rmsd():
    rng = np.random.default_rng(3)
    frames = [rng.standard_normal((10, 3)) + 0.01 * i for i in range(200)]
    pc1 = rf.principal_component_series(frames)[:, 0]
    result = rf.filter_rmsd(pc1, target_frames=15)
    assert result.target_frames == 15
    assert result.filtered.shape == pc1.shape


def test_tica_recovers_slow_mode_buried_under_a_larger_fast_mode():
    # The case where PC1 fails and tICA wins: a small-amplitude SLOW collective
    # motion hidden under a large-amplitude FAST one. PC1 (max variance) locks
    # onto the fast mode; IC1 (slowest) should recover the slow mode.
    rng = np.random.default_rng(4)
    n_atoms, n = 24, 600
    base = rng.standard_normal((n_atoms, 3))
    a = rng.standard_normal((n_atoms, 3))
    b = rng.standard_normal((n_atoms, 3))
    # Orthonormalize the two collective directions so they don't cross-talk.
    a /= np.linalg.norm(a)
    b = b - (b.ravel() @ a.ravel()) * a
    b /= np.linalg.norm(b)
    t = np.linspace(0, 1, n)
    slow = np.sin(2 * np.pi * 1 * t)          # one slow cycle, small amplitude
    fast = 3.0 * np.sin(2 * np.pi * 25 * t)   # many fast cycles, big amplitude
    frames = [base + s * a + f * b + 0.01 * rng.standard_normal((n_atoms, 3))
              for s, f in zip(slow, fast)]

    pc1 = rf.principal_component_series(frames)[:, 0]
    ic1 = rf.tica_series(frames, lag=10)[:, 0]
    assert ic1.shape == (n,)

    # PC1 tracks the high-variance FAST motion; IC1 tracks the SLOW one.
    assert abs(np.corrcoef(pc1, fast)[0, 1]) > 0.9
    assert abs(np.corrcoef(ic1, slow)[0, 1]) > 0.9
    assert abs(np.corrcoef(ic1, slow)[0, 1]) > abs(np.corrcoef(ic1, fast)[0, 1])


def test_tica_stable_on_high_dimensional_input():
    # The overfitting failure the variance cutoff fixes: MANY coordinates
    # (d > n_frames) with variance concentrated in a few collective modes (as in a
    # real protein) -- one of them slow -- plus tiny per-atom jitter. Without the
    # PCA pre-reduction tICA picks a different spurious mode at every lag; with the
    # default variance cutoff it recovers the slow mode and is lag-stable.
    rng = np.random.default_rng(21)
    n_atoms, n = 200, 500           # d = 600 > n -> the overfit regime
    base = rng.standard_normal((n_atoms, 3))
    a = rng.standard_normal((n_atoms, 3)); a /= np.linalg.norm(a)
    b = rng.standard_normal((n_atoms, 3))
    b = b - (b.ravel() @ a.ravel()) * a; b /= np.linalg.norm(b)
    t = np.linspace(0, 1, n)
    slow = np.sin(2 * np.pi * t)            # one slow cycle (the target)
    # Bigger-variance fast mode; frequency chosen so its period (~15 frames) does
    # not alias with the lag-robustness scan lags (5, 10, 20).
    fast = 3.0 * np.sin(2 * np.pi * 33 * t)
    frames = [base + slow[i] * a + fast[i] * b
              + 0.02 * rng.standard_normal((n_atoms, 3)) for i in range(n)]

    ic1 = rf.tica_series(frames, lag=10)[:, 0]
    assert abs(np.corrcoef(ic1, slow)[0, 1]) > 0.9      # recovers the slow mode
    _, _, min_corr = rf.tica_lag_robustness(frames, lag=10)
    assert min_corr > 0.9                                # and it is lag-stable


def test_tica_series_feeds_filter_rmsd():
    rng = np.random.default_rng(5)
    frames = [rng.standard_normal((10, 3)) + 0.01 * i for i in range(200)]
    ic1 = rf.tica_series(frames, lag=8)[:, 0]
    result = rf.filter_rmsd(ic1, target_frames=12)
    assert result.target_frames == 12
    assert result.filtered.shape == ic1.shape


def test_tica_lag_out_of_range_raises():
    frames = [np.random.default_rng(6).standard_normal((8, 3)) for _ in range(20)]
    for bad in (0, 20, 99):
        try:
            rf.tica_series(frames, lag=bad)
        except ValueError:
            pass
        else:
            raise AssertionError("lag=%r should have raised" % bad)


def test_tica_lag_robustness_high_for_a_real_slow_mode():
    # The slow-under-fast trajectory from above has a genuine slow mode, so IC1's
    # shape should be stable across lag times (min cross-lag correlation high).
    rng = np.random.default_rng(11)
    n_atoms, n = 24, 600
    base = rng.standard_normal((n_atoms, 3))
    a = rng.standard_normal((n_atoms, 3)); a /= np.linalg.norm(a)
    b = rng.standard_normal((n_atoms, 3))
    b = b - (b.ravel() @ a.ravel()) * a; b /= np.linalg.norm(b)
    t = np.linspace(0, 1, n)
    frames = [base + np.sin(2 * np.pi * t[i]) * a
              + 3.0 * np.sin(2 * np.pi * 25 * t[i]) * b
              for i in range(n)]
    lags, corrs, min_corr = rf.tica_lag_robustness(frames, lag=10)
    assert set(lags) == {5, 10, 20}
    assert len(corrs) == len(lags)
    assert min_corr > 0.9  # a real slow mode is lag-stable


def test_dihedral_pca_recovers_a_collective_angle_motion():
    # Inject one collective dihedral swing across a set of angles; dPC1 should
    # track it. Handles the sin/cos periodicity (angles wrap past +-pi).
    rng = np.random.default_rng(12)
    n, n_dih = 400, 8
    swing = np.linspace(-np.pi, np.pi, n)       # a collective wrap-around motion
    offsets = rng.uniform(-np.pi, np.pi, n_dih)
    dih = (offsets[None, :] + 0.6 * swing[:, None]
           + 0.05 * rng.standard_normal((n, n_dih)))
    dih = (dih + np.pi) % (2 * np.pi) - np.pi     # wrap into [-pi, pi]
    dpc = rf.dihedral_pca_series(dih)
    assert dpc.shape == (n, 1)
    assert abs(np.corrcoef(dpc[:, 0], swing)[0, 1]) > 0.9


def test_dihedral_pca_feeds_filter_rmsd():
    rng = np.random.default_rng(13)
    dih = rng.uniform(-np.pi, np.pi, (300, 6))
    dpc1 = rf.dihedral_pca_series(dih)[:, 0]
    result = rf.filter_rmsd(dpc1, target_frames=15)
    assert result.filtered.shape == dpc1.shape


def test_dihedral_angles_known_values():
    # Four points forming a right-angle dihedral: p0 on +x, p1 origin, p2 on +z,
    # p3 offset along +y from p2 -> +90 degrees.
    p0 = np.array([1.0, 0.0, 0.0])
    p1 = np.array([0.0, 0.0, 0.0])
    p2 = np.array([0.0, 0.0, 1.0])
    p3 = np.array([0.0, 1.0, 1.0])
    ang = rf.dihedral_angles(p0, p1, p2, p3)
    assert abs(abs(float(ang)) - np.pi / 2) < 1e-9
    # cis (p3 back along +x) -> 0; trans (p3 along -x) -> +-pi.
    assert abs(float(rf.dihedral_angles(p0, p1, p2, np.array([1.0, 0, 1])))) < 1e-9
    assert abs(abs(float(rf.dihedral_angles(p0, p1, p2, np.array([-1.0, 0, 1]))))
               - np.pi) < 1e-9


def test_dihedral_angles_vectorized():
    rng = np.random.default_rng(14)
    q = 5
    pts = [rng.standard_normal((q, 3)) for _ in range(4)]
    stacked = rf.dihedral_angles(*pts)
    assert stacked.shape == (q,)
    # Each entry matches the per-quartet scalar computation.
    for i in range(q):
        one = rf.dihedral_angles(*[p[i] for p in pts])
        assert abs(float(one) - stacked[i]) < 1e-9


def test_dihedral_pca_rejects_bad_shape():
    for bad in (np.zeros(10), np.zeros((10, 0)), np.zeros((1, 5))):
        try:
            rf.dihedral_pca_series(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for shape %r" % (bad.shape,))


def test_cosine_content_of_pure_cosine_is_one():
    n = 1000
    x = np.cos(np.pi * np.arange(n) / n)
    # Not bit-exact 1: the signal is mean-removed first, and a half-cosine has a
    # small nonzero mean, which nudges it a hair below 1.
    assert abs(rf.cosine_content(x) - 1.0) < 1e-3


def test_cosine_content_low_for_clean_oscillation():
    # A genuine multi-cycle oscillation looks nothing like the first half-cosine.
    _, slow = _synthetic_rmsd()
    assert rf.cosine_content(slow) < 0.2


def test_cosine_content_flat_signal_is_zero():
    assert rf.cosine_content(np.ones(200)) == 0.0


def test_cosine_content_high_for_random_walk_pc1():
    # The Schultze & Grubmuller / Hess result: PC1 of a high-dimensional random
    # walk (an undersampled, barrier-free trajectory) is ~cos(pi t / n), so its
    # cosine content is high -- exactly the artifact the guardrail must catch.
    rng = np.random.default_rng(7)
    n_atoms, n = 30, 500
    steps = rng.standard_normal((n, n_atoms, 3))
    walk = np.cumsum(steps, axis=0)  # Brownian motion in coordinate space
    pc1 = rf.principal_component_series(list(walk))[:, 0]
    assert rf.cosine_content(pc1) > 0.5


def test_filter_rmsd_populates_cosine_content():
    rmsd, _ = _synthetic_rmsd()
    result = rf.filter_rmsd(rmsd)
    assert result.cosine_content is not None
    assert 0.0 <= result.cosine_content <= 1.0
    # The clean synthetic signal is not random-walk-like.
    assert not result.cosine_content_high


def test_power_spectrum_shapes_and_cumfrac():
    rmsd, _ = _synthetic_rmsd()
    freqs, power, cum = rf.power_spectrum(rmsd)
    assert freqs.shape == power.shape == cum.shape
    assert freqs[0] == 0.0
    # Cumulative fraction ends at 1.0 for a signal with any AC power.
    assert abs(cum[-1] - 1.0) < 1e-9


def test_power_spectrum_flat_signal_is_all_zero_cumfrac():
    freqs, power, cum = rf.power_spectrum(np.ones(100))
    # No AC power at all -> cumulative fraction stays zero (no division blowup).
    assert np.all(cum == 0.0)


def test_flat_signal_does_not_crash():
    flat = np.ones(200)
    result = rf.filter_rmsd(flat)
    assert np.allclose(result.filtered, 1.0, atol=1e-6)


def test_extra_frames_are_added_as_user_kind():
    rmsd, _ = _synthetic_rmsd()
    base = rf.filter_rmsd(rmsd, cutoff_frequency=0.01)
    # Pick a frame the filter did not already flag as significant.
    picked = next(f for f in range(10, len(rmsd) - 10) if f not in set(base.frames))
    result = rf.filter_rmsd(rmsd, cutoff_frequency=0.01, extra_frames=[picked])
    assert picked in set(result.frames)
    assert result.kinds[list(result.frames).index(picked)] == "user"
    # The frames stay sorted and unique, and steps still reconstruct positions.
    assert np.all(np.diff(result.frames) > 0)
    reconstructed = result.frames[0] + np.cumsum(result.steps)
    assert np.array_equal(reconstructed, result.frames)


def test_extra_frame_on_existing_extremum_keeps_detected_kind():
    rmsd, _ = _synthetic_rmsd()
    base = rf.filter_rmsd(rmsd, cutoff_frequency=0.01)
    # An already-significant, non-end frame keeps its max/min label and adds no
    # duplicate.
    existing = next(f for f, k in zip(base.frames, base.kinds) if k in ("max", "min"))
    result = rf.filter_rmsd(rmsd, cutoff_frequency=0.01, extra_frames=[existing])
    assert list(result.frames) == list(base.frames)
    assert result.kinds == base.kinds


def test_extra_frames_out_of_range_ignored():
    rmsd, _ = _synthetic_rmsd(n=200)
    result = rf.filter_rmsd(rmsd, cutoff_frequency=0.01,
                            extra_frames=[-5, 10, 999])
    assert 10 in set(result.frames)
    assert -5 not in set(result.frames)
    assert 999 not in set(result.frames)


def test_flat_signal_yields_only_endpoints():
    # A rigid / constant signal carries no real motion; the filter must not
    # manufacture key frames out of the filter's numerical ripple, on any of the
    # cutoff paths.
    assert rf.filter_rmsd(np.ones(50)).frames.size == 2
    rng = np.random.default_rng(0)
    near_flat = 5.0 + 1e-6 * rng.standard_normal(200)
    assert rf.filter_rmsd(near_flat).frames.size == 2
    assert rf.filter_rmsd(np.ones(50), cutoff_frequency=0.1).frames.size == 2
    assert rf.filter_rmsd(np.ones(50), power_fraction=0.95).frames.size == 2


def test_flat_signal_still_honours_extra_frames():
    # Even with no detected motion, user-forced frames survive.
    result = rf.filter_rmsd(np.ones(50), extra_frames=[10, 20])
    assert set(result.frames) == {0, 10, 20, 49}
