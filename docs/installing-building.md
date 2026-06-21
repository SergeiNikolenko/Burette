# Installing And Building

Most users should install Burrete with Homebrew, the Bun CLI, or
[GitHub Releases](https://github.com/SergeiNikolenko/Burrete/releases/latest).
Use this page when you want to build the app from the repository.

## System Requirements

| Requirement | Details |
| --- | --- |
| Operating system | macOS 12+ for the desktop app, Finder Quick Look, and local release builds. |
| Xcode | Required for Tauri/macOS packaging, Quick Look extensions, thumbnail extension, and the source-built iPhone target. |
| Bun | Required for workspace scripts, JavaScript checks, vendoring, package metadata, and the CLI installer. |
| Vite+ `vp` CLI | Preferred entrypoint for frontend install, dev, check, test, and build workflows. |
| Rust toolchain | Required for the Tauri crate and `crates/burrete-core`. |
| `xyzrender` | Optional external renderer for XYZ, CUBE, quantum input, MAE, CMS, and other external-renderer formats. |
| Python + `uv` | Optional runtime installation path for descriptor, RDKit, Datamol, and MSBuddy workflows. |
| VESTA | Optional handoff target for selected crystal and volumetric formats. |

Run the local doctor first when setting up a checkout:

```bash
./scripts/doctor.sh
```

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

## Focused Checks

Pick the smallest check that covers the changed surface:

```bash
vp check
vp test
bun run ci:fast
```

For native code:

```bash
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

For format registry or vendored runtime changes:

```bash
bun scripts/check-preview-format-registry.mjs
bun scripts/check-vendor-assets.mjs
```

## Quick Look Refresh

After replacing the app or extension during local development, refresh Quick
Look state:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Logging And Diagnostics

Use local diagnostics before guessing at app, Quick Look, or runtime failures:

```bash
./scripts/diagnose.sh samples/mini.pdb
./scripts/tail-log.sh
```

The desktop app can also export a diagnostics bundle from Settings > System >
Diagnostics or from the command palette. Diagnostics bundles are local files and
should not include raw molecule contents or credentials.

Primary Quick Look logs are under the extension container:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/Burrete.log
```

For dev-flavored installs, the container identifier is flavor-specific. Use the
same `BURRETE_DEV_FLAVOR` value across build, install, smoke, and diagnostics
commands.
