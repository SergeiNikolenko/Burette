---
name: molecule-collection
description: "Review SDF and molecule-property collections with bounded tables, filters, selected-molecule handoff, and Burrete display panels."
---

# Molecule Collection

Use this workflow for SDF sets, property tables, score tables, filtered
collections, and selected molecule review.

## Workflow

1. Prepare or receive a local SDF/CSV/JSON artifact outside Burrete when
   computation is required.
2. Validate the collection as a bounded molecular artifact before rendering.
3. Render a `molecule-table` widget or Burrete side panel.
4. If the user selects a row, hand the selected molecule or derived structure
   back to `open-workspace` or `molstar-scene`.

## Data Contract

Rows should stay compact and reviewable. Keep useful fields for exploration:

- molecule id or title;
- SMILES or source record id when safe;
- score or property columns;
- filter flags;
- source path or run id.

Do not claim filtering or property calculation happened inside Burrete unless a
Burrete runtime actually performed it. Prefer external RDKit or workflow tools
for chemistry computation, then display the reviewed results in Burrete.
