# Ligand interaction diagrams

A 2D map of how a ligand sits in its pocket: the ligand drawn flat with its
real bond orders and charges, the residues it touches around it, and one mark
per contact (hydrogen bonds, salt bridges, π stacking, cation–π, halogen
bonds, metal and water contacts, hydrophobic contacts). Burette draws it from the structure the
user has open, with no server and no account.

## Where it appears

- **Interactions** dock tab (right dock, `+` → Interactions). It maps the
  structure shown in the dock's document: a ligand picker, a design picker,
  and the map, which fills the panel. Picking a residue or a contact in the
  map focuses it in the 3D view with the contact's atom pairs and distances.
- **Ligand card** in the 3D view. Pointing at a ligand opens its card with a
  compact map: only the residues in contact, no legend. The header switches
  between the map and the plain molecule and picks the design. A click on free
  space in the map shows it at full size in the Interactions tab; while that
  tab is open the card shows the molecule. A click on the header or on ×
  folds the card into a chip in the corner, and hover no longer opens it until
  the chip is clicked.
  Settings → Structure rendering → Ligand card sets what the card shows first
  (`ligandCardContent`: interaction map or molecule), its design
  (`ligandCardDiagramStyle`) and whether it opens on hover or stays open
  (`ligandCardDisplay`).
- The map is offered for PDB and mmCIF files (`.pdb`, `.ent`, `.cif`,
  `.mmcif`) in the desktop app and in browser-dev. Quick Look, the agent shell
  and hosted builds have no engine and do not offer it.

## Designs

The page ships five designs, listed in `styles/index.json` in panel order:
Schrödinger, MOE, PoseEdit, Pocket wall and Burial map. Each design has a
`pipeline` block with the layout rules the engine applies (how partners are
drawn, which other pocket residues are shown, waters, hydrophobic arcs) and a
`view` block the page uses to draw it. The page also asks for a portrait or a
landscape layout to suit the shape of its frame, and a compact pocket context
when it is small.

## Engine

`apps/desktop/src-tauri/src/commands/interaction_diagram_runner.py` reads one
JSON request on stdin (`path`, `ccdCache`, optional `ligand`, `rules`) and
prints one JSON line: the structure's ligands (HETATM residues with at least
five heavy atoms, minus waters, ions and common additives) and the diagram of
the requested ligand or of the largest one.

1. gemmi reads the structure (first model, no alternate locations, no
   hydrogens).
2. The ligand gets bond orders, charges and aromaticity from its Chemical
   Component Dictionary entry, then pH 7 protonation states.
3. Contacts are perceived from the 3D coordinates with geometric criteria per
   contact kind; solvent exposure comes from a Shrake–Rupley surface.
4. RDKit draws the ligand in 2D oriented like its 3D pose. The residues get
   a greedy first placement, then SciPy minimises one energy over all of
   them: contact lines near their target length, residues near their 3D
   direction, and penalties for residues overlapping the ligand or each
   other and for lines crossing residues or ligand atoms.

The result is an InteractionDrawer scene plus overlay data (pocket contour,
exposure, chain links) and atom references back to the structure, so a pick in
2D maps to atoms in 3D. A typical complex takes a few seconds.

### Runtime and dependencies

The engine runs in the xyzrender Python runtime bundled with the app, which
carries RDKit, NumPy, SciPy and gemmi (`config/xyzrender/requirements.in`;
`scripts/prune-xyzrender-runtime.py` keeps gemmi and SciPy). Without the
bundled runtime (a development build) the app uses the interpreter it would
use for descriptors; that interpreter needs gemmi, RDKit and SciPy.

The desktop app runs the engine with the `interaction_diagram` command
(`commands/interaction_diagram.rs`): it checks the file type and size (at most
256 MiB), passes the design's rules through (at most 1 KiB; the engine checks
each value), runs one BLAS thread per diagram, and keeps the last 16 diagrams
by file, modification time, ligand and rules. Browser-dev runs the same script
through `POST /__burette/interaction-diagram`
(`apps/desktop/vite/browser-dev/interaction-diagram.ts`) for files it is
allowed to read.

### Network

Chemical Component Dictionary entries come from
`https://files.rcsb.org/ligands/download/<CODE>.cif` the first time a ligand
code is mapped and are kept in the app cache (`chemical-components` in the
desktop app, `~/.cache/burette/ccd-ligands` in browser-dev). The code is
checked (1–5 letters and digits) and an entry is limited to 4 MiB. The
structure itself never leaves the machine.

## Page and host messages

The page is `apps/desktop/public/interaction-diagram/index.html`, a static
module served with the app. It runs in a frame with `embed=1` and talks to its
host over `postMessage`. The Interactions tab is its host directly. In the
ligand card the viewer is the host: it relays `diagram-request` to the app as
`interactionDiagramRequest` and the answer back. The viewer learns the page's
address from `interactionDiagramPage` in its configuration: an `asset:` URL of
the copy in the app's resources in the desktop app (the viewer runs at an
`asset:` origin), the dev server's copy in browser-dev, and none elsewhere.

| Direction | Message | Meaning |
| --- | --- | --- |
| page → host | `{ source: "burette-lid", type: "ready" }` | The page listens for `configure`. |
| page → host | `{ type: "diagram-request", id, ligand, rules }` | Asks for a diagram; the host answers with `type: "diagram"`, the same `id` and `result` or `error`. |
| page → host | `{ type: "ligands", ligands }`, `{ type: "styles", styles }` | What the page can show. |
| page → host | `{ type: "loaded", ligand }` | A diagram is drawn. |
| page → host | `{ type: "contact", contact }`, `{ type: "atom", atom }` | The user picked a contact, a residue or an atom. |
| page → host | `{ type: "open" }` | The user clicked free space in the map. |
| host → page | `{ source: "burette-lid-host", type: "configure", ligand, style, theme, hydrogens }` | Changes what is shown. |

## Third-party code

The page draws with InteractionDrawer (rareylab, BSD-3-Clause, revision
`59cf647`, minified with esbuild), d3 7.9.0 (ISC) and Fraction.js 4.3.7 (MIT).
Their licenses ship in `vendor/` beside them; see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Validation

- `python3 tests/test-interaction-diagram-engine.py` with a Python that has
  gemmi, RDKit and SciPy: imatinib in its ABL pocket (trimmed 2HYY), offline,
  the expected hinge, gatekeeper, αC glutamate and DFG contacts, and rejected
  rules and ligands. Native CI runs it with the interpreter inside the built
  app.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` and
  `bun run test:tauri-structure` for the command and its registration.
- In browser-dev, open a complex with `?devFiles=` and the Interactions tab.
