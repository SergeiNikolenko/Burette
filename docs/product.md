# Product Direction

This document describes Burrete's product intent. It is not a release checklist,
marketing page, or complete feature specification. Keep it aligned with
`README.md`, the active desktop app, the Quick Look extension, the source-built
iPhone app, and the agent/plugin surface.

## Current Product

Burrete is a molecular file workspace with four connected surfaces:

- Finder Quick Look previews for molecular files.
- A compact macOS desktop workspace for opening, comparing, editing, and
  triaging molecular/project files.
- A source-built iPhone preview app that reuses the preview runtime for mobile
  document handoff.
- Agent/plugin tooling for typed observe/action workflows, reports, and bounded
  molecular workspace automation.

The product is a local molecular workspace for inspection, workflow handoff,
and a curated set of reproducible native compute operations. It is not a cloud
ELN, collaborative notebook, arbitrary script environment, or unrestricted
molecular-modeling suite.

## Native Compute Layer Status

The Apple Silicon Compute Layer is under active implementation. The first
desktop source workflow now runs from immutable Grid scope through a pinned
RDKit worker, checked CPU/Metal Tanimoto neighbor construction, deterministic
Butina, immutable artifacts, and typed Grid results. Real Metal command-buffer
dispatch exists, and a unique development package now compiles, bundles,
verifies, loads, and dispatches its hash-bound precompiled Metal runtime on an
Apple M2 Pro. Production Metal remains gated on Developer ID/hardened-runtime
signing, notarization, scientific-corpus parity, scale benchmarks, and visual
installed-app evidence.

| Workflow family | Product status |
| --- | --- |
| Similarity and clustering | `Cluster all`/`Cluster selected` source workflow and ad-hoc packaged Metal dispatch proven; production release/scale gates pending |
| Similarity search and diverse selection | `Find similar` reuses a verified cluster EnginePack for exact CPU/Metal top-50 ranking and Grid writeback; immutable diverse export includes structures, table, and provenance |
| Conformer generation | Native Grid selection now runs RDKit parameter extraction, adaptive `N x K` Metal DG/ETK/stereo execution, CPU reference validation, durable EnginePack/ResultPack publication, typed Grid writeback, and path-based Mol* ensemble opening; broader RDKit/upstream corpus and production-package gates remain |
| MMFF94/MMFF94s optimization | Seven-term CPU/Metal evaluation, BMFX RDKit parameter ABI, fused Metal BFGS/L-BFGS selection, selectable MMFF94/MMFF94s conformer ranking, exact Grid/XYZ provenance, and all eight DG/ETDG/ETKDG Grid choices are implemented; standalone geometry optimization and broad parity corpus remain in progress |
| Alignment, RMSD, shape/electrostatic scoring | Grid `Align & compare` performs bounded Metal Horn alignment, CPU parity validation, typed Grid score writeback, and aligned Mol* ensemble opening for same-order pose sets; non-identity mappings, chemistry-derived partial charges, durable reports, and production-package evidence remain |
| Semiempirical energies and charges | Planned method by method after independent parity gates |

Production compute is native Metal plus native CPU/reference chemistry. Python
and MLX are permitted only in development as pinned reference oracles and are
not ordinary application dependencies.

## Primary Users

Burrete is for people who inspect molecular and adjacent computational chemistry
files as part of technical work:

- computational chemists
- structural biologists
- cheminformaticians
- molecular modeling practitioners
- researchers and engineers reviewing generated structure/workflow artifacts

They often enter through Finder, a project folder, a generated workflow output,
or an agent session. They need fast visual feedback, predictable file handling,
and a way to recover when renderer or Quick Look infrastructure needs attention.

## Core Jobs

- Preview a molecular file from Finder without opening a heavyweight tool.
- Open multiple structures or related files in a desktop workspace and compare
  them without losing renderer state.
- Switch between Mol*, RDKit grids, text/spectrum fallbacks, and external
  `xyzrender` when the file or workflow requires it.
- Inspect SDF/SMILES/CSV/TSV collections with search, sorting, filtering,
  selection, append/merge, export, and Ketcher handoff.
- Sketch or edit small molecules in Ketcher and send them to preview or
  collection workflows.
- Review focused workflow artifacts such as docking/pose surfaces and FEP
  network GraphML previews.
- Diagnose and repair local preview infrastructure: Quick Look reset, cache
  cleanup, logs, diagnostics, update checks, and install health.
- Use typed agent workflows where screenshots are not enough: open, observe,
  act, render bounded panels, and validate molecular artifacts.
- Run curated similarity, conformer, optimization, alignment, and energy
  workflows from Grid or the 3D inspector once each workflow reaches its
  packaged-app completion gate.
- Build and use the iPhone app from source for mobile file handoff and
  inspection.

## Product Principles

- **Molecule first.** The structure, collection, trajectory, spectrum, or
  workflow artifact is the visual center. Shell UI exists to support inspection.
- **Native enough to trust.** Burrete should feel like a serious macOS utility:
  predictable menus, keyboard access, stable window behavior, familiar controls,
  and clear recovery actions.
- **Surface truth matters.** Finder Quick Look, desktop app, browser-dev,
  tokenized browser preview, iPhone app, and agent sessions are separate
  runtimes. Product claims must say which surface is supported.
- **File workflows beat dashboards.** Burrete is organized around files,
  project folders, tabs, previews, and handoff, not hero metrics or abstract
  workspace cards.
- **Local first.** The app should work from local files and local tools. External
  integrations such as `xyzrender`, VESTA, chemistry editors, and agent tooling
  remain optional and explicit.
- **Maintenance is product UX.** Quick Look registration, renderer discovery,
  logs, cache reset, and install checks are first-class because broken local
  preview infrastructure is a common user problem.

## Non-Goals

- Replace full molecular modeling environments.
- Provide macromolecule editing inside Ketcher.
- Hide local tool requirements behind silent cloud execution.
- Turn the desktop shell into a marketing-style dashboard.
- Treat the source-built iPhone app as part of the Homebrew macOS release.
- Let agent screenshots replace typed observe/action state or validation output.

## Voice

Burrete should sound practical, direct, and precise. User-facing copy should say
what the app can do, what surface it applies to, and what the user can do next.
Avoid aspirational claims that are not backed by README, docs, tests, or the
current runtime.
