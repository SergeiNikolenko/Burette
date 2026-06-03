# Web Bundle Duplication Audit

## Scope

This report covers the current duplicated `PreviewExtension/Web` bundle paths in
Burrete. It is an audit and split plan only. It does not change bundle contents,
renderer behavior, Xcode target membership, or installer behavior.

## Evidence

Current build inputs include one source web tree:

- `PreviewExtension/Web`

The largest source assets in that tree are:

| Asset | Size |
| --- | ---: |
| `PreviewExtension/Web/rdkit/RDKit_minimal.wasm` | 6,914,823 bytes |
| `PreviewExtension/Web/molstar.js` | 4,825,091 bytes |
| `PreviewExtension/Web/viewer.js` | 221,029 bytes |
| `PreviewExtension/Web/rdkit/RDKit_minimal.js` | 128,073 bytes |
| `PreviewExtension/Web/grid-viewer.js` | 90,219 bytes |
| `PreviewExtension/Web/molstar.css` | 72,737 bytes |

The Tauri bundle configuration includes the same source tree as an app
resource:

```json
"resources": {
  "../../../PreviewExtension/Web": "Web"
}
```

That produces the expected app-side path:

```text
Burrete.app/Contents/Resources/Web
```

The Xcode Quick Look target also includes `Web` in its Resources build phase.
That produces the expected embedded extension-side path:

```text
Burrete.app/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web
```

The build script embeds the Quick Look extension into the Tauri app:

```text
Burrete.app/Contents/PlugIns/BurretePreview.appex
```

The local installer explicitly rewrites both copies from the same source tree:

```text
Burrete.app/Contents/Resources/Web
Burrete.app/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web
```

## Current Runtime Size Evidence

`build/Burrete.app` is not present in this worktree at the time of this audit,
so exact final bundle duplicate byte counts are pending a local app build.

The updated `scripts/size-report.sh` now prints explicit sections for:

- `Contents/Resources/Web`
- `Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web`
- matching heavy files such as `molstar.js` and `rdkit/RDKit_minimal.wasm`
- whether paired files have the same SHA256 hash

Run after building:

```bash
./scripts/build.sh
./scripts/size-report.sh
```

The report is written to:

```text
build/reports/size-report.txt
```

## Duplication Assessment

The configuration strongly indicates that at least the heavy web assets are
duplicated in the final installed app:

- `molstar.js`
- `molstar.css`
- `viewer-runtime.css`
- `viewer-shell.js`
- `burette-agent.js`
- `viewer.js`
- `grid-viewer.js`
- `grid.css`
- `rdkit/RDKit_minimal.js`
- `rdkit/RDKit_minimal.wasm`

This is likely intentional for the current architecture:

- the desktop app uses app resources through Tauri asset URLs;
- the Quick Look extension runs in its own appex bundle and reads its own
  resources;
- Quick Look must remain a separate fast path.

## Safe Split Plan

### Keep For Now

Keep both physical bundle copies until a tested split exists. The current
functional boundary is clear and low risk:

- desktop runtime reads from `Contents/Resources/Web`;
- Quick Look reads from its embedded appex resources;
- installer validation checks both copies against `PreviewExtension/Web`.

### Candidate Manifest Split

A low-risk next step is to keep one source tree but introduce separate target
manifests:

- desktop manifest for assets needed by the desktop runtime;
- Quick Look manifest for assets needed by the extension;
- shared manifest entries for files required by both.

This avoids moving source files first and makes bundle membership explicit
before changing Xcode or Tauri resource layout.

### Candidate Source Split

If the manifest split proves stable, split source ownership later:

```text
PreviewExtension/Web/shared
PreviewExtension/Web/quicklook
apps/desktop/public/Web
```

or keep one physical source directory with generated target manifests if that is
less disruptive.

### Possible Desktop Removals

Potential desktop removals from app resources, subject to runtime tests:

- grid-only assets from non-grid desktop profiles;
- Quick Look-only shell/template assets if any become extension-only;
- `rdkit/` from desktop resources only if the desktop grid path is changed to an
  alternate asset source.

Do not remove `rdkit/` from desktop resources while desktop grid still loads:

```text
../assets/rdkit/RDKit_minimal.wasm
../assets/rdkit/RDKit_minimal.js
```

### Possible Quick Look Removals

Potential Quick Look removals, subject to Quick Look smoke tests:

- desktop-only app shell assets;
- any file not referenced by `PreviewViewController.swift` generated HTML or
  copied runtime assets.

Do not remove Molstar, grid, or RDKit assets from the appex until Quick Look PDB,
SDF grid, SMILES grid, and XYZ/external-renderer smoke checks pass.

## Required Verification Before Functional Changes

Before deleting or splitting any resource, run:

```bash
./scripts/build.sh
./scripts/size-report.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.sdf
```

Also verify desktop open paths for:

- small PDB;
- single-record SDF;
- multi-record SDF grid;
- SMILES grid.

## Non-Goals

This audit does not:

- remove assets from either bundle;
- change Xcode target membership;
- change Tauri resource configuration;
- change renderer policy;
- merge the desktop app and Quick Look runtime paths.
