---
name: trajectory-review
description: "Review molecular trajectories, frame metrics, representative structures, and trajectory result bundles in Burrete."
---

# Trajectory Review

Use this workflow for MD trajectories, Desmond-like bundles, representative
frames, RMSD/RMSF/contact plots, and trajectory cleanup outputs.

## Workflow

1. Run preflight.
2. Identify the trajectory bundle and required companion files.
3. Open the displayable structure or bundle through `open-workspace`.
4. Validate trajectory metrics and artifacts as a bounded snapshot.
5. Render a trajectory review widget or side panel with metrics and artifact
   provenance.
6. Use Browser or Computer visual QA when trajectory controls or frame display
   must be verified.

## Supported State Labels

- `supported`: the bundle opens and observe reports trajectory-ready state.
- `partial`: metrics or representative frames are reviewable, but interactive
  trajectory controls are missing or incomplete.
- `unsupported`: required topology/coordinate files are absent or unreadable.
- `external_workflow`: cleanup or production MD must run outside Burrete.
