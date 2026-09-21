"""
Core MDSmoothing logic for the MDSmooth ChimeraX bundle.

This module deliberately depends only on ``numpy`` and ``scipy``, never on any
``chimerax`` package, so that the science can be unit tested and reused outside
of ChimeraX.  Everything that touches ChimeraX models lives in ``cmd.py``.

The pipeline:

    1. Take a per-frame RMSD series (one value per trajectory frame).
    2. Choose a low-pass cutoff frequency from the cumulative power spectrum.
    3. Apply a zero-phase Butterworth low-pass filter (``filtfilt``).
    4. Locate local maxima/minima of the filtered series, the "significant"
       (structurally meaningful) frames.
    5. Compute the frame spacing between consecutive significant frames; these
       become the morph interpolation-step counts that preserve real timing.
"""

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from scipy.linalg import eigh as _generalized_eigh
from scipy.signal import butter, filtfilt, find_peaks


#: Frame count aimed for when the caller specifies no cutoff at all.  A frame
#: target (rather than a fixed cutoff or power fraction) is the default because
#: it self-normalizes across trajectories and atom selections, a good default
#: gives a comparable number of key frames whatever signal it is handed.
DEFAULT_TARGET_FRAMES = 50

#: Cosine-content threshold above which a signal is *cautioned* as looking like a
#: diffusive random walk (see :func:`cosine_content`).  A high-dimensional random
#: walk projects onto a clean ``cos(pi t / n)`` with cosine content approaching 1,
#: so a value in this regime means the "slow mode" may reflect undersampled
#: diffusion rather than a sampled transition.
#:
#: This is deliberately set high (0.85), in the genuinely-diffusive regime, and
#: NOT at Hess's 0.5.  Cosine content cannot by itself tell a real slow
#: conformational sweep from a random walk, a single genuine slow transition is
#: *also* roughly cosine-shaped (a one-cycle drift scores ~0.7, and RMSD-to-a-
#: reference naturally drifts and often lands ~0.8), so a low threshold cries
#: wolf on perfectly good signals, including the tool's own paper-reproduction
#: RMSD.  Above 0.85 the signal is clearly random-walk-like; below it we surface
#: the number as an informational diagnostic without an alarm.  It is a *caution*,
#: never a hard gate.
COSINE_CONTENT_WARN = 0.85

#: Default tICA lag (in frames) for :func:`tica_series`.  Too small ~ PCA (fast
#: modes leak in); too large ~ noisy (few lagged pairs remain).  Exposed as the
#: ``lag`` keyword so it can be tuned per trajectory.
DEFAULT_TICA_LAG = 10

#: Fraction of positional variance kept when reducing coordinates onto their PCA
#: subspace *before* the tICA eigenproblem (see :func:`_align_and_reduce`).  This
#: is the fix for the classic tICA overfitting failure: with the whole system as
#: features the reduced dimension approaches the number of frames, the lagged
#: covariances are estimated from too few samples per dimension, and tICA returns
#: a different spurious "slow" mode at every lag.  Keeping ~95% of the variance
#: collapses tens of thousands of coordinates to a well-conditioned handful of
#: dominant modes (proteins concentrate variance in a few), so IC1 becomes stable.
DEFAULT_TICA_VAR_CUTOFF = 0.95

#: Below this cross-lag correlation, IC1's shape is judged *lag-sensitive* and is
#: cautioned as possibly undersampled / spurious (see :func:`tica_lag_robustness`).
#: A genuine slow mode keeps its shape whether measured at lag tau/2, tau, or
#: 2*tau; a spurious one flips around.
TICA_LAG_ROBUST_WARN = 0.9


@dataclass
class FilterResult:
    """Everything the command needs to report results and build a morph."""

    #: The raw per-frame RMSD series that was filtered.
    raw: np.ndarray
    #: The zero-phase low-pass filtered RMSD series (same length as ``raw``).
    filtered: np.ndarray
    #: Cutoff frequency actually used, in cycles per frame.
    cutoff_frequency: float
    #: 0-based indices of the significant frames, in ascending order.
    frames: np.ndarray
    #: "max", "min", or "end" label for each entry in ``frames``.
    kinds: List[str]
    #: Interpolation steps to reach each frame from the previous one.
    #: ``steps[0]`` is 0 (there is no segment before the first frame); every
    #: later entry equals ``frames[i] - frames[i-1]``.
    steps: Optional[np.ndarray] = field(default=None)
    #: Frame count the cutoff was solved for, when the caller drove the filter by
    #: ``target_frames`` (or let it default).  ``None`` when the cutoff came from
    #: an explicit ``cutoff_frequency`` or ``power_fraction`` instead, so callers
    #: can tell how the cutoff was chosen and report "asked for N, got M".
    target_frames: Optional[int] = field(default=None)
    #: Cosine content of the (mean-removed) raw signal in ``[0, 1]``, a
    #: random-walk / undersampling sanity check (see :func:`cosine_content`).
    #: ``None`` only if it was not computed.  Values near 1 mean the extrema the
    #: filter found are likely diffusive-noise artifacts, not real transitions.
    cosine_content: Optional[float] = field(default=None)

    @property
    def cosine_content_high(self):
        """True when :attr:`cosine_content` is at/above :data:`COSINE_CONTENT_WARN`."""
        return (self.cosine_content is not None
                and self.cosine_content >= COSINE_CONTENT_WARN)

    def __post_init__(self):
        if self.steps is None:
            if len(self.frames):
                diffs = np.diff(self.frames)
                self.steps = np.concatenate([[0], diffs]).astype(int)
            else:
                self.steps = np.zeros(0, dtype=int)


def power_spectrum(rmsd, sampling_rate=1.0):
    """One-sided power spectrum of the RMSD series (mean removed first).

    The mean (DC component) is removed before the FFT so the spectrum is not
    swamped by the constant offset of the RMSD series. That offset carries the
    vast majority of the raw power but no dynamical information.  Shared by
    :func:`choose_cutoff_frequency` and the optional spectrum panel, so both draw
    from exactly the same numbers.

    Returns
    -------
    freqs : np.ndarray
        Frequencies in cycles per frame (0 .. Nyquist), from ``rfftfreq``.
    power : np.ndarray
        ``|rfft|**2`` of the mean-removed series, same length as ``freqs``.
    cumulative_fraction : np.ndarray
        Running sum of ``power`` normalized to its total (0 .. 1); all zeros for
        a perfectly flat signal.
    """
    rmsd = np.asarray(rmsd, dtype=float)
    n = rmsd.size
    if n < 2:
        raise ValueError("Need at least two RMSD samples for a spectrum.")
    signal = rmsd - rmsd.mean()
    power = np.abs(np.fft.rfft(signal)) ** 2
    freqs = np.fft.rfftfreq(n, d=1.0 / sampling_rate)
    total = power.sum()
    if total > 0.0:
        cumulative_fraction = np.cumsum(power) / total
    else:
        cumulative_fraction = np.zeros_like(power)
    return freqs, power, cumulative_fraction


def cosine_content(series):
    """Cosine content of a 1D signal in ``[0, 1]``, a random-walk artifact check.

    Hess's cosine content (Hess, *Phys. Rev. E* 2002) measures how much a signal
    looks like the first half-cosine ``cos(pi t / n)``.  This matters because a
    diffusing high-dimensional random walk, the mathematical model of an
    *undersampled* trajectory that never actually crosses a barrier, projects
    onto PCA/tICA modes that are almost exactly ``cos(pi t / n)``, cosine content
    approaching 1 (Schultze & Grubmuller, *JCTC* 2021).  So a value in the
    diffusive regime (see :data:`COSINE_CONTENT_WARN`) is a caution: the "slow
    mode" may reflect undersampled diffusion rather than a real transition.

    It is only a caution, never a verdict: cosine content cannot by itself tell a
    genuine slow conformational sweep from a random walk, because a single real
    slow transition is *also* roughly cosine-shaped.  Use it as one diagnostic
    among several (lag robustness, more sampling), not as a pass/fail gate.

    Defined for the leading (i=1) cosine, on the mean-removed signal:

        c = (2 / n) * (sum_t cos(pi t / n) * x(t))**2 / (sum_t x(t)**2)

    which is exactly 1 for ``x(t) = cos(pi t / n)`` and ~0 for a signal with no
    slow drift.  Returns 0.0 for a flat (zero-variance) signal.
    """
    x = np.asarray(series, dtype=float)
    n = x.size
    if n < 2:
        raise ValueError("Need at least two samples for cosine content.")
    x = x - x.mean()
    denom = float(np.sum(x * x))
    if denom == 0.0:
        return 0.0
    t = np.arange(n)
    proj = float(np.sum(np.cos(np.pi * t / n) * x))
    return (2.0 / n) * proj * proj / denom


def choose_cutoff_frequency(rmsd, sampling_rate=1.0, power_fraction=0.979):
    """Pick a low-pass cutoff from the cumulative power spectrum.

    Walks up the one-sided power spectrum (see :func:`power_spectrum`) and
    returns the smallest frequency at which the cumulative power reaches
    ``power_fraction`` of the total.

    Parameters
    ----------
    rmsd : array-like
        Per-frame RMSD values.
    sampling_rate : float
        Samples per unit time.  With the default of 1.0 the returned cutoff is
        in cycles per frame, which is what the Butterworth stage expects.
    power_fraction : float
        Fraction of retained spectral power.

    Returns
    -------
    float
        Cutoff frequency in cycles per frame (strictly between 0 and Nyquist).
    """
    rmsd = np.asarray(rmsd, dtype=float)
    n = rmsd.size
    if n < 2:
        raise ValueError("Need at least two RMSD samples to choose a cutoff.")
    if not 0.0 < power_fraction < 1.0:
        raise ValueError("power_fraction must be between 0 and 1 (exclusive).")

    freqs, spectrum, cumulative_fraction = power_spectrum(rmsd, sampling_rate)

    nyquist = 0.5 * sampling_rate
    if spectrum.sum() == 0.0:
        # Perfectly flat signal: nothing to filter, return Nyquist.
        return nyquist

    idx = int(np.searchsorted(cumulative_fraction, power_fraction))
    idx = min(idx, freqs.size - 1)
    cutoff = float(freqs[idx])

    # Guard against a degenerate zero cutoff (would make an unusable filter).
    if cutoff <= 0.0:
        cutoff = float(freqs[1]) if freqs.size > 1 else nyquist * 0.1
    return cutoff


def count_significant_frames(rmsd, cutoff_frequency, sampling_rate=1.0, order=5,
                             include_ends=True):
    """How many significant frames a given cutoff produces (no morph built).

    A cheap probe used by :func:`find_cutoff_for_frame_count` to search the
    cutoff axis: filter, count the extrema, throw the rest away.
    """
    filtered = butter_lowpass(rmsd, cutoff_frequency, sampling_rate=sampling_rate,
                              order=order)
    frames, _ = find_significant_frames(filtered, include_ends=include_ends)
    return frames.size


def find_cutoff_for_frame_count(rmsd, target_frames, sampling_rate=1.0, order=5,
                                include_ends=True, max_iter=48):
    """Solve for the low-pass cutoff that yields about ``target_frames`` frames.

    The number of local maxima/minima of the filtered series rises (in
    expectation, by Rice's formula) monotonically with the cutoff frequency, so
    the cutoff can be found by bisecting the band ``(0, Nyquist)``.  The frame
    count is an integer step function of the cutoff, so an exact hit is not
    guaranteed; we return the cutoff whose frame count came *closest* to the
    target, preferring the smaller (smoother) cutoff on ties.

    No ceiling is imposed: a ``target_frames`` larger than the trajectory can
    support simply drives the cutoff up to the top of the band and returns as
    many frames as the signal has, the caller is never capped.

    Parameters
    ----------
    rmsd : array-like
        Per-frame RMSD values.
    target_frames : int
        Desired number of significant frames (must be at least 2).
    sampling_rate, order, include_ends
        Passed through to the filter / extrema detection so the search counts
        frames exactly as the final :func:`filter_rmsd` call will.
    max_iter : int
        Bisection steps.  Each step is a single cheap filter pass, so the whole
        search costs only tens of milliseconds even on long trajectories.

    Returns
    -------
    float
        Cutoff frequency in cycles per frame.
    """
    rmsd = np.asarray(rmsd, dtype=float)
    if rmsd.size < 2:
        raise ValueError("Need at least two RMSD samples to choose a cutoff.")
    if target_frames < 2:
        raise ValueError("target_frames must be at least 2.")

    nyquist = 0.5 * sampling_rate
    lo = 1e-6 * nyquist
    hi = nyquist * (1.0 - 1e-6)

    def count(cf):
        return count_significant_frames(
            rmsd, cf, sampling_rate=sampling_rate, order=order,
            include_ends=include_ends
        )

    best_cf = hi
    best_diff = None
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        c = count(mid)
        diff = abs(c - target_frames)
        if best_diff is None or diff < best_diff or (
            diff == best_diff and mid < best_cf
        ):
            best_diff, best_cf = diff, mid
        if c < target_frames:
            # Too few extrema: let more signal through by raising the cutoff.
            lo = mid
        else:
            # At or above the target: smooth harder (and, on an exact hit, keep
            # searching down for the smallest cutoff that still reaches it).
            hi = mid
    return float(best_cf)


def butter_lowpass(rmsd, cutoff_frequency, sampling_rate=1.0, order=5):
    """Apply a zero-phase Butterworth low-pass filter.

    ``filtfilt`` runs the filter forward and backward, cancelling phase shift so
    the timing of peaks is preserved, essential for lining the filtered series
    up with the original trajectory frames.
    """
    rmsd = np.asarray(rmsd, dtype=float)
    nyquist = 0.5 * sampling_rate
    wn = cutoff_frequency / nyquist
    # Keep the normalized cutoff strictly inside (0, 1) for a valid design.
    wn = float(np.clip(wn, 1e-6, 1.0 - 1e-6))

    b, a = butter(N=order, Wn=wn, btype="low")

    # filtfilt needs the signal to be longer than its default edge padding
    # (3 * max(len(a), len(b))).  Shrink padlen for short trajectories instead
    # of raising, so the tool still works on modest frame counts.
    default_padlen = 3 * max(len(a), len(b))
    padlen = min(default_padlen, rmsd.size - 1)
    padlen = max(padlen, 0)
    return filtfilt(b, a, rmsd, padlen=padlen)


def find_significant_frames(filtered, include_ends=True, extra_frames=None):
    """Return significant-frame indices and their kind labels.

    Significant frames are the local maxima and minima of the filtered series.
    When ``include_ends`` is true the first and last frames are added even if
    they are not extrema, so the morph spans the full trajectory.

    ``extra_frames`` is an optional iterable of 0-based frame indices the caller
    wants forced into the set, the frames a user picks by hand from the plot or
    the ``extraFrames`` command keyword.  They are labelled ``"user"`` unless the
    filter already found that frame as an extremum (or an end), in which case the
    detected label is kept.
    """
    filtered = np.asarray(filtered, dtype=float)
    maxima, _ = find_peaks(filtered)
    minima, _ = find_peaks(-filtered)

    kind_by_index = {}
    for i in maxima:
        kind_by_index[int(i)] = "max"
    for i in minima:
        kind_by_index[int(i)] = "min"

    if include_ends and filtered.size:
        last = filtered.size - 1
        kind_by_index.setdefault(0, "end")
        kind_by_index.setdefault(last, "end")

    if extra_frames is not None:
        for i in extra_frames:
            i = int(i)
            if 0 <= i < filtered.size:
                kind_by_index.setdefault(i, "user")

    frames = np.array(sorted(kind_by_index), dtype=int)
    kinds = [kind_by_index[int(i)] for i in frames]
    return frames, kinds


def _kabsch_align(mobile, ref):
    """Rigid-body superimpose ``mobile`` (n×3) onto ``ref`` (n×3), no reflection.

    Removes translation and rotation via the Kabsch algorithm, so a principal
    component analysis of the aligned frames captures the molecule's *internal*
    motion instead of it tumbling and drifting through the simulation box.
    """
    mobile = np.asarray(mobile, dtype=float)
    ref = np.asarray(ref, dtype=float)
    mc = mobile - mobile.mean(axis=0)
    rc = ref - ref.mean(axis=0)
    h = mc.T @ rc
    u, _, vt = np.linalg.svd(h)
    # Flip the last axis if the naive rotation would be a reflection (det < 0).
    d = np.sign(np.linalg.det(vt.T @ u.T))
    rot = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    return mc @ rot.T + ref.mean(axis=0)


def principal_component_series(frames, n_components=1, reference_index=0):
    """Project a trajectory onto its top principal component(s) over time.

    "Essential dynamics": every frame is first rigid-body superimposed on the
    reference frame (:func:`_kabsch_align`), the average structure is subtracted,
    and the resulting displacement matrix is decomposed.  Column 0, PC1, is
    the single largest collective motion of the selection as a function of frame,
    and can be handed to :func:`filter_rmsd` in place of an RMSD series: it tracks
    the *direction* of the dominant motion, not just distance from a reference.

    The decomposition uses the temporal (frame-by-frame) covariance, an N×N
    matrix, so the cost scales with the number of frames, not the (usually far
    larger) number of coordinates, and no coordinate-sized covariance matrix is
    ever formed.

    Parameters
    ----------
    frames : sequence of (n_atoms, 3) arrays
        Per-frame coordinates of the atoms to analyze.
    n_components : int
        How many leading components to return (default 1 => just PC1).
    reference_index : int
        0-based frame every other frame is superimposed on before the analysis.

    Returns
    -------
    np.ndarray
        Shape ``(n_frames, n_components)``; column ``k`` is the projection onto
        the ``k``-th principal component over time.  Each column's sign is fixed
        so its largest-magnitude excursion is positive (PCA signs are otherwise
        arbitrary), so the output is reproducible.
    """
    frames = [np.asarray(f, dtype=float) for f in frames]
    n = len(frames)
    if n < 2:
        raise ValueError("Need at least two frames for a principal component.")
    ref = frames[reference_index]
    aligned = np.array([_kabsch_align(f, ref) for f in frames])
    flat = aligned.reshape(n, -1)
    return _pca_time_courses(flat, n_components)


def _pca_time_courses(features, n_components):
    """PC time courses of a per-frame feature matrix (mean removed internally).

    ``features`` is ``(n_frames, n_features)``.  Uses the temporal (N×N)
    covariance. Its eigenvectors are the PC time courses (the left singular
    vectors of the mean-removed matrix), eigenvalues the variance each carries,
    so the cost scales with the number of frames, not features, and no
    feature-sized covariance is ever formed.  Shared by
    :func:`principal_component_series` (Cartesian coords) and
    :func:`dihedral_pca_series` (sin/cos of dihedrals).  Each column's sign is
    fixed so its largest-magnitude excursion is positive.
    """
    features = np.asarray(features, dtype=float)
    n = features.shape[0]
    displacement = features - features.mean(axis=0)
    gram = displacement @ displacement.T
    eigvals, eigvecs = np.linalg.eigh(gram)  # ascending
    k = min(n_components, n)
    order = np.argsort(eigvals)[::-1][:k]

    out = np.empty((n, k), dtype=float)
    for j, idx in enumerate(order):
        proj = eigvecs[:, idx] * np.sqrt(max(float(eigvals[idx]), 0.0))
        if proj[np.argmax(np.abs(proj))] < 0:  # fix arbitrary PCA sign
            proj = -proj
        out[:, j] = proj
    return out


def dihedral_pca_series(dihedrals, n_components=1):
    """dPCA: PC1 of backbone dihedral angles, so no structural alignment is needed.

    Cartesian PCA (:func:`principal_component_series`) must first superimpose every
    frame, which couples internal motion to the fit for flexible molecules.
    Dihedral PCA sidesteps that: internal coordinates (backbone phi/psi angles)
    already exclude global translation and rotation, so there is nothing to align.

    Dihedral angles are periodic, so a plain covariance is wrong (the mean of 359
    and 1 degrees is not 180).  Each angle ``theta`` is mapped to ``(cos theta,
    sin theta)`` on the unit circle before PCA (Mu/Stock 2005; Altis 2007), which
    linearizes the wrap-around.  The result is the same ``(n_frames, k)`` contract
    as the other signal producers, so it drops straight into :func:`filter_rmsd`.

    Parameters
    ----------
    dihedrals : array-like, shape (n_frames, n_dihedrals)
        Per-frame dihedral angles **in radians**.  The caller extracts these from
        the structure (see ``compute_dpca_series`` in ``cmd.py``); this function
        is pure math and never touches ChimeraX.
    n_components : int
        How many leading components to return (default 1 => dPC1).
    """
    d = np.asarray(dihedrals, dtype=float)
    if d.ndim != 2:
        raise ValueError("dihedrals must be a 2-D (n_frames, n_dihedrals) array.")
    n = d.shape[0]
    if n < 2:
        raise ValueError("Need at least two frames for dihedral PCA.")
    if d.shape[1] == 0:
        raise ValueError("No dihedral angles to analyze.")
    # Metric-coordinate encoding: each angle -> (cos, sin) so periodicity is linear.
    features = np.concatenate([np.cos(d), np.sin(d)], axis=1)
    return _pca_time_courses(features, n_components)


def dihedral_angles(p0, p1, p2, p3):
    """Signed dihedral angle(s) in radians for four points (or stacks of points).

    Standard IUPAC dihedral about the ``p1-p2`` bond, in ``[-pi, pi]``.  Each
    ``p*`` is a ``(..., 3)`` array (a single point, or a stack of ``Q`` points for
    ``Q`` dihedrals at once), so ``cmd.py`` can compute a whole frame's phi/psi
    angles in one vectorized call.  Pure numpy, so it is unit-tested; the atom
    bookkeeping that feeds it lives in ``cmd.py`` (``compute_dpca_series``).
    """
    p0, p1, p2, p3 = (np.asarray(p, dtype=float) for p in (p0, p1, p2, p3))
    b0 = p0 - p1
    b1 = p2 - p1
    b2 = p3 - p2
    b1n = b1 / np.linalg.norm(b1, axis=-1, keepdims=True)
    # Components of b0 and b2 perpendicular to the central bond.
    v = b0 - (b0 * b1n).sum(-1, keepdims=True) * b1n
    w = b2 - (b2 * b1n).sum(-1, keepdims=True) * b1n
    x = (v * w).sum(-1)
    y = (np.cross(b1n, v) * w).sum(-1)
    return np.arctan2(y, x)


def tica_series(frames, lag=DEFAULT_TICA_LAG, n_components=1, reference_index=0):
    """Project a trajectory onto its slowest collective motion(s) via tICA.

    Where PCA/PC1 finds the highest-*variance* motion, time-lagged independent
    component analysis (tICA) finds the *slowest*: the coordinate whose value
    stays autocorrelated the longest across a lag of ``lag`` frames.  Slowness is
    usually a far better proxy for a functional transition than variance, big
    thermal breathing has large variance but no function, so IC1 often tracks
    the meaningful conformational change that PC1 buries under fast wobble.

    The method is dependency-free (numpy/scipy only): it solves the generalized
    eigenproblem ``C(tau) v = lambda C(0) v`` where ``C(0)`` is the instantaneous
    covariance and ``C(tau)`` the time-lagged covariance of the aligned,
    mean-removed coordinates.  The eigenvector with the *largest* eigenvalue is
    the slowest mode (its lagged autocorrelation is closest to 1).

    To stay well-conditioned when there are more coordinates than frames (``C(0)``
    would be singular), the coordinates are first reduced onto their non-trivial
    PCA subspace (dropping only numerically-zero-variance directions), and a tiny
    ridge is added to ``C(0)``; neither discards real signal at the tool's scale.

    Parameters
    ----------
    frames : sequence of (n_atoms, 3) arrays
        Per-frame coordinates of the atoms to analyze.
    lag : int
        Lag time in frames (>= 1 and < n_frames).  The one finicky knob: too
        small behaves like PCA, too large leaves too few lagged pairs.
    n_components : int
        How many leading (slowest) components to return (default 1 => IC1).
    reference_index : int
        0-based frame every other frame is superimposed on before the analysis
        (reuses :func:`_kabsch_align`, exactly like :func:`principal_component_series`).

    Returns
    -------
    np.ndarray
        Shape ``(n_frames, n_components)``; column ``k`` is the projection onto
        the ``k``-th slowest mode over time.  Same output contract as
        :func:`principal_component_series`, so it drops straight into
        :func:`filter_rmsd`.  Each column's sign is fixed so its largest-magnitude
        excursion is positive, so the output is reproducible.
    """
    y = _align_and_reduce(frames, reference_index,
                          var_cutoff=DEFAULT_TICA_VAR_CUTOFF)
    _check_lag(int(lag), y.shape[0])
    comps, _ = _tica_components(y, int(lag), n_components)
    return comps


def _check_lag(lag, n):
    if lag < 1:
        raise ValueError("tICA lag must be at least 1 frame.")
    if lag >= n:
        raise ValueError(
            "tICA lag (%d) must be smaller than the number of frames (%d)."
            % (lag, n)
        )


def reduced_coordinates(frames, reference_index=0,
                        var_cutoff=DEFAULT_TICA_VAR_CUTOFF):
    """Aligned coordinates projected onto their leading PCA subspace.

    Public wrapper over :func:`_align_and_reduce`: returns ``(n_frames, k)``
    features suitable as input to a learned CV (e.g. the DeepTICA worker), with
    global tumbling removed and the dimensionality reduced to the leading modes
    (``var_cutoff`` of the variance) so the network sees a well-conditioned,
    manageable feature set rather than tens of thousands of coordinates.
    """
    return _align_and_reduce(frames, reference_index, var_cutoff=var_cutoff)


def _align_and_reduce(frames, reference_index, var_cutoff=None,
                      max_components=None):
    """Align frames to the reference and project onto their leading PCA subspace.

    Returns ``(n_frames, k)`` coordinates in the PCA subspace, the shared front
    half of tICA, reused by :func:`tica_series` and :func:`tica_lag_robustness` so
    a lag scan aligns and decomposes only once.

    Zero-variance directions are always dropped (so ``C(0)`` is full rank).  When
    ``var_cutoff`` is given, only the leading components explaining that fraction
    of the positional variance are kept, essential for tICA, which overfits
    badly when the kept dimension approaches the number of frames (see
    :data:`DEFAULT_TICA_VAR_CUTOFF`).  ``max_components`` is an optional hard cap.
    """
    frames = [np.asarray(f, dtype=float) for f in frames]
    n = len(frames)
    if n < 2:
        raise ValueError("Need at least two frames for tICA.")
    ref = frames[reference_index]
    aligned = np.array([_kabsch_align(f, ref) for f in frames])
    flat = aligned.reshape(n, -1)
    displacement = flat - flat.mean(axis=0)

    # The right singular vectors (Vt) are the PCA directions, in descending
    # variance order; keep the leading ones with non-negligible singular value.
    _, s, vt = np.linalg.svd(displacement, full_matrices=False)
    tol = max(s[0], 1.0) * 1e-10 if s.size else 0.0
    n_nonzero = int((s > tol).sum())
    if n_nonzero == 0:
        raise ValueError("Trajectory has no internal motion to analyze.")

    k = n_nonzero
    if var_cutoff is not None:
        var = s[:n_nonzero] ** 2
        cum = np.cumsum(var) / var.sum()
        k = min(int(np.searchsorted(cum, var_cutoff)) + 1, n_nonzero)
    if max_components is not None:
        k = min(k, int(max_components))
    k = max(k, 1)

    basis = vt[:k]                       # (k, d)
    return displacement @ basis.T        # (n, k) coordinates in the PCA subspace


def _tica_components(y, lag, n_components):
    """Solve the tICA generalized eigenproblem on already-reduced coords ``y``.

    Returns ``(components, eigenvalues)`` where ``components`` is ``(n_frames, k)``
    (sign-fixed) and ``eigenvalues`` are the corresponding (descending) lagged
    autocorrelations of the slowest modes.
    """
    n = y.shape[0]
    _check_lag(lag, n)
    y0 = y[:-lag]
    yt = y[lag:]
    m = y0.shape[0]

    # Symmetric instantaneous and time-lagged covariances over the lagged pairs.
    c0 = (y0.T @ y0 + yt.T @ yt) / (2.0 * m)
    ctau = (y0.T @ yt + yt.T @ y0) / (2.0 * m)
    # Ridge for numerical safety (tICA regularization); scaled to the data.
    ridge = 1e-6 * float(np.trace(c0)) / c0.shape[0]
    c0 = c0 + ridge * np.eye(c0.shape[0])

    # Generalized eigenproblem C(tau) w = lambda C(0) w.  eigh returns ascending
    # eigenvalues; the slowest modes are the *largest* (autocorrelation -> 1).
    eigvals, eigvecs = _generalized_eigh(ctau, c0)
    k = min(n_components, eigvecs.shape[1])
    order = np.argsort(eigvals)[::-1][:k]

    out = np.empty((n, k), dtype=float)
    for j, idx in enumerate(order):
        proj = y @ eigvecs[:, idx]       # IC time course over all n frames
        if proj[np.argmax(np.abs(proj))] < 0:  # fix arbitrary eigenvector sign
            proj = -proj
        out[:, j] = proj
    return out, eigvals[order]


def tica_lag_robustness(frames, lag=DEFAULT_TICA_LAG, reference_index=0, lags=None):
    """How stable IC1's shape is across nearby lag times, a slow-mode sanity check.

    tICA's one free knob is the lag time, and a *genuine* slow mode keeps roughly
    the same shape whether it is measured at lag tau/2, tau, or 2*tau.  An
    undersampled or spurious mode, by contrast, changes drastically and
    discontinuously at "critical" lag times (Schultze & Grubmuller, *JCTC* 2021).
    So comparing IC1 across a small spread of lags is a cheap, direct test of
    whether the slow mode is real.

    Returns ``(lags, correlations, min_corr)``: the lags tried, the absolute
    correlation of each lag's IC1 against the primary ``lag``'s IC1 (sign is
    arbitrary, hence ``abs``), and the minimum of those.  ``min_corr`` near 1 =
    stable/robust; low = lag-sensitive (see :data:`TICA_LAG_ROBUST_WARN`).  Aligns
    and decomposes the trajectory only once for the whole scan.
    """
    y = _align_and_reduce(frames, reference_index,
                          var_cutoff=DEFAULT_TICA_VAR_CUTOFF)
    n = y.shape[0]
    lag = int(lag)
    _check_lag(lag, n)
    if lags is None:
        cand = {max(1, lag // 2), lag, lag * 2}
        lags = sorted(L for L in cand if 1 <= L < n)
    base = _tica_components(y, lag, 1)[0][:, 0]
    corrs = []
    for L in lags:
        ic = _tica_components(y, int(L), 1)[0][:, 0]
        if np.std(ic) > 0 and np.std(base) > 0:
            corrs.append(float(abs(np.corrcoef(ic, base)[0, 1])))
        else:
            corrs.append(0.0)
    min_corr = min(corrs) if corrs else 1.0
    return lags, corrs, min_corr


#: A signal whose full range is below this fraction of its own magnitude carries
#: no real motion, only floating-point ripple, so it is treated as flat.
FLAT_SIGNAL_REL_TOL = 1e-5


def _is_flat_signal(signal, rel_tol=FLAT_SIGNAL_REL_TOL):
    """True if ``signal`` is constant to within numerical noise.

    A rigid selection (or any near-constant series) has no real extrema; filtering
    it leaves only ~1e-9 ripple. Without this guard the frame-count solver would
    drive the cutoff up until the extrema detector counted that ripple as motion
    and manufactured spurious key frames.
    """
    signal = np.asarray(signal, dtype=float)
    if signal.size == 0:
        return True
    scale = float(np.max(np.abs(signal)))
    if scale == 0.0:
        return True
    return float(np.ptp(signal)) <= rel_tol * scale


def filter_rmsd(
    rmsd,
    sampling_rate=1.0,
    target_frames: Optional[int] = None,
    power_fraction: Optional[float] = None,
    cutoff_frequency: Optional[float] = None,
    order=5,
    include_ends=True,
    extra_frames=None,
):
    """Run the full filter-and-detect pipeline and return a :class:`FilterResult`.

    The filter has a single degree of freedom, the low-pass cutoff, and the
    three inputs below are just different ways of naming it.  They are applied in
    strict priority order, highest first, so the outcome is never ambiguous when
    more than one is given:

    1. ``target_frames``, solve for the cutoff that yields about this many
       significant frames (see :func:`find_cutoff_for_frame_count`).  This is the
       most intuitive dial and is robust to the atom selection, since it re-fits
       the cutoff to whatever RMSD signal it is handed.
    2. ``cutoff_frequency``, use this explicit cutoff (cycles per frame).
    3. ``power_fraction``, pick the cutoff that retains this fraction of
       cumulative spectral power (see :func:`choose_cutoff_frequency`).

    With none of the three given, the filter defaults to a frame target of
    :data:`DEFAULT_TARGET_FRAMES`.

    Parameters
    ----------
    rmsd : array-like
        Per-frame RMSD series.
    sampling_rate : float
        Samples per unit time (default 1.0 => work in cycles per frame).
    target_frames : int, optional
        Desired number of significant frames (highest priority).
    power_fraction : float, optional
        Cumulative-power threshold for spectral cutoff selection (lowest
        priority).
    cutoff_frequency : float, optional
        Explicit cutoff in cycles per frame (middle priority).
    order : int
        Butterworth filter order.
    include_ends : bool
        Include the first and last frames as significant frames.
    extra_frames : iterable of int, optional
        Extra 0-based frame indices to force into the significant-frame set (the
        frames a user adds by hand).  See :func:`find_significant_frames`.
    """
    rmsd = np.asarray(rmsd, dtype=float)

    # Flat / near-constant signal: no real motion, so its only "extrema" are
    # filter ripple. Keep just the endpoints (and any user-forced frames) rather
    # than manufacturing key frames out of numerical noise, whichever cutoff mode
    # was requested. Mirrors the flat-signal guard in choose_cutoff_frequency.
    if _is_flat_signal(rmsd):
        frames, kinds = find_significant_frames(
            np.zeros_like(rmsd), include_ends=include_ends,
            extra_frames=extra_frames,
        )
        return FilterResult(
            raw=rmsd,
            filtered=rmsd.copy(),
            cutoff_frequency=0.5 * sampling_rate,
            frames=frames,
            kinds=kinds,
            target_frames=None,
            cosine_content=(cosine_content(rmsd) if rmsd.size >= 2 else None),
        )

    resolved_target = None
    if target_frames is not None:
        resolved_target = int(target_frames)
        cutoff_frequency = find_cutoff_for_frame_count(
            rmsd, resolved_target, sampling_rate=sampling_rate, order=order,
            include_ends=include_ends,
        )
    elif cutoff_frequency is not None:
        cutoff_frequency = float(cutoff_frequency)
    elif power_fraction is not None:
        cutoff_frequency = choose_cutoff_frequency(
            rmsd, sampling_rate=sampling_rate, power_fraction=power_fraction
        )
    else:
        resolved_target = DEFAULT_TARGET_FRAMES
        cutoff_frequency = find_cutoff_for_frame_count(
            rmsd, resolved_target, sampling_rate=sampling_rate, order=order,
            include_ends=include_ends,
        )

    filtered = butter_lowpass(
        rmsd, cutoff_frequency, sampling_rate=sampling_rate, order=order
    )
    frames, kinds = find_significant_frames(
        filtered, include_ends=include_ends, extra_frames=extra_frames
    )
    # Random-walk / undersampling sanity check on the signal that was filtered.
    cc = cosine_content(rmsd) if rmsd.size >= 2 else None
    return FilterResult(
        raw=rmsd,
        filtered=filtered,
        cutoff_frequency=float(cutoff_frequency),
        frames=frames,
        kinds=kinds,
        target_frames=resolved_target,
        cosine_content=cc,
    )
