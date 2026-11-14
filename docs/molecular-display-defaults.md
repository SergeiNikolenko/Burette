# Molecular display defaults

These rules apply to Burette viewers, agent-authored scenes, molecular
illustrations, stories, screenshots, and exports.

- Keep Burette's default display and any existing user-selected representation.
  Change representation, atom size, or bond thickness only when the user
  explicitly requests that change. A request to make a ligand readable is not
  a request to enlarge its atoms or thicken its bonds.
- When constructing a protein–ligand scene, use the standard polymer cartoon
  and ligand ball-and-stick representations with their native size defaults.
  Omit `sizeFactor`, `sizeAspectRatio`, custom radii, and bond-width overrides.
  Preserve the default element colors unless the user asks for another palette.
- Improve readability with camera orientation, focus, framing, and a smaller
  relevant selection. Do not use oversized spheres, thick sticks, heavy
  outlines, or spacefill as a substitute for a well-composed ligand view.
- For an illustrative protein, use Burette's illustrative appearance on the
  standard cartoon. Appearance controls lighting and outlining; it must not
  inflate ligand geometry. Mol*'s separate representation preset named
  `illustrative` draws the entire structure in spacefill and is not equivalent
  to Burette's default illustrative appearance.
- Show molecular surroundings from the loaded receptor/complex in its original
  coordinate frame. Select actual nearby residues with an explicit distance
  cutoff. Draw interaction lines only for calculated or supplied interactions;
  do not invent pocket shapes, atoms, residues, or contacts for decoration.
- Verify the actual view at its intended display size, including small cards.
  Check that rings and separate bonds remain distinct and that protein context
  does not obscure the ligand. Check both themes when both are supported.

## Source references

`PreviewExtension/Web/viewer.js` owns Burette's default `illustrative` style and
appearance. Its `applyMolstarStyle` / `applyMolstarIllustrativePostprocessing`
path keeps the structure representations and changes lighting and
postprocessing. The bundled Mol* ball-and-stick provider uses the physical size
theme, element colors, `sizeFactor = 0.15`, and `sizeAspectRatio = 2/3` in this
version. These values document the installed dependency; scene authors should
inherit its defaults instead of copying numeric overrides into scenes.

The installed MolViewSpec adapter is a distinct default: its `ball_and_stick`
node sets `sizeFactor = 0.5`, `sizeAspectRatio = 0.5`, and a uniform size theme,
even when the scene contains no explicit size values. That is larger than the
native builder's `0.15`, `2/3`, and physical size theme. For standard geometry,
use native representation builders or inspect the resulting representation
parameters. An omitted MVS size parameter does not prove native thickness.
Native `line` representations can show real neighboring residues without the
adapter's enlarged ball-and-stick geometry.

An explicit user request can override these choices. Keep that override scoped
to the requested scene or representation; do not turn it into a new default.
