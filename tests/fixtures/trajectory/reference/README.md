# Explicit reference geometry controls

These small analytic fixtures were independently authored before the reference-index correction. The two-frame XYZ has C–O distances 1/2 angstrom and declared energies -1.25/-2.5 Hartree. The two legacy science documents have distinct or duplicate history geometries, global modes/orbitals and file-scoped NMR, but no reference-index field. They are not real calculation outputs.

Both MOLX archives were generated with the independently accepted B1a native/codec runtime before the correction, then independently reopened and checked for exact source, Original and all science fields. Their matching JSON is the expected complete scientific payload. Tests must reuse these frozen bytes rather than generate supposedly legacy archives with the new codec.

Provenance receipt: reference-frame-independent-oracle/manifest.json, SHA-256 71470bb3103284f6e0ed5452c4d30dce75d2c02dd6ee3ea130cef09f03a340ca. The existing synthetic ORCA dispatcher fixture is reused at ../../quantum/dispatcher/two-step-orca.out; the full upstream CJSON fixture remains ../retained-nmr.cjson with its own license/provenance.
