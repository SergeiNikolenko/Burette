# Vite+ Development Workflow

Burette follows the Writer Computer convention of using Vite+ through the
global `vp` CLI as the development entrypoint for frontend and JavaScript
tooling.

## Core Rules

- Use `vp` for day-to-day package installation, frontend development, and
  JavaScript validation.
- Prefer the Vite+ built-ins: `vp dev`, `vp check`, `vp test`, and `vp build`.
- Run Burette package scripts through `vp run <script>` only when a
  project-specific check is not covered by a Vite+ built-in.
- Keep direct Bun calls inside repository-owned scripts until the lockfile,
  release scripts, and package installer are migrated in a separate step.
- Do not replace the macOS release, signing, Quick Look, or installer scripts
  with Vite+ commands without validating the native release workflow.

## Common Commands

```bash
vp install
vp dev
vp check
vp test
vp build
```

For a full local readiness pass, use:

```bash
vp run ready
```

`vp test` runs a Vitest wrapper over the existing Burette contract scripts.
`vp check` runs Vite+ linting and type-aware checks. Vite+ formatting is
temporarily disabled for the legacy source tree to avoid a repository-wide
format-only diff during the toolchain migration.

## Native Binding Troubleshooting

If `vp dev`, `vp check`, or another Vite+ command fails on macOS with
`Cannot find native binding` and mentions
`rolldown-binding.darwin-arm64.node`, treat it as a local toolchain issue
before investigating application code.

First make sure the workspace dependencies are installed:

```bash
vp install
```

When running inside the Codex desktop shell, also check which Node executable
is first in `PATH`:

```bash
which node
```

If it resolves to the Node binary inside `Codex.app`, macOS library validation
can prevent Vite+ native packages from loading even when the optional
dependencies are installed. Run Vite+ with the first non-Codex Node executable
first in `PATH`:

```bash
node_bin="$(
  printf '%s' "$PATH" | tr ':' '\n' | while IFS= read -r dir; do
    case "$dir" in *Codex.app*|'') continue ;; esac
    if [ -x "$dir/node" ]; then
      printf '%s\n' "$dir/node"
      break
    fi
  done
)"
PATH="$(dirname "$node_bin"):$PATH" vp dev
```

This keeps `vp` as the development entrypoint while avoiding false regressions
from Codex's app-bundled Node binary.

## Native Validation

Rust and native macOS validation still run from the Tauri crate or the existing
release scripts:

```bash
vp run check:rust
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

The local signed/notarized release path remains documented in
[releasing.md](releasing.md).
