#!/usr/bin/env python3
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

MODELS = Path(__file__).resolve().parents[1] / "compute/models"
sys.path.insert(0, str(MODELS))
import model_assets as assets
import chemical_space_representations as worker


class ModelAssetsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        environment = patch.dict(os.environ, {"HF_HOME": str(self.root)})
        environment.start()
        self.addCleanup(environment.stop)
        self.content = b"reviewed model fixture"
        self.digest = hashlib.sha256(self.content).hexdigest()
        manifest = patch.dict(assets.ASSETS, {
            "fixture": [("config.json", "https://huggingface.co/model/resolve/pin/config.json",
                         len(self.content), self.digest)]})
        manifest.start()
        self.addCleanup(manifest.stop)

    def download(self, content):
        return patch.object(assets.urllib.request, "build_opener", return_value=SimpleNamespace(
            open=lambda *a, **kw: io.BytesIO(content)))

    def test_verified_download_copy_and_isolated_offline_execution(self):
        with self.download(self.content), patch.dict(os.environ, {
            "HF_MODULES_CACHE": "untrusted-module-cache", "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": "1"}):
            with assets.verified_snapshot("fixture") as snapshot:
                self.assertEqual((snapshot / "config.json").read_bytes(), self.content)
                self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
                self.assertEqual(os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"], "1")
                self.assertNotIn("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", os.environ)
                self.assertEqual(Path(os.environ["HF_MODULES_CACHE"]).parent, snapshot)
                # Mutating the shared cache cannot alter the already-verified copy.
                cached = self.root / "burette-verified" / (self.digest + ".blob")
                cached.write_bytes(b"malicious replacement")
                self.assertEqual((snapshot / "config.json").read_bytes(), self.content)
            self.assertFalse(snapshot.exists())
            self.assertEqual(os.environ["HF_MODULES_CACHE"], "untrusted-module-cache")

    def test_tampered_short_and_oversized_downloads_never_yield_snapshot(self):
        for value in [b"wrong".ljust(len(self.content), b"x"), b"short", self.content + b"extra"]:
            with self.subTest(value=value), self.download(value):
                with self.assertRaises(ValueError):
                    with assets.verified_snapshot("fixture"):
                        self.fail("unverified bytes reached loader")
            self.assertEqual(list((self.root / "burette-verified").iterdir()), [])

    def test_corrupt_existing_cache_recovers_and_extra_python_is_not_loaded(self):
        with self.download(self.content):
            with assets.verified_snapshot("fixture"):
                pass
        root = self.root / "burette-verified"
        (root / "evil.py").write_text("raise RuntimeError('must not execute')")
        with patch.object(assets.urllib.request, "build_opener") as download:
            with assets.verified_snapshot("fixture") as snapshot:
                self.assertEqual([p.name for p in snapshot.iterdir()], ["config.json"])
            download.assert_not_called()
        cached = root / (self.digest + ".blob")
        cached.write_bytes(b"corrupted")
        with self.download(self.content) as download:
            with assets.verified_snapshot("fixture") as snapshot:
                self.assertEqual((snapshot / "config.json").read_bytes(), self.content)
            download.assert_called_once()
        self.assertEqual(cached.read_bytes(), self.content)

    def test_repeated_bad_repairs_never_load_or_publish(self):
        root = self.root / "burette-verified"
        root.mkdir()
        cached = root / (self.digest + ".blob")
        cached.write_bytes(b"corrupted")
        for _ in range(2):
            with self.download(b"also corrupt") as download, self.assertRaises(ValueError):
                with assets.verified_snapshot("fixture"):
                    self.fail("bad repair reached loader")
            download.assert_called_once()
            self.assertEqual(cached.read_bytes(), b"corrupted")
            self.assertEqual(list(root.iterdir()), [cached])

    def test_replacement_after_download_is_verified_before_loading(self):
        replace = os.replace
        def race(source, destination):
            replace(source, destination)
            Path(destination).write_bytes(b"concurrent corruption")
        with self.download(self.content), patch.object(assets.os, "replace", side_effect=race):
            with self.assertRaises(ValueError):
                with assets.verified_snapshot("fixture"):
                    self.fail("concurrent replacement reached loader")
        with self.download(self.content):
            with assets.verified_snapshot("fixture") as snapshot:
                self.assertEqual((snapshot / "config.json").read_bytes(), self.content)

    def test_http_redirect_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            assets.HTTPSRedirect().redirect_request(None, None, 302, "", {}, "http://example.org/file")

    def test_molformer_loader_uses_local_authenticated_snapshot_and_safe_weights(self):
        class Loaded(Exception):
            pass
        calls = []
        def model(path, **kwargs):
            calls.append((path, kwargs))
            raise Loaded()
        fake = SimpleNamespace(
            AutoModel=SimpleNamespace(from_pretrained=model),
            AutoTokenizer=SimpleNamespace(from_pretrained=lambda path, **kwargs: calls.append((path, kwargs))))
        torch = SimpleNamespace(nn=SimpleNamespace(functional=SimpleNamespace()))
        with patch.dict(sys.modules, {"torch": torch, "torch.nn": torch.nn,
                "torch.nn.functional": torch.nn.functional, "transformers": fake}):
            with self.assertRaises(Loaded):
                worker.transformer_embeddings("molformer", ["CCO", "CCC"], "mps", self.root)
        self.assertEqual(calls[0], (self.root, {"local_files_only": True, "trust_remote_code": False}))
        self.assertEqual(calls[1], (self.root, {"local_files_only": True, "trust_remote_code": True,
                         "weights_only": True, "use_safetensors": True, "deterministic_eval": True}))

    def test_all_engines_authenticate_before_model_execution(self):
        for engine in worker.MODEL_SPECS:
            with self.subTest(engine=engine), patch.object(worker, "normalize_records", return_value=(
                    [worker.ValidRecord(0, "CCO"), worker.ValidRecord(1, "CCC")], 0)), \
                    patch.object(worker, "require_mps", return_value="mps"), \
                    patch.object(worker, "verified_snapshot", side_effect=ValueError("tampered")), \
                    patch.object(worker, "transformer_embeddings") as transformer, \
                    patch.object(worker, "unimol_embeddings") as unimol:
                with self.assertRaisesRegex(ValueError, "tampered"):
                    worker.represent({"engine": engine, "neighbors": 1, "records": []})
                transformer.assert_not_called()
                unimol.assert_not_called()


if __name__ == "__main__":
    unittest.main()
