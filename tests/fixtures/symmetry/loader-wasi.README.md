# WASI loader fixture

`loader-wasi.wat` calls each loader-supplied import from `_initialize`, writes
known bytes to stdout/stderr, and exposes a later diagnostic write. It is not a
scientific engine. Generate its retained 467-byte binary with Binaryen 133:

```bash
wasm-as tests/fixtures/symmetry/loader-wasi.wat -o tests/fixtures/symmetry/loader-wasi.wasm
```

Tests read the retained binary without running an assembler or accessing the
external network. `loader-init-error.wat` and `loader-link-error.wat` are small
negative fixtures for initialization traps and missing imports; assemble each
with the same command and matching filename. Actual libmsym/spglib binaries are
exercised separately by the same
loader suite, including nonzero ArrayBufferView offsets and lengths.
