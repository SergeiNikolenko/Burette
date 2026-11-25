---
name: bio-media
description: "Use when producing publication-grade molecular stills, binding-site figures, pharmacophore/orbital/measurement renders, or smooth 60fps 3D molecular videos with Burette."
---

# Burette Molecular Photography & 3D Bio-Video

Produce publication-grade molecular stills and smooth 60fps 3D camera videos
using Burette's real WebGL2 `Illustrative` renderer and MolViewSpec Stories
(via `burette.capture_view`, `scripts/burette-agent.mjs`, or
`cleanshot-studio bio-still` / `bio-video`).

## Visual Quality Contract

1. **Real Burette WebGL2 `Illustrative` rendering — never flat or plastic fallbacks:**
   - Keep Burette's native `ignoreLight: true` flat ambient shading with crisp
     ~1px black ambient-occlusion outlines (`scale ~0.88-1.0`, `threshold: 0.33`,
     `multiScale: off`) and no forced molecular surface unless requested.
   - Match light and dark scenes cleanly across framing surfaces. Keep companion
     light/dark stills on the exact same structure, camera angle, and crop.
2. **Strict `ball-and-stick` geometry for ligands and binding-site residues:**
   - Never inflate Mol* `sizeAspectRatio` above `0.52`, and never pass raw
     `sizeFactor: 0.16` onto MVS `uniform(1.0)` size themes (which shrinks
     ligands to thin hairlines).
   - In MolViewSpec (`uniform` theme): use `size_factor: 0.54` for primary
     ligands and multi-ligand poses, `0.46` for cofactors, and `0.42` for
     important pocket residues so atoms render as smooth round spheres at every
     bond junction.
   - In direct Mol* (`physical` theme): use `sizeFactor: 0.17, sizeAspectRatio: 0.50`
     for ligands and `sizeFactor: 0.14, sizeAspectRatio: 0.52` for pocket
     residues.
   - On animated multi-model trajectories (`ModelFromTrajectory` with updating
     `modelIndex`), set `tryUseImpostor: false` on animated ligand
     representations so Mol* rebuilds sphere meshes on every frame instead of
     freezing sphere impostors at frame 0.
3. **Binding pockets, labels, and 3D measurements:**
   - Render key binding-site residues as real `ball-and-stick` (`--pocket-style sticks`),
     never thin wire lines (`lines`).
   - When the binding pocket is the subject, show the pocket clearly (optionally
     with a translucent pocket cavity via `--surface pocket`), use large
     high-contrast labels (`--labels`), and include native MVS 3D distance
     (`distance_measurement`, Å) and angle (`angle_measurement`, ° with arc
     section) primitives (`--measurements`) when geometry matters.
4. **Crystallographic water visibility (matches Burette):**
   - Full protein or multi-protein overview (`--focus structure --waters`): show
     all crystallographic waters as delicate translucent sky-blue spheres
     (`#4DB6FF`).
   - Pocket or binding-site focus (`--focus pocket --waters` or
     `--water-bridges`): show only key interacting or bridging waters alongside
     key interacting pocket residues.
5. **Pharmacophores and volumetric orbitals:**
   - Pharmacophores (`--pharmacophores`): render clean, non-overlapping
     translucent semantic spheres **with directional vectors** — H-bond Donor
     (`#6BA8D0`) and Acceptor (`#D75A91`) arrows oriented toward polar pocket
     partners or outward along lone-pair/bond axes, Aromatic (`#E1AD54`)
     centered on real planar rings with bi-directional ring-normal arrows, and
     isotropic Hydrophobe (`#A8CE78`) spheres. Omit text labels, wireframe cages,
     and overlapping dot clutter.
   - Molecular orbitals, electron density, and NCI surfaces: load `.cube` /
     `.cub` files directly via native Mol* `ParseCube` + `VolumeFromCube` with
     `+iso` / `-iso` isosurfaces (`--orbital-mode mo|density|nci --iso <val>`).
6. **Display presets, authentic window chrome, and 16:9 60fps bio-videos:**
   - Supported Burette presets: `illustrative`, `illustrative-surface`,
     `molecular-surface`, `gaussian-surface`, `ball-and-stick`, `spacefill`,
     `line`, `mesoscale`, `realistic`.
   - Never draw fake macOS titlebars or footer banners. Keep chrome off by
     default (`--chrome none`); when desktop UI is part of the shot, capture the
     real Burette window (`--app-shell`, optionally `--open-style-menu`) or use
     a calibrated display/device frame or system wallpaper backdrop.
   - Never fake a 3D video with 2D Ken Burns pans or slideshows. Render true
     60fps 3D camera or trajectory motion (`pocket-story`, `flight`, `fly-in`,
     `diffusion`, `trajectory --smooth`, `orbit`) at native **16:9**
     (`1600x900` or `1920x1080`) with tight, balanced margins (`--padding 44`)
     when framing into 16:9 — never pillarbox a 16:10 canvas inside 16:9.

## Workflow

1. Decide whether the request needs an interactive workspace snapshot
   (`burette.capture_view`), a reproducible MolViewSpec Story
   ([mvs-story](../mvs-story/SKILL.md)), or an offline framed still / 60fps
   video (`cleanshot-studio bio-still` / `bio-video`).
2. For interactive scenes in Burette, follow [index](../index/SKILL.md)
   preflight, configure the scene with [molstar-scene](../molstar-scene/SKILL.md)
   or [mvs-story](../mvs-story/SKILL.md), and capture via `burette.capture_view`.
3. For publication stills and 60fps videos with framing, pharmacophore vectors,
   3D measurements, `.cube` orbitals, or trajectory smoothing:

```bash
# Pocket still with ball-and-stick residues, cavity, 3D distances & angles
cleanshot-studio bio-still \
  --input complex.pdb -o outputs/pocket_measurements.png \
  --theme light --width 1800 --height 1150 \
  --preset illustrative --focus pocket --pocket-style sticks \
  --surface pocket --waters --measurements --labels \
  --style burette-light

# Clean pharmacophores with directional vectors (no labels)
cleanshot-studio bio-still \
  --input complex.pdb -o outputs/pharmacophores.png \
  --theme light --width 1800 --height 1150 \
  --preset illustrative --focus pocket --pocket-style sticks \
  --pharmacophores --no-labels --no-contacts \
  --style burette-light

# Smooth 60fps 16:9 3D flight video with balanced margins and contact sheet
cleanshot-studio bio-video \
  --input complex.pdb -o outputs/complex_flight_60fps.mp4 \
  --theme light --width 1600 --height 900 --fps 60 --duration 7 \
  --preset illustrative --choreography flight \
  --aspect 16:9 --padding 44 --style landscape-auto \
  --sheet work/complex_flight_sheet.png
```

## Completion Gate

Complete only after visually inspecting every output still and video `--sheet`
contact sheet to confirm:

- crisp Burette `Illustrative` outlines and round atom spheres at every ligand
  and pocket bond vertex (including mid-trajectory video frames);
- balanced 16:9 margins with zero wide empty sidebars, zero stray hover
  highlights, and zero colliding labels;
- pharmacophore vectors point cleanly along H-bond / ring-normal axes with no
  text clutter, and water visibility matches the structure vs. pocket rule.
