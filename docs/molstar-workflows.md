# Molstar workflows

This document records Molstar capabilities that Burette exposes as product or
agent workflows. It separates upstream availability from a Burette contract and
from scientific validation.

## Adopted in Molstar 5.11

| Workflow | Burette action or command | Result contract | Validation boundary |
| --- | --- | --- | --- |
| Assembly symmetry | `show_assembly_symmetry` / `showAssemblySymmetry` | Adds the upstream `Global Symmetry` axes-and-cage state object. The result reports its label and point-group description. | Requires assembly metadata and the RCSB provider at `https://data.rcsb.org`. Absence of a non-C1 object is reported as a warning. |
| xTB charges and Fukui indices | `color_xtb_charges`, `color_xtb_fukui` / `colorScalarField` | Persistent atom overpaint with an 11-bin signed blue-white-orange scale, strict one-value-per-displayed-atom mapping, and provenance echo. | Fukui values remain signed. Atom-count mismatch fails instead of applying a shifted map. Method, charge, multiplicity, and solvent belong in provenance. |
| Water bridges | `show_water_bridges` / `showWaterBridges` | Creates a tagged Molstar interactions representation with the water-bridge provider enabled. | These are candidates. Confirm explicit waters, donor/acceptor chemistry, occupancy, alternate locations, and geometry before interpretation. |
| Large assemblies | `apply_mesoscale_preset` / `applyMesoscalePreset` | Applies Molstar's mesoscale spacefill preset with instance granularity and level of detail. | The result identifies the graphics mode. Compare assembly instance counts before and after applying the preset. |
| Image export | `screenshot` / `export_image` | Applies requested resolution, PNG/JPEG/WebP format, quality, alpha, axes, illumination, and relative crop; reports the encoded MIME type and actual output dimensions. | Consumers must decode the data URI and verify dimensions/hash on the written artifact. |
| Stories | `observe_story`, `control_story` | Reports all snapshot ids/names/current index/playback state and controls next, previous, goto, play, and pause. | A Story is a multi-snapshot state. Loading one frame does not prove the sequence. |
| Native Molstar session | `export_session` / `exportSession` | Returns a real Molstar `.molx` or `.molj` serialization, including managed assets, as base64 with byte count and a 2 MiB inline limit. | This is not called MVS. Arbitrary Molstar state cannot be losslessly claimed as MolViewSpec. Larger sessions require a future path-based artifact export. |
| Density and reflection data | Open `.ccp4`, `.mrc`, `.map`, `.mtz`, or a structure-factor `.cif` | CCP4-family maps use the native volume provider. MTZ amplitude/phase pairs produce 2Fo-Fc and signed Fo-Fc maps. CIF is routed to the structure-factor provider when `_refln.pdbx_FWT` and `_refln.pdbx_PHWT` are present. | Preserve unit cell, axes/origin, symmetry, and coefficient-column provenance. Difference density is rendered as separate positive and negative contours. |
| Ligand MCCS superposition | Molstar Controls → Superposition → Ligands | Molstar 5.11 uses atom-name matching for identical compounds and maximum common connected subgraph otherwise, then selects the lowest-RMSD pose among compatible mappings. | Record matched-heavy-atom coverage, RMSD, truncation/time budget, aromaticity, bond-order, formal-charge, stereochemistry, and hydrogen policy. This remains an interactive Molstar workflow, not a typed Burette agent action. |

## Product workflows on the Molstar runtime

Beyond the typed actions above, these shipped product workflows are built on
the same Molstar runtime:

- **Dedicated Mesoscale viewer**: `molj`/`molx`/`mesozip` documents (and
  CellPack/Petworld-style CIF paths) open in a separate Mesoscale Explorer
  runtime (`PreviewExtension/Web/mesoscale.js`, contract
  `apps/desktop/src/lib/mesoscale-contract.ts`) rather than the standard
  viewer. See
  [Mesoscale viewer implementation plan](mesoscale-viewer-implementation-plan.md)
  for what shipped.
- **Structure superposition**: the superposition panel
  (`PreviewExtension/Web/superposition-panel.js`) drives auto,
  residue-number, sequence, chain, and TM-align flows over the demo set below
  and user structures.
- **Maestro/PyMOL-style structure operations**: chain splitting, subset
  extraction by atom serial, a selection toolkit, typed interactions, colour
  presets, and angle/dihedral measurements (PR #534).
- **Trajectory playback**: wiggle controls and smoothed playback
  (`PreviewExtension/Web/trajectory-smoothing.js`), including
  topology+trajectory pairs and trajectories without topology.
- **Viewport rail**: screenshot menu and wiggle controls attached to the
  viewport rail, plus scene history and an optimized lasso selection.

## Assembly symmetry object

`Global Symmetry Icosahedral (I)` is not part of the polymer surface. Molstar's
Assembly Symmetry extension sends the loaded assembly identity to the configured
RCSB or PDBe symmetry provider, attaches the returned symmetry property, and
creates a separate shape representation containing axes and a polyhedral cage.
Burette registers the same upstream extension and invokes its applicable state
action, so its object appears in the same state tree and can be hidden or removed
independently.

The desktop Molecular Inspector exposes a contextual `Assembly symmetry` row
directly below the structure summary when Molstar reports the action as
applicable. `Show axes` creates the upstream object and changes the action to
`Hide axes`; hiding removes the `Global Symmetry` scene object and restores the
show action. Structures without applicable biological-assembly metadata do not
show the row.

The Molstar canvas toolbar exposes the same contextual `Symmetry` toggle next
to the representation style. It is hidden when the action is not applicable or
when another renderer is active, and stays synchronized with Molecular Inspector.
After the `Global Symmetry` object is created, its Scene Tree context menu can
switch between `Axes + Cage`, `Axes only`, and `Cage only`, and adjust the
upstream representation scale from 0.1 to 5 without recreating the assembly.

Only the RCSB GraphQL origin is added to the Molstar runtime `connect-src`
allowlist. Other preview runtimes retain their local-only policy.

## Not conflated

- `exportMVS` remains the bounded Burette command-log export for compatibility.
  Use `export_session` for a real `.molx` scene/session.
- Water-bridge rendering is not a scientific assertion that a bridge exists.
- The mesoscale preset changes representation and level of detail, not assembly
  identity or coordinates.
- A successful state action or JSON response is insufficient proof for a visual
  workflow; browser or native-surface evidence is still required.

## Superposition demo set

`samples/structures/proteins/superposition-demo/` holds four real protein
fragments that exercise structure superposition with visible alpha helices,
beta strands, loops, and side-chain geometry:

- `1htb-a.pdb` and `1htb-a-rotated.pdb` are exact rigid placements of chain A.
- `1htb-b.pdb` and `1htb-b-rotated.pdb` are exact rigid placements of chain B.

Every file contains residues 194–280 of human beta3 alcohol dehydrogenase from
PDB entry 1HTB (X-ray diffraction, 2.40 Å resolution). Chains A and B are two
experimentally observed copies from the crystallographic homodimer, so they
share sequence and residue numbering but retain a measurable conformational
difference. Each fragment contains all 635 deposited heavy-atom records for its
87 residues, not a synthetic C-alpha trace.

The four rigid placements keep the unaligned structures visually separate.
Auto, residue-number, sequence, chain, and TM-align flows can then superpose the
real fragments without relying on artificial residue correspondence.
