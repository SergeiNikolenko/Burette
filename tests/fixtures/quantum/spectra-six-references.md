# Additional scientific spectra fixtures

`spectra-native-nmr.cjson` is minimized from OpenChemistry/avogadrodata at commit
67ab090bb4cc1ec9417d420f8df1f316c6a214f3, data/cjson/nmr.cjson:
https://github.com/OpenChemistry/avogadrodata/blob/67ab090bb4cc1ec9417d420f8df1f316c6a214f3/data/cjson/nmr.cjson
Original SHA256 eb572e0b2bfd9a01f71708bfef9abe09062700ae4d8146b978a4d93121651709.
Kept atom order, Cartesian coordinates, bonds and spectra unchanged; removed unrelated
orbital/layer/charge metadata and redundant coordinate sets. The upstream README
describes the project's three-clause BSD license; see the existing Avogadro license.
The raw NMR values are native source ppm inputs, before element-specific reference
adjustment. No calculated spectrum or physical reference values were invented.

Tests with all six kinds exercise the real native-matrix data API contract using
explicitly synthetic values; they are not represented as quantum calculation output.
Actual ORCA/MCD/DOS reader fixture coverage is documented separately in the owning
source contract and subsequent reader stage.
