# Local native widget: preserved source

The recovered local plugin `0.2.2+local.20260913.6` is preserved in this
repository at commit `73089828849d97609866c7b50cdb734c61106a65`, with annotated
tag `local-widget-recovered-20260921` and branch `recovery/local-widget-20260921`.
The commit contains the full recovered source tree, tests, and prebuilt offline
plugin, including previously uncommitted changes. It is an independent snapshot
of the recovered tree, not a merge or rollback of the current application.

## Current packaged widget

`config/native-widget.json` pins the corrected widget revision. Run
`bun run install:plugin` to stage and install it. `scripts/stage-native-widget.mjs`
extracts only its plugin subtree into ignored `plugins/burette-native-bundle`,
checks its version and every compressed native asset, and records provenance.
The first stage needs the pinned Git object (fetched from origin if missing).
Native application builds stage this package before copying the isolated build
tree; Tauri includes it at the unchanged `plugins/burette-agent` resource path.
This packages the preserved widget without reverting current desktop sources.

The package installs as `burette@burette-widget`, isolated from legacy desktop
auto-refresh. The new app refresh path recognizes that namespace. Its legacy
Python fallback must not install native widgets into a different marketplace.
An already-installed older application is not changed by merging this work;
installation and update acceptance require a newly built application.

Rebuild UI changes in the widget source branch, commit the generated package,
then advance the pin. Do not edit staged files. This is a packaging bridge,
not a completed forward port of the older UI source into current desktop code.

## Restore the historical snapshot without overwriting another checkout

From an existing Burette Git checkout:

```sh
git fetch origin tag local-widget-recovered-20260921
git worktree add --detach ../Burette-native-widget 73089828849d97609866c7b50cdb734c61106a65
cd ../Burette-native-widget
node plugins/burette-agent/scripts/install-local.mjs
```

Use a new destination directory. No build is needed for the preserved bundle.
Restart Codex completely after installation. Open Burette in a fresh task and
verify the actual in-chat widget, not a browser preview.

The snapshot is intentionally pinned: do not replace it with a newer-looking
`0.2.2` bundle. Semver build metadata does not establish capability precedence.
The main installer refuses to replace a staged native widget with a bundle that
lacks its entrypoint, manifest, registration, or session transport.
The updater also checks this before either its JavaScript installer or Python
fallback. That updater protection takes effect only in an application built
with this change; it cannot retroactively protect already-shipped updaters.

## Surface boundaries and remaining integration

The snapshot includes the native MCP workspace and its packaging sources,
inline/side-pane placement, local file transport, selection context, retained
document tabs, pointer reordering, and Apps SDK UI wrapper work. Its tests and
historical QA notes are preserved evidence, not fresh acceptance results.

The historical compatibility metadata still says `.4` while the manifest says
`.6`; the full historical agent suite therefore fails its version-alignment
assertion. The snapshot keeps that discrepancy intact for provenance. Resolve
it in a new development commit before presenting a refreshed bundle as a release.

Current `main` continues to own the latest desktop, Quick Look, and hosted
plugin implementation. The recovered source predates changes on `main`; do not
copy its entire desktop or renderer directories over current code. Native
widget integration into current application sources still requires focused
forward ports and cross-surface validation. This preservation change does not
claim that integration or OpenAI submission readiness is complete.

After reinstalling, check a visible molecular scene, inline/side-pane switching,
adding and reordering two documents, returning to an edited tab without losing
state, export, and reopening. Browser tests alone do not prove native host
mounting or persistence. Keep offline backups until this acceptance is complete.
