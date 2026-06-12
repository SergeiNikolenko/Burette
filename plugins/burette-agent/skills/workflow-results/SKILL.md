---
name: workflow-results
description: "Accept and display externally produced protein prep, ligand prep, docking, MD, cleanup, and bulk property artifacts."
---

# Workflow Results

Burrete is a workspace interface, not a general job manager. Heavy
workflows should run through domain tools or servers, then hand local artifacts
back to Burrete.

## External Workflows

Treat these as external unless a dedicated Burrete runtime is added:

- protein preparation;
- ligand preparation;
- docking;
- molecular dynamics setup and production;
- trajectory cleanup;
- bulk SDF property calculation.

## Intake Contract

Each result bundle should provide:

- display artifacts: PDB/CIF/SDF/trajectory files;
- metric artifacts: CSV/JSON tables;
- report artifacts: markdown or HTML converted to bounded report blocks;
- provenance: source path, server/job id, command summary, warnings, errors.

Validate the bounded manifest/snapshot before rendering widgets. Use
`open-workspace` to display structures and `molecular-report` for notes, plots,
and result summaries.

## Safety

Server submission, overwrites, and irreversible cleanup require explicit
confirmation outside this app interface. Do not hide those side effects behind a
viewer action.
