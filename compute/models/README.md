# Chemical-space representation models

`chemical_space_representations.py` is the strict Apple Metal/MPS worker for
learned molecular representations. It supports these pinned engines:

- DeepChem ChemBERTa-77M-MLM
- IBM MoLFormer-XL-both-10pct
- DP Technology Uni-Mol2-84M
- DP Technology Uni-Mol v1

The worker rejects execution when Apple MPS is unavailable and sets
`PYTORCH_ENABLE_MPS_FALLBACK=0`. Model inference and chunked cosine top-k run on
MPS. SMILES parsing and Uni-Mol conformer preparation remain CPU preprocessing.

The packaged desktop app installs a managed runtime on demand: the Chemical
Space panel offers "Install model runtime" when a learned engine is selected,
which drives `apps/desktop/src-tauri/src/commands/chemical_space_models.rs`
(uv venv + hash-locked `requirements.txt`, staged and promoted into
`~/Library/Application Support/Burette/model-python`). The worker script and
requirements are embedded in the binary via `include_str!`, so packaged builds
never read this directory. `BURETTE_CHEMICAL_SPACE_MODEL_PYTHON` overrides the
managed environment in both the desktop app and browser dev.

For browser development, create a dedicated environment and point the dev
server at it:

```bash
uv venv --python 3.12 .venv-chemical-space
uv pip install --no-deps --require-hashes --only-binary=:all: --no-cache --no-config --python .venv-chemical-space/bin/python -r compute/models/requirements-bootstrap.txt
uv pip sync --require-hashes --only-binary=:all: --no-binary=antlr4-python3-runtime --no-build-isolation --no-cache --no-config --default-index https://pypi.org/simple --python .venv-chemical-space/bin/python compute/models/requirements.txt
BURETTE_CHEMICAL_SPACE_MODEL_PYTHON="$PWD/.venv-chemical-space/bin/python" vp dev
```

Weights download on first explicit use into
`~/Library/Application Support/Burette/chemical-space-models`.

The direct requirements live in `requirements.in`; the generated lock resolves the
complete Python 3.12/macOS arm64 dependency set. Managed installations disable
ambient pip/uv configuration and extracted package caches before syncing the lock.
ANTLR 4.9.3 has no upstream wheel. Its hash-pinned source distribution is the sole
source exception; it builds without isolation/network dependency resolution using
hash-locked setuptools, wheel and packaging installed first. This preserves the
Hydra 1.3/OmegaConf 2.3 APIs instead of resolving obsolete wheel-only fallbacks.
Explicit interpreter overrides remain user-managed environments.

All three worker callers use `model_assets.py`. Its allowlist pins model revisions,
lengths and SHA-256 hashes for executable code, tokenizer/config files, dictionaries
and weights. The public upstream metadata supplies LFS hashes; small-file bytes are
also checked against the pinned Git blob identity when updating the manifest.
Only those files enter a fresh verified snapshot. Extra files are excluded;
corrupt caches are replaced only after a successful authenticated download; Transformers uses a fresh module cache and offline,
local-only loading. MoLFormer keeps its verified implementation because the pinned
Transformers version has no native implementation. Tokenizers never enable remote
code. Uni-Mol receives explicit verified model and dictionary paths, including its
preprocessing dictionary, so library mirror/latest downloads are not used.

PyTorch weights-only loading is forced; unsafe pickle fallback is not allowed.
This does not attest packages in user-supplied interpreters. Old managed installations are excluded from status and inference until the panel
installation flow adopts the current lock. Failed replacements preserve the old
directory, while explicit interpreters and development virtualenvs stay user-managed. Tests on Linux cover
integrity and loader boundaries; actual four-model MPS compatibility must be checked
on macOS before release.
