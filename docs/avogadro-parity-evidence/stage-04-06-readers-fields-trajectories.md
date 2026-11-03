# Stages 4–6 evidence: scientific readers, fields and trajectories

## Indexed trajectory plots

The source owner in `87f71e7aa` retains scientific reader precedence. Indexed
Plots reads the displayed frame slice, seeks with the global frame index and
uses explicit velocities and forces when a frame provides them. Geometry is
computed for the chosen source atoms. The frame count and CSV are bounded.

In the Codex in-app browser, the `vite-dev` shell opened a paired PDB/TRR
trajectory checked against MDAnalysis 2.11.0. Frame 1 showed 2.750 ps,
0.931 Å/ps RMS speed and 3.742/2.209 maximum/RMS force. Frame 2 showed
4.250 ps and 7.483/4.418 maximum/RMS force. The frame without velocities
had no speed value. The selected pair distance was 28.422 Å. The indexed
Plots tests covered displayed frame ownership and CSV in the test harness.

Live CSV download, XTC and DCD, multi-segment seek and the full large-file
matrix are open.

## Quantum sources and fields

Source and compiled-shell orbital job checks exercised signed orbital,
total-density and spin-density Cube artifacts with hashes and source
revision checks. They covered stale jobs, cancellation, close/reopen and
the grid size limit. These checks establish the tested job and artifact
contract. The explicit grid job and live multi-dataset Cube field display,
export and reopen still need their own acceptance. Scientific reader
fixtures and their limits remain in the
[coverage audit](../scientific-format-coverage.md).
