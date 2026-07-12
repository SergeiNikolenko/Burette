"""Optional learned-CV signals (DeepTICA / SRV) for the MDSmooth bundle.

The bundle's one *heavy* optional feature.  Deep-learning collective variables
(DeepTICA / SRVs via ``mlcolvar``) need PyTorch, which must **not** go in
ChimeraX's own Python, torch bundles its own OpenMP runtime (a second copy in
process aborts with ``OMP: Error #15`` or silently slows down), and it pins the
NumPy ABI.  So, following the pattern ChimeraX's own ML tools (Boltz, OpenFold)
use, torch + mlcolvar live in a **dedicated virtual environment** and training
runs as a **subprocess**; this module orchestrates that and streams the 1D CV back.

The split keeps the risky part isolated and the safe part testable:

  * **This module** runs in ChimeraX's Python: venv management, subprocess launch,
    and multi-seed consensus / robustness.  It is **numpy-only** and unit-tested
    against a stub worker, no torch is imported here, ever.
  * **``_deeptica_worker.py``** runs *inside the venv*: the actual mlcolvar/torch
    training.  It is executed as a script by the venv's Python, never imported here.

.. note::
   Verified against mlcolvar 1.3.1 / torch 2.2.2: the orchestration below (unit
   tested with a numpy stub) plus the real worker recover a known slow mode with
   the seeds in agreement.  Remaining to confirm on a real deployment: the
   ChimeraX venv bootstrap (``create_venv``) and a run on an actual trajectory.
"""

import os
import subprocess
import sys
import tempfile

import numpy as np

#: How many independently-seeded models to train.  Learned CVs are
#: initialization-unstable (VAMPnets recovered the leading modes in only ~29% of
#: single runs; SRVs ~70%), so a single run cannot be trusted. Train several and
#: take the consensus (see :func:`consensus`).
DEFAULT_N_SEEDS = 5
DEFAULT_OUT_DIM = 1
#: Below this minimum pairwise correlation across seeds, the learned CV is judged
#: seed-unstable and should be cautioned (mirrors :data:`filter.TICA_LAG_ROBUST_WARN`).
SEED_ROBUST_WARN = 0.9
#: Packages the venv must provide.
LEARNED_PACKAGES = ("torch", "mlcolvar")


def default_venv_dir():
    """Where the learned-CV venv lives (override with ``MDSMOOTH_LEARNED_HOME``)."""
    override = os.environ.get("MDSMOOTH_LEARNED_HOME")
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".mdsmooth", "learned-venv")


def venv_python(venv_dir):
    """Path to the venv's Python interpreter (platform-aware)."""
    if os.name == "nt":
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def worker_script():
    """Path to the in-venv training worker (ships inside the bundle)."""
    return os.path.join(os.path.dirname(__file__), "_deeptica_worker.py")


def venv_ready(venv_dir=None):
    """True if the venv exists and can import torch + mlcolvar."""
    venv_dir = venv_dir or default_venv_dir()
    py = venv_python(venv_dir)
    if not os.path.exists(py):
        return False
    # Guard against a venv left broken by the old bug, whose "python" is actually
    # the ChimeraX launcher, running it could spawn the whole app. Only trust an
    # interpreter that really resolves to a python*.
    if not os.path.basename(os.path.realpath(py)).lower().startswith("python"):
        return False
    check = ";".join("import %s" % p for p in LEARNED_PACKAGES)
    try:
        proc = subprocess.run([py, "-c", check], capture_output=True, timeout=120)
        return proc.returncode == 0
    except Exception:
        return False


def base_python():
    """Path to a REAL CPython interpreter to build the venv from.

    Inside ChimeraX ``sys.executable`` is the *ChimeraX launcher*, not a plain
    Python, so ``venv`` built from it produces a broken environment (its "python"
    is the whole app and ``ensurepip`` gets SIGKILLed).  ChimeraX does ship a real
    CPython; find it and reject anything that doesn't actually resolve to a
    ``python*`` binary (that filters out the launcher).

    Measured layout inside the app (``sysconfig`` BINDIR is useless. It is the
    build machine's ``/Library/...`` path): ``sys.prefix`` points at the framework
    (``.../Versions/3.11``) whose ``bin/python3.x`` is the real interpreter, and
    ``<app>/Contents/bin/python3.x`` also exists.
    """
    ver = "python%d.%d" % sys.version_info[:2]
    exedir = os.path.dirname(sys.executable)
    search_dirs = [
        os.path.join(sys.prefix, "bin"),               # framework python install
        os.path.join(sys.exec_prefix, "bin"),
        os.path.join(os.path.dirname(exedir), "bin"),  # <app>/Contents/bin (GUI)
        exedir,                                         # <app>/Contents/bin (nogui)
    ]
    names = [ver, "python3", "python"]
    if os.name == "nt":
        search_dirs = [sys.prefix, os.path.join(sys.prefix, "Scripts")] + search_dirs
        names = ["python.exe", "python3.exe"] + names
    for d in search_dirs:
        for nm in names:
            c = os.path.join(d, nm)
            if (os.path.exists(c)
                    and os.path.basename(os.path.realpath(c)).lower()
                        .startswith("python")):
                return c
    return sys.executable


def create_venv(venv_dir=None, index_url=None, logger=None):
    """Create the venv and pip-install torch + mlcolvar into it (~GB download).

    ``index_url`` selects a torch build, e.g.
    ``https://download.pytorch.org/whl/cu126`` for CUDA or ``.../whl/cpu`` for
    CPU-only.  Runs several minutes; intended to be triggered explicitly by the
    user (an "install" command / button), never silently mid-analysis.  The venv
    is built from :func:`base_python` (the real CPython), NOT ``sys.executable``
    (the ChimeraX launcher), and ``--clear`` wipes any half-built earlier attempt.
    """
    venv_dir = venv_dir or default_venv_dir()
    base = base_python()
    if logger is not None:
        logger.info("Creating learned-CV venv at %s (base python: %s) …"
                    % (venv_dir, base))
    os.makedirs(os.path.dirname(venv_dir) or ".", exist_ok=True)
    made = subprocess.run([base, "-m", "venv", "--clear", venv_dir],
                          capture_output=True, text=True)
    if made.returncode != 0:
        raise RuntimeError(
            "venv creation failed with %s:\n%s"
            % (base, (made.stderr or made.stdout or "")[-1500:]))
    py = venv_python(venv_dir)

    # Upgrade pip (best-effort; don't fail the whole install if this hiccups).
    subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip"],
                   capture_output=True, text=True)

    # Install torch + mlcolvar.  ``index_url`` is added as an *extra* index (not a
    # replacement), so mlcolvar / lightning are still resolved from PyPI, passing
    # a PyTorch index as the sole --index-url would hide them and fail.  With no
    # index (the default), plain PyPI serves the right torch: CPU/MPS on macOS,
    # CUDA on Linux.  A PyTorch index is only needed to force a specific CUDA build.
    # Pin numpy < 2: torch wheels through 2.2.x (the newest build for Intel-Mac
    # Python) were compiled against NumPy 1.x and crash at import against NumPy 2
    # ("_ARRAY_API not found"), yet torch's own metadata does not cap it, so a
    # fresh venv otherwise pulls NumPy 2.x.  1.x works with every dep here.
    install = [py, "-m", "pip", "install", *LEARNED_PACKAGES, "numpy<2"]
    if index_url:
        install += ["--extra-index-url", index_url]
    if logger is not None:
        logger.info("Installing %s into the venv (this downloads several GB and "
                    "can take a while) …" % ", ".join(LEARNED_PACKAGES))
    done = subprocess.run(install, capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(
            "pip install failed:\n%s" % (done.stderr or done.stdout or "")[-2500:])
    return py


def _sign_fixed(series):
    """Fix a CV's arbitrary sign so its largest-magnitude excursion is positive."""
    series = np.asarray(series, dtype=float)
    if series.size and series[np.argmax(np.abs(series))] < 0:
        return -series
    return series


def consensus(seed_series):
    """Reduce per-seed CV time courses to one consensus signal + a robustness score.

    ``seed_series`` is ``(n_seeds, n_frames)`` (or ``(n_seeds, n_frames, out_dim)``,
    component 0 is used).  Each seed's sign is normalized, then the *medoid*
    seed (highest mean absolute correlation with the others) is taken as the
    consensus, and the **minimum** pairwise absolute correlation is returned as the
    robustness score.  A low score means the seeds disagree, the learned CV is
    initialization-unstable and should not be trusted (see
    :data:`SEED_ROBUST_WARN`).

    Returns ``(consensus_series, min_pairwise_corr)``.
    """
    seeds = np.asarray(seed_series, dtype=float)
    if seeds.ndim == 3:
        seeds = seeds[:, :, 0]
    if seeds.ndim != 2 or seeds.shape[0] < 1:
        raise ValueError("seed_series must be (n_seeds, n_frames).")
    ics = np.array([_sign_fixed(seeds[s]) for s in range(seeds.shape[0])])
    s = ics.shape[0]
    if s == 1:
        return ics[0], 1.0

    corr = np.ones((s, s), dtype=float)
    for i in range(s):
        for j in range(i + 1, s):
            if np.std(ics[i]) > 0 and np.std(ics[j]) > 0:
                c = abs(float(np.corrcoef(ics[i], ics[j])[0, 1]))
            else:
                c = 0.0
            corr[i, j] = corr[j, i] = c
    # Medoid = seed most like all the others; robustness = worst pair.
    mean_to_others = (corr.sum(axis=1) - 1.0) / (s - 1)
    medoid = int(np.argmax(mean_to_others))
    min_corr = float(corr[np.triu_indices(s, k=1)].min())
    return ics[medoid], min_corr


def run_deeptica(features, lag, n_seeds=DEFAULT_N_SEEDS, out_dim=DEFAULT_OUT_DIM,
                 python_exe=None, worker=None, timeout=1800):
    """Train DeepTICA in the venv (subprocess) and return the consensus CV.

    Writes ``features`` (``(n_frames, d)``) + params to a temp ``.npz``, runs the
    worker with the venv's Python, reads back the per-seed CV time courses, and
    reduces them to a consensus via :func:`consensus`.

    ``python_exe`` / ``worker`` default to the venv interpreter and the shipped
    worker; tests override them to point at the current Python and a numpy stub, so
    the whole subprocess round-trip is exercised without torch.

    Returns ``(consensus_series, min_pairwise_corr)``.  Raises ``RuntimeError`` if
    the worker fails or produces no output.
    """
    features = np.asarray(features, dtype=float)
    if features.ndim != 2:
        raise ValueError("features must be a 2-D (n_frames, d) array.")
    lag = int(lag)
    if not (1 <= lag < features.shape[0]):
        raise ValueError("lag %d is out of range (1-%d)."
                         % (lag, features.shape[0] - 1))
    python_exe = python_exe or venv_python(default_venv_dir())
    worker = worker or worker_script()

    with tempfile.TemporaryDirectory() as tmp:
        inp = os.path.join(tmp, "input.npz")
        out = os.path.join(tmp, "output.npz")
        np.savez(inp, features=features, lag=lag,
                 n_seeds=int(n_seeds), out_dim=int(out_dim))
        try:
            proc = subprocess.run(
                [python_exe, worker, inp, out],
                capture_output=True, text=True, timeout=timeout,
            )
        except FileNotFoundError as e:
            raise RuntimeError(
                "Could not launch the learned-CV worker (%s). Is the venv "
                "installed? See the install command." % e
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                "DeepTICA training timed out after %d s. Try fewer seeds, a "
                "smaller highlight, or a longer timeout." % int(timeout)
            )
        if proc.returncode != 0:
            raise RuntimeError(
                "DeepTICA worker failed (exit %d):\n%s"
                % (proc.returncode, (proc.stderr or proc.stdout or "")[-2000:])
            )
        if not os.path.exists(out):
            raise RuntimeError(
                "DeepTICA worker produced no output.\n%s"
                % (proc.stderr or "")[-2000:]
            )
        data = np.load(out)
        if "series" not in data:
            raise RuntimeError(
                "DeepTICA worker output is missing the 'series' array "
                "(keys: %s)." % ", ".join(data.files)
            )
        seed_series = data["series"]
    return consensus(seed_series)
