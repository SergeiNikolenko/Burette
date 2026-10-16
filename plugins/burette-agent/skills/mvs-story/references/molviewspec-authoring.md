# MolViewSpec authoring reference

Use this reference when a Story needs more than an installed template. It is a
routing index, not a frozen copy of the upstream documentation. MolViewSpec and
Mol* can evolve, so use `burette.get_mvs_authoring_reference` as the execution
contract for the Mol* version bundled with Burette.

## Progressive lookup

1. Call `burette.get_mvs_authoring_reference` without `nodeKind` and choose
   `schema: "scene"` or `schema: "animation"`.
2. Request one unfamiliar node at a time, for example `component`, `focus`,
   `primitive`, `volume_representation`, or `interpolate`.
3. Follow the returned parent constraints, parameter types, defaults, and
   descriptions exactly.
4. Validate a multi-state Story with `burette.validate_story`. It rejects
   single-state scenes (`kind: "single"`), so they have no preflight check.
5. Open the result and perform visual QA; schema validity does not prove that a
   selector matches atoms or that a camera communicates the intended evidence.
   After opening, observe the session and confirm `viewerAgent.ready` with no
   load error in `viewerAgent.lastMessage`. A failed load leaves a blank pane;
   fix the file and reopen it in a new session instead of reporting success.

The scene overview reports the installed MolViewSpec version and these node
families:

- source and parsing: `download`, `parse`, `coordinates`;
- molecular structure: `structure`, `transform`, `instance`, `component`,
  annotation-derived components;
- visual encodings: `representation`, `color`, `opacity`, `clip` and
  annotation-derived colors;
- explanation: `label`, `tooltip`, `focus`, `camera`, `canvas`;
- spatial evidence: `primitives`, `primitive`, URI-backed primitives;
- density and other grids: `volume`, `volume_representation`;
- animation: `animation`, `interpolate` in the separate animation schema.

## Official documentation map

- [Introduction](https://molstar.org/mol-view-spec-docs/): concepts, MVSJ,
  MVSX, multi-state files, and builder examples.
- [Tree Schema](https://molstar.org/mol-view-spec-docs/tree-schema/): valid
  parent-child relationships and node parameters.
- [Selectors](https://molstar.org/mol-view-spec-docs/selectors/): static
  selectors, residue or atom expressions, unions, and numbering systems.
- [Annotations](https://molstar.org/mol-view-spec-docs/annotations/): external
  CIF/JSON annotations for components, colors, labels, and tooltips.
- [Camera Settings](https://molstar.org/mol-view-spec-docs/camera-settings/):
  explicit camera vectors, focus, and reproducible framing.
- [Primitives](https://molstar.org/mol-view-spec-docs/primitives/): meshes,
  tubes, arrows, distance lines, labels, and other explanatory geometry.
- [Volumetric Data](https://molstar.org/mol-view-spec-docs/volumetric-data/):
  density and grid sources, isosurfaces, colors, and opacity.
- [Animations](https://molstar.org/mol-view-spec-docs/animations/):
  interpolation targets and animation authoring.
- [Mol* MVS Extension and demos](https://molstar.org/mol-view-spec-docs/mvs-extension/):
  integration examples and runnable demonstrations.
- [OpenAPI JSON schema](https://molstar.org/mol-view-spec-docs/tree-schema/openapi.json):
  upstream machine-readable schema. Prefer the Burette reference tool when the
  upstream schema and installed Mol* version differ.

## Authoring choices

### MVSJ versus MVSX

- Use MVSJ when every resource has a stable HTTP(S) URL or accompanies the file
  with the same relative layout.
- Use MVSX when local coordinates, volumes, annotations, primitive data, or
  other sidecars must travel with the Story.
- A multi-state Story contains a complete root scene for each snapshot. Do not
  rely on click history or state inherited from the previous snapshot.

### Selectors and annotations

- Prefer `label_*` identifiers for stable mmCIF semantics. Use `auth_*` when the
  scientific question explicitly uses author or PDB numbering.
- Confirm that a selector matches the intended atoms in the rendered structure.
  An empty but syntactically valid component is not useful evidence.
- Use annotation-backed nodes for repeated, data-driven categories rather than
  generating a large number of handwritten components.
- Record the annotation source, field, units, category meaning, and missing-data
  handling in the Story description or accompanying report.

### Camera, focus, primitives, and volume

- Use `focus` for component-relative framing and `camera` for a reproducible
  explicit view. Keep the molecular evidence visible after labels and panels
  are added.
- In a single-state scene opened with `burette.open_viewer`, do not add `focus`
  nodes. A schema-valid `focus` under a component crashed the bundled Mol*
  loader (`Cannot read properties of undefined (reading 'forEach')`). Use
  `camera`, or frame after load with `focus_ligand` or `focus_selection`.
- Use primitives for explanation, measurement, and spatial context. Do not draw
  an interaction or distance that was not calculated from the loaded model.
- State contour level, units, sign convention, and source for volume
  representations. A visually persuasive isosurface is not by itself a
  quantitative conclusion.

### Scientific and visual QA

- Keep compared structures, poses, maps, or frames in a documented common
  coordinate system before overlaying them.
- Use a consistent color mapping across snapshots and a colorblind-safe palette
  when colors encode categories.
- Put method status, units, uncertainty, and limitations next to quantitative
  claims. Templates do not calculate contacts, affinity, alignment, RMSD, or
  confidence.
- Inspect the first step and at least one transition on the real Burette canvas.
  Confirm nonblank geometry, readable labels, intended selections, and camera
  continuity.
