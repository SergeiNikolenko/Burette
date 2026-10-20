"""Authenticated model snapshots. Hashes pin executable code, config and weights."""

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import tempfile
import time
import urllib.parse
import urllib.request


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("Model asset redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def copy_verified(source, destination, size, digest, *, deadline=None):
    hasher = hashlib.sha256()
    copied = 0
    read = getattr(source, "read1", source.read)
    while True:
        if deadline is not None and time.monotonic() > deadline:
            raise TimeoutError("Model asset download deadline exceeded")
        chunk = read(min(1024 * 1024, size - copied + 1))
        if not chunk:
            break
        copied += len(chunk)
        if copied > size:
            raise ValueError("Model asset exceeds its pinned length")
        hasher.update(chunk)
        destination.write(chunk)
    if copied != size or hasher.hexdigest() != digest:
        raise ValueError("Model asset checksum or length mismatch")


@contextmanager
def verified_snapshot(engine):
    """Never execute code or deserialize weights from the shared download cache."""
    assets = ASSETS[engine]
    root = Path(os.environ.get("HF_HOME", Path.cwd())) / "burette-verified"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="snapshot-", dir=root) as name:
        snapshot = Path(name)
        for relative, url, size, digest in assets:
            target = snapshot / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            cached = root / (digest + ".blob")
            # Hash the bytes copied into this process's private snapshot. Repair a
            # missing/corrupt cache once; publish only a fully verified download.
            try:
                with cached.open("rb") as source, target.open("xb") as output:
                    copy_verified(source, output, size, digest)
                continue
            except (OSError, ValueError):
                target.unlink(missing_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix="download-", dir=root)
            try:
                opener = urllib.request.build_opener(HTTPSRedirect())
                with os.fdopen(descriptor, "wb") as output, opener.open(url, timeout=30) as response:
                    copy_verified(response, output, size, digest,
                                  deadline=time.monotonic() + 15 * 60)
                os.replace(temporary, cached)
                # Another process may replace the cache after publication. Verify
                # this copy too instead of trusting the shared pathname.
                with cached.open("rb") as source, target.open("xb") as output:
                    copy_verified(source, output, size, digest)
            finally:
                Path(temporary).unlink(missing_ok=True)
        isolated = {
            "HF_MODULES_CACHE": str(snapshot / "_modules"),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "TORCH_FORCE_WEIGHTS_ONLY_LOAD": "1",
            "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": None,
        }
        previous = {key: os.environ.get(key) for key in isolated}
        try:
            for key, value in isolated.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            yield snapshot
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

ASSETS = {'chemberta': [('added_tokens.json',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/added_tokens.json',
                25,
                '2b0e66b84bd97bc08467f7a7c033cfd5a66c6335eb79779a144b50f8e7b2557d'),
               ('config.json',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/config.json',
                631,
                'b9ec477f76a173461741cb0f339b89661c9d9249af2f6a84df7593c3baede9b0'),
               ('merges.txt',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/merges.txt',
                52,
                '291976363a8a20ed148ff687cf3da54ada8ddbc99655fa876326f0ef28dbd6ad'),
               ('pytorch_model.bin',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/pytorch_model.bin',
                13734116,
                '95571af26b61ba8d56b9d61ff108b5c9afe96fd69ea3cbd1901d9421e3d2dd6d'),
               ('special_tokens_map.json',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/special_tokens_map.json',
                420,
                '23dbc119b7e11cb23d3c43b13004c5a4ab4e6530c7146e34fa1f9564856b5580'),
               ('tokenizer.json',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/tokenizer.json',
                8262,
                '1197005224bc8917f46f8d6fc360aec71c6626858966e167b2ff8af62214f814'),
               ('tokenizer_config.json',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/tokenizer_config.json',
                1271,
                '79919cd4b54bdf241f19956753e8a47b8b782eb4b38eec0e0254bd2434545abd'),
               ('vocab.json',
                'https://huggingface.co/DeepChem/ChemBERTa-77M-MLM/resolve/ed8a5374f2024ec8da53760af91a33fb8f6a15ff/vocab.json',
                6963,
                '0c9afbd534ab59fa51718c998027da0e7932293c9a51de03317d4c83d3fe48f6')],
 'molformer': [('config.json',
                'https://huggingface.co/ibm-research/MoLFormer-XL-both-10pct/resolve/361063d0ad524ef77cf39b08469f6be770dc550f/config.json',
                1015,
                '3ef9eaac8c7ca6282fd6256ed038d151bd4ff42a4ff855367e0d7197bbc1c284'),
               ('configuration_molformer.py',
                'https://huggingface.co/ibm-research/MoLFormer-XL-both-10pct/resolve/361063d0ad524ef77cf39b08469f6be770dc550f/configuration_molformer.py',
                7101,
                'b88ea8d4b7b5e54f4f186cc7a230eff308928020a030f153a038fd12c05e3bed'),
               ('modeling_molformer.py',
                'https://huggingface.co/ibm-research/MoLFormer-XL-both-10pct/resolve/361063d0ad524ef77cf39b08469f6be770dc550f/modeling_molformer.py',
                36884,
                '6f1ef72022de2c69e95661899422a7bb39a40a2cc5a6cb6216f14e9b7d84559c'),
               ('model.safetensors',
                'https://huggingface.co/ibm-research/MoLFormer-XL-both-10pct/resolve/361063d0ad524ef77cf39b08469f6be770dc550f/model.safetensors',
                187248784,
                '0795977fe7192c4acdaf052f0e8464af57bc4bb59211271c5e61aaba2637b9c6'),
               ('tokenizer.json',
                'https://huggingface.co/ibm-research/MoLFormer-XL-both-10pct/resolve/361063d0ad524ef77cf39b08469f6be770dc550f/tokenizer.json',
                54010,
                '3df1f2219653c44fac9fa03b7f788b372eb2544ecc176737bb9aca8411b471a5'),
               ('tokenizer_config.json',
                'https://huggingface.co/ibm-research/MoLFormer-XL-both-10pct/resolve/361063d0ad524ef77cf39b08469f6be770dc550f/tokenizer_config.json',
                1132,
                '56f93dc43e4383fcfc6342e09d782ef38d48ef227215a4a92ff8762fd5b8ff3e')],
 'unimol-v1': [('mol_pre_all_h_220816.pt',
                'https://huggingface.co/dptech/Uni-Mol-Models/resolve/9f19c45c718192888a1c8a1c905f69f0755ea502/mol_pre_all_h_220816.pt',
                190540187,
                '7f5f14bb28bf479a0b8f38ebab4bb9d7ae867383f14c4d694d056500fa3446a7'),
               ('mol.dict.txt',
                'https://huggingface.co/dptech/Uni-Mol-Models/resolve/9f19c45c718192888a1c8a1c905f69f0755ea502/mol.dict.txt',
                91,
                '94135cb9a9198f988de684cb61e2c372882a3bd59b8320effbae704c38057127')],
 'unimol2-84m': [('modelzoo/84M/checkpoint.pt',
                  'https://huggingface.co/dptech/Uni-Mol2/resolve/bf37d253c0f5ac61f468137eb00059978a104ff0/modelzoo/84M/checkpoint.pt',
                  336632021,
                  '5b9241630f1cf0b173fb06d1e76096e5daf5f91c3e51b066ba69524dafe60e35'),
                 ('mol.dict.txt',
                  'https://huggingface.co/dptech/Uni-Mol-Models/resolve/9f19c45c718192888a1c8a1c905f69f0755ea502/mol.dict.txt',
                  91,
                  '94135cb9a9198f988de684cb61e2c372882a3bd59b8320effbae704c38057127')]}
