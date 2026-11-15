# Avogadro parity: showcase plan

How each feature from the [stage plan](avogadro-stage-plan.md) is presented:
a staged screen, a contextual hint, both, or nothing, and what the landing page
gets. Write a feature's presentation after its stage is accepted, not before.

## Presentation forms today

### Staged screen

A live browser-shell frame that a script clicks through a few named states.
Burette has no registry for these yet; the pieces are:

- **Live frame.** The web demo with `?presentation=light|dark` opens the
  presentation file list instead of the curated workspace:
  `DEMO_STRUCTURES` in `apps/desktop/src/lib/web-demo-workspace.ts` (files
  imported with `?raw` from `samples/`). Each file's provenance goes in
  [presentation-samples.md](presentation-samples.md). The standalone workspace
  list is `apps/desktop/src/lib/web-demo-scenes.ts`, with assets in
  `apps/burette-public-plugin/public/demo-scenes/`.
- **Script.** The only current instance is the landing hero:
  `burette-landing/components/landing/workspace-scenes.js` (scene list),
  `workspace-presentation.js` (`openWorkspaceScene`, `prepareWorkspaceScene`)
  and `workspace-choreography.js` (`playWorkspaceStory`), driven from
  `macbook-workspace.jsx`.
- **Template to copy.** The Codex UI Atlas main screen:
  `InterfaceAtlas/src/atlas/workspace-page.jsx` declares
  `STATES = [[id, label, steps]]`, where a step is `{until}`, `{press}`,
  `{css, wait}`, `{fill, key}` or `{hover|focus|click}`; `runSteps` in
  `src/atlas/story.jsx` plays them; a segmented control selects the state and
  keeps it in `?state=`; a poster image shows while the frame loads. Each state
  has a 2–6 word label and no caption.

To add one: add the sample to `samples/` and `DEMO_STRUCTURES`, document it in
`presentation-samples.md`, write the state list (one state per step of the
stage's **Done when** scenario), capture a poster per state, and cut the
landing clip from the same run.

### Contextual hint

A one-time card shown the first time the user reaches a feature.

- Catalog: `apps/desktop/src/components/onboarding/contextual-guides.ts`
  (`pattern`: `carousel`, `education`, `first-use`, `announcement`,
  `inline`; copy, media, `where`/`when`).
- Trigger: `requestContextualGuide(id, anchor)` from
  `onboarding/request.ts`; frames post `{ type: "burette:contextual-guide" }`.
- Rendering: `contextual-guide-card.tsx`, `contextual-guide-host.tsx`.
- Media: `apps/desktop/public/onboarding/guides/` (WebP stills, short H.264
  clips, under 512 KB each).
- Check: `/dev/onboarding.html` in both themes; update the table in
  [onboarding.md](onboarding.md).
- Russian mirror: `BuretteGuideGallery/dist/catalog.json` (no source in that
  repository; rebuild the dist when guides change).

Policy limits hints to two a day, ten minutes apart, so new hints must not
fire on the same action as an existing one.

### Landing

- Home stories: `burette-landing/components/landing/features.jsx`, one
  `<article id="…-story">` per story with an eyebrow, a two-line headline and a
  20–30 word paragraph, shown with `<Demo id>` (looping MP4 + JPG poster from
  `public/assets/features/`, sizes in `components/features/media-sizes.json`).
  No captions under media.
- Features page: `components/features/catalog.json`, groups with
  `{ title, description, video | screenshot }` cards; a new group also needs
  its nav label in `catalog.jsx`.
- Live data copies and provenance: `public/live-data/README.md`,
  `lib/live-scene.mjs`.
- Check: `npm test` (`scripts/check-site.mjs`, `scripts/check-live-scenes.mjs`).

## Feature decisions

Copy rules: user terms, one sentence, no library or engine names. Program and
file format names stay where the user picks them.

| Stage | Feature | Form | Sample | Landing copy | Landing placement |
| --- | --- | --- | --- | --- | --- |
| 1 | All and Align for frames of a saved scene | Hint (`first-use` on Align in a scene) | Missing: MOLX scene saved from `samples/structures/demo/sn2.v000.xyz` | Show every frame at once and superimpose them on the current one. | Features `motion`: new card next to Pose alignment |
| 2 | Geometry panel for XYZ: edit a bond, angle or torsion from the 3D measurement, Undo/Redo | Both | `tests/fixtures/zmatrix-reference/s-1-phenylethanol.xyz` | Type a bond length, angle, or torsion and the molecule follows. | New home story `#geometry-story`; Features new group `geometry` |
| 2 | Convert to Z-matrix, copy and export it | Hint (`inline` on Convert) | Same | Switch to a Z-matrix at any time and copy or save it. | Features `geometry` |
| 3 | Optimization with frozen atoms, locked distances/angles/torsions, step limit, progress, Open steps | Staged screen | `samples/structures/small-molecules/caffeine.sdf`; missing: a distorted SDF that visibly relaxes | Freeze atoms or hold a distance while the rest relaxes. | Home `#geometry-story`; Features `geometry` |
| 3A | Automatic force field; models without parameters disabled with the element named | Hint (`inline` in Configure) | Missing: tetramethyltin SDF and Ar₆ cluster XYZ under `samples/` | Burette picks a force field that covers your elements. | Features `compute`: extend MMFF refinement |
| 3B | Optimize Geometry (⌥⌘O): live steps, energy, Cancel, one Undo; Calculate Energy; Configure; Freeze/Unfreeze | Staged screen (states of the stage 3 screen) | As stage 3 | Press ⌥⌘O and watch the structure relax. One Undo takes it back. | Home `#geometry-story`; Features `geometry` |
| 3C | Auto Optimize: drag an atom, the molecule relaxes live with ΔE | Both (hint `first-use` on Start) | Missing: water trimer SDF; Ar₆ cluster XYZ (see 3A) | Drag an atom and the molecule relaxes around it. | Home `#geometry-story` lead clip; Highlights card |
| 3D | Semiempirical and plugin energy models in the same menus | Hint (`inline` on the model list) | `tests/fixtures/avogadro/energy-plugin/` | Use semiempirical methods or your own energy plugin from the same menu. | Features `compute`: extend Semiempirical energies |
| 4 | Export input file for ORCA, Gaussian, Psi4, CP2K, Cartesian or Z-matrix | Hint (`first-use` in the dialog) | `tests/fixtures/properties/ethanol.sdf`, `samples/mini.pdb` | Write a ready input file for your quantum chemistry program. | Features new group `quantum` |
| 5 | Calculation files with vibrations, orbitals, basis and cell | Both | `tests/fixtures/cjson/avogadro-formaldehyde-orbitals.cjson`, `avogadro-formaldehyde-raman.cjson`, `avogadro-rutile.cjson` | Open a calculation and play its vibrations or show an orbital. | New home story `#calculation-story`; Features `quantum` |
| 5 | Coordinate set selector | Hint (`inline` on the card) | Missing: CJSON with several coordinate sets under `samples/` | Pick any geometry stored in the file. | Features `quantum` |
| 6 | Multi-field Cube: dataset selector, lobe colours, frame-bound fields | Staged screen (states of the stage 5 screen) | `tests/fixtures/oblique-angstrom-3fields.cube` is synthetic; missing: a real HOMO/LUMO Cube (e.g. exported from the formaldehyde CJSON) | Switch between orbitals in one cube file and choose the lobe colours. | Home `#calculation-story`; Features `quantum` |
| 7 | Plots and CSV for XTC/DCD trajectories in the browser, whole-trajectory scan | Hint (`first-use` when Plots opens on a trajectory) | `samples/md/paired/paired.pdb` (LAMMPS pair); missing: a real PDB + XTC and PDB + DCD pair (`tests/fixtures/trajectory/compressed.xtc` is one synthetic frame) | Plot a distance across every frame and save it as CSV. | Features `motion`: extend Topology and trajectory |
| 8 | Peptide, DNA/RNA and metal-complex builders; Insert into the open file | Both | Target `samples/structures/small-molecules/caffeine.sdf`; references `tests/fixtures/metal-complex/samples/cisplatin.sdf`, `tests/fixtures/nucleic/fnab-b-dna.pdb` | Build a peptide, a DNA strand, or a metal complex and add it to your file. | Features `editing`: new card; Highlights card |
| 9 | Crystal scenes reopen editable; assembly and XRD jobs | Hint (`first-use` on reopening a saved crystal) | `samples/structures/crystals/caffeine.cif`, `tests/fixtures/crystals/rutile.cif`, `si.poscar` | Saved crystal scenes reopen ready to edit the cell. | Features `structures`: extend Crystal structures |
| 10 | Export as XYZ, MOL, CIF, POSCAR, CJSON, with a compressed copy | None | `samples/structures/small-molecules/caffeine.sdf` | Save any structure as XYZ, MOL, CIF, POSCAR, or CJSON, compressed if you like. | Features `editing`: new card |
| 11 | Script edits, builds, exports and views | None | `tests/fixtures/automation/ethanol.sdf` | Script the same edits, builds, and exports from Python. | Features `integrations`: extend Automate repeatable steps |
| 12 | Plugins that add file formats and input generators | Hint (`first-use` after the first plugin install) | `tests/fixtures/avogadro/avogadro-rdkit-82498e3a.zip` (command plugin); missing: a format plugin package | Add file formats and input generators with community plugins. | Features `integrations`: new card |
| 12 | Edit, Geometry and Properties in the 3D context menu; full fragments library | None | `samples/structures/small-molecules/caffeine.sdf` | Right-click an atom to edit it or open its geometry. | Features `geometry` |
| 13 | Themes, narrow windows, keyboard, reduced motion, packaged app | None | — | — | — |

New Features groups:

- `geometry`: "Shape the molecule. Let it relax." Rows for stages 2, 3, 3B,
  3C and the 3D context menu. Place it after `compute`.
- `quantum`: "From a calculation to its orbitals." Rows for stages 4, 5
  and 6. Place it after `geometry`.

New home stories, both after `#structure-story`:

- `#geometry-story`. Eyebrow "Edit the geometry". Headline "Drag an atom. /
  The molecule follows." Body: "Change a bond length or torsion, freeze what
  must stay, and let the structure relax. One Undo returns to where you
  started." Clip from the Auto Optimize and Optimize staged screens.
- `#calculation-story`. Eyebrow "Read your calculation". Headline "Open the
  output. / See the orbitals." Body: "Play vibrational modes, show an orbital
  surface, and switch between the fields in a cube file. Export an input file
  for the next run." Clip from the calculation staged screen.

## Staged screens first

1. **Auto Optimize** (3C). The feature is motion: an atom under the pointer
   and a molecule relaxing around it. A card cannot show it, and it is the
   strongest landing clip. States: Start, Drag, Relaxed, Stop, Undo.
2. **Optimize with constraints** (3, 3B). A multi-step workflow whose payoff,
   a frozen part that stays while the rest moves, only shows when played.
   States: Freeze, Lock distance, ⌥⌘O, Cancel, Undo.
3. **Geometry editing** (2). The core edit loop that 1 and 2 build on: a 3D
   measurement jumps to its row, a typed value moves the atoms, Z-matrix view.
   States: Measure, Edit value, Undo/Redo, Z-matrix.
4. **Calculation results** (5, 6). Vibrations and orbital lobes are the most
   visual results in this work and give the `quantum` group its media. States:
   Vibration, Orbital, Switch field, Recolour.
5. **Builders and insertion** (8). Three steps across a dialog and the open
   file that a hint cannot sequence. States: Build peptide, Insert, Metal
   complex, Undo.

Before recording 1, 2 and 5, add the missing samples above to `samples/` and
`DEMO_STRUCTURES`, with provenance in `presentation-samples.md`.
