"""Kinetic (MSM / PCCA+) keyframe selection for the MDSmooth bundle.

A *different* keyframe-selection mode from the 1D-signal-extrema pipeline in
``filter.py``.  Instead of sampling one collective motion and cutting at its
extrema, it groups the trajectory into kinetically distinct **metastable states**
and picks one representative frame per state, ordered into a tour of the distinct
conformations.  This answers "show me the N different shapes the molecule visits"
rather than "sample the main motion".

The pipeline (essential dynamics of Markov State Models):

    1. Cluster the frames' slow coordinates into many microstates (k-means).
    2. Estimate a Markov State Model on the largest kinetically-connected set.
    3. Coarse-grain the microstates into ``n_states`` metastable macrostates with
       PCCA+ (Perron-Cluster Cluster Analysis).
    4. For each macrostate, take the frame with the highest membership as its
       representative, and order the states along the slowest coordinate.

This module is the bundle's one **optional-dependency** feature: it needs
``deeptime`` (pure Python: numpy / scipy / scikit-learn, no PyTorch).  The import
is deferred to :func:`_require_deeptime` so the rest of the bundle, and its
default install, stays numpy/scipy-only.  ``deeptime`` is deliberately *not*
listed in ``bundle_info.xml``; the user installs it on demand.
"""

from dataclasses import dataclass

import numpy as np

#: Default number of metastable macrostates (representative key frames).
DEFAULT_N_STATES = 5
#: Default number of k-means microstates the MSM is built on.
DEFAULT_N_MICROSTATES = 100
#: Default MSM / clustering lag time, in frames.
DEFAULT_MSM_LAG = 10
#: Interpolation steps per morph segment in kinetic mode.  The representatives are
#: ordered by conformation, not chronology, so real per-frame timing does not
#: apply, each state-to-state transition simply gets equal screen time.
DEFAULT_STATE_STEPS = 20


def _require_deeptime():
    """Import ``deeptime`` (and the submodules used below) or raise a friendly hint.

    Imports the specific submodules too, not just the top-level package, so a
    partially-installed deeptime surfaces the same install hint instead of a raw
    ImportError deeper in.
    """
    try:
        import deeptime  # noqa: F401
        from deeptime.clustering import KMeans  # noqa: F401
        from deeptime.markov.msm import MaximumLikelihoodMSM  # noqa: F401
        from deeptime.markov import TransitionCountEstimator  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "The kinetic (MSM) mode needs the optional 'deeptime' package, which "
            "is not installed (or is incomplete). Install it into ChimeraX's "
            "Python with:\n"
            "    pip install deeptime\n"
            "(deeptime is pure Python: numpy/scipy/scikit-learn, no PyTorch.)"
        ) from e
    return deeptime


@dataclass
class KineticResult:
    """Representative key frames for a trajectory's metastable states."""

    #: Representative frame indices (0-based), ordered along the slow coordinate,
    #: the tour the morph follows.
    frames: np.ndarray
    #: Mean slow-coordinate value of each state, in the same order as ``frames``
    #: (for labelling / ordering).
    order_values: np.ndarray
    #: Number of metastable states actually found (== ``frames.size``).
    n_states: int
    #: Microstates the MSM was built on, and the lag used.
    n_microstates: int
    lag: int
    #: Per-frame macrostate assignment (-1 where a frame's microstate fell outside
    #: the largest connected set).
    frame_macrostate: np.ndarray


def kinetic_keyframes(components, n_states=DEFAULT_N_STATES,
                      n_microstates=DEFAULT_N_MICROSTATES,
                      lag=DEFAULT_MSM_LAG, seed=0):
    """Cluster -> MSM -> PCCA+ metastable states; return ordered representative frames.

    Parameters
    ----------
    components : array-like, shape (n_frames, d)
        A few slow coordinates the clustering runs in, typically the top ``d``
        tICA independent components (``filter.tica_series(..., n_components=d)``).
        Column 0 is treated as the slowest coordinate and used to order the states.
    n_states : int
        Desired number of metastable macrostates / representative key frames.
    n_microstates : int
        k-means microstates the MSM is built on (clamped to ``[n_states, n-1]``).
    lag : int
        MSM / count lag time in frames (>= 1 and < n_frames).
    seed : int
        k-means seed, so the result is reproducible.

    Returns
    -------
    KineticResult
    """
    _require_deeptime()
    from deeptime.clustering import KMeans
    from deeptime.markov.msm import MaximumLikelihoodMSM
    from deeptime.markov import TransitionCountEstimator

    x = np.asarray(components, dtype=float)
    if x.ndim != 2:
        raise ValueError("components must be a 2-D (n_frames, d) array.")
    n = x.shape[0]
    if n < 4:
        raise ValueError("Need at least a few frames for a Markov State Model.")
    lag = int(lag)
    if not (1 <= lag < n):
        raise ValueError("lag %d is out of range (1-%d)." % (lag, n - 1))
    n_states = int(n_states)
    if n_states < 2:
        raise ValueError("states must be at least 2 (a morph needs two key frames).")
    if n_states >= n:
        raise ValueError(
            "states (%d) must be fewer than the number of frames (%d)."
            % (n_states, n))

    # Clamp to [n_states, n - 1] so k-means never gets more clusters than
    # samples: the inner min caps the request, the outer max keeps room for the
    # requested states, and n_states < n (checked above) keeps the result valid.
    n_micro = max(n_states, min(int(n_microstates), n - 1))

    km = KMeans(n_clusters=n_micro, fixed_seed=int(seed),
                progress=None).fit_fetch(x)
    dtrajs = np.asarray(km.transform(x)).astype(int).reshape(-1)

    counts = TransitionCountEstimator(
        lagtime=lag, count_mode="sliding").fit_fetch(dtrajs)
    msm = MaximumLikelihoodMSM().fit_fetch(counts.submodel_largest())

    n_macro = min(n_states, msm.n_states)
    if n_macro < 2:
        raise ValueError(
            "Only %d kinetically-connected microstate(s); not enough for an MSM. "
            "Try a smaller lag, fewer microstates, or a longer trajectory."
            % msm.n_states
        )
    pcca = msm.pcca(n_macro)

    # Map original microstate labels -> active-set index -> macrostate.
    symbols = msm.count_model.state_symbols
    sym2active = {int(s): i for i, s in enumerate(symbols)}
    assign = np.asarray(pcca.assignments)
    memb = np.asarray(pcca.memberships)

    frame_macro = np.full(n, -1, dtype=int)
    frame_memb = np.zeros(n, dtype=float)
    for f, m in enumerate(dtrajs):
        ai = sym2active.get(int(m))
        if ai is not None:
            macro = int(assign[ai])
            frame_macro[f] = macro
            frame_memb[f] = memb[ai, macro]

    # Representative frame per macrostate = the frame most firmly in that state.
    slow = x[:, 0]
    reps = []
    centroids = []
    ic1_means = []
    for k in range(n_macro):
        cand = np.where(frame_macro == k)[0]
        if cand.size == 0:
            continue
        reps.append(int(cand[np.argmax(frame_memb[cand])]))
        centroids.append(x[cand].mean(axis=0))          # centre in FULL tICA space
        ic1_means.append(float(slow[cand].mean()))

    if len(reps) < 2:
        raise ValueError(
            "PCCA+ produced fewer than two populated states; try fewer states "
            "or a different lag."
        )

    reps = np.array(reps, dtype=int)
    centroids = np.array(centroids, dtype=float)
    ic1_means = np.array(ic1_means, dtype=float)

    # Order the states into a smooth tour with a nearest-neighbour path through the
    # FULL tICA space, not by IC1 alone: states that overlap on IC1 but differ on
    # other slow coordinates would otherwise be crushed together, making the morph
    # crawl through near-identical states and then jump.  Start from the most
    # extreme state along IC1 so the tour still runs end-to-end.
    order = _nearest_neighbour_path(centroids, start=int(np.argmin(centroids[:, 0])))
    return KineticResult(
        frames=reps[order],
        order_values=ic1_means[order],
        n_states=len(reps),
        n_microstates=n_micro,
        lag=lag,
        frame_macrostate=frame_macro,
    )


def _nearest_neighbour_path(points, start=0):
    """Greedy nearest-neighbour visiting order over ``points`` (n, d) from ``start``.

    A cheap open-path traversal so consecutive states are actually close in the
    feature space, good enough to keep a handful of morph key frames in a smooth
    order without a full TSP solve.
    """
    n = len(points)
    remaining = set(range(n))
    remaining.discard(start)
    path = [start]
    cur = start
    while remaining:
        nxt = min(remaining,
                  key=lambda j: float(np.sum((points[cur] - points[j]) ** 2)))
        path.append(nxt)
        remaining.discard(nxt)
        cur = nxt
    return np.array(path, dtype=int)
