# Additional spectra source projections

The projections follow OpenChemistry/avogadrolibs commit
`d250eb3c62a61470b1e0cdf205dcfe26b06f991f`:

- `qtplugins/spectra/spectradialog.cpp:381–450, 604–625`: six matrix keys,
  native axis units, Electronic third-column priority for CD and explicit type admission.
- `io/cjsonformat.cpp:1310–1361`: electronic energies/intensities/rotation
  and dense atom-ordered `nmr.shifts`.
- `quantumio/qcschema.cpp:430–508`: excited-state energies in nm (default),
  cm^-1 or eV, and dense atom-ordered `nmr_shifts.isotropic`. These are the pinned
  Avogadro property extensions, not a claim that MolSSI standardizes these fields.

The existing real `spectra-native-nmr.cjson` fixture is unchanged. Its values
match the actual ORCA shielding source, as documented by the C1 fixture. Generic
CJSON/QCSchema field names alone do not establish a physical reference, so these
projections explicitly retain `native-input`; they never pre-reference values.
Unsupported reference/quantity annotations are refused, rather than silently
converting an already-referenced shift again. NMR display settings and formula
remain a separate, auditable choice in the plotting API, not source mutation.

Native matrix rows use fixed published columns; unsupported extra columns fail.
NMR rows must cover the supplied source atoms exactly; sparse indexed ORCA NMR
uses its separate reader. MCD's third absorption column and native NMR weight
are retained. With paired Electronic/CD matrices, row axes must match exactly;
Electronic's third column has native display priority, while the other CD signal
is retained as an auxiliary column. A standalone CD matrix uses its own declared
axis. This intentionally repairs the native dialog's access to absent Electronic
data; it does not invent an absorption spectrum or zip unrelated data by count.

These functions accept already parsed matrix/subtree values with explicit source
provenance and atom context. They preserve raw CJSON/QCSchema vector references
and do not parse coordinates, select a live source/frame, acquire files, or
activate a normal application reader, ScientificDocument/MOLX or UI. QCSchema
unit fixtures and native six-key matrices in the tests are authored boundary
cases, not actual quantum output. An actual six-type file fixture, file producer
for DOS, real QCSchema spectral fixture and actual ORCA VCD/MCD fixture have not
been established here. DOS matrix/data-API support remains real independently.
