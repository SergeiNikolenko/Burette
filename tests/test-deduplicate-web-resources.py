import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "dedup", Path(__file__).resolve().parents[1] / "scripts/deduplicate-web-resources.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DeduplicateTests(unittest.TestCase):
    def test_paths_bytes_modes_and_copy_remain_usable(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp) / "Burette.app"
            roots = [app / relative for relative in (
                "Contents/Resources/ViewerWeb",
                "Contents/Resources/plugins/burette-agent/preview-web",
                "Contents/Resources/plugins/burette-agent/browser-shell-dist",
                "Contents/PlugIns/BurettePreview.appex/Contents/Resources/Web",
            )]
            payload = b"wasm-fixture" * 20000
            for root in roots:
                root.mkdir(parents=True)
                (root / "engine.wasm").write_bytes(payload)
                (root / "different.js").write_bytes(str(root).encode() * 2000)
            executable = roots[0] / "executable.js"
            executable.write_bytes(payload)
            executable.chmod(0o755)
            link = roots[1] / "alias.wasm"
            link.symlink_to("engine.wasm")
            before = {p: p.read_bytes() for r in roots for p in r.iterdir()}
            self.assertEqual(MODULE.deduplicate(app), (3, 3 * len(payload)))
            self.assertEqual({p: p.read_bytes() for p in before}, before)
            self.assertTrue(link.is_symlink())
            self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
            self.assertFalse(executable.samefile(roots[0] / "engine.wasm"))
            self.assertEqual(MODULE.deduplicate(app), (0, 0))
            if sys.platform == "darwin":
                copied = Path(tmp) / "Copied.app"
                subprocess.run(["ditto", str(app), str(copied)], check=True)
                copies = [copied / (r / "engine.wasm").relative_to(app) for r in roots]
                self.assertTrue(all(p.samefile(copies[0]) for p in copies))
                self.assertEqual(copies[-1].read_bytes(), payload)

    def test_missing_roots_fail_before_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "web resource root"):
                MODULE.deduplicate(Path(tmp))


if __name__ == "__main__":
    unittest.main()
