# Optical source columns

The actual pinned ORCA `camphor.out` electric-dipole absorption table contains
transition labels such as `0-1A -> 1-1A`, eV, cm-1, nm, oscillator strength,
D2 and DX/DY/DZ. Its 11 columns include three transition-label tokens and eight
numbers. Besides the primary energy and signal, six numerical columns must
survive source export. The corresponding CD table carries signed R and MX/MY/MZ.

This additive data contract preserves optional producer row identities and up
to six auxiliary columns; the existing 10,000 total rows, 100,000 total scalar
values and 8 MiB serialized-file bounds remain. Row labels are unique and at
most 128 characters, counted toward the scalar budget. NMR continues to use
explicit atom indices instead. The original source bytes and labels remain
separate from display settings and float32 curves. Unlabelled datasets retain
their previous CSV shape, and the plotting API retains its behavior.

The authored test values exercise storage, identity and export, not a new QC
calculation or an upstream numerical oracle. Actual file-reader projections
are the next separate stage. Primary source: OpenChemistry/avogadrodata commit
`67ab090bb4cc1ec9417d420f8df1f316c6a214f3`, `data/orca/camphor.out:1865–1884`.
