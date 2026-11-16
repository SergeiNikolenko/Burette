# Retained CJSON coordinate sets

`retained-nmr.cjson` is the complete 6263-byte `data/cjson/nmr.cjson` from OpenChemistry/avogadrodata commit `67ab090bb4cc1ec9417d420f8df1f316c6a214f3`. SHA-256: `eb572e0b2bfd9a01f71708bfef9abe09062700ae4d8146b978a4d93121651709`. The upstream BSD license is retained alongside it.

Seven source coordinate sets and file-scoped NMR are retained. Tests explicitly author `3dSetsActive = 5`; the original default is 0. The current reader does not admit the producer energy fields as scientific frame energies. This four-atom fixture is not a large/indexed trajectory benchmark.
