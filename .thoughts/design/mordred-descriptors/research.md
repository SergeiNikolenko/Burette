# Research

## Upstream Descriptor Engine

`mordredcommunity` is a community-maintained continuation of Mordred. The
upstream package is installable as `mordredcommunity`, requires Python 3.9 or
newer, and exposes the same public API shape as Mordred:

```python
from mordred import Calculator, descriptors

calc = Calculator(descriptors, ignore_3D=True)
result = calc(mol)
```

The upstream documentation reports 1,613 2D descriptors, 213 3D descriptors,
and 1,826 descriptors total. The CLI also supports descriptor selection and a
3D mode. The PyPI release inspected for this design is `2.0.7`, released on
2026-01-22, with BSD-3-Clause licensing.

Sources:

- https://github.com/JacksonBurns/mordred-community
- https://pypi.org/project/mordredcommunity/

## Current Burrete Integration Points

The current Burrete codebase already has the right seams for collection-level
descriptor work:

- `grid_fetch_page` and related commands bridge the grid iframe to the Rust
  runtime.
- `GridRuntimeRegistry` owns per-document grid runtime state.
- `grid_store.rs` stores molecule rows in SQLite and already supports paged
  fetch, search, and limited sort.
- `grid-viewer.js` already has a host request pattern with page fetches and
  remote pagination.
- `grid-ui.tsx` owns the grid toolbar, renderer controls, and current card-only
  presentation.

The right dock also has a natural place for descriptors, but no descriptor tab
exists today:

- `DockTabKind` does not include `descriptors`.
- `RIGHT_DOCK_DEFAULT_TABS` and `RIGHT_DOCK_TAB_CATALOG` do not expose it.
- `DockPanelContent` currently renders `files`, `text`, `inspector`, and simple
  placeholders for other tabs.

Ketcher defines the small-molecule boundary:

- `.mol`, `.sd`, `.sdf`, `.smi`, and `.smiles` are already Ketcher-compatible
  import/edit formats.
- Runtime Ketcher edit config supports mol, single-record SDF/SD, and
  SMILES/SMI under existing size and record-count limits.

## Important Product Correction

Descriptors are not only a `grid2d` feature. The feature should cover active
small molecules wherever the existing app treats Ketcher as appropriate:

- single molecule file,
- selected collection row,
- Ketcher sketch,
- collection grid.

The grid remains the cleanest large-collection data surface, but the descriptor
tab must be source-agnostic and context-aware.
