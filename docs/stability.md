# Stability Program

Burrete stability work should improve observability and runtime handoff safety
without changing renderer selection policy unless a task explicitly targets that
policy.

## Current Scope

The first stability layer is deliberately narrow:

- append `preview-trace.jsonl` for desktop preview opens and Quick Look preview
  requests
- include `preview-trace.jsonl` in exported diagnostics bundles
- write `manifest.json` into generated desktop and Quick Look runtime
  directories
- keep the desktop trace and runtime manifest schema in `burrete-core`
- run packaged build, install, forced Quick Look smoke, and perf report in the
  scheduled `nightly-smoke.yml` workflow
- make Quick Look smoke fail when a successful preview is missing its completed
  trace event or complete runtime manifest
- make Quick Look smoke fail with a specific launch-failure diagnostic when
  macOS refuses to start an ad-hoc signed app extension

These changes do not move renderer decisions. The current routing rules stay in
place: grid previews are considered before structure viewer runtimes where the
desktop path requires them, multi-frame trajectories use Mol*, `xyzrender`
falls back to Mol* when allowed, and cube defaults remain tied to the existing
xyzrender control path.

## Trace Contract

`preview-trace.jsonl` is a JSON Lines file. Each event has:

```json
{
  "schemaVersion": 1,
  "timestampMs": 0,
  "documentId": "stable-or-request-id",
  "state": "created|completed|failed",
  "subsystem": "desktop|quicklook",
  "sourceExtension": "pdb",
  "renderer": "molstar",
  "runtimePath": "...",
  "elapsedMs": 0,
  "errorCode": "BRT-PREVIEW-RUNTIME-ERROR",
  "message": "short sanitized message"
}
```

Trace events must not include raw molecule content, base64 payloads, or
structure text.

The Rust source of truth for trace state names, schema version, desktop error
code mapping, and the small lifecycle transition guard is `burrete-core`.
Quick Look mirrors the same contract in Swift because the extension does not
link the Rust crate.

## Runtime Manifest Contract

Generated runtime directories should contain `manifest.json` with:

- `schemaVersion`
- `createdAtMs`
- `complete`
- `documentId`
- `sourceExtension`
- `renderer`
- `byteCount`
- `previewByteCount`
- asset profile or host-specific runtime details

Write the manifest after generated runtime files are staged. Readers and
diagnostic tools should treat a missing or incomplete manifest as a
runtime-generation problem before investigating Mol*, RDKit, or `xyzrender`.

Quick Look smoke can only validate trace and manifest artifacts after the
extension process launches. If ExtensionKit or AMFI rejects an ad-hoc signed
extension before preview code runs, the smoke result must report that launch
failure directly and must not treat it as a renderer, fixture, or cache
problem.

## Order Of Work

1. Keep trace, diagnostics export, runtime manifests, and nightly smoke stable.
2. Add explicit fixture expectations only where existing tests hide the product
   contract inside Rust assertions.
3. Extend fixture coverage for trace/manifest outputs from packaged runtime
   smoke before changing renderer orchestration.
4. Expand the lifecycle state machine only around orchestration states that
   already exist in runtime code.
5. Move additional shared, platform-neutral contracts into `burrete-core` only
   after the desktop and Quick Look boundaries are documented and pinned by
   tests.

Do not make Quick Look depend on the desktop process. Do not change
`BurreteConfig`, `BurreteDataURL`, asset profiles, or renderer fallback behavior
as part of observability-only work.
