# Installing And Building

Most users should install Burrete with Homebrew, the Bun CLI, or
[GitHub Releases](https://github.com/SergeiNikolenko/Burrete/releases/latest).
Use this page when you want to build the app from the repository.

## Build From Source

Clone the repository, install the required local tools, then run:

```bash
./scripts/doctor.sh
./scripts/build.sh
./scripts/install.sh
```

The local installer places the app here:

```text
~/Applications/Burrete.app
```

## Development Workflow

Burrete uses Vite+ through the `vp` CLI for frontend development and JavaScript
validation:

```bash
vp install
vp dev
vp check
vp test
vp build
```

Existing Burrete package scripts may still be run through `vp run <script>` for
project-specific checks. Rust validation runs from `apps/desktop/src-tauri`,
and native release scripts remain under `scripts/`.

See [Vite+ workflow](vite-plus.md), [Development loops](development-loops.md),
and [Releasing](releasing.md) for the detailed engineering flow.

## Quick Look Refresh

After replacing the app or extension during local development, refresh Quick
Look state:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```
