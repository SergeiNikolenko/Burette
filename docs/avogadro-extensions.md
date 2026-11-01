# Avogadro extension and resource contracts

This is stage 11 of the [full adoption contract](avogadro-adoption.md).
The [acceptance ledger](avogadro-parity-checklist.md) distinguishes adopted
resources from future scientific adapters and other-runtime verification.
Settings Extensions, Jobs and the Crystals browser resource workflow are adopted;
this does not establish arbitrary Python/C++ plugin compatibility.

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

## Focused checks and remaining acceptance

Run from the repository root:

```sh
vp run test:crystals
vp run test:extension-resources
vp run test:extension-runner
vp run test:extension-ui
vp run test:crystals-browser
```

Keep deterministic offline regeneration, corrupt/truncated/unsafe bundles,
quota failure, concurrent/stale install, before/during-publication cancel,
retry and old-version preservation covered. Real installation, Jobs continuation,
keyboard/focus, light/dark and narrow layouts, search/25-row pagination,
duplicate-name opening, exact source/export/reload and representative
chemical classes require target-surface evidence. Native storage/opening and
hosted deployment are separate from browser source or local packaging checks.
The other four candidates remain operation-specific work, not accepted plugin
execution. Shared camera requirements remain **11.12** in the adoption contract.
