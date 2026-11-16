# ORCA electric-dipole optical source fixture

`spectra-orca-camphor.out` concatenates unchanged source blocks 270–299,
1864–1884 and 1908–1928 from OpenChemistry/avogadrodata commit
`67ab090bb4cc1ec9417d420f8df1f316c6a214f3`, `data/orca/camphor.out`.
The original 98,999-byte file SHA-256 is
`9eab985435aaf914fe4873b736b6c5d03a04faa59b4c530f206dc4ac731bc845`.
Only unrelated output and the separate velocity-dipole tables are omitted.
The source transition IDs, geometry and all numeric electric-dipole table
columns are unchanged. The retained Avogadro BSD fixture notice applies.

The source reader reference is OpenChemistry/avogadrolibs commit
`d250eb3c62a61470b1e0cdf205dcfe26b06f991f`, `quantumio/orca.cpp:975–1040`.
That reader recognizes 8/11-column absorption and 7/10-column CD rows. The real
fixture verifies the modern forms. The legacy-form tests are authored format
regressions grounded in those source column accesses, not an actual ORCA run.
An actual legacy optical fixture and spin-forbidden-row syntax remain coverage
gaps; incomplete or unknown rows are refused instead of inventing zero strength.

The projector reads electric-dipole tables only, matching the native channel.
It keeps every declared numeric column and does not convert source cm^-1 to eV.
The independent plotting layer performs that display conversion. CD keeps its
own declared energies and transition labels, avoiding native count-only pairing
with an unrelated absorption table. This is the explicit standalone/independent
CD axis repair documented in the earlier matrix projection stage.

Offsets address the original input string, including CRLF/CR and UTF-16 prefix
length. The owning coordinate parser must bind each table to its lexical source
frame; the projector does not guess the current or final frame. Normal-reader,
ScientificDocument/schema/MOLX and UI activation are separate prerequisites.
