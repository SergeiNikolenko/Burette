# Scientific reader coverage

`parseScientificFile(name, text)` in
`apps/desktop/src/lib/molecular-workbench/quantum.ts` turns a scientific text
source into a `ScientificDocument`. This audit lists every reader it dispatches
to, what each reader keeps, where it refuses, and the tests and fixtures that
cover it. Reader paths are relative to `apps/desktop/src/lib/molecular-workbench/`;
test and fixture paths are relative to `tests/` and `tests/fixtures/`.

## Dispatch and shared bounds

Before any reader runs, the dispatcher refuses text over 16 MiB (as characters
or UTF-8 bytes) and text containing NUL, so binary checkpoints never reach a
reader. File names route first, in this order: `.xyz`, `.zmat` or `.zmatrix`
carrying a `BURETTE_INTERNAL_COORDINATES_V` marker; `.zmat`/`.zmatrix`; `.cjson`;
`.qcschema`/`.json`; `.fchk`/`.fch`; `.cube`/`.cub`; `.xyz`;
`.molden`/`.molf`/`molden.input`; `.hess`. Other text starting with `{` is
QCSchema. The rest is matched by program banner within its first 64 KiB
(`quantum/signatures.ts`): ORCA property file (also any `.property.txt` or
`_property.txt` name), NWChem, Psi4, GAMESS, Q-Chem, Molpro, xtb trajectory,
then xtb output unless the ORCA banner is also present. Looser markers follow:
Gaussian banner or orientation table, `[Molden Format]`,
`$vibrational_frequencies`, and ORCA's `CARTESIAN COORDINATES (ANGSTROEM)`.
Anything else fails with the list of supported inputs.

Shared bounds (`quantum.ts`, `quantum/reader-values.ts`,
`quantum/output-history.ts`): 10,000 atoms, 2,000 frames, 2,000,000 retained
coordinate or mode values, 10,000 orbitals per table and one million grid
values. Coordinates are finite and within ±10⁶ Å. Atom count and element order
may not change between frames. The text-log readers attach energies, charges,
dipoles and orbitals to the geometry printed before them. Properties printed
after an unprinted line-search trial are dropped. A correlated total energy
replaces the SCF energy of the same geometry. File-level orbitals and modes
belong to the last geometry.

Routing as a whole is covered by `test-scientific-dispatch.test.ts`,
`test-scientific-format-routing.test.ts` and
`test-scientific-import-formats.test.ts` (fixtures in `quantum/dispatcher/`).

## Program outputs

| Reader | Yields | Limits and refusals | Tests (fixtures) |
| --- | --- | --- | --- |
| Gaussian log (`quantum/gaussian-log.ts`) | Orientation frames (a Standard table replaces the uncomputed Input table of its step); SCF and MP/CC energies; modes with symmetry, reduced mass, force constant, IR, Raman activity and both depolarization ratios; Mulliken charges and spin densities; `S**2 before annihilation`; Cartesian forces; dipole; thermochemistry; convergence. TD-DFT, CIS and EOM excited states become the frame's absorption spectrum with transition dipoles (the last block wins, so EOM-CC keeps its results over the CIS guess), velocity rotatory strengths an ECD spectrum when any is nonzero, and GIAO shieldings an NMR shielding table (`quantum/gaussian-log-properties.ts`). A `freq=hpmodes` high-precision table is skipped for the standard one that follows it. Orbitals with coefficients and basis need `pop=full` with `gfinput` on the last geometry; otherwise eigenvalues give energies and occupations only, as they do when the coefficients print a window (EOM-CC starts at the first correlated orbital). The geometry reprinted after `Optimization completed.` joins the last step with its charges, dipole and orbitals. | Frequency blocks of more than three modes are refused. Malformed orientation, Mulliken, dipole, orbital and normal-coordinate rows fail. xtb's Gaussian-format frequency output is tagged `xtb` and keeps only frequencies, reduced masses, IR and displacements. | `test-direct-quantum-readers`, `test-scientific-dispatch-readers`, `test-gaussian-log-orbitals`, `test-xtb-reader` (`quantum/gaussian-water-optimization.log`, `quantum/gaussian/`, `quantum/xtb/*-g98.out`) |
| ORCA output (`parseOrca` in `quantum.ts`) | One frame per coordinate block with its `FINAL SINGLE POINT ENERGY`; orbital energies and occupations of the last `ORBITAL ENERGIES` table; convergence; each frequency block's modes on its own geometry, with symmetry, displacements, IR (km/mol, or T² for older tables), Raman activity and depolarization; VCD, NMR shielding and absorption/CD spectra scoped to their frame; Mulliken, Löwdin and Hirshfeld charges with their spin populations, ⟨S²⟩, the Cartesian gradient as forces, total dipole and thermochemistry of the geometry printed before them; the run description (see below). | No orbital coefficients. IR and Raman rows must match their mode within 0.02 cm⁻¹; negative strengths, duplicate indices and an unknown Raman header are refused. | `test-scientific-dispatch`, `test-workbench-orca-frame-modes`, `test-orca-line-endings`, `test-orca-nmr-spectra`, `test-orca-optical-spectra`, `test-orca-circular-spectra`, `test-orca-vcd-section-boundary` `test-thermochemistry-readers` (`quantum/dispatcher/two-step-orca.out`, `quantum/spectra-orca-*.out`, `quantum/orca-log/`) |
| ORCA Hessian (`parseHessian` in `quantum.ts`) | One frame: `$atoms` (bohr, masses), `$hessian` in Hartree/bohr², modes from `$vibrational_frequencies` and `$normal_modes`, `$ir_spectrum` (five columns: T²; six: km/mol) and `$raman_spectrum`. | `$atoms` and `$vibrational_frequencies` are required. Duplicate sections, dimension mismatches, mixed row widths and depolarization outside 0–1 are refused. | `test-orca-hessian-parser`, `test-scientific-dispatch`, `test-normal-modes` (`quantum/dispatcher/*.hess`, `quantum/orca-3.0.2-methane.hess`, `quantum/orca-property/pyepfd-co2-opt-freq.hess`) |
| ORCA property file (`quantum/orca-property.ts`) | ORCA 6 keyed blocks and the ORCA 5 `!PROPERTIES!` listing: one frame per geometry index with final (or SCF plus dispersion) energy, Mulliken and Löwdin charges, dipole, gradient as forces, Hessian (ORCA 6 only), modes including rigid motions and thermochemistry; `converged: false` on abnormal status. | No orbitals and no masses. ORCA 6 coordinates must be in Bohr; geometry indices must run contiguously from 1; modes without matching frequencies are refused. | `test-orca-property-reader`, `test-thermochemistry-readers` (`quantum/orca-property/`) |
| NWChem (`quantum/nwchem-log.ts`) | Geometries in Å or a.u.; SCF/DFT and MP2/CC/CI energies; orbital energies, occupations and symmetry; Mulliken charges; dipole; the mass-weighted Hessian converted with the vibrational analysis's own masses (isotopes included), its fixed-width fields read even where NWChem 6 runs a negative value into the previous one; modes (projected replaces unprojected) with IR in km/mol; thermochemistry. A line search prints the accepted step's orbitals, charges and dipole before that geometry; they bind to it by its repeated SCF energy. | No basis or coefficients. `bq` ghost centres are refused; a DFT vector window that does not start at vector 1 yields no orbitals; an IR table not in KM/mol is refused. | `test-nwchem-reader`, `test-thermochemistry-readers` (`quantum/nwchem/`) |
| GAMESS, Firefly, PC GAMESS (`quantum/gamess-log.ts`) | Bohr input and Å optimizer geometries; final SCF energy (an unconverged placeholder is dropped) and MP/CC energies; Mulliken and Löwdin charges; dipole; force-constant Hessian with atomic weights; modes with symmetry, reduced mass, IR (converted to km/mol), Raman and depolarization, rigid motions dropped; Cartesian basis and orbitals for RHF, UHF and ROHF; the `SUMMARY OF TDDFT RESULTS` states (symmetry, transition dipole, oscillator strength) as the absorption spectrum of their geometry. CIS excitations printed one by one are not read. | Orbitals need the `ATOMIC BASIS SET` print, an RHF, UHF or ROHF `SCFTYP` and the final SCF of the last geometry. Ghost and dummy centres are refused. | `test-gamess-reader` (`quantum/gamess/`) |
| Psi4 (`quantum/psi4-log.ts`) | Geometries; SCF and post-HF energies; orbital energies with irreps and occupations; Mulliken and Löwdin charges; dipole; `Total Hessian (Symmetry 0)` with the geometry's masses; modes with signed imaginary frequencies, irrep, reduced mass, force constant, IR and displacements; thermochemistry. A finite-difference job keeps its reference geometry, which gets the vibrational analysis; displaced geometries, ghost-centre monomers (counterpoise, SAPT) and the SAD guess's one-atom geometries are not frames. | No basis or coefficients. | `test-psi4-reader`, `test-thermochemistry-readers` (`quantum/psi4/`) |
| Q-Chem (`quantum/qchem-log.ts`) | Standard Nuclear Orientation frames; SCF and post-HF energies; orbital energies (0.001 Eh) with symmetry, or (0.0001 Eh, no symmetry labels) under the bare `Alpha MOs`/`Beta MOs` header of a job without symmetry, where a bare beta block marks an unrestricted job; Mulliken, ChElPG, Hirshfeld, CM5 and Merz–Kollman charges; dipole; modes with force constant, reduced mass, IR, Raman and depolarization (dropped for Raman-inactive modes); thermochemistry; TDDFT, TDA, CIS and RPA excited states (energy, multiplicity, transition moment, strength) as the absorption spectrum of their geometry. | MO coefficients are not read: printed to five decimals, they are left to the job's FCHK or Molden file. Ghost atoms are refused. | `test-qchem-reader`, `test-thermochemistry-readers` (`quantum/qchem/`) |
| Molpro (`quantum/molpro-log.ts`) | Bohr `ATOMIC COORDINATES` and the final Å `Current geometry`; SCF and correlated energies; dipole; orbital energies and occupations in energy order (UHF spin tables titled `POSITIVE`/`NEGATIVE` in 2012 and `ALPHA`/`BETA` in 2018), and the compact `Orbital energies:` list of a closed-shell SCF, whose doubly occupied orbitals per symmetry come from `Final occupancy` only when they add up to the equal alpha and beta counts of `NUMBER OF ELECTRONS`; Mulliken charges; Hessian from force constants or mass-weighted second derivatives; modes with symmetry and IR in km/mol. | Coefficients over symmetry-adapted functions are not read (`put,molden` writes a readable Molden file). Intermediate optimizer steps are only in Molpro's `.log`. Ghost and dummy centres are refused. | `test-molpro-reader` (`quantum/molpro/`) |
| xtb output (`parseXtbOutput` in `quantum/xtb.ts`) | The `final structure` geometry (XYZ or `$coord`); total energy; the printed orbital window with source numbering; charges (Mulliken for GFN-xTB, EEQ for GFN-FF); dipole; `--ohess` thermochemistry; convergence. | Output without a printed geometry (a single point or `--hess` run) is refused and points at the input coordinates, `xtbopt.xyz`, `xtbopt.log` or `g98.out`. | `test-xtb-reader`, `test-thermochemistry-readers` (`quantum/xtb/`) |
| xtb trajectory (`parseXtbTrajectory`) | Every `xtbopt.log` frame with its `energy:` comment energy. | Every frame needs that comment; a frame cut while being written is dropped. | `test-xtb-reader` (`quantum/xtb/water-opt-xtbopt.log`, `water-unconverged-xtbopt.log`) |
| QCSchema (`quantum/qcschema.ts`, `quantum/qcschema-wavefunction.ts`) | Molecule v2; atomic result v1 for the energy, gradient (as forces), Hessian and properties drivers; optimization result v1 with initial, kept and final geometries and per-step energies under every `protocols.trajectory`; wavefunction basis and orbitals; excited-state and NMR spectra scoped to their frame; the SCF dipole (e·bohr) of each result; the model's method and basis, `provenance` and the molecule's charge and multiplicity as the run description. | Bohr only; `success` must be true; ghost atoms, unsupported versions and drivers, disagreeing energies or gradients, ECPs for orbital fields and angular momentum above i are refused. | `test-direct-quantum-readers`, `test-scientific-dispatch-readers`, `test-qcschema-wavefunction`, `test-scientific-spectra-readers` (`quantum/qcschema-water-gradient.json`, `quantum/qcschema/`) |

## Wavefunction and field files

| Reader | Yields | Limits and refusals | Tests (fixtures) |
| --- | --- | --- | --- |
| FCHK (`fchk.ts`, `fchk-vibrations.ts`) | Geometry, total energy, packed Cartesian force constants with `Vib-AtMass` or atomic weights, modes from `Vib-E2`/`Vib-Modes`, s–i shells with sp contractions, alpha and beta orbitals; restricted open shells get separate alpha and beta occupations. | IR and Raman stay unknown unless their derivative tensors are present or a value is nonzero. At most 2,000 basis functions; partial-molecule vibrations (`Vib-NDim`) and beta without alpha orbitals are refused. | `test-fchk-readers`, `test-workbench-gaussian-conventions`, `test-normal-modes` (`quantum/gaussian16-water-raman.fchk`) |
| Molden (`parseMolden` in `gaussian.ts`) | `[Atoms]` in Angs or AU, `[GTO]` s/p/sp/d/f/g with the `[5D]`, `[7F]`, `[9G]` flags, `[MO]` with symmetry, energy, spin and occupation; `orca_2mkl` normalization and sign conventions are undone. | `[STO]` Slater bases, shells above g and files without `[GTO]` or `[MO]` are refused; at most 2,000 functions and 2,000,000 coefficients. One frame, no modes. | `test-molden-fields`, `test-molden-orca`, `test-scientific-dispatch` (`quantum/dispatcher/hydrogen.molden`, `quantum/molden/`) |
| Cube (`parseCube` in `quantum.ts`) | Atoms and a scalar grid in bohr or Å (by the sign of the axis counts), oblique axes allowed. A negative atom count adds orbital datasets (`Orbital n`); `NVAL` > 1 adds interleaved fields (`Field k`); all go in `gridDatasets`, the first also in `grid`. | Atom-free cubes, orbital datasets combined with `NVAL` > 1, mixed axis units, zero-volume axes and corners beyond 10⁶ Å are refused; all fields together hold at most one million values. | `test-scientific-dispatch`, `test-molstar-cube-datasets`, `test-molstar-cube-units`, `test-quantum-science-session`, `test-cube-ui-history` (`oblique-angstrom-3fields.cube`, `cube-ui-history/three-fields.cube`) |

## Coordinate files

| Reader | Yields | Limits and refusals | Tests (fixtures) |
| --- | --- | --- | --- |
| XYZ and extended XYZ (`parseXyzTrajectory`, `trajectory-metadata.ts`) | Every frame; energy, time and temperature from `key=value` comments with explicit units; extended `Properties` columns with velocities and forces; `Lattice` stays in the frame comment, where the Crystal and Symmetry tools read it. | Unitless values are ignored. Extended XYZ needs `species:S:1` and `pos:R:3`; vector columns need a declared unit. A `.xyz` name without the internal-coordinate marker takes this reader before any content signature. | `test-scientific-dispatch`, `test-direct-quantum-readers`, `test-built-molstar-xyz-lattice.mjs` (`xyz-lattice/`) |
| Z-matrix (`scripts/zmatrix-document.mjs`, `scripts/coordinate-interchange.mjs`) | Rows with references and values or named variables (`name = value`, or Gaussian's `Variables:` section); `X` rows are reference points only; a marker restores the saved atom/definition pair. | 1 MiB, 512 rows and 1,536 variables. Gaussian `Constants` sections, expressions and mixed Cartesian rows are refused; dihedrals must lie within ±360°. A marker that disagrees with the rows is refused, never ignored. | `test-scientific-dispatch`, `test-coordinate-interchange-reader`, `test-coordinate-interchange`, `test-zmatrix-reference` (`zmatrix-reference/`) |
| Chemical JSON (`cjson-graph.ts`, `cjson-science.ts`) | Versions 0 and 1: explicit bonds, formal charges and isotopes as a source-ordered MOL graph; every `3dSets` entry as a frame; vibrations with IR, Raman activity and eigenvectors (zero padding past 3N allowed), by set through `conformers` or for the active set; Avogadro `basisSet` and orbitals (energies eV to Hartree, occupations or aufbau from `electronCount` and multiplicity); electronic, ECD and NMR spectra scoped to the file; `properties.energies` (Hartree) on their sets when there is one per set, and `totalEnergy`, `dipoleMoment` (debye) and `atoms.partialCharges` on the final geometry: the only set, or the set whose stored energy is the total energy. | 1–256 atoms, at most 2,000 sets and 2,000,000 coordinates. Bond orders 4–6, self or duplicate bonds, more than 3N vibrations, shells other than s/p/d/f/g and unnormalized primitives are refused. A periodic file (`cellVectors` or a, b, c, α, β, γ, with Cartesian or `3dFractional` coordinates) opens as extended XYZ with its lattice. | `test-cjson-graph`, `test-cjson-science`, `test-cjson-graph-codec`, `test-cjson-import` (`cjson/`, `quantum/spectra-native-nmr.cjson`) |

## CJSON coordinate sets

A multi-set CJSON opens on its active set: `3dSetsActive`, or set 0 when it is
absent, even if a separate `3d` block holds another geometry. Each set is a
frame of the document; the MOL source holds the active set's positions. The
Info dock's Coordinate set card
(`apps/desktop/src/components/workbench/coordinate-set-card.tsx`) appears for a
MOL source with at least two sets. Choosing a set writes its positions into
that MOL source as one revision (`apps/desktop/src/lib/workbench/cjson-coordinate-set.ts`);
Undo returns to the previous set, and choosing a set shown before reuses its
revision. Modes travel with their set: the chosen set's modes become the
document's and the previous set's return to its frame. Orbitals and basis stay
with the set they were computed for, so another set's revision has none and
returning to the file's own set restores them. `test-cjson-graph-codec`
covers the revision and its save and reopen
(`cjson/avogadro-formaldehyde-raman.cjson`).

## Calculation metadata

`metadata` describes the job as its output prints it: program and version, the
input keyword lines, the basis, charge and multiplicity, how the run ended
(`normal` or `error`; absent while a job runs or when the output was cut) and
the run time (`quantum/run-metadata.ts`). ORCA and Gaussian output give all of
them (Gaussian: the first route section and the elapsed time of all links);
QCSchema gives the model, `provenance`, charge and multiplicity. xtb output gives its
version, Hamiltonian and command-line options, charge and unpaired electrons,
termination and total wall time. Q-Chem gives the method, job type and basis
of the first `$rem` and the charge and multiplicity of the first `$molecule`.
GAMESS and Firefly give the method keywords and basis from their printed
option tables (the Pople and Dunning families get their usual names, a
semiempirical `GBASIS` stays a keyword), `ICHARG` and `MULT`. Molpro gives the
programs the input ran, the basis it set, and the charge and multiplicity from
the nuclear charge and the first SCF's electron counts; a restarted job that
reads its basis from a record has none. The
Info dock's Calculation card shows them with the energy of the geometry the
scene shows and whether the job converged. `test-calculation-metadata` checks
each reader against its printed lines.

## Thermochemistry

`frames[i].thermochemistry` holds the ideal-gas values a frequency job printed
for that geometry: temperature, zero-point correction, and absolute enthalpy and
Gibbs energy in Hartree per particle, and the entropy in cal/(mol·K). Readers
share one rule table (`quantum/thermochemistry.ts`). NWChem and Q-Chem print
enthalpy corrections, which are added to the frame's energy, and no Gibbs
energy, which is then H − T·S; ORCA and xtb print T·S, which becomes the
entropy. `test-thermochemistry-readers` compares every reader with its
program's printed numbers.

## Optimization convergence

`frames[i].convergence` holds what a geometry optimizer printed for the step it
took from that geometry: maximum and RMS force (gradient, hartree per bohr),
maximum and RMS step, the energy change and xtb's gradient norm, each with the
threshold when the program printed one (`quantum/convergence.ts`). The energy
change comes from ORCA's and Q-Chem's tables and the Psi4 and NWChem step rows;
a first step, which has no previous energy, has none. Gaussian and ORCA print all four items with
thresholds; Q-Chem prints the maximum gradient and displacement; Psi4 prints a
row per step whose inactive criteria have no threshold; NWChem prints a row per
step and its thresholds once in the optimizer header. GAMESS prints the maximum
and RMS gradient of each search step (`NSERCH: n E= … GRAD. MAX= … R.M.S.=`);
its thresholds are `OPTTOL` and `OPTTOL`/3, the criteria GAMESS applies. Psi4,
NWChem and GAMESS rows are kept only on the frame whose energy they repeat, so a
summary reprint cannot move a value to another geometry. xtb's `xtbopt.log` gives each frame its gradient norm; an xtb output, which
prints only the final structure, gives it the last cycle's energy change and
gradient norm with the `energy convergence` and `grad. convergence` thresholds,
when that cycle's energy is the final energy. The
Plots panel draws the chosen item on a log axis with the threshold dashed.
`test-optimization-convergence` checks every reader against its printed table.

## Known gaps

- ORCA, NWChem, Psi4, Q-Chem, Molpro and xtb text outputs give orbital
  energies and occupations only; their coefficients, and so orbital fields,
  come from FCHK, Molden, QCSchema or CJSON files.
- ORCA output keeps no Hessian; the ORCA property file keeps no orbitals or
  masses.
- QCSchema results carry no modes; a Hessian result keeps only the matrix.
- CJSON results that no coordinate set can be named for (energies whose count
  differs from the sets, and then the total energy, dipole and charges) and
  `atoms.forces`, whose unit Avogadro does not record, are not read. A periodic
  CJSON keeps only atoms and cell: no bonds, vibrations, orbitals or spectra.
- Ghost and dummy centres are refused wherever a reader can meet them.
- xtb output keeps only its final structure; Molpro output keeps no
  intermediate optimizer steps.
- Gaussian frequency blocks wider than three modes, FCHK vibrations of part of
  the molecule, Molden Slater bases and shells above g, and Cubes with both
  orbital datasets and several values per point are refused.
