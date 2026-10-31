# Scientific spectrum display worker

The six additional scientific spectra use the accepted `plotScientificSpectrum`
kernel: VCD, MCD, NMR, electronic absorption, electronic circular dichroism, and
DOS. The worker keeps its exact signed Float32 grid, source row indices, NMR atom
indices, units, and display settings. It does not alter the source columns used
by CSV/JSON exports. Peak centers and signed heights come from that same kernel.

`computeScientificSpectrum` checks the bounded source contract before cloning,
then evaluates the existing limits (200,000 samples and 100,000,000 peak evaluations)
in a private worker. Abort terminates the loop; the worker also has a 60-second
limit. A caller owns source identity and must cancel/discard work after its source
changes. The task itself is source-independent and does not publish a document.

The SVG display receives at most 1,026 selected grid indices. These include both
endpoints and each raw/smoothed channel's minimum and maximum in 256 consecutive
bins. This is a drawing envelope, not a new resampled scientific curve: all exact
numeric samples remain in the result. Signed extrema survive the bounded drawing.

`test:scientific-spectrum-worker` runs actual workers against all six pinned C++
whole-grid fixtures, signed extrema, NMR source-atom identity, cancellation and
input/work limits. `check:scientific-spectrum-worker` checks the imported worker
and test types. The panel and its real Browser interaction require separate proof.

## Panel and source ownership

The dedicated Spectra owner follows the current scientific revision and exact scene
frame. A scientific final import is a single materialized XYZ frame and uses the
last source frame; a steps document follows the reported trajectory index only
when frame counts match. File-wide spectra, frame-specific spectra and an explicit
paired MCD source are separate choices. No equal-geometry or name matching occurs.

The panel supports all six kinds, signed axes, NMR element/reference settings,
source row identities and 50-row pages. Raw source columns (including auxiliary
columns such as MCD absorption) remain separate from display curves. CSV/JSON
exports preserve those source values; display settings export independently.
NMR references are editable approximate starting values, not isotope calibration.

Each source/frame change remounts its owner; each settings change aborts the prior
worker. A retired worker cannot publish after replacement or Cancel. Retry starts
a new request. The plot has keyboard Home/End/arrow selection linked to exact
source-row IDs, with source-atom labels for NMR. Selection here is within the
spectrum and its source table. For a frame-scoped NMR dataset owned by the current
XYZ source, these gestures also select the exact source atom in Mol*. The existing
source/viewer target and native trajectory address must remain current; see
[spectrum atom selection](spectrum-atom-selection.md).

`test:scientific-spectra-panel` uses compiled React components, real workers, real
ORCA NMR input, source/frame replacement, explicit companion data, exports and
cancel/retry. `check:scientific-spectra-panel` checks that source/test closure.
Compute, palette and dock activation, ordinary MCD companion admission, paired
draft persistence and actual Browser acceptance remain separate stages.

## Spectra entry points

For a document with a file dataset or data for its exact displayed frame, Spectra
appears in the right-dock picker, Compute menu and Command Palette (`Show spectra`).
All three routes use the same lazy owner and bind the dock to the requested document.
Palette focus additionally retains the requested workspace and tool kind, so a
late close cannot focus another workspace or another tool showing the same file.
The ordinary imported NMR/optical reader path is exercised by
`test:scientific-spectra-activation`; full actual Browser acceptance remains open.

## Display choices across dock remounts

Spectra keeps only display choices for the last 64 document/frame owners: source,
spectrum kind, NMR element, plot settings, raw visibility, source row and page.
Each source retains at most 64 kind/element views. An exact document lifetime,
scientific revision and logical source own these values; source-store events
invalidate an unmounted panel too, including a same-turn revision rollback.
Ownership references are weak and the cache contains no scientific arrays, worker
results, viewer targets or native leases. Restoring a selected row does not send a
new molecular selection request. Reopening the same owner recalculates its plot.

The compiled display test covers the observed Settings/dock remount failure using
the actual camphor and NMR fixtures, source replacement/rollback and a bounded
synthetic pagination dataset. Actual Appearance navigation is a separate Browser
acceptance step after adoption.
