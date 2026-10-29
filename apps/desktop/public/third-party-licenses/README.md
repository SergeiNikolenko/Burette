# Third-party licenses

These files accompany the browser optimizer and compression worker in Burette.
The desktop app also includes this directory as the `third-party-licenses`
resource. Vite copies the same directory into desktop, agent-shell and hosted
shell builds.

| Component | License and notice files |
| --- | --- |
| Avogadro FIRE2 / ABC-FIRE adaptation, revision f5aea255b15d24f658a18d258e56357fa2719646 | avogadro-LICENSE |
| fflate 0.8.3 | fflate-LICENSE |
| xz-decompress 0.2.3 / xzwasm | xz-decompress-NOTICE |
| walloc, revision a93409f5ebd49c875514c5fee30d3b151f7b0882, included in xz-decompress | walloc-LICENSE.md |
| node-liblzma 5.1.3 | node-liblzma-NOTICE, node-liblzma-LICENSE, GPL-3.0.txt |
| liblzma 5.8.4, included in node-liblzma WebAssembly | liblzma-COPYING.0BSD |
| @hpcc-js/wasm-zstd 1.17.0 | hpcc-wasm-zstd-LICENSE |
| Zstandard 1.5.7, included in @hpcc-js/wasm-zstd | zstd-LICENSE |
| fzstd 0.1.1, included in @hpcc-js/wasm-zstd | fzstd-LICENSE |

XZ Embedded by Lasse Collin and Igor Pavlov is in the public domain and is
included in xz-decompress; its attribution is in xz-decompress-NOTICE.

node-liblzma uses its WebAssembly entry without local package modifications.
The unmodified package source is available at
<https://github.com/oorabona/node-liblzma/tree/v5.1.3>.
liblzma is from <https://github.com/tukaani-project/xz/tree/v5.8.4>;
Copyright (C) The XZ Utils authors and contributors.
