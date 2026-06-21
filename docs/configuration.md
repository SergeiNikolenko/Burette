# Configuration

Burrete configuration is split between user-facing app settings, checked-in
runtime registries, build/release environment variables, and local development
overrides. Keep each setting in the smallest layer that owns it.

## Source Of Truth Files

| File | Owns |
| --- | --- |
| `config/preview-formats.json` | Supported file extensions, content types, renderer routing, grid routing, Quick Look limits, and VESTA handoff flags. |
| `config/web-runtime-profiles.json` | Which bundled web runtime assets are included for Tauri, Quick Look, grid, Mol*, and external-artifact profiles. |
| `apps/desktop/src-tauri/AppMetadata.plist` | App-level document type metadata used by the Tauri bundle. |
| `PreviewExtension/Info.plist` | Finder Quick Look preview extension metadata and supported content types. |
| `PreviewExtension/ThumbnailInfo.plist` | Finder thumbnail extension metadata and supported content types. |
| `apps/desktop/src-tauri/tauri.conf.json` | Tauri bundle metadata, resources, app identifiers, update config, and macOS file associations. |
| `apps/desktop/src-tauri/capabilities/default.json` | Tauri capability set exposed to the desktop shell windows. |
| `apps/desktop/src-tauri/permissions/burrete.toml` | Burrete command allowlist exposed through Tauri permissions. |
| `package.json` | Workspace version, public scripts, package manager, and JavaScript dependency metadata. |
| `vendor-assets.lock.json` | Expected Mol*, RDKit, and bundled web-runtime asset state. |

When a preview format or document type changes, keep the registry, plist files,
and focused format tests in sync. Run:

```bash
bun scripts/check-preview-format-registry.mjs
```

When vendored runtime assets change, update or verify the vendor lock:

```bash
bun scripts/check-vendor-assets.mjs
```

## Development Overrides

| Variable | Use |
| --- | --- |
| `BURRETE_DEV_FLAVOR` | Namespaced local app/Quick Look build for safe packaged testing. Use this for local installs unless explicitly producing a release bundle. |
| `BURRETE_DEV_FS_ALLOW` | Adds browser-dev filesystem roots for local preview work. Use path-list syntax for the current platform. |
| `BURRETE_DEV_DEFAULT_FILES` | Opens a controlled set of default files in browser-dev. |
| `BURRETE_AGENT_SHELL_SESSION_DIR` | Points browser-dev shell sessions at the observe/action directory used by the agent CLI. |
| `BURRETE_APP_PATH` | Points agent or perf commands at a specific installed app bundle. |
| `BURRETE_DESCRIPTOR_RUNTIME_DIR` | Uses a prepared descriptor runtime directory in browser-dev. |
| `BURRETE_MSBUDDY_RUNTIME_DIR` | Uses a prepared MSBuddy runtime directory in browser-dev. |

Example browser-dev shell:

```bash
BURRETE_DEV_FS_ALLOW="$PWD/samples" \
  bun scripts/burrete-agent.mjs open --mode browser-dev-shell samples/mini.pdb
```

Example packaged dev install:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/install.sh
```

## External Runtime Overrides

| Variable | Use |
| --- | --- |
| `BURRETE_RDKIT_PYTHON` | Python interpreter for RDKit-backed browser-dev workflows. |
| `BURRETE_DATAMOL_PYTHON` | Python interpreter for Datamol-backed preparation workflows. |
| `BURRETE_DESCRIPTOR_PYTHON` | Python interpreter with RDKit and descriptor dependencies. |
| `BURRETE_MSBUDDY_PYTHON` | Python interpreter for MSBuddy runtime support. |
| `BURRETE_UV` | Override for the `uv` executable used by runtime installers. |
| `BURRETE_SKIP_XYZRENDER_RUNNER_CHECK` | Skips the `xyzrender` runner check only when debugging the runner boundary. |

Prefer app-managed runtime installation when available. Use environment
overrides for debugging, CI, or known local toolchains.

## Release And Signing Environment

| Variable | Use |
| --- | --- |
| `BURRETE_BUILD_MODE=release` | Forces release build semantics in repository scripts. |
| `BURRETE_XCODE_CONFIGURATION=Release` | Uses the Xcode Release configuration. |
| `BURRETE_CODESIGN_IDENTITY` | Developer ID signing identity for macOS releases. |
| `BURRETE_DEVELOPMENT_TEAM` | Apple Developer Team ID for signing. |
| `BURRETE_NOTARY_KEYCHAIN_PROFILE` | Local notarytool keychain profile. |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | Apple notarization credentials when no keychain profile is used. |
| `BURRETE_RELEASE_ALLOW_ADHOC=1` | Builds and validates an ad-hoc release artifact when Developer ID credentials are unavailable. |
| `BURRETE_UPDATE_MANIFEST_PUBLIC_KEY_HEX` | Public key used by update manifest validation. |
| `BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM` | Private key used to sign update manifests. Do not print or commit it. |
| `HOMEBREW_TAP_TOKEN` | GitHub token used by stable release automation to update the external Homebrew tap. |

Secrets belong in the local environment or GitHub Actions secrets, never in
tracked files, examples, logs, or diagnostics bundles.

## Smoke And Performance Environment

| Variable | Use |
| --- | --- |
| `BURRETE_QUICKLOOK_SMOKE_RESULTS` | Output TSV path for focused Quick Look smoke checks. |
| `BURRETE_QUICKLOOK_SMOKE_TIMEOUT_SECONDS` | Timeout for focused Quick Look smoke checks. |
| `BURRETE_QUICKLOOK_SMOKE_RESET_CACHE` | Controls cache reset behavior in focused Quick Look smoke checks. |
| `BURRETE_SAMPLES_QUICKLOOK_RESULTS` | Output TSV path for all-samples Quick Look smoke. |
| `BURRETE_SAMPLES_QUICKLOOK_TIMEOUT_SECONDS` | Default per-sample timeout for all-samples Quick Look smoke. |
| `BURRETE_SAMPLES_QUICKLOOK_LONG_TIMEOUT_SECONDS` | Longer timeout for known slow sample formats. |
| `BURRETE_PERF_REPORT` | Output path for performance smoke reports. |
| `BURRETE_PERF_RUN_GUI` | Enables or skips GUI performance checks. |
| `BURRETE_PERF_RUN_QUICKLOOK` | Enables or skips Quick Look performance checks. |
| `BURRETE_PERF_RUN_GRID_FTS` | Enables or skips grid full-text-search checks. |
| `BURRETE_PERF_PDB`, `BURRETE_PERF_SDF`, `BURRETE_PERF_QUICKLOOK_FILE` | Sample files used by performance smoke checks. |

These variables are for CI and focused local validation. Do not commit generated
reports unless a maintainer asks for that artifact.

## Configuration Change Rules

- Keep user-facing settings in the app UI when they are normal preferences.
- Keep release, signing, and CI-only values in environment variables or GitHub
  secrets.
- Keep supported file formats in `config/preview-formats.json`; do not encode
  new format routing only in React, Tauri, or Quick Look code.
- Keep web asset membership in `config/web-runtime-profiles.json`; do not add
  ad hoc asset copies to bundle scripts.
- Update [docs/tools/index.md](tools/index.md) or [scripts/README.md](../scripts/README.md)
  when adding a public command or changing a documented command contract.
