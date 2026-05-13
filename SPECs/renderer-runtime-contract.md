# Renderer Runtime Contract

## Summary

Burette's molecular renderer runtime is the product engine inserted into the
Writer-like shell.

## Renderer Modes

- Auto
- Mol* interactive
- Fast XYZ SVG
- External xyzrender
- RDKit-style 2D grid for structure collections

## Requirements

- Rust/Tauri continues creating preview runtime directories and files.
- Molecular preview generation is isolated under
  `apps/desktop/src-tauri/src/preview/`.
- `preview/runtime.rs` remains the runtime orchestrator that writes preview
  artifacts and metadata.
- `preview/formats.rs` owns extension-to-renderer format resolution.
- `preview/xyz.rs` owns lightweight XYZ frame parsing for the fast renderer.
- `preview/xyzrender.rs` owns external xyzrender discovery and SVG artifact
  generation.
- React viewer pages load generated runtime HTML through a viewer iframe.
- Desktop molecular viewer iframes are inset below the Writer-like top chrome so
  Mol* runtime controls cannot overlap tabs or titlebar controls.
- In-app Mol* runtime controls use compact translucent toolbar styling aligned
  with the Writer-like shell. The toolbar opens collapsed by default, shows
  icon-only panel/theme controls, and expands on hover or keyboard focus.
- Renderer preference changes trigger active preview refresh as they do today.
- Sidebar, tabs, and command palette may display renderer metadata but do not
  duplicate renderer logic.
- Grid preview behavior remains separate from 3D structure behavior.

## Acceptance Criteria

- PDB/CIF files still use the Mol* path.
- Mol* iframes do not visually sit underneath the top tab chrome in the desktop
  shell.
- XYZ files still support the fast path and renderer switching.
- SDF/SMILES/table collection files still use grid preview when supported.
- Runtime cache cleanup still works from Settings and command palette.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passes after
  preview module changes.
