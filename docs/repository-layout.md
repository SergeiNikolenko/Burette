# Repository Layout

Burette is organized around a small number of application surfaces and the
shared preview runtime they use.

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Main React and Tauri desktop workspace. The React shell, hooks, preview bridges, command palette, Ketcher surface, grids, and Tauri commands live here. |
| `apps/burette-public-plugin` | Hosted public plugin submission, public HTTPS MCP endpoint, bounded attachment/PDB preparation, and CSP-compatible Burette workspace. |
| `PreviewExtension` | macOS Finder Quick Look preview and thumbnail extension. `PreviewExtension/Web` contains the bundled Mol*, RDKit grid, and viewer runtime assets shared with desktop and Quick Look. |
| `ios/BuretteMobile` | Source-built iPhone preview app target. It reuses the bundled preview runtime for iOS document handoff and phone-first molecular inspection. |
| `packages/burette` | Private Bun helper used by installer, doctor, and release-channel checks. It is not a public registry package. |
| `packages/ketcher-agent-contract` | Shared `@burette/ketcher-agent-contract` types consumed by the desktop app and the hosted public plugin. |
| `plugins/burette-agent` | Codex/Burette plugin, MCP server, skills, and bounded agent workflow contracts. It wraps the repository CLI instead of reimplementing app control. |
| `crates/burette-core` | Shared Rust crate for native molecular and preview-support logic used by the Tauri app. |
| `crates/burette-compute-core` | CPU reference implementations and fixed ABIs for the native compute layer (fingerprints, clustering, conformers, UMAP). |
| `crates/burette-compute-metal` | Apple Metal compute runtime: kernel packaging, tiling, dispatch, and GPU timings. |
| `crates/burette-compute-protocol` | Fixed request/job/artifact contracts and the attested helper control plane for compute. |
| `compute` | Reviewed Metal kernel sources with their `.v1.json` contracts, model runners, and packaged compute runtimes. `schemas/compute` holds the compute JSON schemas and fixtures. |
| `templates/mvs-story` | MolViewSpec story template descriptors packaged for the agent story tools. |
| `packaging/dmg` | DMG background and layout assets used by `scripts/create-dmg.sh`. |
| `config` | Source-of-truth runtime registries: preview formats, web runtime bundle profiles, and the pinned managed xTB environment (`config/xtb`). |
| `scripts` | Build, install, release, Quick Look, smoke-test, vendoring, and agent helper commands. See `scripts/README.md` before adding public commands. |
| `samples` | Small checked-in sample files for supported molecular formats, preview routes, and focused fixtures such as FEP network GraphML. These are test and smoke inputs, not arbitrary data dumps. |
| `tests` | JavaScript and fixture-based contract checks for app, agent, preview, update, and UI behavior, plus Python suites under `tests/mdsmooth_core/`. |
| `docs` | Current engineering and agent-facing documentation graph. Start at `docs/README.md`. |
| `.codex` | Repo-local Codex maintenance skills for review, PR, release, testing, and contract checks. These are development-time instructions, not packaged Burette plugin skills. |
| `.github` | GitHub workflows, contribution notes, and PR template. |
| `Burette.xcodeproj` | Xcode project wiring for the Swift targets: Quick Look preview, thumbnail, and the source-built iPhone app. The macOS app itself is built by Tauri via `scripts/build.sh`. |
| `vite.config.ts` (root) | Browser-dev / Vite+ entrypoint that composes `apps/desktop/vite.config.ts`. |

Do not commit scratch output, local renderer dumps, downloaded datasets, or
one-off investigation folders. Use local ignored paths such as `.tmp/` for that
work, and promote only small, reviewed fixtures into `samples/` or
`tests/fixtures/` when they protect a documented format or behavior.
