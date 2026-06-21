# Agent Tool Index

Use this index to pick the smallest reliable command for the changed surface.
Prefer focused tools first, then broaden validation when the change crosses
runtime boundaries.

| Tool | Path | Use When | Input | Output |
| --- | --- | --- | --- | --- |
| Vite+ install/check/test/build | `vp install`, `vp check`, `vp test`, `vp build` | Frontend development and JavaScript validation. | Current checkout. | Vite+ validation output. |
| Fast CI | `bun run ci:fast` | PR-scale validation before a broad review. | Current checkout. | Focused CI summary. |
| Full CI | `bun run ci` | Broad pre-merge validation. | Current checkout. | Full repository validation summary. |
| Packaged build | `scripts/build.sh` | Building a local or release app bundle. | Optional `BURRETE_DEV_FLAVOR`. | `build/Burrete*.app`. |
| Packaged install | `scripts/install.sh` | Installing a local bundle for native/Quick Look checks. | Optional `BURRETE_DEV_FLAVOR`. | App installed under `~/Applications`. |
| Forced preview | `scripts/force-preview.sh` | Checking one structure file through Quick Look. | One structure file. | `qlmanage` result and extension logs. |
| Quick Look smoke | `scripts/quicklook-preview-smoke.sh` | CI-style focused packaged preview smoke. | One or more sample files. | TSV report path or failure. |
| All samples Quick Look smoke | `scripts/smoke-samples-quicklook.sh` | Enumerating `samples/` against an installed dev extension. | Samples directory. | TSV and Markdown reports under `build/reports`. |
| Agent CLI | `scripts/burrete-agent.mjs` | Opening, observing, acting, or rendering agent panels. | Mode, session dir, action JSON, file paths. | JSON session/action/observe output. |
| Agent preview server | `scripts/agent-preview.mjs` | Tokenized browser preview session checks. | Files and launch options. | Local URL and session metadata. |
| Preview format registry check | `scripts/check-preview-format-registry.mjs` | Changing formats, UTIs, or preview routing. | `config/preview-formats.json` and metadata files. | Pass/fail registry validation. |
| Vendor asset check | `scripts/check-vendor-assets.mjs` | Changing Mol*, RDKit, or vendored runtime assets. | Vendored asset tree. | Pass/fail freshness result. |
| Performance smoke | `scripts/perf-smoke.sh` | Checking non-GUI and Quick Look performance budgets. | App path and perf env flags. | Text report under `build/reports`. |
| Release version check | `scripts/check-release-version.mjs` | Release or versioning changes. | Git state and package version. | Pass/fail release readiness. |

See `scripts/README.md` for command groups and local usage notes.
