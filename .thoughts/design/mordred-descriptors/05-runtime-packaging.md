# Runtime And Packaging

## Runtime Choice

Prefer `uv` for the first implementation. Burrete already bundles a Python
runtime for `xyzrender` using a uv-shaped environment, and the build scripts
already know how to copy and sign Python binaries and native libraries.

`pixi` remains a fallback option if uv cannot produce a reliable RDKit plus
Mordred environment for macOS distribution. It should not be introduced as the
primary path until the existing uv runtime pattern is proven insufficient.

## Development Runtime

Development can use a managed descriptor runtime under application support or a
known uv tool/runtime path. The UI should expose runtime status and a
user-initiated install action.

The app should not silently install Python packages during file open or preview.

## Release Runtime

Release builds should eventually bundle a descriptor runtime analogous to the
existing `xyzrender-runtime` approach:

- bundled Python interpreter,
- RDKit,
- `mordredcommunity`,
- descriptor runner script,
- signed native extensions and libraries,
- smoke check during install/build.

The runtime must not depend on the user's global Python, Conda, or PATH in a
release bundle.

## Runner Process

The descriptor runner should be invoked by Rust with:

- explicit executable path,
- explicit working directory,
- sanitized environment,
- `PYTHONNOUSERSITE=1`,
- bounded input files,
- timeout,
- cancellation support.

Avoid shell commands with molecule strings embedded in arguments.

## 3D Descriptor Policy

The first version should compute 2D descriptors only:

- `ignore_3D=True` in Mordred,
- no conformer generation,
- no dependence on source 3D coordinates,
- no mixed 2D/3D descriptor table semantics.

3D descriptors can be added later behind an explicit mode and clear coordinate
quality rules.
