# ChatGPT Pro Audit Remediation Plan

Source conversation: https://chatgpt.com/c/6a0508d7-b0ac-8389-a7a8-78981f8ae288

Local context used for the Pro request:

- Repository: https://github.com/SergeiNikolenko/Burrete
- Local snapshot: `8eab88c9`
- Product: macOS menu bar app plus Quick Look Preview Extension for molecular structure previews.
- Main stack: Tauri 2, React 19, TypeScript, Vite, Rust, Swift Quick Look extension, Mol* 5.7.0, RDKit `@rdkit/rdkit` 2025.3.4-1.0.0, Zustand.
- Stable Quick Look extension identifier: `com.local.BurreteV10.Preview`.
- No files were attached to the Pro model; the request used the public GitHub URL plus a short local factual summary.

## Normalized Remediation Checklist

## Remediation Status

Completed in this pass:

- SDF desktop grid delimiter fixed and covered by a Rust regression test.
- `ci-fast` now runs Rust tests; the misleading `build.sh samples/mini.sdf` smoke was removed and `build.sh` rejects unexpected positional arguments.
- Update install assets are zip-only and now require/download a `.sha256` sidecar before unpacking.
- Update validation now runs `spctl`, requires a Developer ID Team ID anchor, and validates the embedded Quick Look extension identity/signature.
- External `xyzrender` execution now has timeout and log capture bounds.
- Quick Look reset returns structured command diagnostics instead of fire-and-forget success.
- File association rank is less aggressive and broad public CSV/TSV default-handler takeover is skipped during local install.
- Parent `postMessage` handling now validates the iframe source and document id.
- Quick Look network entitlement was removed.
- Preference changes now refresh all open preview runtimes, preserving the active tab.
- Large desktop and Quick Look structure payloads are written as `preview-data.bin`; RDKit WASM is loaded from shared assets instead of being inlined per grid preview.
- Vendored Molstar/RDKit assets are hash-locked against `package-lock.json`.
- README settings claims were reconciled with the current UI surface.
- A checked `formats.manifest.json` now verifies the active format/UTI surface against app filters, Rust renderers, Tauri associations, AppMetadata, and forced Quick Look mappings.
- Release packaging now publishes a `.zip.sha256` sidecar, and release validation fails if the app is not Developer ID signed, Gatekeeper-accepted, stapled, and bundled with the expected Quick Look extension.
- Release packaging now also produces `Burrete-<version>.zip.manifest.json` and a detached Ed25519 signature; the app verifies the manifest signature before trusting the manifest SHA/version/bundle-id fields.
- The release workflow now imports a Developer ID certificate, builds with a release signing identity, submits the app for notarization, staples it, validates the signed bundle, and publishes the zip, SHA256 sidecar, signed manifest, and manifest signature.

External release prerequisites:

- Public releases require GitHub secrets for the Developer ID certificate, Apple notarization account, `BURRETE_CODESIGN_IDENTITY`, `BURRETE_UPDATE_MANIFEST_PUBLIC_KEY_HEX`, and `BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM`.

### Critical

1. Fix the desktop SDF grid parser delimiter.
   - Pro finding: Rust desktop grid parsing uses `$$`, while Swift Quick Look uses the standard SDF separator `$$$$`.
   - Risk: multi-record SDF files can be treated as one record in the desktop app, so grid mode can silently fail or diverge from Finder Quick Look.
   - Fix direction: change the Rust delimiter to `$$$$`; add shared SDF fixtures with two or more records.
   - Verification: add a Rust test asserting two records are parsed and grid runtime selects `grid2d`.

2. Harden the update and release trust chain.
   - Pro finding: updater checks URL/name/size/bundle id/version/codesign, but there is no signed manifest, SHA256 verification, notarization/Gatekeeper assessment, or strict embedded `.appex` validation.
   - Risk: public auto-update is weak against compromised release assets or token/release workflow compromise.
   - Fix direction: introduce a signed update manifest with version, asset URL, SHA256, size, bundle id, extension id, minimum OS, and signature; verify Developer ID, `spctl`, notarization, and embedded extension identity.
   - Verification: release CI must fail for unsigned, unnotarized, mismatched, or missing extension bundles.

### High

3. Add a timeout and explicit trust boundary to external `xyzrender` execution.
   - Pro finding: Rust uses `Command::new(...).output()` with implicit path discovery and no timeout or output cap.
   - Risk: opening a supported file can hang the app or exhaust memory through unbounded stdout/stderr.
   - Fix direction: add explicit `xyzrender` preferences, executable validation, timeout, process-group kill, output cap, and SVG output validation.
   - Verification: fake `xyzrender` fixtures for long sleep and large stderr.

4. Create one source of truth for formats and UTIs.
   - Pro finding: file format and UTI support is duplicated across `Info.plist`, `AppMetadata.plist`, `force-preview.sh`, `tauri.conf.json`, docs, and Rust/Swift code.
   - Risk: Finder, Quick Look, forced preview, and desktop open behavior can diverge.
   - Fix direction: add `formats.manifest.json` or YAML and generate plist fragments, docs tables, script mappings, and Rust/Swift constants from it.
   - Verification: CI consistency check across every declared extension, UTI, renderer path, and fixture.

5. Make Quick Look reset diagnostic instead of fire-and-forget.
   - Pro finding: `reset_quick_look` spawns `qlmanage` and `killall`, ignores failures, and returns success.
   - Risk: UI reports success while macOS Quick Look registration/cache remains broken.
   - Fix direction: run commands sequentially, capture status/output, treat missing `quicklookd` as non-fatal, and return structured diagnostics.
   - Verification: stub failed commands in tests; manual macOS smoke via `pluginkit` and forced `qlmanage`.

6. Replace structural CI coverage with behavioral tests where needed.
   - Pro finding: current fast tests mostly inspect source shape; `ci-fast` does not run Rust tests; `ci.sh` appears to pass sample args into a build script that ignores them.
   - Risk: parser, updater, renderer timeout, and Quick Look regressions can pass CI.
   - Fix direction: add `cargo test`, Rust parser/updater/external-renderer tests, and real sample preview smoke tests.
   - Verification: current SDF delimiter bug should fail before the fix.

7. Reconcile README promises with actual settings UI.
   - Pro finding: README promises `xyzrender` executable path, presets/custom JSON, extra flags, grid toggles, and file association controls; current preferences expose a smaller set.
   - Risk: product/docs mismatch and likely React/Rust/Swift settings drift.
   - Fix direction: either downgrade docs to current product scope or add a shared settings schema and UI surface.
   - Verification: change each setting, restart the app, and verify desktop preview plus Quick Look see the same value.

### Medium-high

8. Restrict update assets to the archive type the installer actually supports.
   - Pro finding: frontend accepts `.dmg`, `.zip`, and `.pkg`; Rust installer uses a zip-style `ditto -x -k` flow and searches for `.app`.
   - Risk: `.dmg` or `.pkg` releases can appear installable but fail at install time.
   - Fix direction: support only `.zip` until DMG/PKG flows are implemented explicitly.
   - Verification: mock release assets with zip/dmg/pkg combinations.

9. Make file association install less aggressive.
   - Pro finding: app metadata uses owner rank and install script sets default handlers for broad types including public CSV/TSV.
   - Risk: Burrete can unexpectedly become the default app for non-molecular files.
   - Fix direction: avoid automatic default ownership for broad public types; separate Quick Look registration from double-click defaults; add explicit opt-in.
   - Verification: query default handlers before and after install.

### Medium

10. Avoid duplicating large preview payloads as base64 JavaScript.
    - Pro finding: runtime writes payloads into JS as base64, and grid preview can inline RDKit WASM per preview.
    - Risk: high memory and cache overhead, especially in Finder Quick Look.
    - Fix direction: write binary payload files and load via `fetch(...).arrayBuffer()` or allowed file URL; load RDKit WASM from shared assets.
    - Verification: benchmark 5 MB, 25 MB, and 75 MB files for RSS, cache size, and time to first render.

11. Validate `postMessage` source and nonce.
    - Pro finding: parent window accepts messages by `data.source === "burrete-viewer"` and message type only.
    - Risk: future embedded content can spoof preference-changing messages.
    - Fix direction: add a per-runtime nonce and validate `event.source` against known iframe windows.
    - Verification: fake iframe forged message must not change preferences; real viewer switch still works.

12. Remove Quick Look network entitlement unless required.
    - Pro finding: extension entitlement includes `com.apple.security.network.client` despite offline bundled runtime design.
    - Risk: unnecessary sandbox privilege for a Finder previewer handling arbitrary local files.
    - Fix direction: remove the entitlement if no documented feature needs it; add CSP to block remote network loads.
    - Verification: Quick Look smoke tests without the entitlement.

13. Refresh inactive preview tabs after preference changes.
    - Pro finding: preference changes reload only the active runtime.
    - Risk: inactive tabs can show stale renderers/themes.
    - Fix direction: mark inactive tabs dirty and regenerate on activation, or bulk-regenerate with concurrency limits.
    - Verification: open two files, change renderer/theme, switch tabs, and assert the second tab refreshes or shows a clear dirty state.

14. Split local and production release signing paths.
    - Pro finding: local/release scripts sign ad-hoc while public release packaging uses the produced app bundle.
    - Risk: weak Gatekeeper/notarization posture and weaker updater trust anchor.
    - Fix direction: keep `build:local` ad-hoc; add `build:release` with Developer ID, hardened runtime, notarization, and stapling.
    - Verification: `codesign -dv`, `spctl --assess`, `stapler validate`, and embedded extension signature validation.

15. Hash-lock vendored Mol*/RDKit assets.
    - Pro finding: vendor scripts copy assets from `node_modules` but do not bind copied assets to package versions and hashes.
    - Risk: silent drift in bundled JavaScript/WASM assets.
    - Fix direction: generate `PreviewExtension/Web/assets.lock.json` with package, version, source path, and SHA256.
    - Verification: modifying a copied asset should fail CI.

## Pro Model Original Audit Text

### 1. [Critical | confirmed] Desktop SDF grid parser использует неправильный record delimiter

Evidence. В Rust desktop grid runtime `apps/desktop/src-tauri/src/preview/runtime_grid.rs::parse_sdf_grid` delimiter указан как `$$`, тогда как Swift Quick Look `PreviewExtension/MoleculeGridPreview.swift::parseSDF` делит SDF records по `$$$$`. Swift-реализация соответствует стандартному SDF separator; README обещает RDKit grids for SDF collections.

Impact. Multi-record SDF в desktop app, скорее всего, будет воспринят как один record. Поскольку grid runtime для SDF возвращает grid только при collection size > 1, desktop может silently fall back to Mol* или открыть не тот режим. Это особенно неприятно, потому что Quick Look parser в Swift выглядит правильным, то есть поведение app vs Finder preview расходится.

Fix. Заменить delimiter на `$$$$`; вынести SDF fixtures в общую test data директорию; добавить shared expectation: `recordsTotal`, `recordsIncluded`, first molecule name, props, molblock. Хорошее направление — единый parser contract manifest для Rust/Swift/JS, даже если реализации остаются раздельными.

Verification. `cargo test` должен включать fixture с двумя SDF records и assert: `create_grid_runtime(...).renderer == "grid2d"`, `recordsTotal == 2`, `recordsIncluded == 2`. Добавить e2e test для `open_documents([samples/two-molecule.sdf])`. Текущий код должен падать на этом тесте до фикса.

### 2. [Critical | confirmed] Update/release trust chain недостаточен для безопасного auto-install

Evidence. Frontend берёт GitHub Releases API и выбирает asset `.dmg/.zip/.pkg`; Rust updater валидирует URL prefix, asset name/size, bundle id/version, `codesign --verify --deep --strict`, но нет SHA256/signature manifest, notarization/Gatekeeper assessment, explicit embedded `.appex` validation, и team enforcement работает только если текущий app уже имеет team id. Сборка и local install подписывают app ad-hoc через `codesign --sign -`; release workflow публикует zip из `build/Burrete.app` без Developer ID/notarytool.

Impact. Для локальной/dev установки это терпимо. Для публичного auto-update это слабая supply-chain модель: компромисс GitHub release/token/asset может привести к установке bundle с правильным id/version. Если текущая установка ad-hoc, downloaded app тоже может пройти без stable Team ID anchor. Embedded Quick Look extension может быть missing/mismatched, а updater всё равно продолжит installer path до поздних ignored `pluginkit` steps.

Fix. Ввести signed update manifest: version, asset_url, sha256, size, bundle_id, extension_id, min_os, signature, подписанный offline key, лучше Ed25519. Rust updater должен проверять digest до unpack, затем Developer ID Team ID, `spctl --assess --type execute`, notarization/stapling where applicable, app id/version, embedded `.appex` id/version/signature/team. Не принимать `.pkg/.dmg`, пока Rust installer реально их не поддерживает.

Verification. CI release job должен fail, если app не Developer ID signed; `spctl --assess --type execute Burrete.app` не проходит; `BurretePreview.appex` отсутствует или имеет wrong bundle id/version.

### 3. [High | confirmed] Desktop external xyzrender запускается без timeout, trust boundary и advertised settings

Evidence. `apps/desktop/src-tauri/src/preview/xyzrender.rs::create_xyzrender_artifact` вызывает `Command::new(resolve_xyzrender_executable()?).arg(input_path).arg("-o").arg(output_path).arg("--config").arg("default").output()`. `resolve_xyzrender_executable()` ищет executable в `~/.local/bin`, `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`. Нет timeout, нет max stdout/stderr, нет check “is executable”, нет user-approved path. React preferences содержат только theme, canvasBackground, rendererMode, xyzFastStyle; README при этом обещает executable path, preset/custom JSON config и extra CLI flags.

Impact. Любое открытие external-only формата или user-selected `xyzrender-external` может зависнуть, если binary hangs; `.output()` также может забить память бесконечным stderr/stdout. Поведение desktop app не совпадает с обещанным product surface и с Swift Quick Look path, где виден вызов worker с executablePath, customConfigPath, extraArguments, orientationRefText.

Fix. Ввести `XyzrenderPreferences` в TypeScript, Rust IPC и persisted settings: executable path, preset, custom config path, extra args, timeout. По умолчанию лучше не искать PATH silently; external renderer должен быть explicit opt-in или хотя бы показывать resolved path в UI. Запускать child process с timeout, kill process group, cap logs, validate output SVG size/content.

Verification. Fake xyzrender fixtures: sleep 60s should return bounded error; 100 MB stderr should be capped without OOM.

### 4. [High | confirmed] Format/UTI support matrix не имеет единого source of truth

Evidence. `PreviewExtension/Info.plist` exports/supports many UTIs and legacy/dynamic content types; `apps/desktop/src-tauri/AppMetadata.plist` separately declares document types and UTIs; `scripts/force-preview.sh` has its own extension-to-UTI map; `tauri.conf.json` has another fileAssociations list; Rust `formats.rs` supports yet another renderer map.

Impact. Finder may route a file to Burrete that desktop Rust cannot render, or the app may support a file that Finder Quick Look registration does not. This is exactly the kind of hidden coupling that causes “works after force-preview, not after normal Space” bugs. Legacy identifiers like `com.local.molstarquicklook10.*`, dynamic `dyn.*`, typo-looking `com.local.burettexyzrender.smiles`, public CSV/TSV and broad MD/Schrödinger types make the registration surface hard to reason about.

Fix. Create `formats.manifest.json` or YAML with fields: extensions, exported UTI, imported/legacy UTIs, renderer support, grid eligibility, Quick Look support, app open support, force-preview UTI, examples. Generate `Info.plist`, `AppMetadata.plist`, `tauri.conf.json` associations, `force-preview.sh`, docs support table, and Rust/Swift format maps from it.

Verification. CI should run a manifest consistency check for every app association, every sample fixture, and every explicit “registration-only” annotation.

### 5. [High | confirmed] Quick Look reset command returns “success” without waiting or validating

Evidence. `apps/desktop/src-tauri/src/commands/quicklook.rs::reset_quick_look` spawns `/usr/bin/qlmanage -r`, `/usr/bin/qlmanage -r cache`, `/usr/bin/killall quicklookd`, ignores failures, and returns `Ok(())`. React then sets status “Quick Look reset requested”.

Impact. User-visible false positive: Quick Look can remain stale, plugin registration can still be broken, and UI says reset was requested/succeeded. This is painful because Quick Look caching/registration is already one of the most brittle macOS boundaries.

Fix. Run commands sequentially with `status()`/`output()`, treat “quicklookd not running” as non-fatal, return structured diagnostics: `qlmanageReset`, `cacheReset`, `quicklookdKilled`, `pluginkitRegistration`, `extensionFound`, `extensionEnabled`. Add a “Copy Diagnostics” button.

Verification. Stub commands in tests or inject command runner. Fail `qlmanage` and assert UI reports failure. On macOS integration CI/manual smoke: after reset, check `pluginkit -m -p com.apple.quicklook.preview | grep Burrete` and forced `qlmanage -p -c ... samples/mini.pdb`.

### 6. [High | confirmed] Tests/CI are mostly structural, not behavioral; current SDF bug would pass

Evidence. `tests/test-tauri-structure.mjs` reads source files and asserts regexes such as modules/functions/CSS selectors; it does not call Rust parsers. `scripts/ci-fast.sh` runs `npm run check:js`, `test:agent`, `test:ui`, `test:tauri-structure`, and plist lint, but not `cargo test`. `scripts/ci.sh` then calls `./scripts/build.sh samples/mini.sdf`, but `build.sh` ignores positional args.

Impact. The suite protects architecture shape, but not behavior. Parser bugs, update validation bugs, external process timeout bugs, and many Quick Look failure modes can pass CI. Passing `samples/mini.sdf` to `build.sh` looks like a smoke test but currently is not one.

Fix. Add `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`; Rust tests for `create_grid_runtime`, `open_document`, `format_for_extension`, updater validation, and fake external renderer; macOS integration smoke in a separate workflow or manual script.

Verification. CI should fail on the current SDF delimiter bug. Also make `build.sh` reject unexpected args, or rename call sites to explicit smoke scripts.

### 7. [High | confirmed] Product docs promise settings that current React app does not expose

Evidence. README says settings include xyzrender executable path, built-in preset/custom JSON config, extra CLI flags, grid enablement per file type, Finder file association registration. Current `ViewerPreferences` only has theme, canvasBackground, rendererMode, xyzFastStyle; `SettingsPanel` exposes Display, Structure Rendering, Updates, Workspace, System, but no xyzrender path/preset/custom config/extra args/grid toggles/file association controls.

Impact. User trust issue and support issue: README describes a richer app than the code exposes. Worse, Swift Quick Look has preference keys for grid file support and visible paths for xyzrender preferences, so there is likely a partially implemented cross-boundary settings model without a desktop UI/control plane.

Fix. Either downgrade README to actual current scope, or implement a settings schema shared by React/Rust/Swift.

Verification. Settings e2e: change each value in app, reopen app, generate desktop preview, generate Quick Look preview, assert both layers see the same setting.

### 8. [Medium-high | confirmed] Frontend accepts .dmg/.pkg update assets that Rust installer does not actually support

Evidence. `apps/desktop/src/update.ts::installAssetFor` accepts `[".dmg", ".zip", ".pkg"]`. Rust `unpack_and_validate_update` uses `ditto -x -k archive staging`, then searches for `.app`; this is a zip-style flow, not a DMG mount or PKG install flow.

Impact. If a release contains a `.dmg` or `.pkg`, the UI may offer “Install and Restart”, then fail in updater. This is user-visible and looks like a broken updater.

Fix. Until real DMG/PKG support exists, select only `.zip` in frontend and validate `.zip` in Rust. If DMG is required later, implement explicit mount/verify/copy/unmount path. If PKG is required, that is a different trust/admin flow and should not be silently installed by this updater.

Verification. Mock GitHub releases with `.zip`, `.dmg`, `.pkg`, mixed assets. Assert only supported installable assets are selected. Add Rust validation test rejecting non-zip.

### 9. [Medium-high | confirmed] File association install is aggressive and can take over broad public types

Evidence. `AppMetadata.plist` declares `LSHandlerRank` as Owner, includes public CSV/TSV content types and many molecular/legacy UTIs; `install-local.sh` calls `LSSetDefaultRoleHandlerForContentType` for every content type in the app’s document types.

Impact. Burrete may become the default viewer for CSV/TSV or broad molecular types without a clear user opt-in. On macOS this feels invasive; users may blame Burrete when double-click behavior changes outside molecular workflows.

Fix. Do not set defaults for public CSV/TSV automatically. Prefer `LSHandlerRank=Alternate` for broad types, or expose per-type association toggles with explicit confirmation. Keep Quick Look registration separate from double-click default ownership.

Verification. After install, query default handlers for public CSV/TSV and molecular UTIs. Ensure defaults are not changed unless user opted in.

### 10. [Medium | confirmed] Runtime model duplicates large data as base64 JS and inlines RDKit WASM per grid preview

Evidence. Rust desktop `open_document` reads full file with a 75 MB size limit; viewer runtime writes `preview-data.js` containing base64 data. Swift Quick Look does analogous runtime file generation. Grid paths inline `RDKit_minimal.wasm` as base64 into records script, while `grid-viewer.js` can also use `locateFile` for `../assets/rdkit/...`.

Impact. Large inputs cost file bytes + base64 expansion + JS parse + decoded ArrayBuffer. In Quick Look, memory pressure can kill previews or make Finder feel hung. RDKit WASM base64 per preview bloats cache and startup.

Fix. Store structure payload as a binary file in runtime dir and load via `fetch(assetURL).arrayBuffer()` or file URL inside allowed readAccess scope. Load RDKit WASM from shared `assets/rdkit/RDKit_minimal.wasm`, not inline. Use renderer-specific size limits and memory estimates.

Verification. Benchmark 5 MB, 25 MB, 75 MB PDB/CIF/XYZ/SDF. Track peak RSS, time to first render, generated cache size. Assert no per-preview WASM duplication.

### 11. [Medium | confirmed] Parent window message handler does not validate source/origin

Evidence. `App.tsx` listens to `window.message`, checks only `data.source === "burrete-viewer"` and `body.type === "setRenderer"`, then writes `rendererMode`. The viewer bridge posts messages from iframe/runtime; the iframe is sandboxed, which is good, but parent can still validate `event.source` against known iframe windows and require a nonce.

Impact. This is not an obvious RCE path, but it is a trust-boundary smell. Any future embedded frame or accidental external content could spoof `source: "burrete-viewer"` and mutate app preferences.

Fix. Add a per-runtime nonce to `BurreteConfig`; require the same nonce in every message. Keep refs to viewer iframes and reject `event.source` not in that set. Check expected origin/protocol where possible.

Verification. Browser/Tauri test: fake iframe posts a forged message; preference must not change. Real viewer toolbar switch still works.

### 12. [Medium | confirmed] Quick Look extension has network entitlement despite “offline bundled runtime” design

Evidence. `PreviewExtension/BurretePreview.entitlements` enables app sandbox, user-selected read-only files, and `com.apple.security.network.client`. The README/product story emphasizes bundled/offline preview runtime; grid footer explicitly says offline RDKit.js rendering.

Impact. Extra entitlement increases blast radius. If bundled JS or future dependency tries remote network, the sandbox permits it. For a Finder Quick Look previewer handling arbitrary local files, least privilege matters.

Fix. Remove network client entitlement unless a documented feature needs it. Add a CSP/meta policy in Quick Look HTML that blocks remote network loads. Keep all Mol*/RDKit assets bundled.

Verification. Build extension without network entitlement; run PDB/CIF/XYZ/SDF/CSV/SMILES Quick Look smoke tests. Add a test that injected remote fetch fails.

### 13. [Medium | confirmed] Preference changes reload only the active runtime; inactive tabs can become stale

Evidence. `App.tsx` has an effect that calls `reloadActive()` on preferences.theme, canvasBackground, rendererMode, xyzFastStyle, with comment: “Preferences intentionally refresh only the active runtime.” State persists documents/tabs/recent structures in Zustand.

Impact. After changing renderer/theme, active tab updates, inactive tabs keep old generated runtime until reopened/reloaded. That can look like settings are flaky.

Fix. Mark inactive file tabs dirty on preference changes; regenerate on activation. Or bulk regenerate with concurrency limit and visible progress.

Verification. Open two files, change renderer/theme, switch tabs. Assert second tab either regenerates on activation or shows explicit “needs refresh” state.

### 14. [Medium | confirmed] Release workflow publishes ad-hoc build; hardened runtime settings are inconsistent

Evidence. Tauri config has `hardenedRuntime: false`; Xcode extension target has `ENABLE_HARDENED_RUNTIME = YES`, but build scripts sign app/appex with `CODE_SIGN_IDENTITY=-` / `codesign --sign -`; release workflow packages that build into a zip.

Impact. For local dev this is fine. For public releases, it undermines Gatekeeper/notarization expectations and weakens updater team-id validation.

Fix. Split build modes: `build:local` ad-hoc, explicit local-only; `build:release` Developer ID signed, hardened runtime, notarized/stapled.

Verification. `codesign -dv --verbose=4`, `spctl --assess`, `stapler validate`, embedded extension signature validation.

### 15. [Low-medium | confirmed] Vendored web assets are copied from npm packages but not hash-verified against a manifest

Evidence. `vendor-molstar.mjs` copies `molstar.js/css` from `node_modules/molstar/build/viewer`; `vendor-rdkit.mjs` copies RDKit JS/WASM from `node_modules/@rdkit/rdkit`; build validates presence and `node --check`, but no hash manifest binds committed vendored assets to `package-lock` versions.

Impact. Vendored artifacts can drift silently. This is not catastrophic if repo is trusted, but for a previewer loading JS in Finder, asset provenance should be crisp.

Fix. Generate `PreviewExtension/Web/assets.lock.json` with package name/version/source path/SHA256 for each copied asset. CI should regenerate/check and fail on mismatch.

Verification. Modify one byte of `molstar.js` or RDKit WASM; CI hash check fails.

## Architecture/design review

Что хорошо. The main boundary is sane: React shell owns UX/state; Rust owns IPC and desktop preview generation; Swift owns Quick Look; bundled Web runtime is shared. Docs explicitly describe those directories and boundaries. The Tauri command surface is small: startup docs, open docs, cache clear, logs, external URL, Quick Look reset, update install.

Главная архитектурная проблема — duplicate truth. Renderer policy appears in Rust, Swift, JS, docs, and UI. Format support appears in at least six places. Preferences appear in React/Rust/Swift with different fields. This is the classic source of “one side fixed, another side stale”.

Recommended design direction:

- Add `formats.manifest.json`.
- Add `settings.schema.json`.
- Generate plist fragments, docs tables, Rust/Swift constants, and `force-preview.sh` mapping.
- Add a compatibility test that opens every manifest-declared extension through the app preview service and, where possible, Quick Look forced content type.

Runtime model. UUID runtime directories and shared assets are pragmatic. The iframe sandbox in desktop is a good boundary: Tauri runtime uses `sandbox="allow-scripts allow-downloads"` without `allow-same-origin`.

## Security/reliability review

Positive controls already present:

- Tauri CSP is reasonably tight and only allows GitHub API for update checks plus local IPC/asset protocols.
- Desktop viewer iframe is sandboxed without same-origin in Tauri.
- Quick Look WKWebView uses non-persistent website data store and disables JavaScript window opening.
- `open_external_url` allowlists GitHub Releases URLs instead of opening arbitrary URLs.
- Grid viewer sanitizes RDKit SVG by removing scripts, foreignObject, event handlers, and JavaScript URLs.

Hardening priorities:

- Update manifest signing and release notarization.
- External renderer timeout and explicit configuration.
- Quick Look network entitlement removal.
- `postMessage` nonce/source validation.
- Less aggressive file association defaults.

## UX/macOS product review

Burrete being an `LSUIElement` menu bar app is consistent with product intent; build script explicitly marks `LSUIElement=true`.

The current install script is too aggressive about default handlers. For CSV/TSV especially, “Burrete owns this file type now” will surprise users.

Quick Look reset UI should become diagnostics-first: “Reset requested” is not enough; users need to know whether extension is registered/enabled and which bundle path macOS is using.

Settings/docs mismatch is product debt, not just docs debt. README promises a serious settings surface; the actual SettingsPanel is much thinner.

Tray behavior should be manually tested: `show_menu_on_left_click(true)` plus left-click window activation may produce “click tray = menu + window” ambiguity. Pro marked this as a hypothesis because it did not run the app.

## Testing/CI/release review

Current CI shape. GitHub Actions has fast validation and native bundle build on native/package changes; release workflow validates versions, builds app, zips, creates GitHub release.

Main gaps:

- No visible `cargo test` in `ci:fast`.
- JS tests are largely source-contract regexes.
- Build smoke does not actually preview `samples/mini.sdf`; the argument to `build.sh` is ignored.
- No updater negative tests.
- No Quick Look registration integration checks in CI.
- No release signing/notarization gate.

Practical test plan:

- Rust integration: open document fixtures for PDB, CIF, XYZ multi-frame, SDF one-record, SDF multi-record, CSV/TSV/SMILES, and external-only formats.
- Swift unit: `MoleculeGridPreviewBuilder`, `BurreteRendererPolicy`, preference loading, Quick Look size limits.
- Browser/Tauri: forged postMessage, tab dirty refresh, settings persistence, update asset selection.
- macOS manual/integration: build, install, `pluginkit`, forced `qlmanage`, app launch, codesign assessment.

## Prioritized Roadmap

Immediate fixes:

- Fix Rust SDF delimiter `$$` to `$$$$`; add failing fixture test first.
- Make frontend update asset selection zip-only until DMG/PKG are actually implemented.
- Add timeout/log cap to desktop `xyzrender` execution.
- Make `reset_quick_look` wait for commands and return diagnostics.
- Add `cargo test` to `ci:fast`; make `build.sh` reject ignored args or move sample smoke to a real script.

Medium-term hardening:

- Implement signed update manifest with SHA256 and offline signature.
- Require Developer ID signing/notarization for public release workflow.
- Validate embedded `BurretePreview.appex` in updater and release CI.
- Remove Quick Look network entitlement if not required.
- Add `postMessage` nonce/source validation.
- Replace base64 data scripts with binary runtime assets/fetch.

Architectural/design improvements:

- Generate all format/UTI/docs/script maps from one manifest.
- Generate settings UI/defaults/Rust/Swift preference keys from one schema.
- Unify renderer mode naming: pick either `fast-xyz` public name and `xyz-fast` internal name with explicit mapping, or one name everywhere.
- Add dirty/runtime regeneration state for inactive tabs.
- Separate local-dev build/install from production release build/install.

## Open Questions / Things Pro Could Not Verify

- Pro could not run local clone/build/tests because its container could not resolve GitHub for `git clone`; it used GitHub connector/web inspection instead.
- Pro did not audit uncommitted local worktree changes; it audited the GitHub commit corresponding to `8eab88c9`.
- Pro could not run macOS-only commands: `xcodebuild`, `codesign`, `spctl`, `notarytool`, `pluginkit`, `qlmanage`, `killall quicklookd`.
- GitHub connector returned no combined statuses/workflow runs for the commit, so Pro could not verify whether CI passed for this exact snapshot.
- `PreviewExtension/Platform/PreviewViewController.swift` is long and tool output truncated later methods; Pro audited visible major paths, but not every tail function in that file.
- Severity of signing/update findings depends on intent: for local-only personal builds they are medium; for public auto-update distribution they are critical.
