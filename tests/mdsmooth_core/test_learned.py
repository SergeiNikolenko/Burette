"""Unit tests for the learned-CV orchestration (learned.py).

These exercise the venv/subprocess/consensus plumbing WITHOUT PyTorch, by pointing
the runner at the current Python and a numpy stub worker (``_stub_worker.py``).
The actual in-venv torch/mlcolvar training (``src/_deeptica_worker.py``) is NOT
covered here -- it needs a real torch venv and is flagged for app/GPU testing.

    pip install numpy pytest
    pytest ChimeraX-MDSmooth/tests/test_learned.py
"""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "mdsmooth_core"))

import learned as lc  # noqa: E402

_HERE = os.path.dirname(__file__)
_STUB = os.path.join(_HERE, "_stub_worker.py")


def _features(n=400, d=6, seed=0):
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 1, n)
    base = np.outer(np.sin(2 * np.pi * t), rng.standard_normal(d))
    return base + 0.05 * rng.standard_normal((n, d))


# --- consensus ----------------------------------------------------------------

def test_consensus_high_for_agreeing_seeds():
    rng = np.random.default_rng(1)
    base = rng.standard_normal(300)
    seeds = np.array([base + 1e-3 * rng.standard_normal(300) for _ in range(5)])
    cons, min_corr = lc.consensus(seeds)
    assert cons.shape == (300,)
    assert min_corr > 0.99


def test_consensus_low_for_disagreeing_seeds():
    rng = np.random.default_rng(2)
    seeds = rng.standard_normal((5, 300))   # independent -> uncorrelated
    _, min_corr = lc.consensus(seeds)
    assert min_corr < 0.5


def test_consensus_is_sign_invariant():
    rng = np.random.default_rng(3)
    base = rng.standard_normal(200)
    seeds = np.array([base, -base, base, -base, base])
    _, min_corr = lc.consensus(seeds)
    assert min_corr > 0.99          # sign flips don't count as disagreement


def test_consensus_accepts_3d_and_single_seed():
    rng = np.random.default_rng(4)
    three_d = rng.standard_normal((4, 100, 2))
    cons, _ = lc.consensus(three_d)
    assert cons.shape == (100,)
    one, mc = lc.consensus(rng.standard_normal((1, 50)))
    assert one.shape == (50,) and mc == 1.0


# --- run_deeptica via the numpy stub worker -----------------------------------

def test_run_deeptica_roundtrip_with_stub():
    x = _features()
    series, min_corr = lc.run_deeptica(
        x, lag=5, n_seeds=4, python_exe=sys.executable, worker=_STUB)
    assert series.shape == (x.shape[0],)
    assert min_corr > 0.99          # stub returns near-identical PC1 per seed


def test_run_deeptica_rejects_bad_lag():
    with pytest.raises(ValueError):
        lc.run_deeptica(_features(n=100), lag=0,
                        python_exe=sys.executable, worker=_STUB)
    with pytest.raises(ValueError):
        lc.run_deeptica(_features(n=100), lag=100,
                        python_exe=sys.executable, worker=_STUB)


def test_run_deeptica_surfaces_worker_failure(tmp_path):
    bad = tmp_path / "boom.py"
    bad.write_text("import sys; sys.stderr.write('kaboom'); sys.exit(1)")
    with pytest.raises(RuntimeError):
        lc.run_deeptica(_features(n=100), lag=5,
                        python_exe=sys.executable, worker=str(bad))


# --- venv helpers -------------------------------------------------------------

def test_default_venv_dir_respects_override(monkeypatch):
    monkeypatch.setenv("MDSMOOTH_LEARNED_HOME", "/tmp/my-learned-venv")
    assert lc.default_venv_dir() == "/tmp/my-learned-venv"


def test_venv_not_ready_for_missing_dir(tmp_path):
    assert lc.venv_ready(str(tmp_path / "nope")) is False


def test_worker_script_path_points_into_bundle():
    assert lc.worker_script().endswith("_deeptica_worker.py")


def test_worker_environment_forces_cpu_on_macos():
    env = lc.worker_environment(platform="darwin", environ={"EXISTING": "1"})
    assert env["MDSMOOTH_DEEPTICA_ACCELERATOR"] == "cpu"
    assert env["EXISTING"] == "1"


# --- real DeepTICA worker (needs torch + mlcolvar; skipped otherwise) ---------

def test_real_deeptica_worker_recovers_slow_mode():
    pytest.importorskip("torch")
    pytest.importorskip("mlcolvar")
    # A slow mode buried under a bigger fast mode; the real worker (trained via the
    # subprocess) should recover the slow one, reject the fast one, and the seeds
    # should agree. Locks in the sys.path + input-normalization fixes.
    n, d = 400, 8
    t = np.linspace(0, 1, n)
    slow = np.sin(2 * np.pi * t)
    fast = 2.0 * np.sin(2 * np.pi * 19 * t)
    rng = np.random.default_rng(0)
    x = 0.1 * rng.standard_normal((n, d))
    x[:, 0] += slow
    x[:, 1] += fast
    worker = os.path.join(os.path.dirname(lc.__file__), "_deeptica_worker.py")
    cons, min_corr = lc.run_deeptica(
        x, lag=10, n_seeds=2, python_exe=sys.executable, worker=worker, timeout=560)
    assert cons.shape == (n,)
    assert abs(np.corrcoef(cons, slow)[0, 1]) > 0.85    # recovers the slow mode
    assert abs(np.corrcoef(cons, fast)[0, 1]) < 0.2     # rejects the fast mode
    assert min_corr > 0.8                                # seeds agree
