---
name: visual-qa
description: "Verify Burrete Browser preview and desktop app visual state with Browser and Computer without replacing typed observe/action contracts."
---

# Visual QA

Use Browser and Computer as verification surfaces.

## Browser

Use Browser for:

- tokenized localhost browser-preview URLs;
- screenshot and canvas nonblank checks;
- DOM or Playwright checks for preview panels;
- visual QA when the user asks to watch inside Codex.

Do not reload an already useful browser tab unless a code or asset change
requires it.

## Computer

Use Computer for:

- real macOS Burrete app windows;
- accessibility tree checks for Tauri shell and Mol* controls;
- clicking native/Tauri controls when the CLI contract is insufficient;
- confirming that the user-visible desktop app is open and usable.

Computer can see some Mol* toolbar elements, but it cannot reliably provide
chains, ligands, waters, atoms, residues, or selections as typed molecular
state. Always prefer `observe` for molecular truth.

## Completion

Visual QA should cite what was checked:

- target app or URL;
- active document;
- visible controls or panels;
- screenshot/canvas/accessibility evidence;
- any gap between typed observe state and visible UI.
