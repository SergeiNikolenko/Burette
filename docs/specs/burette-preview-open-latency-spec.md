# Burrete Preview Open Latency Spec

## Summary

Make first-time preview opens feel immediate for small and medium molecular
files. Burrete currently generates a per-file web runtime, writes preview data,
and loads a WebView/iframe. That path should avoid visible `Loading...` states
for fast files and should not regenerate or reload more than necessary when
the user switches between already-open structures.

## Goals

- Open typical PDB/CIF/SDF/XYZ fixtures without a visible loading flash.
- Keep tab switching between already-open structures instant.
- Reuse runtime assets and avoid redundant per-render work.
- Keep slow-file feedback explicit instead of leaving the viewer blank.
- Measure fixture latency using permanent files under
  `tests/fixtures/BurettePreviewSamples`.

## Non-Goals

- Streaming partial molecular renders.
- Rewriting Mol*, RDKit, or xyzrender internals.
- Prefetching arbitrary filesystem paths before user intent.
- Changing Quick Look runtime contracts.

## Approach

### Runtime cache reuse

- Keep shared web assets in one cache directory.
- Create per-preview runtime directories only for data/config files that are
  specific to the opened structure.
- Prune stale runtime directories without touching shared assets.

### Grace window for fast opens

For app-shell opens:

1. Start `open_documents` and runtime generation.
2. If the result resolves within a short grace window, activate the document
   with no intermediate loading UI.
3. If it exceeds the grace window, show a quiet status message.
4. On error, keep the previous active structure selected and show the failure
   in the status surface.

For Quick Look:

- Keep the existing Quick Look timeout behavior, but log generation phases so
  slow files can be diagnosed.

### Active renderer refresh

Changing renderer/theme preferences should refresh only affected open viewer
runtimes, not close and recreate all tabs.

## Fixture Matrix

Always include these fixture groups in latency checks:

- `mini.pdb`, `1HTB.pdb`
- `mini.cif`, `mini_core.cif`
- `mini.sdf`, `sdf/single.sdf`, `sdf/multi.sdf`
- `xyz/single.xyz`, `xyz/trajectory.xyz`
- unsupported or future formats under `smiles/` and `tables/` should produce
  deterministic errors until support is intentionally added.

## Expected Files

- `src/App.tsx`
- `src/store.ts`
- `src-tauri/src/lib.rs`
- `scripts/test-web-preview.sh`
- `tests/fixtures/BurettePreviewSamples/`
- future latency tests under `tests/`

## Acceptance Criteria

- Small fixtures open with no visible app-shell loading flash on a normal local
  SSD.
- Switching between already-open tabs does not regenerate runtime directories.
- Slow or unsupported files show a deterministic status/error message.
- Quick Look still renders supported fixtures.
- Latency checks cover the permanent fixture directory.

