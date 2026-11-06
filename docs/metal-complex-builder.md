# Metal complex builder

`apps/desktop/src/lib/molecular-workbench/metal-complex.ts` places rigid ligand templates
on an ideal coordination polyhedron around one metal and returns an explicit graph with
formal charges and separate metal–donor coordination bonds. The worker
(`lib/workbench/metal-complex-task.ts`, `metal-complex-worker.ts`) serializes it as SDF or
MOL; the dialog (`components/workbench/metal-complex-builder-host.tsx`, request
`{ kind: "builder", builder: "metal", document: null }`, command palette *Build metal
complex…*) previews it and opens it as a new document. Agents build the same file with
the documentless `metal_complex` job ([agent-platform.md](agent-platform.md#structure-editing-and-builder-jobs)). Placement alone establishes neither energetic stability nor the metal's
oxidation or spin state: the builder writes the oxidation state the user chose, and the
geometry is an unrelaxed model.

## Avogadro parity

The reference is the Template tool of OpenChemistry/avogadrolibs
(`avogadro/qtplugins/templatetool`, revision `064eeb4706877ffed8ddc4b037489ed3748b0547`,
BSD-3-Clause, notice in `docs/third-party/avogadro-LICENSE`). Avogadro inserts a metal
center template (coordination numbers 1–8, hydrogen placeholders at 2 Å) on click and
replaces placeholders with ligand templates by Kabsch alignment of the template's dummy
atom, aligning a polydentate ligand to the placeholders in the order the user clicked
them; a haptic ring's centroid dummy is removed and the ring gets no metal bond. Burette
builds the complete complex in one request: metal, oxidation state, geometry, the
ligands and their sites, metal–donor distances. It covers coordination numbers 2–8
(linear, trigonal planar, tetrahedral, square planar, trigonal bipyramidal, square
pyramidal, octahedral, trigonal prismatic, pentagonal bipyramidal, hexagonal
bipyramidal, square antiprismatic) and the whole Avogadro ligand library except one
broken template (below). Unlike Avogadro it chooses the donor-to-site assignment
itself, refuses site sets the rigid ligand cannot reach (terpyridine only meridional,
tacn and Tp only facial octahedron sites), and gives haptic rings a coordination bond
from every ring carbon. Clipboard ligands are not offered.

Burette's polyhedra match Avogadro's center templates within 0.2° except square
pyramidal: Burette uses the vacant octahedron (apical–basal 90°, trans basal 180°);
Avogadro's `5-spy` is a C4v pyramid with 113.4° apical–basal and 133.2° trans angles.
Burette's trigonal prism and square antiprism have equal edges (Avogadro's `6-tpr` and
`8-sqa` are uneven, up to 14° and 27° off), and the hexagonal bipyramid, which
Avogadro lacks, holds a crown ether's six donors with two axial ligands.

## Request and result

`MetalComplexBuildRequest` is `{ metal, oxidationState, geometry, ligands, format }`:

- `metal`: Sc–Zn, Y–Cd, Hf–Hg, Mg, Al or Ga.
- `oxidationState`: integer from −2 to +8, written as the metal's formal charge.
- `ligands`: at most 8 `{ ligand, sites, distance? }`. `sites` are 0-based indices into
  `COORDINATION_GEOMETRIES[geometry].sites`, one per donor and one for a haptic ring; a
  bidentate ligand lists two sites whose directions are less than 135° apart (cis), a
  ligand with three or more donors a set from `fittingSiteSets(ligand, geometry)`.
  Every site holds exactly one ligand. `distance` (Å, 1.4–3.5) applies to every donor
  of a mono- or bidentate ligand and is the metal–centroid distance of a haptic ring;
  ligands with three or more donors keep their template distances and refuse it.
- `format`: `"sdf"` or `"mol"` (the same record without `$$$$`).

`MetalComplexBuildResult` returns `text`, `format`, `name` (an IUPAC-style formula such
as `[Co(NH3)6]3+`, also the document name), `atomCount`, `bondCount` (covalent plus
coordination bonds), Hill `formula`, total `charge`, `coordinationNumber`, `geometry` and
`graph` (`atoms` with formal charges, Kekulé `bonds`, `coordination` edges with `a` the
donor and `b` the metal at index 0). Invalid requests fail with a named error; nothing is
partially placed.

### Site numbering

| Geometry | Sites (unit directions) |
| --- | --- |
| Linear | 1 +x, 2 −x |
| Trigonal planar | 1–3 in the xy plane at 0°, 120°, 240° |
| Tetrahedral | 1 (+,+,+), 2 (+,−,−), 3 (−,+,−), 4 (−,−,+) |
| Square planar | 1 +x, 2 +y, 3 −x, 4 −y |
| Trigonal bipyramidal | equatorial 1–3 at 0°, 120°, 240°; axial 4 +z, 5 −z |
| Square pyramidal | basal 1 +x, 2 +y, 3 −x, 4 −y; apical 5 +z |
| Octahedral | equatorial 1 +x, 2 +y, 3 −x, 4 −y; axial 5 +z, 6 −z |
| Trigonal prismatic | upper triangle 1–3 at 0°, 120°, 240°; lower 4–6 below them (equal edges, z = ±√(3/7)) |
| Pentagonal bipyramidal | equatorial 1–5 at 72° steps; axial 6 +z, 7 −z |
| Hexagonal bipyramidal | equatorial 1–6 at 60° steps; axial 7 +z, 8 −z |
| Square antiprismatic | upper square 1–4 at 0°, 90°, 180°, 270°; lower 5–8 turned 45° (equal edges) |

## Ligands

`metal-ligands.json` holds 76 templates: 75 of the 76 files under `ligands/` of
OpenChemistry/fragments `7d842f435aec4729a308b23ad7f9501bdd44aa02` (BSD-3-Clause,
`docs/third-party/fragments-LICENSE`) plus hydroxido (aqua with one H removed), with the
source path and SHA-256 of each file: 30 monodentate, 11 bidentate, 7 tridentate, 9
tetradentate, 3 hexadentate and 16 haptic. `scripts/generate-metal-ligands.ts`
regenerates it. Coordinates and covalent bonds are copied; a template's dummy atom
bonded to its donors marks the metal position and is stored as `metal`; a haptic
template's two bonded dummies are the ring centroid (`centroid`, its ηⁿ carbons become
the donors) and the metal 2 Å away.

Formal charges follow the bond orders in the dative (ionic) ligand model, so metal
charge plus ligand charges is the total charge: an atom one bond short of its valence
is −1 (alkyls, cyanido C, alkoxide/carboxylate/thiolate O and S, amide N of
porphyrinato and phthalocyaninato), one bond over is +1 (carbonyl O, nitrosyl O, azide
central N), a four-bonded boron (Tp) is −1. The file charges are not used: several
contradict their own bonds. Explicit exceptions are the SIMes carbene carbon (0),
cyclopropenyl and tropylium cations (+1). RDKit reads every reference complex back
with the expected ligand SMILES. The generator corrects the source where it is wrong:

| Template | Correction |
| --- | --- |
| `nta`, `tpa` | the tertiary amine N carried an H; removed |
| `9-ane-S3` | each thioether S carried an H; removed |
| `isocyano` | N=C with a bare carbon becomes N≡C⁻ |
| `eta3-indenyl`, `eta5-indenyl` | one carbon had two double bonds; indenide Kekulé structure (C2⁻) |
| `eta5-fluorenyl` | one carbon had two double bonds; C9 is the carbanion |
| `tacn`, `cyclen`, `cyclam`, `hexaaza-18-crown-6` | the amine N had no H; one is added opposite its neighbours or, for a planar N, along the normal away from the metal |
| `tpen` | left out: one pyridine N sits 1.5 Å from the metal and its donor angles fit no polyhedron |

## Placement

- A monodentate template is rotated so that its donor → dummy direction (the template's
  lone-pair direction) points from the donor at the metal, and the donor sits on the site
  direction at the requested distance. Its rotation about the M–D axis is chosen among
  24 steps of 15°.
- A bidentate template keeps its donor–donor span: the donor midpoint lies on the
  bisector of the two site directions, the donor–donor vector in their plane, the
  dummy on the metal side, and both donors at the requested distance. The bite angle
  is therefore `2·asin(span / 2d)`, not the ideal site angle; the other sites stay ideal.
  Either donor may take either site.
- A template with three or more donors stays rigid around its own metal position. Every
  donor-to-site assignment whose donor–metal–donor angles match the sites' within 25°
  is rotated onto them (Horn's quaternion fit about the metal, `bestRigidMotion`); fits
  whose worst donor is more than 25° off its site are refused, and the best fits within
  5° of each other are the candidate poses. `fittingSiteSets` lists the site sets this
  admits, which the dialog offers.
- A haptic ring is placed like a monodentate donor with its centroid on the site. The
  default metal–centroid distance gives every ring carbon an M–C(sp2) bond of Cordero
  radii, √((r(M) + 0.73)² − r(ring)²), at least 1.5 Å: 1.67 Å for ferrocene (1.65
  measured), 1.61 Å for Cr(C₆H₆)₂ (1.61).
- Ligands are placed in request order, each choosing the pose that maximizes its closest
  contact with earlier ligands, then one sweep re-chooses each pose against all others.
  Ties keep the earlier pose, so the output is deterministic.
- The build is refused when atoms of different ligands, or a non-donor atom and the
  metal, are closer than their covalent radii plus 0.35 Å: the XYZ bond-perception rule
  in `molecular-graph.ts`, so no export can read back an extra bond. A haptic ring's
  carbons and atoms the template itself draws that close to its metal (the fifth carbon
  of η⁴-C₅H₅, a CH₂ hydrogen of `nta` or `9-ane-S3`) are exempt.
- Default distances are sums of Cordero single-bond covalent radii (Dalton Trans. 2008,
  DOI:10.1039/B801115J), with the low-spin Mn, Fe and Co radii and the sp/sp2 carbon
  radius for triple- or double-bonded C donors.

## File format and round trips

Coordination bonds are written as bond type 9 from donor to metal in V2000 with
`M  CHG` charges (V3000 with `CHG=` above 999 atoms or bonds). The CTfile specification
lists type 9 for V3000, but RDKit 2025.09 (dative bonds), Open Babel 3.1 (order 9),
OpenChemLib 9.25 (metal–ligand bonds, order 9 in `parseMolecule`) and Mol* 5.11 read it
in V2000, and Mol* ignores V3000 `CHG=`; V2000 keeps the formal charges in the viewer.

- The new document's source is the generated SDF text; reading it again with
  `parseMolecule` yields the same atoms, covalent bonds and coordination bonds.
- Mol* mmCIF export (`to_mmCIF`, the viewer's structure export) keeps atoms and formal
  charges; the coordination bond type is lost and Mol* re-perceives metal–donor bonds
  from distances on reopening.
- The viewer's PDB export copies `ATOM`/`HETATM` records from a PDB source text, which
  an SDF source does not have.

## References

`tests/fixtures/metal-complex/README.md` lists the COD crystal structures, tools,
commands and tolerances. `tests/test-metal-complex-builder.test.ts` checks the exact
builder output against RDKit and Open Babel read-back (formula, charge, atoms, bonds,
dative bonds, ligand SMILES), donor–metal–donor angles and chelate bites against the
crystal structures, default distances against crystal means and Open Babel's radii,
ligand rigidity and lone-pair direction, Avogadro's center templates, and OpenChemLib
and Mol* read-back. `tests/test-metal-complex-worker.test.ts` and
`tests/test-metal-complex-dialog.test.tsx` cover the worker and the dialog.

## Limits

- No relaxation, no vacant sites, no more than one metal, at most 256 atoms.
- Polydentate templates keep their drawn metal–donor distances (cyclam and cyclen
  1.88 Å, porphin 2.0 Å) whatever the metal; their planar amine nitrogens leave the
  added N–H about 2.1 Å from the metal. Optimize the structure after building.
- Ideal polyhedra do not follow Jahn–Teller elongation or the trigonal twist of
  tris-chelates; default distances do not model π back-bonding (Fe–CO 0.21 Å long) or
  Jahn–Teller apical bonds (Cu–OH2 0.6 Å short). Edit the distance where it matters.
- Rigid templates keep their own conformation: the ethylenediamine template's N···N span
  gives an 89.8° bite at 1.96 Å against 85.5° in [Co(en)3]3+.
- Crowded choices (for example six PMe3 on an octahedron) are refused rather than
  relaxed.
