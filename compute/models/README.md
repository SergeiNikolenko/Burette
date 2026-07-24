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

For browser development, create a dedicated environment and point the dev
server at it:

```bash
uv venv --python 3.12 .venv-chemical-space
uv pip install --python .venv-chemical-space/bin/python -r compute/models/requirements.txt
BURRETE_CHEMICAL_SPACE_MODEL_PYTHON="$PWD/.venv-chemical-space/bin/python" vp dev
```

Weights download on first explicit use into
`~/Library/Application Support/Burrete/chemical-space-models`.
