# Pose Playback Standardization

This document records the current pose/frame playback problem, the runtime
surfaces involved, and the target contract for standardizing single-item and
all-items modes across docking poses, SDF collections, XYZ frames, PDB models,
and structure scenes.

## Problem Statement

Pose playback has grown through several independent paths:

- native Mol* trajectory/model switching
- SDF collection conversion and visibility switching
- XYZ frame overlay switching
- docking-specific SDF pose overlays
- structure-scene loading for independent structures

The UI exposes these paths through similar controls (`Prev`, `Next`, slider,
`Loop`, `All`), but the internals do not share one contract. In several cases
`All` is not only a display mode; it changes the loading architecture. That
leaks into `single` mode and creates regressions where normal pose switching
behaves like a partial all-poses scene rebuild.

The originally observed user-visible symptoms (camera reset on `Prev`/`Next`,
poses disappearing after an all-ligands fit, loop stalling after one step in a
background tab, smoothing breaking frame stepping) were fixed by #509 and
#549. The remaining motivation is architectural:

- `All` works differently for SDF, XYZ, PDB models, docking, and structure
  scenes
- the playback paths still do not share one controller contract, so each new
  format family re-implements mode switching
- fixes applied to the canonical viewer runtime can be missed when a stale
  bundled plugin asset is used instead of the source checkout runtime (now
  guarded by the packaged-mirror test, see below)

## Current Runtime Surfaces

The editable viewer runtime lives under `PreviewExtension/Web/` and is split
across several sources:

- `viewer.js`: the main desktop, Quick Look, and browser-dev Mol* viewer
  runtime (still the pose-playback owner).
- `viewer-shell.js`, `viewer-bootstrap.js`: shell chrome and startup.
- `trajectory-smoothing.js`: smoothing playback module.
- `superposition-panel.js`, `molstar-preset-preview-controller.js`,
  `burette-agent.js`: superposition, preset preview, and agent bridge.

Agent preview in a source checkout must resolve these canonical sources
directly. The self-contained plugin bundle contains generated `preview-web/`
copies after `bun run build:agent-shell`; those are build outputs, not
editable sources. `tests/test-packaged-plugin-mirror.mjs` fails when the
packaged copies drift from the sources, so divergence is handled by rebuilding
the plugin bundle, never by patching two runtimes.

## Current Code Hotspots

The current behavior is concentrated in these functions:

- `trajectoryControlsForPrepared`: maps prepared structures to the UI control
  contract.
- `prepareDockingStructure`: normalizes docking receptor and ligand inputs into
  `entries`, `poses`, and collection metadata.
- `prepareSdfStructure`: prepares multi-record SDF files as SDF collections or
  grid fallbacks.
- `prepareXyzStructure`: prepares multi-frame XYZ files as frame overlays.
- `preparePdbModelStructure`: prepares multi-model PDB/PDBQT files.
- `prepareStagedStructureScene`: prepares independent structures as scene
  entries.
- `toggleSdfPoseMode`: global toggle for `single`/`all` overlay mode.
- `reloadSdfPoseMode`: reloads the active prepared structure after mode
  changes.
- `applySdfCollectionVisibility`: SDF collection single/all rendering.
- `applyXyzFrameOverlayVisibility`: XYZ frame single/all rendering.
- `applyDockingSceneVisibility`: independent structure scene rendering.
- `applyDockingPoseCollectionVisibility`: docking pose-collection
  visibility/cache rendering.
- `applyDockingTrajectoryPairFrameCount`: topology+trajectory pair frame
  wiring (XTC/TRR pairing).
- `installDockingPoseControls`: shared controls for pose/frame/model/structure
  navigation.

Two adjacent native paths feed these families: trajectory pairing
(`apps/desktop/src-tauri/src/preview/runtime.rs`) and synthetic topology for
trajectories that arrive without one
(`apps/desktop/src-tauri/src/preview/synthetic_topology.rs`).

## Playback Families

The standardization should be organized by playback family, not by file
extension.

### `single-static`

Examples:

- ordinary single-model PDB/CIF
- ordinary single-molecule MOL/MOL2/SDF

Contract:

- no pose controls
- no `All`
- no loop
- one normal Mol* load path

### `native-trajectory`

Examples:

- topology plus coordinate trajectory pairs
- native Mol* model/frame switching where Mol* owns the trajectory

Contract:

- one Mol* structure/trajectory object
- `Prev`/`Next` and loop use Mol* model/frame controls
- no overlay cache
- no scene rebuild on frame change
- no `All` unless the native format has a deliberate all-models rendering path

### `pose-collection`

Examples:

- multi-record SDF opened as a molecule collection
- docking receptor plus multi-record SDF ligand poses

Contract:

- canonical source is `poses[]`
- `single` mode shows exactly one active pose plus required context
- `single` mode must not load all poses into view before switching
- `All` mode is a separate overlay view over the same canonical pose data
- `All` may load background poses, but must not redefine single-mode playback
- `Loop` in `single` mode must use a fast path that does not reset focus

### `frame-collection`

Examples:

- multi-frame `.xyz`
- `.v000.xyz` trajectory-like files such as `bimp.v000.xyz`

Contract:

- `single` mode shows one active frame
- `single` switching keeps a stable cache and hides/shows or replaces only the
  active foreground frame
- `All` mode builds a stable background overlay once for the selected sampling
  strategy
- the `All` background cache key must not depend on the current active frame
- frame switching must not call `plugin.clear()` on every step

### `model-collection`

Examples:

- multi-model PDB
- multi-pose PDBQT

Contract:

- prefer native Mol* model switching in `single` mode
- `All` can use a dedicated all-models preset or a scene-style overlay, but it
  must stay separate from single-mode playback

### `structure-scene`

Examples:

- folder/scene views
- Maestro scene-like structure lists
- docking scene modes `structurePoses` and `structureAll`

Contract:

- these are independent structures, not a trajectory
- `single` mode shows one structure
- `All` mode shows all structures as a scene
- loop should be conservative because switching independent structures is not
  equivalent to native trajectory playback

## Mode Contract

`single` and `all` must be explicit per-document state, not global runtime
state.

Recommended shape:

```ts
type PlaybackFamily =
  | "single-static"
  | "native-trajectory"
  | "pose-collection"
  | "frame-collection"
  | "model-collection"
  | "structure-scene";

type PlaybackMode = "single" | "all";

type PlaybackController = {
  family: PlaybackFamily;
  label: "Pose" | "Frame" | "Model" | "Structure" | "Molecule";
  count: number;
  mode: PlaybackMode;
  supportsAll: boolean;
  supportsLoop: boolean;
  supportsFastLoop: boolean;
  activeIndex: number;
  setIndex(index: number, options?: { loopStep?: boolean; focus?: boolean }): Promise<void>;
  setMode(mode: PlaybackMode): Promise<void>;
};
```

The important invariant is that `setMode("all")` changes the display mode, not
the identity of the playback model. `setIndex(...)` in `single` mode should not
route through a reload path that rebuilds the document as an all-poses scene.

## Standardization Plan

1. Introduce a small internal playback descriptor/controller layer in the viewer
   runtime.
2. Convert docking multi-SDF poses first, because this is the most fragile
   current case.
3. Convert XYZ frame overlays second, preserving the already useful split
   between `single` and `All`.
4. Convert generic SDF collections.
5. Convert multi-model PDB/PDBQT.
6. Convert structure scenes.
7. Replace `activeSdfPoseMode` with per-document/per-controller mode state.
   *Not done:* `activeSdfPoseMode` is still a runtime-global with localStorage
   persistence, and no `PlaybackFamily`/`PlaybackController` layer exists yet.
8. Remove the duplicate viewer runtime or generate the plugin runtime from the
   main runtime source. *Done:* the plugin copies are generated by
   `scripts/build-agent-shell-plugin.mjs` and pinned by
   `tests/test-packaged-plugin-mirror.mjs`.

## Non-Goals

- Do not restore the PDB `MODEL` trajectory conversion for docking SDF poses.
  It was fast, but it can lose SDF bond/order/aromatic semantics and distort
  ligand rendering.
- Do not add another local `if` only for one sample file.
- Do not make tests the specification. Browser-dev visual behavior is the
  source of truth for this work.
- Do not merge a pose playback change until the relevant browser matrix has
  been checked in the in-app Browser.

## Browser Test Matrix

Use `browser-agent-shell` or a manual `vp dev` server with explicit file
roots. Keep each test URL tied to the worktree under test.

### Minimum Files

The machine-local paths below are examples from the original investigation;
substitute equivalent local files. Repo-anchored alternatives:
`samples/structures/proteins/superposition-demo/` and
`samples/mvs/docking_story.mvsx`.

- `samples/structures/proteins/1htb.pdb`: static protein with ligands/waters.
- `samples/collections/sdf/multi.sdf`: generic multi-record SDF collection.
- `/Users/nikolenko/Downloads/results/gnina/lig3_gnina.sdf`: real gnina SDF
  pose file.
- `/Users/nikolenko/Desktop/BurettePreviewSamples/structures/bimp.v000.xyz`:
  real multi-frame XYZ trajectory-like file.
- `/Users/nikolenko/Desktop/BurettePreviewSamples/structures/mn-h2.v000.xyz`:
  second multi-frame XYZ file.
- `/tmp/burette-5c01-gnina/5c01.pdb` plus
  `/tmp/burette-5c01-gnina/*_gnina.sdf`: docking receptor plus pose files.
- `samples/schrodinger/metadynamics-binding.mae`: Maestro/scene-style input.
- `samples/mvs/docking_story.mvsj`: MolViewSpec scene input.

### Expected Checks

For each file family:

- initial load reaches a visible Mol* canvas or the intended non-Mol* renderer
- controls use the correct label: `Pose`, `Frame`, `Model`, `Structure`, or
  `Molecule`
- `Prev`/`Next` changes the active index without resetting camera focus
- slider changes active index without rebuilding the whole scene
- `Loop` advances at the expected speed and does not stall after one step
- `All` toggles only for families that support it
- leaving `All` returns to the same single-mode active index
- no console error says `Mol* trajectory controls are not available`

## Known Good Browser Startup Shape

For manual browser-dev testing:

```bash
PORT=1439
BURETTE_DEV_FS_ALLOW="$PWD/samples:/Users/nikolenko/Desktop/BurettePreviewSamples:/Users/nikolenko/Downloads/results/gnina:/tmp/burette-5c01-gnina" \
  vp dev apps/desktop \
    --host 127.0.0.1 \
    --port "$PORT" \
    --strictPort \
    --config apps/desktop/vite.config.ts
```

Then open a `devFiles` URL for the broad matrix and a `devDocking` URL for the
docking-specific case.
