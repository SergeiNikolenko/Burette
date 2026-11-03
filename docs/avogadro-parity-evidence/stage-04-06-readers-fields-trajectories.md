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

The packaged browser shell from `9b7a8ccde` opened the same PDB/TRR pair via
the trajectory startup route. The topology matched
`tests/fixtures/trajectory/vector-reference.pdb` byte for byte. The TRR was
the concatenation of `vectors.trr` and `forces-only.trr` in that directory.
Opening these files together in the ordinary multi-file picker created
separate tabs. The paired startup route created a single trajectory.

In the Codex in-app browser, Cmd+P → Show plots opened the panel. The viewer's
frame buttons moved between frames and Enter on Export frame downloaded each
CSV. The second frame showed 4.250 ps and both force metrics. Returning to
the first frame showed 2.750 ps, RMS speed 0.931 Å/ps and a 28.422 Å distance
for source atoms 1 and 2. MDAnalysis 2.11.0 independently matched the three
exported elements and source indices, all coordinates and the presence or
absence of vector columns. The comparison converted MDAnalysis forces from
kJ/(mol·Å) to kcal/(mol·Å).

| Frame | Max coordinate error, Å | Max speed component error, Å/ps | Max force component error, kcal/(mol·Å) | CSV SHA-256 |
| --- | ---: | ---: | ---: | --- |
| 1 | 0 | 2.98e-8 | 8.02e-8 | `a2e661a28366bb534cc44bbb242aaab0af4e12f3376613b864fd836147e2c4a7` |
| 2 | 0 | no velocity columns | 1.60e-7 | `e9875c2e36742517a90029c2c4a8d715a9b9c4f12fa837cfcc88bb3d61525c34` |

The packaged renderer rejected a two-segment TRR pair with its explicit
shared-topology XTC requirement. Two XTC segments with the same PDB topology
opened in 3D. Both segments showed two frames in the segment chooser.
Selecting the second segment moved to its first frame, and Next frame moved
to its second frame. A paired PDB/DCD also opened in 3D and advanced to frame
2 of 2. The XTC and DCD files were written and read back with MDAnalysis
2.11.0 from the three-atom TRR source with a 1.5 ps frame interval. The
second XTC segment translated all atoms by +15 Å along x. The browser
observations establish player navigation. Neither XTC nor DCD exposed
Show plots in the browser palette for these paired files.

Scientific comparison of displayed XTC and DCD positions and cell geometry,
indexed plots/CSV for those formats, and the large-file matrix are open.

## Quantum sources and fields

Source and compiled-shell orbital job checks exercised signed orbital,
total-density and spin-density Cube artifacts with hashes and source
revision checks. They covered stale jobs, cancellation, close/reopen and
the grid size limit. These checks establish the tested job and artifact
contract. The explicit grid job and live multi-dataset Cube field display,
export and reopen still need their own acceptance. Scientific reader
fixtures and their limits remain in the
[coverage audit](../scientific-format-coverage.md).
