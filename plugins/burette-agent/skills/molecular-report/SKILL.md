---
name: molecular-report
description: "Render molecular notes, property tables, charts, workflow reports, and provenance alongside the active Burrete workspace."
---

# Molecular Report

Use this workflow when the user asks for molecule descriptions, adjacent notes,
charts, property summaries, or workflow reports.

## Workflow

1. Build a bounded manifest and snapshot.
2. Validate before rendering.
3. Render with `render_molecular_report_widget` or open through
   `burrete-agent render-panel`.
4. If the report references a molecule, ligand, frame, or row, link it back to
   the active workspace when possible.

## Manifest Rules

- `manifest.title` is required.
- `manifest.blocks` is required.
- A molecular report starts with a markdown `# <title>` block.
- Source paths and metric definitions must be visible in sources or notes.
- Large raw logs belong in files, not inline widget payloads.

## Panel Rule

Use Burrete side panels for work the user should see beside the molecular
viewer. Use MCP report widgets for in-Codex review or shareable analytical
handoff.
