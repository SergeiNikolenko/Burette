# Agent Notes

Burrete is a macOS menu bar app plus a Quick Look Preview Extension for
molecular structure files.

## Documentation Graph

- User-facing overview: [README.md](README.md)
- Documentation map: [docs/README.md](docs/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Renderer support: [docs/renderer-support.md](docs/renderer-support.md)
- Quick Look debugging: [docs/quicklook-debugging.md](docs/quicklook-debugging.md)
- Release process: [docs/releasing.md](docs/releasing.md)

## Stable Runtime Identifiers

Quick Look extension bundle identifier:

```text
com.local.BurreteV10.Preview
```

Forced preview content types:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
```

## Common Commands

```bash
vp install
vp dev
vp check
vp test
vp build
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/build.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/install.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.pdb
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.cif
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.xyz
```

Use Vite+ through the `vp` CLI for frontend development and JavaScript
validation. Prefer `vp dev`, `vp check`, `vp test`, and `vp build` over direct
package-manager or Vite commands. Existing package scripts may still be run
through `vp run <script>` when they cover project-specific validation not yet
folded into a Vite+ built-in. Direct Bun commands remain implementation details
inside repository-owned build, release, and installer scripts until a separate
toolchain migration replaces those paths.

When an agent builds or installs a packaged app for local testing, always use a
dev flavor with a unique slug, preferably the worktree suffix:

```bash
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/build.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/install.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.pdb
```

This keeps the app, Quick Look extension, thumbnail extension, content types,
and Launch Services registrations isolated from other worktrees and from the
release bundle. Do not run unflavored `./scripts/build.sh`,
`./scripts/install.sh`, or packaged preview smoke commands unless the user
explicitly asks for a release or final non-dev bundle. `scripts/build-dev.sh`
does not support dev flavors; agents should prefer the flavored
`./scripts/build.sh` path for packaged local builds.

Rust validation runs from the Tauri crate:

```bash
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

After replacing the app, refresh Quick Look:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Maintenance Rules

- Keep current docs under `docs/`.
- Do not reintroduce imported reference snapshots or migration handoff logs into
  the active docs graph.
- Verify doc claims against source, scripts, or runtime output before updating
  docs.
