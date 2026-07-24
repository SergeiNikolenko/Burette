---
name: molecular-report
description: "Use when molecular notes, property tables, charts, workflow reports, or provenance should be rendered beside an active Burette workspace."
---

# Molecular Report

Use this workflow when the user asks for molecule descriptions, adjacent notes,
charts, property summaries, or workflow reports.

## Workflow

1. Build a bounded manifest and snapshot.
2. Validate before rendering.
3. Open visible report content through `burette-agent render-panel` when the
   user needs it beside the workspace.
4. If the report references a molecule, ligand, frame, or row, link it back to
   the active workspace when possible.

## Manifest Rules

- `manifest.title` is required.
- `manifest.blocks` is required.
- A molecular report starts with a markdown `# <title>` block.
- Source paths and metric definitions must be visible in sources or notes.
- Large raw logs belong in files, not inline payloads.

## Panel Rule

Use Burette side panels for work the user should see beside the molecular
viewer. MCP inline report widgets are intentionally not exposed by this plugin.
