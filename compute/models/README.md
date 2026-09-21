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
(uv venv + pinned `requirements.txt`, staged and promoted into
`~/Library/Application Support/Burette/model-python`). The worker script and
requirements are embedded in the binary via `include_str!`, so packaged builds
never read this directory. `BURETTE_CHEMICAL_SPACE_MODEL_PYTHON` overrides the
managed environment in both the desktop app and browser dev.

For browser development, create a dedicated environment and point the dev
server at it:

```bash
uv venv --python 3.12 .venv-chemical-space
uv pip install --python .venv-chemical-space/bin/python -r compute/models/requirements.txt
BURETTE_CHEMICAL_SPACE_MODEL_PYTHON="$PWD/.venv-chemical-space/bin/python" vp dev
```

Weights download on first explicit use into
`~/Library/Application Support/Burette/chemical-space-models`.
