---
date: 2026-06-08
feature: chemical-editor-handoff
service: apps/desktop
---

# Research: Chemical Editor Handoff

## Summary

The requested UI block matches the "Open in..." launcher pattern shown in the
Codex screenshot: a compact app-icon button in the top-right chrome, a chevron
trigger, and a dropdown of detected applications that can open the current
workspace item. The screenshot itself was inspected visually; no Codex source
for that control was available in this workspace, so implementation details are
inferred from its behavior and appearance rather than copied from Codex code.

Burrete already has the right local seams for this feature. The desktop shell
uses a Tauri/React split, has top-right chrome controls, already exposes
`Reveal in Finder`, and already has a Radix dropdown abstraction. The native
layer uses `tauri-plugin-opener` for file/folder opening and can open a path
with a specified application via `open_path(path, Some(app))`.

The feature should not embed chemical editor logic into Burrete. It should
detect installed local applications, filter them by the active file extension,
display them as launch targets, and pass the current file to the selected app.
Burrete remains the preview/workspace shell; Avogadro, Maestro, PyMOL, VESTA,
ChimeraX, DataWarrior, and similar tools stay external editors/viewers.

## Project Structure Discovered

- **Desktop UI:** `apps/desktop/src/components/app-layout.tsx:96` owns the
  top-right chrome controls where the compact launcher should mount.
- **Existing dropdown:** `apps/desktop/src/components/radix-menu.tsx:16` exposes
  `RadixDropdownMenu`, currently text-only.
- **Action surface:** `apps/desktop/src/components/types.ts:58` defines
  `ShellActions`; active file operations already live there.
- **Existing native file action:** `apps/desktop/src/App.tsx:950` implements
  `revealPath` and calls the native `reveal_path` command.
- **Native command module:** `apps/desktop/src-tauri/src/commands/shell.rs:59`
  implements `reveal_path`; this is the closest existing pattern.
- **Tauri permissions:** `apps/desktop/src-tauri/permissions/burrete.toml:4`
  allowlists exposed commands.
- **Format registry:** `config/preview-formats.json` is the current source of
  Burrete molecular extensions and should be reused when filtering active files.

## Installed Chemical Applications Observed

The local application inventory was checked from `/Applications` and
`~/Applications` without launching apps.

| App | Path | Bundle ID | Notes |
| --- | --- | --- | --- |
| Avogadro | `/Applications/Avogadro2.app` | `cc.avogadro` | Declares many chemistry formats and also a wildcard. Treat wildcard carefully. |
| ChimeraX | `/Applications/ChimeraX-1.10.app` | `edu.ucsf.cgl.ChimeraX` | Broad molecular and volume-data support. |
| DataWarrior | `/Applications/DataWarrior.app` | `org.openmolecules.datawarrior` | Best fit for SDF/CSV/table workflows. |
| PyMOL | `/Applications/PyMOL.app` | `com.schrodinger.pymol` | Strong PDB/CIF/MOL2/SDF/session viewer. |
| PyMOL-RS | `/Applications/PyMOL-RS.app` | `me.yakovlev.pymol-rs` | Installed, but document type metadata was minimal in the inspected output. |
| PyMolAI | `/Applications/PyMolAI.app` | `com.pymolai.app` | Declares PDB/CIF/mmCIF/MOL2/SDF/PSE/PML. |
| VESTA | `/Applications/VESTA.app` | not printed by inspected command | Strong crystal/CIF/XYZ/CUBE/VASP support; declares wildcard-like support. |
| Maestro | `/Applications/SchrodingerSuites2026-1/Maestro.app` | `com.schrodinger.Maestro` | Declares MAE/MAEGZ/PRJ/SDF/MOL/MOL2/ENT/PDB. |
| BioLuminate | `/Applications/SchrodingerSuites2026-1/Bioluminate.app` | `com.schrodinger.BioLuminate` | Same Schrodinger document families as Maestro. |
| Materials Science | `/Applications/SchrodingerSuites2026-1/Materials Science.app` | `com.schrodinger.Materials Science` | Same Schrodinger document families as Maestro. |
| Mol* web app | `/Users/nikolenko/Applications/Mol*.app` | `com.apple.Safari.WebApp...` | Safari web app; useful as a known app, but not a robust native file handler. |

## Important Finding

Do not rely only on `CFBundleDocumentTypes`. Avogadro declares `*`; VESTA
declares `****`. If Burrete trusts those wildcard entries blindly, the dropdown
will advertise apps for unrelated formats. Use a Burrete-owned compatibility
profile for known chemistry apps, then supplement it with document types for
unknown apps only when the extension is explicit.

## Existing Patterns To Reuse

- Use `ShellActions` for UI actions instead of wiring direct IPC calls deep in
  presentation components.
- Use `pushStatus` and `pushErrorStatus` in `App.tsx` for user-visible feedback.
- Use existing chrome controls and `chrome-button` styling for the trigger.
- Extend `RadixDropdownMenu` rather than introducing another menu library.
- Put native file/application discovery in `commands::shell` or a sibling
  command module and expose it through the existing permission file.

## Open Questions

- Whether icons should be app bundle icons converted to a Tauri asset URL, or a
  deterministic built-in fallback per known app. The screenshot needs real app
  icons; for first implementation, app-icon extraction can be a second pass.
- Whether to show all compatible apps or only the best five plus "More...".
  The screenshot shows a compact list; Burrete should keep the list short and
  deterministic.
