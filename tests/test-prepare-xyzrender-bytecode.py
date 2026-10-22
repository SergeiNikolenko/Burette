import importlib.util
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

compile_imports = runpy.run_path(str(Path(__file__).resolve().parents[1]
                                   / "scripts/prepare-xyzrender-bytecode.py"))["compile_imported_modules"]


class BytecodeTest(unittest.TestCase):
    def test_relocation_invalidation_and_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / "original/Contents/Resources"
            package = resources / "xyzrender-runtime/lib/site-packages"
            package.mkdir(parents=True)
            source = package / "fixture.py"
            source.write_text("VALUE = 1\n")
            outside = root / "outside.py"
            outside.write_text("VALUE = 9\n")
            unused = package / "unused.py"
            unused.write_text("VALUE = 0\n")
            link = package / "external.py"
            link.symlink_to(outside)
            result = compile_imports(resources, [SimpleNamespace(__file__=str(path))
                                                for path in (source, source, outside, link)])
            self.assertEqual(result["modules"], 1)
            cache = Path(importlib.util.cache_from_source(str(source)))
            self.assertTrue(cache.exists())
            self.assertFalse(Path(importlib.util.cache_from_source(str(unused))).exists())
            self.assertFalse(Path(importlib.util.cache_from_source(str(outside))).exists())

            moved = root / "relocated.app/Contents/Resources"
            shutil.copytree(resources, moved, symlinks=True)
            package = moved / package.relative_to(resources)
            source = package / "fixture.py"
            cache = Path(importlib.util.cache_from_source(str(source)))
            cached_bytes = cache.read_bytes()
            command = [sys.executable, "-B", "-c", "import fixture; print(fixture.VALUE)"]
            env = {**os.environ, "PYTHONPATH": str(package), "PYTHONNOUSERSITE": "1"}
            self.assertEqual(subprocess.check_output(command, env=env, text=True).strip(), "1")
            stat = source.stat()
            source.write_text("VALUE = 2\n")
            os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns))
            self.assertEqual(subprocess.check_output(command, env=env, text=True).strip(), "2")
            self.assertEqual(cache.read_bytes(), cached_bytes, "runtime imports must not modify signed caches")


if __name__ == "__main__":
    unittest.main()
