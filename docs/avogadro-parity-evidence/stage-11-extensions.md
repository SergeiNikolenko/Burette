# Stage 11 evidence: extensions and shared interactions

Branch `parity/extensions`, from `a5f7303cd`; `parity/optimization-automation`
merged at `caa5d94ef`. Nothing here was run in a live browser, the packaged
plugin or the native app GUI. Those lanes have exact acceptance scripts below.
The one native check that did run is the real-package Rust test, which
downloads RDKit from conda-forge (see the results table).

## References and fixtures

| File | Provenance |
| --- | --- |
| `config/avogadro-plugin-index.snapshot.json` | `https://avogadro.cc/plugins2.json`, recorded 2026-11-01 (`Last-Modified: Sun, 01 Nov 2026 12:04:11 GMT`). 34,929 bytes, SHA-256 `bcc5fe247bfbd8e54b4abc878bb9e50fe7191708a98b57420c1d7318dbbf8816`, 31 entries, all `pyproject.toml` packages. This is the saved list the catalog shows when the live index is unreachable. |
| `tests/fixtures/avogadro/avogadro-rdkit-82498e3a.zip` | Archive of `ghutchis/avogadro-rdkit` at `82498e3a3cedc2d465ccdcd93cabec1b2505dc5a`, downloaded from the index's archive address. 13,716 bytes, SHA-256 `f93c4df5296eae7a52e482a3b334452adab1123d06330845db334879ceea9fa4`, which equals the index entry. 18 entries: 14 files, 22,375 bytes expanded. |
| `tests/fixtures/avogadro/rdkit-mmff94-caffeine.stdout.json`, `rdkit-select-smarts-caffeine.stdout.json`, `rdkit-etkdg-caffeine.stdout.json` | Real stdout of that package (`pixi install`; RDKit 2026.09.1 from conda-forge) for `samples/structures/small-molecules/caffeine.sdf`. Produced by the Avogadro protocol (`<script> <identifier> --lang en`, JSON on stdin). |

## Requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| 11.01: Settings Extensions shows author, download and issues links and a reliable install state; deterministic errors and retry; progress and cancel in Jobs | Done (desktop install; browse on every web surface) | `avogadro-plugins-section.tsx` and `avogadro-plugin-controls.tsx`. The catalog shows the live index or, when it fails, the saved list with a fixed message (`CATALOG_UNREACHABLE` / `CATALOG_INVALID`). Each row shows the name, description and version; expanding it shows authors, license, features, last update, revision and links (Source, Readme, Report an issue, Download). Install, Update, Set up and Remove use confirmation dialogs; Install and Update show the license, authors, source and revision before anything is downloaded. Native errors become fixed messages (`pluginFailure`). Install, setup and runs appear in Jobs and can be cancelled (`run_cancellable`, `fetch_cancellable`). Tests: `test:avogadro-plugin-index`, `test:avogadro-plugin-install`, `test:extension-ui`, `cargo test --lib avogadro_plugins`. |
| 11.02: assess each capability individually | Partial | `menu-commands` are wired: options dialog, SDF/MOL/XYZ/CJSON input, results open as new documents, selections and notices. `file-formats`, `input-generators`, `energy-models` and `electrostatic-models` are listed under "Provides" but not wired ([contracts](../avogadro-extensions.md#desktop-package-lifecycle)). |
| Per-surface decision for Python command plugins | Done | [Command and script extensions by surface](../avogadro-extensions.md#command-and-script-extensions-by-surface). The browser shell, browser-dev and hosted plugin browse only (rows say "Desktop app"). The desktop runs packages through pixi after explicit Set up. Quick Look and iPhone have no route. Agents get no route either: it would run third-party code, which the plugin/MCP surface excludes. Nothing runs silently. |
| 11.03–11.07: Crystals bundle | Foundation kept; desktop links fixed | The existing Crystals runner, store and opening path are unchanged and their tests still pass (`test:extension-*`, `test:crystals-browser`). The desktop Source and Report an issue links for Crystals were refused by the `open_external_url` allowlist; `shell.rs` now admits exactly `https://github.com/OpenChemistry/crystals` and its `/issues`, with tests. A live corpus open, search and pagination run is script B. |
| 11.08: Fragments | Not done | No attachment-aware insertion was built in this stage. |
| 11.09: RDKit candidate operations | Desktop host adapter done; browser not done | The real package installs, sets up and runs. MMFF94, SMARTS selection and ETKDG outputs are recorded and parsed (`test:avogadro-commands`). The ignored `real_rdkit_plugin_prepares_and_optimizes_caffeine` passed: 2:20 on the first `pixi install`, 30 s when cached. Standardize, tautomer, UFF, stereo assignment and SMILES insertion go through the same adapter but have no recorded output. There are no browser (RDKit WASM) ports. |
| 11.10: cclib reader | Not done | It is a `file-formats` feature, which is not wired (see 11.02). |
| 11.11: legacy commands | Not done | |
| 11.12: shared camera and projection | Done for the main Mol* viewer | Camera menu: Perspective/Orthographic (radio items showing the live mode) and View from ±X/±Y/±Z. Each axis view puts the camera on the named side in either projection. Framing keeps the projection unless a caller names one. Tests: `tests/test-native-viewer-menus.mjs` uses the real builders and handlers, a Mol*-like `getFocus` and Mol*'s `Vec3`/`Mat4`. |
| 11.12: genuine keyboard rotation | Done for the main Mol* viewer | The canvas is focusable (`role="application"`, "3D view", focus ring only for keyboard focus). With keyboard focus and no pointer over it, the keys move the camera in steps: Shift+arrows rotate 5°, Q/E roll, W/S zoom 10 %, A/D and R/F pan, all in Mol*'s directions. With the pointer over the view, Mol*'s continuous controls own the keys, so nothing is applied twice. Docking-pose and ligand-card arrows ignore Shift. The test checks that a full turn returns to the start, that pitch keeps up square to the view, and that roll, zoom and pan are inverses of each other. Documented in [3D view camera](../keyboard-shortcuts.md#3d-view-camera) (the shortcuts page is pinned by `test-ui-shell-contract`). |
| 11.12: camera persisted through documents | Done (source evidence) | MOLX save goes through `plugin.managers.snapshot.serialize`, whose default parameters include `camera` (with `mode`, via `Camera.copySnapshot`) and `canvas3d` props (`molstar/lib/mol-plugin/state.js`). The per-document checkpoint keeps `mode` (`renderer-view-state.js`). No second store was added. A live check is script F. |
| 11.12: active-frame agreement | Done for frame consumers | Info used to keep its own listener and showed nothing when it mounted after the last report. It now reads the shared `useTrajectoryFrame` store with Plots, Vibrations and spectra; the store keeps the global index, segment start and source path (`test:info-trajectory-frame`, `test:scientific-source`, `test:retained-plots`). Geometry, Edit and Properties edit one structure and do not follow frames; Z-matrix conversion is single-frame only. |
| 11.12: property-editing entry points | Done (palette) | Edit atoms and bonds (MOL/SDF) and Edit geometry (XYZ) open their docks from the command palette, with the same availability rules as the docks, and return keyboard focus to the dock tab (`test:editing-entry-points`). Properties stays in Info → Tools. |
| Coordinator finding: Geometry/Z-matrix at 360 px | Fixed | The tables have no fixed minimum width. Below 440 px of panel width, a container query puts the reference and its pin above the value, so all three columns fit; headers may wrap. Headers are one text run ("Bond, Å"). Pins read "Keep bond of H2 fixed" (`test:geometry-ui`). Script H. |

## Edits to shared or central files

- `apps/desktop/src/App.tsx`: mounts `AvogadroCommandHost` (one line).
- `apps/desktop/src/components/command-palette/index.tsx`: Extensions group, Edit/Geometry entries, generic `workbench-tool-*` focus mapping; `lib/workbench/focus-tool-dock.ts` kinds.
- `apps/desktop/src/components/editor-area/scene-compute-menu.tsx`: Extensions submenu.
- `apps/desktop/src/components/jobs-panel.tsx`: phase labels; `lib/extensions/resource-install-runner.ts`: `prepare`/`run` operations and `plugin` field.
- `apps/desktop/src/lib/structure-composition.ts` (`granularity: "atom"`), `lib/workbench/selection.ts` (`viewerAtomSelection` export), `lib/workbench/source.ts` (frame store fields).
- `apps/desktop/src/components/structure-info-panel.tsx`: uses the shared frame store.
- `PreviewExtension/Web/viewer.js` and `viewer-runtime.css` (copied to `plugins/burette-agent/preview-web/`): camera menu, axis views, focus framing, keyboard camera, Shift guards.
- `crates/burette-core/src/bounded_process.rs` (`run_cancellable`), `apps/desktop/src-tauri/src/commands/database/http.rs` (`fetch_cancellable`), `commands/shell.rs` (Crystals links), `src/lib.rs`, `commands/mod.rs`, `permissions/burette.toml`, `gen/schemas/acl-manifests.json`: native commands and their permissions.
- `apps/desktop/src/components/workbench/zmatrix-panel.tsx`, `geometry-fields.tsx`, `components/geometry-panel.tsx`, `workbench/geometry.css`: the coordinator's Geometry fixes.
- `package.json` (new `test:*` scripts appended to `test:ui`), `README.md`, `docs/security-and-permissions.md`, `docs/keyboard-shortcuts.md`, `docs/graph-editing-and-properties.md`, `docs/avogadro-extensions.md`.

## Focused validation run

At the commit that adds this file, every check below passed:
- `bun run typecheck` and `check:js`;
- `test:avogadro-plugin-index`, `test:avogadro-plugin-install` and `test:avogadro-commands`;
- `test:extension-resources`, `test:extension-runner`, `test:extension-ui` and `test:crystals-browser`;
- `test:geometry-ui` and `test:zmatrix-controls`;
- `test:info-trajectory-frame`, `test:editing-entry-points`, `test:orbitals-activation`, `test:retained-plots` and `test:scientific-source`;
- `bun tests/test-native-viewer-menus.mjs`, `bun tests/test-ui-shell-contract.mjs` and `bun test tests/test-viewer-viewport-toolbar.test.tsx`;
- `git diff --check a5f7303cd HEAD`;
- `nice cargo test -j 2 --lib avogadro_plugins`: 11 passed, 1 ignored.

The ignored test, `cargo test --lib real_rdkit_plugin -- --ignored`, passed earlier on this branch against the live conda-forge download. Clippy reported nothing in the new modules. Full `test:ui` and `ci-fast` were not run.

## Remaining gaps

- 11.02 feature kinds other than menu commands; 11.08 Fragments; 11.10 cclib; 11.11 legacy commands.
- Browser ports of the RDKit operations.
- Recorded output for the five unrecorded RDKit commands.
- Camera parity outside the main Mol* viewer. The mesoscale viewer, Mol* preset previews, Ketcher's Miew view and the chemical-space three.js view keep their own controls.
- No Edit, Geometry or Properties item in the 3D context menu.
- No agent action for projection or axis views.
- Every scenario below is unrun on its target surface.

## Acceptance scripts

Browser shell, once per run: `bun run build:agent-shell` (its output is not committed). Then:

```bash
OPEN=$(node scripts/burette-agent.mjs open --mode browser-agent-shell "$PWD/<fixture>")
jq -r .result.url <<<"$OPEN"   # open this URL in the Codex in-app Browser
```

Desktop: `BURETTE_DEV_FLAVOR=avoext ./scripts/build.sh && BURETTE_DEV_FLAVOR=avoext ./scripts/install.sh`, then open the installed dev app.

Every scenario runs four times:
- light theme;
- dark theme (Settings → Appearance);
- a narrow window: browser viewport 800×600, or the desktop window at its minimum width with the right dock at its default 360 px;
- keyboard only: Tab, Shift+Tab, Enter, Space, Escape and the arrows; no pointer over the 3D view.

A scenario passes only if all four runs show the expected result.

### A. Catalog browse, search, pagination and links (browser shell and desktop; any fixture, e.g. `samples/mini.pdb`)

1. Open Settings: `/` or Cmd+P, then type "Settings" and press Enter. Choose Extensions.
   - Expect an "Avogadro plugins" card with a search field.
   - "Loading…" shows briefly, then 25 rows and a pager reading "1–25 of 31" with Previous disabled.
2. Press Next.
   - Expect "26–31 of 31", Next disabled and Previous enabled.
   - Focus stays on Next or moves to Previous; it is never lost to the page body.
3. Type `rdkit` in the search field.
   - Expect one row, "avogadro-rdkit 0.3.0", and the pager disappears.
   - Type `zzzz`: expect "No matching plugins".
   - Clear the field: 25 rows return.
4. Expand "avogadro-rdkit details" with Enter.
   - Expect Authors, License "BSD-3-Clause", Provides (commands), Updated, Revision `82498e3a3ced`, and the links Source, Readme, Report an issue and Download.
   - Press Report an issue. Desktop: the system browser opens the repository's issues page. Browser shell: a new tab opens it.
5. Rows by surface:
   - Browser shell: every row ends with "Desktop app"; there are no Install buttons.
   - Desktop: rows end with Install.
6. Failure:
   - Block `avogadro.cc`: browser shell via DevTools request blocking; desktop by turning off the network. Reopen Settings → Extensions.
   - Expect "Could not reach the Avogadro plugin index. Showing the saved list." with Retry, and still 31 rows.
   - Restore the network and press Retry: the message disappears.
7. Narrow window: rows wrap; the version and action never overlap the description, and the card does not scroll sideways.

### B. Crystals (browser shell and desktop)

Settings → Extensions → Crystals.

1. Install. Expect a Jobs entry with byte progress.
2. Cancel mid-download. Expect the entry to read Cancelled and Crystals to stay uninstalled.
3. Install again. Expect Installed.
4. Browse, then search "NaCl". Open the result.
   - Expect a new ordinary CIF document with its citation.
5. Remove Crystals. The open document stays.
6. Desktop: Source and Report an issue open `github.com/OpenChemistry/crystals` and its `/issues` page; this was refused before.

### C. Desktop install, update and remove (`avogadro-rdkit`)

1. Press Install on avogadro-rdkit.
   - Expect a confirmation titled "Install avogadro-rdkit 0.3.0?" showing License BSD-3-Clause, the authors, Source `github.com/ghutchis/avogadro-rdkit` and Revision `82498e3a3ced`.
   - Escape cancels and nothing is downloaded.
2. Confirm with Install.
   - Expect "Installing…" with Cancel, and an "Install avogadro-rdkit" Jobs entry.
   - It ends with status "Installed" and a Set up button.
   - The details list Installed `0.3.0 · 82498e3a3ced`, the eight commands, and View license, which opens the package's BSD text.
3. Cancel test: Remove, then Install and press Cancel at once.
   - Expect the job to read Cancelled and the row to show Install again.
   - No `installed.json` exists under `~/Library/Application Support/com.local.BuretteV10.avoext/avogadro-plugins/avogadro-rdkit/`.
4. Failure: turn off the network and press Install.
   - Expect "avogadro-rdkit could not be installed. Check the connection and try again." with Retry and Dismiss. Retry works once the network is back.
5. Remove.
   - Expect a confirmation saying documents stay.
   - The row returns to Install, and the package folder is gone.

### D. Desktop Set up and run (`samples/structures/small-molecules/caffeine.sdf`)

1. With the package installed, press Set up and confirm.
   - Expect "Setting up…" and a Jobs entry. The first run takes about 2–3 minutes (it downloads RDKit).
   - It ends with "Ready".
   - Without pixi on PATH, expect "Setting up a plugin needs pixi. Install pixi, then try again."
2. Open caffeine.sdf, then Compute → Extensions → RDKit → MMFF94 Optimize.
   - Expect a Jobs entry, then a new document "caffeine-…" whose atoms keep caffeine's graph, with a success notice.
   - The source document is unchanged.
3. Compute → Extensions → Select → Select by SMARTS, enter `a` and press Run.
   - Expect the notice "Select › Select by SMARTS selected 9 atoms" and those atoms selected in the 3D view.
   - These are caffeine's nine ring atoms, all aromatic in RDKit (`Cn1c(=O)c2c(ncn2C)n(C)c1=O`).
4. Compute → Extensions → RDKit → ETKDG Conformer: keep the defaults and press Run.
   - Expect a new SDF document with 3 records (pose stepper 1/3).
5. Start ETKDG again with a large conformer count and cancel it in Jobs.
   - Expect "… was cancelled." and no new document.
6. Keyboard-only: run the same commands through the palette.
   - `/` → "MMFF94" → Enter.
   - The options dialog traps focus, Enter runs it, and Escape cancels.

### E. Camera menu (browser shell and desktop; `samples/mini.pdb`)

1. Open the viewer rail's Camera button.
   - Expect Reset zoom, Lay flat and Reset axes, then Perspective (checked) and Orthographic, then View from +X, −X, +Y, −Y, +Z and −Z.
   - Keyboard: Tab to Camera, press Enter, use the arrows, Home/End and Enter, and Escape returns focus to the button.
2. Choose Orthographic.
   - Expect parallel projection: distant and near atoms are the same size.
   - Reopen the menu: Orthographic is checked.
3. Choose View from +Z, then View from −Z.
   - Expect the structure mirrored left to right between the two, still centred and orthographic.
   - View from +Y looks down with X still pointing right.
4. Choose Reset zoom: the view stays orthographic.
5. Switch to Perspective: the projection returns.

### F. Camera persistence (desktop and browser shell; `samples/mini.pdb`)

1. Choose Orthographic and View from +X. Switch to another tab and back.
   - Expect the same orthographic +X view.
2. Save the scene as MOLX (the tab's context menu → Save scene…). Close the document and reopen the MOLX.
   - Expect the orthographic +X view; the Camera menu shows Orthographic checked.

### G. Keyboard camera and arrow keys (browser shell; `samples/structures/small-molecules/imatinib-poses.sdf`)

1. Move the pointer off the 3D view and press Tab until the view shows its focus ring (accessible name "3D view").
2. Press Shift+Right 18 times.
   - Expect a 90° turn about the vertical screen axis, in 5° steps, without changing the pose.
   - Shift+Up tilts; Q/E roll; W zooms in and S zooms back out; A/D and R/F move the structure.
3. Press Right without Shift: expect the next pose (2/N). Left returns to 1/N.
4. Move the pointer over the view and hold W.
   - Expect Mol*'s smooth zoom, and no double speed compared with step 2.
   - Press T: the view resets.
5. Click the view with the mouse: no focus ring appears (keyboard focus only).
6. Both themes: the focus ring is visible against the background.

### H. Geometry at the default dock width (`tests/fixtures/quantum/gaussian16-water-raman.fchk`)

1. Open the file and add Geometry to the right dock at its default 360 px.
   - Expect all three columns readable without scrolling sideways, and headers "Bond, Å", "Angle, °" and "Dihedral, °".
   - Each value sits under its reference atom.
   - Water values: O–H 0.9893 Å, angle 100.03°.
2. Narrow the dock further.
   - Headers wrap, and no column is hidden.
3. VoiceOver or the accessibility tree: the pins read "Keep bond of H2 fixed" and "Keep angle of H3 fixed"; the headers read "Bond, Å".
4. Widen the dock past about 460 px: each value returns to one line with its reference.

### I. Active frame and editing entry points (`samples/trajectory.xyz`, `samples/structures/small-molecules/benzene.mol`)

1. Open trajectory.xyz with Info closed. Step the trajectory toolbar to frame 3, then open Info.
   - Expect its trajectory controls present at once, without waiting for another frame change.
   - Info, Plots (where offered) and the toolbar agree on frame 3.
2. Open benzene.mol and press `/`. Type "edit", choose Edit atoms and bonds, and press Enter.
   - Expect the Edit dock for benzene, with keyboard focus on its selected tab.
   - For benzene.xyz the palette offers Edit geometry instead, and it opens Geometry.
