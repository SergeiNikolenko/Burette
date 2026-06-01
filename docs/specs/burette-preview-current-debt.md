# Burette Preview Current Debt

This file tracks the active preview debt being closed in the desktop browser
development surface. It is intentionally scoped to the current preview work and
does not replace the broader renderer runtime contracts.

## Verified Requirements

- The browser development default file set includes the large 10k SMILES CSV
  plus the two Desktop molecule sample folders when those paths exist.
- The 10k SMILES grid supports the `xyzrender` card renderer by converting
  SMILES rows to RDKit molblocks before calling the external renderer, so
  `xyzrender` receives coordinates and bonds instead of bare SMILES text.
- `xyzrender` grid cards default to the normal `default` preset; the skeletal
  preset remains available only as a manual style choice.
- Empty `xyzrender` card tuning fields stay in automatic mode instead of being
  coerced to minimum atom and bond scale values.
- `xyzrender` card failures fall back to the RDKit drawing path instead of
  rendering a long command-line failure dump inside a card.
- The grid toolbar is not sticky and does not apply a backdrop blur over the
  molecule grid.
- Grid molecule pictures use a plain white drawing background.
- New grid documents start in RDKit card rendering mode. The previous
  `xyzrender` card choice is not restored from local storage into a new grid.
- Grid molecule titles and metadata are hidden by default. The Properties
  toggle affects the current view but is not persisted as the next default.
- Grid view exposes right, bottom, and corner resize handles on molecule cards.
  The handles resize one square card dimension, keep the card picture square,
  and keep the automatic bounds between roughly 3 and 30 cards per row.
- Grid select controls keep stable arrow backgrounds on hover/focus, and the
  `xyzrender` Tune controls render inside the toolbar flow instead of as a
  fixed overlay that can cover cards or escape the viewport.
- Cube previews expose manual field overlay controls for mode, iso value,
  opacity, surface style, MO lobe colors, density color, color-map palette,
  and color-map range. Iso, opacity, and color-map range also expose visible
  sliders in the `xyzrender` controls popover.
- Cube volumetric control scope is intentionally limited to those field
  overlay controls for now. HOMO/LUMO and ESP previews need direct control over
  mode, threshold, transparency, surface style, and colors; more specialized
  volume rendering controls should be added only when a concrete user workflow
  requires them.
- Cube defaults choose a field overlay mode from the cube descriptor:
  electrostatic potential for ESP cubes, molecular orbital for HOMO/LUMO cubes,
  density for ordinary density cubes, and NCI-style pairing for matching
  density/gradient cube pairs.
- Browser development `.mae.gz` loading uses a raw file endpoint so Vite does
  not decode gzip content before preview parsing.
- Browser development previews support a bounded CMS/MAE/MaeGZ preview path by
  extracting a Maestro atom subset for Mol* as PDB when Maestro residue, chain,
  and PDB atom fields are present. This keeps protein-like CMS previews on a
  protein-aware Mol* path instead of degrading them to bare XYZ.
- SDF series expose an explicit Mol* pose-browser path from the grid. The
  `Poses` action opens a receptor + ligand docking document, preserves SDF
  record order as pose order, and exposes previous/next pose controls in Mol*.
- Drag/drop into the `xyzrender` SVG sheet accepts paths and grid records from
  the desktop shell and preserves the viewport drop point when the drop lands on
  the active viewer.
- The SVG-sheet transform model is shared by the base `xyzrender` artifact and
  all added sheet structures: drag, resize, selection clearing, keyboard
  rotation, and Ketcher-style hover rotation controls all use the same
  interaction installer.

## Current Verification Evidence

- `bunx --bun vp run test-ui`
- `bunx --bun vp check`
- `git diff --check` on the touched preview/browser/test files
- Browser smoke on the 10k grid:
  `60 of 10,000 visible molecules are rendered`, with no `Command failed` text
  and no `-a 0.1` or `-b 0.01` arguments in the rendered page text.
- Browser smoke after `grid-ui-v17` restart confirmed 120 visible 10k-grid
  cards after scrolling, with `xyzrender` SVG bonds and atom circles present,
  no loading cards left, and no `Command failed` text.
- Browser smoke after `grid-ui-v37` restart opened the 10k grid and confirmed
  right-edge, bottom-edge, and corner card resize drags. The screenshots showed
  square cards at each size, molecule drawings contained within the white card
  pictures, and no dark empty card rectangles.
- The same `grid-ui-v37` Browser pass scrolled the resized 10k grid and returned
  to the controls. The top tab chrome ended at `y=56`, the molecule iframe
  started at `y=56`, no file-page progressive blur element was present, and no
  browser error logs were emitted.
- Browser all-files smoke opened 70 files at
  `qa=all-files-grid-v20-clean-1779911319863`: the 10k CSV, the CMS fixture,
  the Desktop BurettePreviewSamples set, and the Desktop xyzrender examples.
  The negative `no-molecule-column.csv` fixture was intentionally excluded from
  this clean smoke because it is expected to raise an issue.
- Browser smoke on `litr_moses_10k.csv` under `grid-ui-v20` confirmed 10,000
  rows loaded, 60 cards shown by default, RDKit active, Properties false, and
  no molecule names visible.
- Browser smoke after switching the 10k grid to `xyzrender` card mode showed
  bonded molecule drawings and no `invalid molecule` or `Command failed` text.
- Browser exact Fast smoke on `single.xyz` clicked
  `[data-buret-renderer="xyz-fast"]` with no visible issue and no browser error
  logs. Broader representative format smoke also produced no issue text, but
  still needs a deterministic active-renderer assertion.
- Contract coverage now asserts that SMILES-backed `xyzrender` grid cards use
  generated SDF/molblock input and no longer submit `.smi` input to
  `xyzrender`.
- Browser visual smoke after the SMILES-to-SDF fix opened
  `samples/large/litr_moses_10k.csv`, confirmed normal bonded `xyzrender`
  cards on the first page, then scrolled to the next batch around molecules
  50-75 with bonded `xyzrender` cards still visible and no console errors
  beyond ordinary Vite/React development logs.
- Browser layout audit on the 10k grid showed the top tab bar ending at
  `y=56` and the molecule iframe starting at `y=56`, with no topbar/iframe
  intersection.
- Browser smoke on `tests/fixtures/maestro-preview.cms`.
- Browser smoke on a temporary workspace `.maegz` generated from
  `tests/fixtures/maestro-preview.cms`, with Mol* runtime HTML created and no
  `ISSUE` or `Command failed` message.
- Browser smoke on `caffeine_homo.cube`; the generated runtime HTML includes
  the expanded field controls and no `ISSUE` or `Command failed` message.
- Browser smoke on `caffeine_lumo.cube`; the generated runtime HTML includes
  the expanded field controls and no `ISSUE` or `Command failed` message.
- Browser visual smoke on `caffeine_esp.cube` confirmed the `xyzrender`
  controls popover opens for field-overlay cube previews and shows the Field
  overlay sliders. Changing the opacity slider reruns the external
  `xyzrender` command without console errors.
- Contract coverage now asserts that renderer buttons expose deterministic
  active and disabled DOM state: Fast is disabled for non-XYZ formats,
  unavailable `xyzrender` is disabled for large/protein-like formats, and
  disabled renderer buttons cannot request a switch.
- Browser regression on `samples/mini.xyz` confirmed clicking Fast sets
  `#buret-toolbar[data-active-renderer="xyz-fast"]` and leaves Fast active and
  enabled.
- Browser regression in the separate finish-interactions worktree confirmed
  `single.xyz` exposes Fast, clicking it switches
  `#buret-toolbar[data-active-renderer="xyz-fast"]`, renders a
  `.buret-xyz-fast-root`, and emits no issue toast.
- Browser regression on `1HTB.pdb` confirmed the toolbar stays on Mol*, the
  renderer switch is not visible, and Fast plus external `xyzrender` are both
  hidden and disabled.
- Browser regression in the separate finish-interactions worktree confirmed
  `1HTB.pdb` keeps Fast hidden and disabled with `aria-disabled="true"`.
- Browser regression on `caffeine_esp.cube` confirmed the preview opens in
  external `xyzrender` mode with field controls present and default
  `fieldMode: "esp"`, `fieldOpacity: 0.5`, and solid surface style.
- Browser smoke in a separate worktree confirmed the 10k RDKit grid loads 96
  visible cards via `/__burette/rdkit-wasm` served as `application/wasm`.
- Browser smoke in a separate worktree confirmed SDF grid `Poses` opens
  `Docking: 1HTB.pdb + 1 ligand` and Mol* pose controls switch `Pose 1 / 2`
  to `Pose 2 / 2` and back with no visible issue.
- Browser smoke in a separate worktree confirmed the base SVG-sheet artifact can
  be dragged from its body, rotated from the keyboard, and deselected by clicking
  outside the artifact.
- The SVG-sheet background is now a hit target, so clicking blank sheet space
  clears the current structure selection without requiring a precise click on a
  molecule card.
- Remote candidate search found the user-reported real CMS on `kolmogorov` at
  `/mnt/ligandpro/shared_storage/nikolenko/nav18_metadynamics_20260526/nav18_7wel_95T_bpmd_n1_metadynamics/pose_01/SystemBuilder_01-out.cms`.
- The remote real CMS is a 78 MB ASCII Maestro CMS. It contains `full_system`,
  `solute`, `ion`, and `solvent` CT blocks; the protein-like `solute` atom table
  starts after the first 32 MB, so bounded CMS/MAE preview now reads the first
  64 MB and scores CT blocks to prefer `solute` over `full_system`, ions, and
  solvent.
- Its atom tables use Maestro's `# First column is atom index #` convention, so
  CMS/MAE/MaeGZ extraction skips that comment and offsets row lookups for the
  implicit atom index column.
- Added `tests/fixtures/real-systembuilder-mini.cms`, a small deterministic
  real-derived fixture cut from that remote `SystemBuilder_01-out.cms`, and
  attached Rust CMS/MAE/MaeGZ parser coverage to both the legacy XYZ extraction
  and the new protein-aware PDB extraction.
- Browser smoke on a locally staged copy of the remote 78 MB
  `SystemBuilder_01-out.cms` under
  `qa=real-cms-full-p0-pdb-v2` confirmed the bounded 64 MB preview path opens
  in Mol* without an issue toast and renders the protein-like `solute` CT as a
  ribbon/cartoon representation.

## Remaining Requirements

- The exact user-reported local Desktop path is still absent on this machine:
  `/Users/nikolenko/Desktop/nav18_metadynamics_20260526/nav18_7wel_95T_bpmd_n1_metadynamics/pose_01/SystemBuilder_01-out.cms`.
  The durable real-world source for this P0 is the matching `kolmogorov`
  `/mnt/ligandpro` file plus the real-derived
  `tests/fixtures/real-systembuilder-mini.cms` fixture.
- Keep Browser smoke coverage attached to the real-derived
  `tests/fixtures/real-systembuilder-mini.cms` fixture and the locally staged
  78 MB remote copy when touching the Maestro parser again.
- Add a full Browser performance pass that scrolls the 10k grid beyond the
  first rendered batch and records paging/render timing for both RDKit and
  `xyzrender` card modes.
- Keep extending docking drag/drop only when a concrete docking workflow needs a
  new combination rule. The current supported path is receptor + SDF series
  opened through the grid `Poses` action, with sidebar/active-document drops
  routed through the existing receptor/ligand rules.
