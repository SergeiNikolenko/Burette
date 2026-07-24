# Documentation Map

This directory is the current documentation graph for Burette. It intentionally
contains only documents that describe the active project.

## Current Docs

- [Changelog](../CHANGELOG.md): pointer to GitHub Releases, which are the
  human-readable changelog for each version.
- [Architecture](architecture.md): repository boundaries and runtime shape.
- [Repository layout](repository-layout.md): top-level code map, app surfaces,
  checked-in samples, and scratch-file policy.
- [Product direction](product.md): current product surfaces, users, core jobs,
  principles, non-goals, and product voice.
- [Design direction](design-system.md): current shell reality, source-of-truth
  theme files, surface rules, and component guidance.
- [shadcn UI migration](shadcn-ui-migration.md): inspected React control
  inventory, protected runtime contracts, staged component migration, and
  validation criteria.
- [Configuration](configuration.md): source-of-truth config files, development
  overrides, runtime environment, release secrets, and smoke/perf variables.
- [Security and permissions](security-and-permissions.md): local file access,
  Tauri permissions, browser/agent surfaces, local servers, release secrets,
  diagnostics, and security reporting.
- [Renderer support](renderer-support.md): renderer modes, supported formats,
  Ketcher editing scope, artifacts, and checks.
- [Performance architecture](performance.md): runtime profiles, caches, binary
  payloads, grid search, and no-regression guardrails.
- [Native GPU Compute Layer](superpowers/specs/2026-07-15-gpu-compute-platform-design.md):
  authoritative target architecture for selectively adapting the useful
  `mlxmolkit` algorithms into native Apple Silicon workflows without a
  production Python/MLX dependency. It covers attribution, provenance,
  clustering, conformers, MMFF, alignment/scoring, semiempirical chemistry,
  scheduling, and product integration. Its companion
  [validation and delivery contract](superpowers/specs/2026-07-15-gpu-compute-validation-and-delivery.md)
  defines scientific gates, failure testing, and staged completion criteria.
  The active
  [foundation and `cluster.v1` implementation plan](superpowers/plans/2026-07-15-gpu-compute-foundation-cluster-v1.md)
  gives the file-by-file delivery sequence for the first packaged Metal slice.
  The [mlxmolkit provenance ledger](third-party/mlxmolkit-provenance.md) is the
  mandatory source/license mapping gate for every adapted file. The
  [implementation status](gpu-compute-status.md) records what is working in
  source today and keeps packaged Metal, browser, Quick Look, and iPhone claims
  separate.
- [MolComputeKit relationship](molcomputekit.md): standalone framework release,
  ownership boundary, compatibility identifiers, and the pinned migration rule
  for removing Burette's integration copy.
- [Stability program](stability.md): preview trace, runtime manifest, nightly
  smoke, and staged stability guardrails.
- [Installing and building](installing-building.md): source build, local
  install, development entrypoints, and Quick Look refresh commands.
- [Vite+ workflow](vite-plus.md): `vp` entrypoints for frontend development and
  JavaScript validation.
- [Modular runtime refactor](modular-runtime-refactor.md): staged extraction
  plan for `vite.config.ts`, `App.tsx`, and browser-dev runtime modules.
- [Development loops](development-loops.md): fast edit, debug, patch, and remote
  check paths that avoid full local rebuilds.
- [Control affordances](control-affordances.md): tooltip and menu-detail rules
  for compact controls across React, Mol*, `xyzrender`, Grid, and Ketcher.
- [Pose playback standardization](pose-playback-standardization.md): current
  single/all playback problem, controller contract, and browser test matrix for
  docking poses, SDF collections, XYZ frames, PDB models, and structure scenes.
- [Quick Look debugging](quicklook-debugging.md): Finder preview diagnosis and
  cache reset workflow.
- [iOS mobile app](../ios/BuretteMobile/README.md): source-built iPhone preview
  app target, runtime reuse, signing, and real-device install flow.
  Agent-facing local rules live in
  [ios/BuretteMobile/AGENTS.md](../ios/BuretteMobile/AGENTS.md).
- Apple-platform agent routes are dispatched from [AGENTS.md](../AGENTS.md):
  use `@build-ios-apps`, `@build-macos-apps`, `@product-design`, and
  `$apple-design` where those platform/design rules apply.
- [Launch modes](launch-modes.md): normal, file-open, tray, and registration
  launch semantics.
- [Releasing](releasing.md): version, build, signing, update, and artifact
  requirements.
- [Keyboard shortcuts](keyboard-shortcuts.md): app shortcuts and command palette
  actions.
- [Agent platform](agent-platform.md): hosted public plugin, public MCP, local CLI,
  Browser shell, desktop session, plugin, observe/action, and visual QA
  boundaries.
- [Repo-local Codex maintenance skills](../.codex/README.md): development-time
  review, PR body, release readiness, contract, and testing skills. These are
  not packaged product workflow skills.
- [Agent tool index](tools/index.md): focused validation and runtime helper
  commands for agents.
- [Testing surfaces](tools/testing-surfaces.md): strict dev-server, browser
  Quick Look, native Quick Look, tokenized preview, and contract-test flows.

## Maintenance Rules

- Keep user-facing installation and usage in [README.md](../README.md).
- Keep current engineering docs in `docs/`.
- Keep product and design direction in `docs/product.md` and
  `docs/design-system.md`, not as top-level scratch notes.
- Keep repository maintenance skills in `.codex/skills`; keep packaged
  molecular workflow skills in `plugins/burette-agent/skills`.
- Keep directory-local README files for ordinary code architecture guidance and
  directory-local AGENTS files only for high-risk agent/runtime boundaries.
- Do not keep imported reference snapshots or migration handoff logs in the
  active docs graph.
- Verify doc claims against code, scripts, or runtime output before changing
  docs.
