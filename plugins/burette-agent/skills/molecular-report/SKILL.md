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

## ADMET Separability Calibration (`spread / MAE`)

Whenever a report compares a group of two or more compounds on predicted ADMET
regression endpoints, compute and display `xMAE = spread / model_error` using
the ADMETForge champion calibration JSON (`champion_calibration.json`, schema
`1.0.0`; see [references/admet-separability.md](references/admet-separability.md)):

- Always compute `spread = max(y_pred) - min(y_pred)` in the **exact same
  target scale and units** recorded in the calibration entry (`scale` /
  `target_transform`, e.g., `log10(1 + max(x, 0))` for OpenADMET KSol/HLM/MPPB,
  `pKa` for IUPAC pKa, `%` for TDC PPBR). Never divide linear-unit spread by a
  log-scale MAE.
- Assign and report one of three separability statuses for every calibrated
  ADMET endpoint:
  - `separable` (`xMAE >= 2.0`): differences clearly exceed model error; safe
    to rank compounds.
  - `borderline` (`1.0 <= xMAE < 2.0`): marginal signal; interpret rankings
    with caution.
  - `noise` (`xMAE < 1.0`): spread falls within model error; **do not rank**
    compounds on this endpoint and flag it explicitly in both summary tables
    and prose (for example, hERG at `0.4× MAE`).
- Every ADMET summary table (both markdown tables and `snapshot.datasets`
  table blocks) must include columns for `scale`, `model_error` (`MAE` or
  `RMSE`), `spread`, `xMAE`, and `separability` (`separable` / `borderline` /
  `noise`), and cite the champion model and calibration source in notes.

## Panel Rule

Use Burette side panels for work the user should see beside the molecular
viewer. MCP inline report widgets are intentionally not exposed by this plugin.
