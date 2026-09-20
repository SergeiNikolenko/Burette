"""Run with the xyzrender environment's Python (requires packaging)."""
import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "prune_runtime", Path(__file__).resolve().parents[1] / "scripts/prune-xyzrender-runtime.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PruneRuntimeTests(unittest.TestCase):
    def stage(self, base, framework=False):
        runtime, python = base / "runtime", base / "python"
        site = runtime / "lib/python3.14/site-packages"
        site.mkdir(parents=True)
        stdlib = python / ("Frameworks/Python.framework/Versions/3.14/lib/python3.14" if framework else "lib/python3.14")
        for name in ("test", "idlelib", "ensurepip", "lib-dynload"):
            (stdlib / name).mkdir(parents=True)
            (stdlib / name / "keep-or-remove").write_text("fixture")
        (stdlib / "site-packages/pip").mkdir(parents=True)
        (stdlib / "site-packages/pip/__init__.py").write_text("fixture")
        (stdlib / "site-packages/pip-1.0.dist-info").mkdir()
        return runtime, python, site, stdlib

    def distribution(self, site, name, requires=(), resources=()):
        metadata = site / f"{name}-1.0.dist-info"
        metadata.mkdir()
        (metadata / "METADATA").write_text(
            f"Name: {name}\nVersion: 1.0\n" + "".join(f"Requires-Dist: {req}\n" for req in requires)
        )
        paths = [f"{name}.py", *resources, f"{metadata.name}/METADATA", f"{metadata.name}/RECORD"]
        for item in paths[:1 + len(resources)]:
            path = site / item
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture")
        with (metadata / "RECORD").open("w", newline="") as stream:
            csv.writer(stream).writerows((item, "", "") for item in paths)

    def test_dependency_closure_and_both_python_layouts(self):
        for framework in (False, True):
            with self.subTest(framework=framework), tempfile.TemporaryDirectory() as tmp:
                runtime, python, site, stdlib = self.stage(Path(tmp), framework)
                self.distribution(site, "xyzrender", ("ipykernel", "cclib", "networkx", 'formatreader; extra == "all"'))
                self.distribution(site, "rdkit", ("numpy",), (
                    "rdkit_data/forcefield.h",
                    "rdkit_data/tests/template.c",
                    "rdkit/Contrib/SA_Score/fpscores.pkl.gz",
                ))
                self.distribution(site, "formatreader", ("shared[formats]",))
                self.distribution(site, "shared", ('decoder; extra == "formats"',))
                self.distribution(site, "decoder")
                self.distribution(site, "cclib", ("scipy",))
                self.distribution(site, "networkx", ("decorator",))
                self.distribution(site, "decorator")
                self.distribution(site, "scipy", ("numpy",))
                self.distribution(site, "numpy")
                self.distribution(site, "datamol", ("rdkit", "scipy", "pandas"))
                self.distribution(site, "pandas")
                cache = site / "datamol/__pycache__"
                cache.mkdir(parents=True)
                (cache / "unrecorded.pyc").write_bytes(b"cache")
                self.distribution(site, "ipykernel", ("debugpy",))
                self.distribution(site, "debugpy")
                # A wheel RECORD must not be able to delete an external path.
                outside = Path(tmp) / "outside"
                outside.write_text("safe")
                record = site / "debugpy-1.0.dist-info/RECORD"
                with record.open("a") as stream:
                    stream.write(f"{outside},,\n")
                MODULE.prune(runtime, python)
                expected = {"xyzrender", "rdkit", "formatreader", "shared", "decoder", "cclib", "networkx", "decorator", "scipy", "numpy"}
                self.assertEqual({p.stem for p in site.glob("*.py")}, expected)
                self.assertFalse((site / "datamol").exists())
                self.assertTrue((site / "rdkit_data/forcefield.h").exists())
                self.assertTrue((site / "rdkit_data/tests/template.c").exists())
                self.assertTrue((site / "rdkit/Contrib/SA_Score/fpscores.pkl.gz").exists())
                self.assertFalse((stdlib / "site-packages/pip").exists())
                self.assertFalse((stdlib / "site-packages/pip-1.0.dist-info").exists())
                self.assertEqual({p.name for p in stdlib.iterdir()}, {"lib-dynload", "site-packages"})
                self.assertEqual(outside.read_text(), "safe")

    def test_missing_dependency_fails_before_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime, python, site, _ = self.stage(Path(tmp))
            self.distribution(site, "xyzrender", ("missing",))
            self.distribution(site, "rdkit")
            self.distribution(site, "datamol")
            with self.assertRaisesRegex(ValueError, "Missing required runtime distribution"):
                MODULE.prune(runtime, python)
            self.assertTrue((site / "datamol.py").exists())


if __name__ == "__main__":
    unittest.main()
