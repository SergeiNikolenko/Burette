# Repository Layout

Burrete is organized around a small number of application surfaces and the
shared preview runtime they use.

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Main React and Tauri desktop workspace. The React shell, hooks, preview bridges, command palette, Ketcher surface, grids, and Tauri commands live here. |
| `apps/burrete-public-plugin` | Hosted OpenAI app-plus-skills submission, public HTTPS MCP endpoint, bounded attachment/PDB preparation, and CSP-compatible Mol* widget. |
| `PreviewExtension` | macOS Finder Quick Look preview and thumbnail extension. `PreviewExtension/Web` contains the bundled Mol*, RDKit grid, and viewer runtime assets shared with desktop and Quick Look. |
| `ios/BurreteMobile` | Source-built iPhone preview app target. It reuses the bundled preview runtime for iOS document handoff and phone-first molecular inspection. |
| `packages/burrete` | Bun CLI installer used by `bunx burrete install`, `bunx burrete doctor`, and release-channel checks. |
| `plugins/burette-agent` | Codex/Burrete plugin, MCP server, skills, and bounded agent workflow contracts. It wraps the repository CLI instead of reimplementing app control. |
| `crates/burrete-core` | Shared Rust crate for native molecular and preview-support logic used by the Tauri app. |
| `config` | Source-of-truth runtime registries, including preview formats and web runtime bundle profiles. |
| `scripts` | Build, install, release, Quick Look, smoke-test, vendoring, and agent helper commands. See `scripts/README.md` before adding public commands. |
| `samples` | Small checked-in sample files for supported molecular formats, preview routes, and focused fixtures such as FEP network GraphML. These are test and smoke inputs, not arbitrary data dumps. |
| `tests` | JavaScript and fixture-based contract checks for app, agent, preview, update, and UI behavior. |
| `docs` | Current engineering and agent-facing documentation graph. Start at `docs/README.md`. |
| `.codex` | Repo-local Codex maintenance skills for review, PR, release, testing, and contract checks. These are development-time instructions, not packaged Burrete plugin skills. |
| `.github` | GitHub workflows, contribution notes, and PR template. |
| `Burrete.xcodeproj` | Xcode project wiring for the macOS app, Quick Look targets, thumbnail target, and source-built iPhone target. |

Do not commit scratch output, local renderer dumps, downloaded datasets, or
one-off investigation folders. Use local ignored paths such as `.tmp/` for that
work, and promote only small, reviewed fixtures into `samples/` or
`tests/fixtures/` when they protect a documented format or behavior.
