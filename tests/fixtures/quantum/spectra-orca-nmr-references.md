# ORCA NMR source fixture

`spectra-orca-nmr.out` retains source lines 3305–3312 and 4237–4248, in that
order and without numerical edits, from OpenChemistry/avogadrodata
[`data/orca/nmr.out`](https://github.com/OpenChemistry/avogadrodata/blob/67ab090bb4cc1ec9417d420f8df1f316c6a214f3/data/orca/nmr.out).
The original SHA-256 is `fdc689cd8f300784843cf16a63b763f8a7775fac4d08fab712342120bd2d85ea`.
The four final-geometry atoms, zero-based nucleus indices, isotropic shielding
and anisotropy are unchanged. The header explicitly declares shielding in ppm;
no reference subtraction belongs in this reader. The repository's retained
Avogadro BSD notice applies; the upstream data README declares three-clause BSD.

The Avogadro d250eb3c62a61470b1e0cdf205dcfe26b06f991f ORCA reader
(`quantumio/orca.cpp:1042–1071`) applies one-based and then zero-based fallback
per row. On this actual zero-based table it overwrites nuclei, producing
`[-394.078, 21.901, 21.901, 0]`. This reader intentionally repairs that defect
by validating one index base and element correspondence for the complete table.
Sparse ambiguous tables are rejected; uncomputed atoms have no invented zero.

The helper returns original-text offsets for the owning coordinate reader to
associate with source frames. It does not parse coordinates, guess a final
frame, or activate ScientificDocument/MOLX/UI integration. Tests with artificial
rows cover index-base and refusal boundaries; they are not QC reference data.
