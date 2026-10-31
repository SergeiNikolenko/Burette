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
