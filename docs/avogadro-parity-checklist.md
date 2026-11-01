# Avogadro parity acceptance ledger

This is the working ledger for the [complete twelve-stage contract](avogadro-adoption.md),
not a reduced scope. No full stage is complete. Source baseline:
`579fc3bf63e626857f5a6b6ec3bd66274b786e5e`. A later implementation must update its
specific row from current source and evidence; old audit prose is not authority
for the current checkout.

## Evidence classifications

- **Implemented foundation:** adopted source and its owner exist in the named
  baseline. This does not imply the complete workflow or a fresh Browser test.
- **Partial:** a concrete requirement remains absent, narrower or unintegrated.
- **Untested acceptance:** available source, focused tests or earlier proofs do
  not establish the remaining user scenario on its target surface.
- A reviewed isolated packet is pending until guarded adoption; modified or
  untracked files are not adopted source merely because they exist locally.

**00.04** Distinguish adopted source, isolated review, named actual Browser proof
and other surfaces. Each accepted scenario records source/build/fixture identity,
commands and results, actual gesture, exported/reopened artifact, failure and
recovery behavior. A build, commit or local packaging check is not deployment or
release. A headless MolStar model check is not packaged macOS acceptance.

Historical successes retain their original fixture, build, runtime and limits.
Do not relabel Vite browser-dev as an immutable production shell, or infer native,
Quick Look, iPhone or hosted acceptance from either. This documentation update
performs source reconciliation only; it runs no new scientific or Browser workflow.

## Stage ledger

All rows remain **partial**, with the listed acceptance gates **untested as a
complete matrix**. The source column names implemented foundations, not full-stage
completion. Requirement IDs refer to the adoption contract and extension inventory.

| Stage | Implemented foundation in the source baseline | Remaining workflow and acceptance gates |
| --- | --- | --- |
| **1. Interchange** | `scripts/internal-coordinates.mjs`, `zmatrix-document.mjs`, definition/export/row controls and Geometry source ownership. [Internal coordinates](internal-coordinate-editing.md) and [input templates](quantum-input-export.md). | The exact CLI helper `scripts/molecular-coordinates.mjs` and its packaged counterpart are absent from this adopted tree; their working-tree implementation is not delivered Stage 1. Complete actual CLI/package subprocess conversion, ordinary open, Copy/export/reopen and all malformed/precision/handedness cases. Generic CLI presence does not prove coordinate interchange. |
| **2. Editing** | [Graph/history/properties](graph-editing-and-properties.md), coordinate binding, measurements, topology transfer, logical source recovery and browser source-close dialog. | Full format/topology/stereo/measurement-style matrix, PDB/mmCIF/ensemble metadata, reorder mappings, real drop/reload/recovered drafts, native counterparts and visible owned scalar fields during topology edits. Preserve all 02.xx obligations. |
| **3. Optimization** | Forcefield/minimizer and frozen/shared-variable cores; Geometry and Z-matrix controls. | Complete methods/constraints/convergence/residuals, failed/cancelled/stale publication and Open-steps cases. Undefined collinear objectives remain explicit refusals; they do not provide automatic 3D preparation. Method selection and preparation UX remain separate work. |
| **4. Scientific readers** | Quantum readers, scientific source ownership, original storage, [CJSON graph sources](cjson-graph-source.md), [MOLX science](scientific-scene-format.md) and [MCD attachments](browser-scientific-attachments.md). | Full producer/input/gesture/frame/malformed/large/reopen matrix, remaining CJSON scientific consumers and real MCD producer pairs. Preserve explicit Gaussian/QCSchema/binary-converter limits. Original bytes alone do not validate scientific consumers. |
| **5. Orbitals/fields** | Basis/MO evaluators, workers, scalar ownership, Orbitals UI and native Cube units/dataset handling. | Broader real producer/numerical/surface/export/reopen coverage, held-worker real timing cases, full-shell multi-field Cube and owned-field/topology coexistence. Native dataset controls do not establish full scientific import support. |
| **6. Spectra/trajectories** | Vibrations, eight spectrum families, source-bound selection/display state, TRR decoder/native adapter and indexed frame-page foundations. | All producer/unit/selection/export matrices; normal modes and frame-specific Hessians; real MCD producer data. Plots consumer integration remains unadopted. Complete large/indexed/seek/reopen/CSV and shared player/chart/property frame ownership; temperature needs masses/units/DOF. |
| **7. Builders** | Peptide graph/geometry/worker/preview/create and [polymer attachment/local tacticity](polymer-builder.md). The stereochemical core was adopted in `318b09`; tetrahedral eligibility is documented with it. | Polymer stereo UI, sampled-once atactic choices, real 3D picks and 3D preparation remain open. General tacticity/termination, fragment insertion/Undo, complexes, DNA and RNA each need their own scientific and Browser acceptance. Standalone creation is not insertion. |
| **8. Crystals** | Cell/CIF, [deposited assembly core and worker/source owner](biological-assemblies.md), exact copied-chain queries, pair-distribution foundation and [pure Niggli reduction](../apps/desktop/src/lib/molecular-workbench/symmetry/README.md), adopted in `580a62cf`. | Assembly rendered activation/ordinary chooser/export proof; cell/supercell consumers; Moyo space-group/primitive/conventional stages; point groups; Niggli output/owner/UI; XRD and complete periodic/partial g(r). Niggli changes basis only. BCIF/label-only composition remains separate. |
| **9. IO/export** | Bounded compression and source/original ownership; binary PLY serializer. | All compressed import/download/corruption/size/Original routes. `scripts/molstar-ply-export.js` remains outside adopted source: visible-scene receiver, cancellation and actual mesh reopen are not completed by the serializer. Format/runtime/native metadata changes remain paired. |
| **10. Automation** | The adopted typed workbench contract/controller exposes `orbital_cube` through the stable CLI; the broader nine-kind contract remains the target in requirement 10.04. | Per-operation counterparts for all editors/builders/science, source/cancel/replay closure and supported batches. `plugins/burette-agent/python/burette_workbench.py` remains outside adopted source; Python/Jupyter and complete batches are not proven by controller tests. Keep compute-free widgets unchanged. |
| **11. Extensions/interactions** | Settings Extensions, shared Jobs, verified resource installation/storage, Crystals browsing/opening and bounded original storage. | [Other pinned adapters](avogadro-extensions.md), scientific/native/hosted resource acceptance and complete shared editing-mode camera/projection/keyboard behavior. Do not repeat the obsolete “Extensions missing” status. |
| **12. Hardening** | Many focused source-owner, numeric, malformed-input, controller and recorded Browser safeguards. | Complete acceptance matrix for real gestures, recovery, accessibility, reduced motion, themes and narrow/full layouts; independently record every affected packaged/native/Quick Look/iPhone/hosted surface. No whole-product or release claim. |

## Focused starting checks

These are commands present in the baseline, not results of this documentation
update. Run only the checks relevant to a change. Follow
[Testing Surfaces](tools/testing-surfaces.md); isolate UI suites whose module
mocks otherwise leak. Large platform-independent scientific sweeps use a configured
compute host; Apple-platform validation uses the Mac.

| Stage | Available starting checks |
| --- | --- |
| 1 | `vp run test:zmatrix-definition-editing`; `vp run test:zmatrix-controls`; `vp run test:quantum-input-export`. Add the real CLI/package conversion check when that helper is adopted. |
| 2 | `vp run test:logical-xyz-topology`; `vp run test:geometry-action-ack`; `vp run test:browser-source-close-dialog`. |
| 3 | `vp run test:minimizer-core`; `vp run test:zmatrix-draft`. |
| 4 | `vp run test:scientific-source`; `vp run test:scientific-mcd-archive`; `vp run test:browser-mcd-admission`. |
| 5 | `vp run test:quantum-worker`; `vp run test:orbitals-owner`; `vp run test:orbitals-spin`. |
| 6 | `vp run test:scientific-spectra-readers`; `vp run test:spectrum-atom-selection-panel`; `vp run test:indexed-trajectory-runtime`; `vp run test:built-indexed-trajectory`. |
| 7 | `vp run test:peptide-builder`; `vp run test:polymer-attachment`; `vp run test:polymer-tacticity`. |
| 8 | `vp run test:biological-assembly`; `vp run test:assembly-worker`; `vp run test:assembly-source`; `vp run test:niggli-cell`. |
| 9 | `vp run test:compressed-worker`; `vp run test:compressed-sources`; `vp exec bun test tests/test-ply-mesh.test.ts`. |
| 10 | `vp run test:orbital-agent`; actual typed CLI jobs against a ready compiled shell, including invalid/replayed/stale/cancelled requests. |
| 11 | `vp run test:extension-resources`; `vp run test:extension-runner`; `vp run test:extension-ui`; `vp run test:crystals-browser`. |
| 12 | Focused typechecks, relevant generated-mirror checks and `git diff --check`, then actual affected-surface gestures. These are not permission to infer full CI or native acceptance. |

## Completion record

For each requirement or supported subset, retain the exact source and runtime
identity, test command/result, fixture and independent scientific oracle, visible
outcome, exported file digest and ordinary reopen result, plus cancellation/error/
recovery checks. Keep the surviving limitations explicit. A checklist is complete
only when every concrete obligation is closed or an explicit scope decision is
recorded; removing an unmet row is not completion.

Update this ledger when a new stage is adopted or a target-surface proof changes
its scope. Durable feature contracts belong in their owning documents; chronological
handoffs, private session descriptors, worktree paths and temporary build URLs do
not belong in this active graph.
