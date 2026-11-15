# Standalone symmetry WebAssembly assets

| Asset | Pinned upstream | License |
| --- | --- | --- |
| `burette-msym.wasm` | [libmsym](https://github.com/mcodev31/libmsym), `85e47232376a8e735c2a7b5283f40b59b3953db1` | MIT, `LIBMSYM_LICENSE.txt` |
| `burette-niggli.wasm` | [spglib](https://github.com/spglib/spglib), v2.8.0 `3ebd8ac3318793932baeee90b44f453a7c35b5b4`, `src/niggli.c` only | BSD-3-Clause, `SPGLIB_LICENSE.txt` |

`build-wasm.sh` exports these exact upstream commits and checks every compiled
upstream source and license against `sources.sha256`. The local adapters are
`burette_msym.c`, `burette_niggli.c` and `msym_EXPORTS.h`. The build requires
Emscripten 6.0.13, uses standalone WebAssembly without generated JavaScript glue,
and records the two distributed outputs in `outputs.sha256`. Memory may grow
up to 256 MiB per module. The TypeScript loader supplies their WASI imports.

The local libmsym adapter also attributes its numerical tolerance presets to
Avogadro (BSD-3-Clause). `avogadro-presets-reference.json` records the cached
reference tree/file identities and the exact retained `AVOGADRO_LICENSE.txt`.
Only that license's content identity was verified offline; the reference source
payload was not retained, so numerical preset equality to that reference is not
asserted. `sources.sha256` describes the compiled libmsym/spglib sources, not a
complete Avogadro preset-parity audit.

The libmsym adapter retains input atom indices and copies results before
releasing its context. The spglib adapter exposes only `niggli_reduce`, with
lattice vectors as matrix columns. Typed scientific validation, worker lifetimes
and user interfaces are separate owners from this asset/loader boundary.

To rebuild with an existing toolchain:

```bash
compute/symmetry-wasm/build-wasm.sh
```

`BURETTE_LIBMSYM_SOURCE` and `BURETTE_SPGLIB_SOURCE` may point at existing Git
clones. The script still exports and checks the pinned revisions. Tests use the
retained assets; they never fetch sources or rebuild them:

```bash
vp exec bun test tests/test-symmetry-wasm-assets.test.ts
vp exec bun test tests/test-symmetry-wasm-loader.test.ts
```

The PreviewExtension vendor registry enumerates its own runtime profiles and
does not manage these desktop source assets. Their paired distribution hashes
are `outputs.sha256`; changing an asset requires its build inputs and record to
remain in sync. Asset or loader validation does not establish browser, packaged
macOS, Finder Quick Look or iPhone symmetry workflow acceptance.
