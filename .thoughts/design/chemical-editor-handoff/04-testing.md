---
date: 2026-06-08
feature: chemical-editor-handoff
service: apps/desktop
---

# Testing

## Contract Tests

Add coverage to `tests/test-ui-shell-contract.mjs` or a new focused
`tests/test-chemical-editor-handoff-contract.mjs`.

Assertions:

- `apps/desktop/src-tauri/src/lib.rs` registers
  `list_chemical_editor_targets` and `open_in_chemical_editor`.
- `apps/desktop/src-tauri/permissions/burrete.toml` allowlists both commands.
- `apps/desktop/src/components/app-layout.tsx` mounts the launcher inside
  `chrome-trailing-controls`.
- `apps/desktop/src/components/types.ts` exposes typed shell actions for
  editor target listing/opening.
- `apps/desktop/src/components/radix-menu.tsx` supports icon-bearing menu rows.
- Wildcard app declarations are ignored unless a known profile matches.

## Rust Tests

Add small native unit tests around pure helper functions:

- extension normalization, including `mae.gz`, `pdb.gz`, `sdf.gz`
- known profile matching
- explicit document extension matching
- wildcard suppression
- ranking order

These helpers should be pure functions so tests do not need to scan the real
machine.

## Manual Local Smoke

Use a dev-flavored packaged app when testing native behavior:

```bash
BURRETE_DEV_FLAVOR=80a3 ./scripts/build.sh
BURRETE_DEV_FLAVOR=80a3 ./scripts/install.sh
```

Smoke cases:

- Open `samples/mini.pdb`; menu should include ChimeraX/PyMOL/Maestro/Avogadro
  candidates if installed.
- Open an SDF sample; menu should include DataWarrior/Maestro/Avogadro/PyMOL.
- Open a CIF/XYZ/CUBE sample; menu should include VESTA/Avogadro where
  compatible.
- Select `Reveal in Finder`; existing behavior should still work.
- Select one external app on a small sample and verify macOS launches it with
  the file.

## Commands

Lightweight checks:

```bash
vp check
vp test
bun tests/test-ui-shell-contract.mjs
```

Rust checks:

```bash
cd apps/desktop/src-tauri
cargo test
cargo fmt --check
```

For this repo, avoid unflavored packaged builds. Use
`BURRETE_DEV_FLAVOR=80a3` for local packaged QA.
