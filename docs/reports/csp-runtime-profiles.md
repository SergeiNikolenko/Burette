# CSP Runtime Profiles

Stage 17 narrows CSP by runtime profile instead of relying only on the broad app
shell CSP.

## Profiles

| Profile | Runtime | Required allowances |
| --- | --- | --- |
| App shell | `apps/desktop/src-tauri/tauri.conf.json` | `ipc:` for Tauri commands, `https://api.github.com` for updates, `unsafe-eval` and `wasm-unsafe-eval` for bundled renderer dependencies. |
| Molstar viewer | Desktop and Quick Look structure viewer | Local `file:`/`asset:` scripts and styles, inline bootstrap scripts, `unsafe-eval` for Molstar. No `wasm-unsafe-eval`. |
| Grid/RDKit | Desktop and Quick Look molecule grids | Local RDKit JS plus RDKit WASM URL loading, inline bootstrap scripts, `unsafe-eval`, and `wasm-unsafe-eval`. |
| External artifact SVG | Desktop and Quick Look `xyzrender-external` | Local shell scripts, styles, data/blob images for SVG display. No `unsafe-eval`, no `wasm-unsafe-eval`, and no workers. |
| Minimal shell | Desktop and Quick Look fallback/simple renderers | Local shell scripts and styles only. No `unsafe-eval`, no `wasm-unsafe-eval`, and no workers. |

## Implementation Notes

- Desktop viewer HTML emits a profile-specific CSP meta tag from `viewer_csp`.
- Desktop grid HTML uses `GRID_RUNTIME_CSP`; its `connect-src` is narrowed to
  local `file:` and `asset:` loads while keeping RDKit's WASM requirements.
- Quick Look viewer and grid HTML use matching profile constants in
  `PreviewViewController`.
- The checked-in app-shell CSP remains broad because it covers the full Tauri
  app surface, update checks, IPC, and renderer dependencies.

## Verification

Run:

```bash
bun tests/test-tauri-structure.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview::runtime_viewer::tests::external_artifact_csp_does_not_grant_eval_or_wasm
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview::runtime_viewer::tests::molstar_csp_keeps_eval_without_wasm_eval
```

Manual smoke for runtime CSP console errors should use the existing preview
flows for:

- Molstar PDB/CIF preview.
- Grid SDF/SMILES preview.
- External `xyzrender` artifact preview.
