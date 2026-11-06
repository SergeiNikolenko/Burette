# Avogadro extension and resource contracts

This is stage 11 of the [full adoption contract](avogadro-adoption.md).
The [acceptance ledger](avogadro-parity-checklist.md) distinguishes adopted
resources from future scientific adapters and other-runtime verification.
Settings Extensions, Jobs and the Crystals browser resource workflow are adopted.
Settings Extensions also browses the Avogadro plugin index on every surface and,
in the desktop shell only, installs, sets up and runs Avogadro Python packages
through the protocol described below. That runner is not a compatibility claim
for every package in the index; each package's commands are verified
individually.

## Pinned upstream boundaries

The reviewed Avogadro library pin is
[`d250eb3c62a61470b1e0cdf205dcfe26b06f991f`](https://github.com/OpenChemistry/avogadrolibs/tree/d250eb3c62a61470b1e0cdf205dcfe26b06f991f)
(BSD-3-Clause). Its package manager names `https://avogadro.cc/plugins2.json`;
that address is not a Burette runtime trust source. The inspected
[registry source](https://github.com/Avogadro/plugins/blob/1c1692db13ab5764559e56f4c3c7c8c02a716466/repositories.toml)
contains 31 entries at that pin, not a target count of Burette features.
A pinned registry snapshot does not establish today's generated catalog or
installation compatibility. Fragments, Crystals and the legacy examples below
were not entries in that registry revision.

The registry distinguishes pinned Git sources from archive URLs with compressed
SHA-256, and `pyproject.toml` from `avogadro.toml` metadata. Its reviewed current
Python package boundary requires an `avogadro-*` executable entry point; legacy
`plugin.json` data/command manifests are a different protocol. Metadata includes
version, source, feature kinds, authors and issue trackers. The pinned
[plugin IO contract](https://github.com/Avogadro/two.avogadro.cc/blob/3ea91236f8e87b69bef94b56bb0845266ebe9cdd/source/develop/plugins/io.md)
allows format-specific molecular input, options and selected atom indices,
with structures, selections, charges or generated files in output. Each actual
executable still needs inspection: cclib emits raw CJSON, not the normal command
envelope. None of these contracts grants browser code execution.

| Candidate | Exact reviewed source | License/attribution and adapter boundary |
| --- | --- | --- |
| Crystals | [OpenChemistry/crystals](https://github.com/OpenChemistry/crystals/tree/7adea78a682c1fa793825c85e67de531005413ff), `7adea78a682c1fa793825c85e67de531005413ff` | Legacy data package 1.0, Geoffrey Hutchison. README declares public-domain files with COD/IZA origins; retain README and each CIF citation. No separate LICENSE in this pin; do not relabel the corpus BSD. |
| Fragments | [OpenChemistry/fragments](https://github.com/OpenChemistry/fragments/tree/7d842f435aec4729a308b23ad7f9501bdd44aa02), `7d842f435aec4729a308b23ad7f9501bdd44aa02` | BSD-3-Clause, Open Chemistry. 242 CJSON files plus amino-acid Z-matrices/depictions/generators; no root plugin.json or pyproject.toml. Review generated-data attribution independently. |
| RDKit commands | [ghutchis/avogadro-rdkit](https://github.com/ghutchis/avogadro-rdkit/tree/82498e3a3cedc2d465ccdcd93cabec1b2505dc5a), `82498e3a3cedc2d465ccdcd93cabec1b2505dc5a` | BSD-3-Clause, Geoff Hutchison. Project 0.3.0 requires Python 3.11+ and RDKit; eight commands, SDF input, CJSON additionally for stereo and some option schemas. Review WASM or host feasibility per operation. |
| cclib | [OpenChemistry/avogadro-cclib](https://github.com/OpenChemistry/avogadro-cclib/tree/cf5f13ba091d0b46f1f243d579f71facbd572e90), `cf5f13ba091d0b46f1f243d579f71facbd572e90` | BSD-3-Clause, Open Chemistry. Project 0.2.0 requires Python 3.11+ and cclib 1.8.1–<2; a read-only file-format feature accepts bytes or a filename envelope and writes raw CJSON. |
| Legacy commands | [OpenChemistry/avogadro-commands](https://github.com/OpenChemistry/avogadro-commands/tree/3ea31ad5b3a1fe4a460ee9644e7c339b0607df09), `3ea31ad5b3a1fe4a460ee9644e7c339b0607df09` | BSD-3-Clause, Open Chemistry. Manifest actions and actual files disagree; inspect option-discovery/run-command flags and molecular JSON before selecting a bounded port. |

## Required resource and adapter behavior

- **11.01** Settings Extensions shows inspectable author/download/issues and reliable install state;
  deterministic errors/retry and actual progress/cancel remain in shared Jobs. Resource success does
  not complete Python/C++/scientific extensions.

- **11.02** Assess capabilities individually, with pinned manifests/protocol/licenses and per-
  operation adapters; registry count is not a feature quota and legacy manifests do not imply
  current install compatibility.

- **11.03** Crystals preserves the complete 524-CIF pinned corpus, paths/categories/scientific
  citations and public-domain README/manifest attribution, excluding previews/executables; do not
  replace it with invented data or label it BSD.

- **11.04** Source archive bytes/hash and distribution/per-file hashes are distinct. Explicit
  maintainer updates verify cached pinned input; normal builds/checks are offline and deterministic,
  reject unsafe paths/links/duplicates/unexpected counts/expansion and never replace output after
  failed authentication.

- **11.05** Serve reviewed same-origin hash-addressed assets with raw compressed response hash;
  fixed catalog is trust anchor, no arbitrary URLs/user hashes/proxy. Atomic verified
  install/update/remove preserves prior version on cancel/quota/stale failure, with publication as
  commit and immutable version identity across uninstall.

- **11.06** Open installed CIF as a new ordinary document retaining original bytes/citations;
  removing resources never deletes open documents/exports. Test reload, retry, search/pagination,
  duplicate names, ordinary restored-source reopening, cancellation/focus and representative
  element/halide/oxide/zeolite files.

- **11.07** Keep the resource bounds explicit: 64 MiB source/archive expansion, 2,048 entries, 32
  KiB per CIF, 4 MiB retained data, 32 live/active resources and 1,024 immutable identity receipts.
  Corpus lexical parsing does not establish occupancy, symmetry or physical-science completeness.

- **11.08** Fragments requires attachment-aware graph insertion, dummy sites, identity/Undo/export
  and generated-data attribution under its pinned BSD notice;242 CJSON files or a viewer alone do
  not complete it.

- **11.09** RDKit candidate operations include standardization, canonical tautomer, MMFF94/UFF
  optimization, ETKDG conformers, stereo assignment, SMARTS selection and SMILES insertion; respect
  SDF/CJSON/options protocols and verify each API in actual WASM or a reviewed host adapter.

- **11.10** cclib candidate is a read-only Python reader producing raw CJSON with content
  compression detection; review backend/browser dependency stack,
  geometry/history/basis/orbitals/modes/units/malformed behavior. Native TS readers are not full cclib
  coverage.

- **11.11** The legacy manifest references absent centroid.py and flatten.py; inspect the actual
  flattenZ.py, scale.py and replace.py contracts. Any bounded revision-owned, undoable TypeScript
  port is not general Python plugin compatibility.

## Adopted Crystals foundation

The source of truth is [the resource lock](../config/crystals-resource.lock.json),
[offline generator](../scripts/crystals-bundle.mjs),
[validator](../apps/desktop/src/lib/extensions/resource-bundle.ts),
[store](../apps/desktop/src/lib/extensions/resource-store.ts) and
[opening adapter](../apps/desktop/src/lib/extensions/open-crystal.ts).
The pinned source archive contains 21,874,232 compressed bytes. The retained
`resources/extensions/openchemistry-crystals.bin` is 294,538 bytes; its 526
sorted records preserve 1,429,884 bytes across all 524 CIFs plus README and
manifest attribution. Their exact archive, bundle and per-entry identities are
recorded in the lock and distribution input, not inferred from Git blob IDs.
The archive's preview images are excluded.

Regeneration verifies the explicit input cache and retained-entry sizes/CRCs,
uses pinned fflate 0.8.3 with fixed level and zero timestamp, and executes no
upstream script. Normal builds/checks do not fetch or update upstream sources.
The `.bin` transport must deliver the locked compressed bytes without automatic
HTTP gzip decoding. The fixed Vite asset import supplies ordinary application
assets; no general runtime URL proxy is introduced. Hosted/widget support has
its own acceptance boundary.

Installation validates data before one transaction publishes the version pointer.
Persistent monotonic intents and compare-and-swap publication/cleanup prevent
stale install resurrection; immutable receipts retain version identity after
update/uninstall. Failed installs or absent removals do not consume live slots.
Quota/cancel before commit preserves the previous installation; cancellation
after committed success cannot revoke it. State derives from verified stored
content, not a preference toggle. Native storage/file opening must provide and
verify equivalent semantics separately.

The resource opener preserves ordinary source/Original identity across reload,
including same-name files, and never overwrites the active molecule. Bundle
removal leaves already opened documents and user exports intact. Scientific
validity, symmetry completeness and large-file behavior are independent of
successful installation or lexical parsing of all CIFs.

## Avogadro plugin index

Settings Extensions lists `https://avogadro.cc/plugins2.json`. Burette ships the
recorded snapshot [`config/avogadro-plugin-index.snapshot.json`](../config/avogadro-plugin-index.snapshot.json)
(retrieved 2026-11-01, `Last-Modified: Sun, 01 Nov 2026 12:04:11 GMT`, 34,929
bytes, SHA-256 `bcc5fe247bfbd8e54b4abc878bb9e50fe7191708a98b57420c1d7318dbbf8816`,
31 entries, all `pypkg` packages with `pyproject.toml` metadata) and shows it
first. Opening the section then refreshes once from the live index: the
browser shell fetches it directly (the host answers with
`Access-Control-Allow-Origin: *`); the desktop shell uses the native
`fetch_avogadro_plugin_index` command with one fixed address, a 1 MiB and
20-second bound and the shared public-address guard. A failed or unreadable
refresh keeps the last good list and shows one fixed message with Retry.

Entries are untrusted display data, validated one by one
([`avogadro-plugin-index.ts`](../apps/desktop/src/lib/extensions/avogadro-plugin-index.ts)):
names, versions, 40-hex commits and 64-hex archive hashes have fixed shapes;
text rejects control and format characters; repositories must be plain https
on GitHub, GitLab or Codeberg; archives must be served by `plugins.avogadro.cc`.
A malformed entry is dropped without hiding the rest; duplicate names keep the
first. Rows show name, description, version and, expanded, authors, license,
provided feature kinds, update date and revision with Source, Readme, issue and
Download links. In the desktop shell the native side resolves those links from
its own last fetched index or the snapshot, so the webview never asks it to
open an arbitrary URL.

## Command and script extensions by surface

Avogadro 2.1 runs a package by creating its environment with `pixi install`
(or a virtual environment) in the package folder and starting its console
script with the feature identifier, `--lang` and molecule JSON on stdin
(`avogadro/qtgui/pythonscript.cpp`, `packagemanager.cpp` and
`interfacescript.cpp` at the pinned avogadrolibs revision). Burette follows that
protocol where a process model exists and never runs downloaded code without
an explicit user step:

| Surface | Index | Install | Run |
| --- | --- | --- | --- |
| Browser shell, browser-dev, hosted plugin | Browse, search, links | Not offered; rows show `Desktop app` | Not offered |
| Desktop app | Browse, search, links | Downloads the indexed archive, requires its index SHA-256, unpacks it into private app data; nothing runs | `Set up` runs `pixi install` after a confirmation naming the package; commands then run from Compute › Extensions and the command palette as Jobs |
| Quick Look, iPhone | None | None | None |

The browser shell does not run these packages. They are Python programs, and
many depend on compiled conda-forge packages or executables (the index lists,
for example, `xtb-python`, `ambertools`, `psi4`, `crest` and `openjdk`; RDKit
and others come through PyPI dependencies). The archive host redirects to
`codeload.github.com`, whose CORS policy only admits GitHub's own renderer, so
even reading an archive would need a proxy, which 11.05 forbids. A Pyodide host
could load some pure-Python packages, but it would still execute downloaded
code inside the app origin next to stored documents, so Burette does not offer
it. The supported browser alternatives are the per-operation ports listed under
11.08–11.11 (for example RDKit operations in the existing RDKit WASM) and the
remote compute hosts.

### Desktop package lifecycle

[The native module](../apps/desktop/src-tauri/src/commands/avogadro_plugins/mod.rs)
takes only a package name and the revision the user saw. It looks the package
up in its own index copy, refuses a changed revision, downloads the archive
(32 MiB, 120 seconds, cancellable, at most three validated redirects), and
compares the bytes with the index SHA-256. [A small ZIP reader](../apps/desktop/src-tauri/src/commands/avogadro_plugins/archive.rs)
accepts stored or deflated regular files below one top-level folder and refuses
encryption, ZIP64, symbolic links, absolute, parent or backslash paths,
case-insensitive duplicates, more than 4,096 entries, entries above 64 MiB and
more than 128 MiB in total, checking each CRC-32. Files are private and not
executable. The package must declare the indexed name in `[project]`.
[The store](../apps/desktop/src-tauri/src/commands/avogadro_plugins/store.rs)
publishes `<name>/<commit>/` and then the `installed.json` receipt atomically;
failure or cancellation before the receipt leaves the previous version, and an
update removes the old revision only after the new receipt is written. Removal
renames the package folder away before deleting it. Documents opened from a
plugin's results are ordinary documents and stay after removal.

`Set up` requires `pixi` (looked up in `~/.pixi/bin`, `~/.local/bin`, `PATH`
and Homebrew) and a declared pixi workspace (`[tool.pixi.*]` or `pixi.toml`),
runs `pixi install` with a 30-minute deadline and cancellation, and reports
success only when `.pixi/envs/default/bin` exists. A run starts
`.pixi/envs/default/bin/<script> <identifier> --lang en` from the package
folder with that `bin` directory first on `PATH`, `PYTHONPATH`/`PYTHONHOME`
removed, molecule JSON (16 MiB) on stdin, 32 MiB stdout, 256 KiB stderr, a
30-minute deadline and cancellation. Script names (`avogadro-*`), identifiers
and `user-options` files are validated against the installed folder.

The webview reads the package's own `pyproject.toml` with a TOML subset reader
([`avogadro-plugin-manifest.ts`](../apps/desktop/src/lib/extensions/avogadro-plugin-manifest.ts))
for the console script and `[[tool.avogadro.menu-commands]]` entries. Command
input carries the declared format (`sdf`, `mol`, `xyz` or `cjson`), CJSON as
well when `input-cjson` is set, `selectedAtoms` from the 3D selection (none when
the viewer reports a truncated selection, with a notice), `charge`, `spin` and
`options` from a typed dialog built from the package's `user-options` file
(`integer`, `float`, `string`, `text`, `boolean`, `stringList`). Output follows
Avogadro's reader ([`avogadro-command-io.ts`](../apps/desktop/src/lib/extensions/avogadro-command-io.ts)):
leading non-JSON lines are ignored; a returned `sdf`/`mol`/`xyz`/`pdb` or CJSON
molecule opens as a new document (CJSON coordinate sets become SDF records and
atom/bond labels a notice); `selectedAtoms` becomes the viewer selection;
`message`, `warning` and `error` become notices. Burette never replaces or
appends to the active molecule, unlike Avogadro's undoable in-place replace;
closing the result document is the undo. `electrostatic-models` are listed but
not yet wired to a charge route.

### File formats and input generators

A `[[tool.avogadro.file-formats]]` reader (`support.read = true`, an output
format Burette opens) adds `Open › With <format-name>` to the sidebar file menu
of every file whose extension it declares
([`avogadro-formats.ts`](../apps/desktop/src/lib/extensions/avogadro-formats.ts)).
As in Avogadro's `fileformatscript.cpp`, the script runs as `<script>
<identifier> --read --lang en` with the file text on stdin, or
`{"operation":"read","filename":path}` for `input-mode = "file"`; the molecule
it prints (CJSON from cclib, after any log lines) opens as a new document named
after the file. Writers are not offered: Burette writes its own formats.

Each `[[tool.avogadro.input-generators]]` program appears under `More` next to
ORCA, Gaussian, Psi4 and CP2K in Export input file
([`plugin-input-form.tsx`](../apps/desktop/src/components/workbench/plugin-input-form.tsx)).
In package mode Avogadro passes these scripts no operation flag, so a run is
`<script> <identifier> --lang en` with `{options, cjson, charge, spin,
selectedAtoms}` on stdin. The form comes from the generator's `user-options`
file, JSON or TOML (ORCA's has 60 options on four tabs), keeps its pages in the
file's `tabs` order, keeps option keys with spaces and empty list entries
verbatim, and names files after the document through `Filename Base`. The
preview regenerates 400 ms after an option changes, one run at a time.
[`avogadro-input-generators.ts`](../apps/desktop/src/lib/extensions/avogadro-input-generators.ts)
then ports `InterfaceScript::replaceKeywords`: `$$atomCount$$`, `$$bondCount$$`
and `$$coords:SPEC$$`, `$$zmat:SPEC$$`, `$$zmatpad:SPEC$$` filled by Burette's
coordinate-block generator. A file that offers both a Cartesian and a Z-matrix
block keeps the one its `Coordinates` option names (any value containing
`z-matrix`, `zmatrix`, `zmat` or `internal`) and loses the other's line; a file
that offers one form always gets it. Files given only by `filePath` are refused
because they would point outside the package. Save writes every returned file.

Verified packages: `avogadro-cclib` (`cf5f13ba`) reads cclib's Gaussian MP2
water log into CJSON that Burette opens, and `avogadro-generators`
(OpenChemistry/avogenerators `965ea6302b930cfc34b0b2deefdab5737bfe15c0`) answers
for all eleven programs (Dalton, GAMESS-UK, Gaussian, MOLPRO, MOPAC, NWChem,
ORCA, Psi, PySCF, Q-Chem, TeraChem) with Burette's stdin and default options.
The Gaussian, ORCA (Z-matrix), Dalton (two files) and cclib answers are
recorded in `tests/fixtures/avogadro/`.

### Energy models

On the desktop, each `[[tool.avogadro.energy-models]]` entry of a set-up package
becomes an optimizer model (`src-tauri/src/commands/energy_models`), following
`qtplugins/forcefield/scriptenergy.cpp` (avogadrolibs
`cb0e94852889da9f7288bd1e58241e69990935a7`). The manifest supplies the
identifier, console script, input format, protocol (`binary-v1` for anything
starting with `binary`, otherwise `text-v1`) and `support` (`gradients`, `ions`,
`radicals`, `unit-cells`, `elements` as atomic numbers or ranges); the webview
names a model only by id. A run starts `<script> <identifier> [--protocol
binary-v1] --lang en` with the package's environment, sends one JSON line
(`charge`, `spin`, `selectedAtoms`, `options` and the molecule under its format
key, CJSON as an object), waits until the process has read that line, then sends
coordinates per evaluation: `x y z` lines answered by `AvogadroEnergy:` and
`AvogadroGradient:` lines, or `AVB1` frames answered by an energy-and-gradient
frame or an error frame. Energies are kJ/mol and become kcal/mol. The process
lives for one optimization and dies with it, its window or the app.

Bounds: 256 atoms, 8 open sessions, a 4 MiB start line, 1 MiB per reply, the
last 16 KiB of stderr for messages, 300 s for the first reply (start-up and
model loading) and 120 s for the next ones. An error frame refuses only that
evaluation; Cancel, a timeout, an exit or a malformed reply ends the session.
Burette writes `cjson`, `cml`, `mdl`, `mol`, `sdf` and `xyz`; models without
gradients, with other input formats or for unit cells are listed as
unavailable. Unlike Avogadro, plugin models are never chosen automatically.

The verified package is `avogadro-xtb-energy` (ghutchis,
`287e8093f65bca5b9d27fbf517a8719ae319d108`, `pixi install`): GFN2 over binary-v1
gives the xtb 6.7.1 water energy (−3181.7057 kcal/mol), and GFN-FF answers too.
At that commit its binary gradients are a factor of bohr² (0.28) too small
(`_HARTREE_TO_KJ_MOL / _ANG_TO_BOHR` instead of the product); Burette passes
replies on unchanged, so minima and directions are right but convergence on
the gradient is looser than configured.

The verified package is `avogadro-rdkit` 0.3.0
(`82498e3a3cedc2d465ccdcd93cabec1b2505dc5a`, archive SHA-256
`f93c4df5296eae7a52e482a3b334452adab1123d06330845db334879ceea9fa4`, recorded in
`tests/fixtures/avogadro/`): its eight declared commands are listed, and MMFF94,
SMARTS selection and ETKDG answers for caffeine are recorded from the real
package (RDKit 2026.09.1 from conda-forge).

## Focused checks and remaining acceptance

Run from the repository root:

```sh
vp run test:crystals
vp run test:extension-resources
vp run test:extension-runner
vp run test:extension-ui
vp run test:crystals-browser
vp run test:avogadro-plugin-index
vp run test:avogadro-plugin-install
vp run test:avogadro-commands
vp run test:avogadro-plugin-formats
(cd apps/desktop/src-tauri && cargo test --lib avogadro_plugins)
# Real package, downloads RDKit from conda-forge:
(cd apps/desktop/src-tauri && cargo test --lib real_rdkit_plugin -- --ignored)
```

Keep deterministic offline regeneration, corrupt/truncated/unsafe bundles,
quota failure, concurrent/stale install, before/during-publication cancel,
retry and old-version preservation covered. Real installation, Jobs continuation,
keyboard/focus, light/dark and narrow layouts, search/25-row pagination,
duplicate-name opening, exact source/export/reload and representative
chemical classes require target-surface evidence. Native storage/opening and
hosted deployment are separate from browser source or local packaging checks.
The other four candidates remain operation-specific browser work; on the
desktop they install and run through the package runner only once their own
commands are verified.

Plugin commands are not registered as agent workbench jobs: they run downloaded
third-party code, which the plugin/MCP surface excludes
([security](security-and-permissions.md#browser-and-agent-surfaces)); setup
and every run stay user gestures.

## Shared interactions (11.12)

- **Camera.** The Mol* Camera rail menu offers Reset zoom, Lay flat, Reset
  axes, Perspective/Orthographic and View from ±X/±Y/±Z. Framing and axis views
  keep the chosen projection. MOLX scene files and per-document view
  checkpoints keep the camera and its projection, because Mol*'s state snapshot
  includes the camera (with `mode`) and the canvas settings. Keys are listed in
  [3D view camera](keyboard-shortcuts.md#3d-view-camera). The focused 3D view
  takes Shift+arrow rotation and Q/E, W/S, A/D, R/F steps. Plain arrows keep pose
  and ligand stepping, which no longer react to Shift.
  Agents use `set_camera_projection` (`perspective`, `orthographic`) and
  `view_axis` (`+x` … `-z`); `observe_scene` reports the camera `mode`.
- **Active frame.** Info, Plots, Vibrations and the spectra panels read one
  frame store (`useTrajectoryFrame` in `lib/workbench/source.ts`). It keeps the
  segment index, global index, segment start and source path from the viewer's
  `trajectoryFrameChanged` report, so a panel opened later starts at the frame
  the player shows. Geometry, Edit and Properties edit one structure and do not
  follow trajectory frames.
- **Property editing.** Edit (MOL/SDF) and Geometry (XYZ) also open from the
  command palette (**Edit atoms and bonds**, **Edit geometry**). Properties
  opens from Info → Tools. The 3D context menu lists the same tools the
  document has, after its title: **Edit atoms and bonds**, **Edit geometry**
  (focused on the right-clicked atom's row) and **Properties…**. The viewer
  sends the picked atom's model index with the menu; the host adds the rows
  (`components/molstar-tool-menu.ts`).

Remaining:
- The mesoscale viewer, Mol* preset previews, Ketcher's Miew view and the
  three.js chemical-space view keep their own camera controls, without the
  projection toggle, axis views or keyboard steps.
