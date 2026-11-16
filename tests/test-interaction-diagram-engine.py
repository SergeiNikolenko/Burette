"""Run the interaction diagram engine on a local complex without network access.

Run with the Python of the xyzrender runtime the app bundles (gemmi, RDKit and
SciPy); native CI runs it with the interpreter inside the built app.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "apps/desktop/src-tauri/src/commands/interaction_diagram_runner.py"
FIXTURES = ROOT / "tests/fixtures/interaction-diagram"
POCKET = FIXTURES / "2hyy-imatinib-pocket.pdb"
SCHRODINGER = {"partners": "disc", "context": "cutoff", "waters": True, "hydrophobic": "none", "orientation": "portrait"}


class InteractionDiagramEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The imatinib entry of the Chemical Component Dictionary is already
        # cached, so the engine never goes to the network.
        cls.components = tempfile.mkdtemp()
        shutil.copy(FIXTURES / "STI.cif", cls.components)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.components)

    def run_engine(self, **request):
        completed = subprocess.run(
            [sys.executable, str(RUNNER)],
            input=json.dumps({"path": str(POCKET), "ccdCache": self.components, **request}),
            capture_output=True, text=True, check=True, timeout=300,
        )
        return json.loads(completed.stdout.strip().splitlines()[-1])

    def test_imatinib_pocket_contacts(self):
        result = self.run_engine(ligand=None, rules=SCHRODINGER)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual([ligand["id"] for ligand in result["ligands"]], ["STI_A_600"])
        diagram = result["diagram"]
        self.assertEqual(diagram["ligand"]["id"], "STI_A_600")
        contacts = {(c["kind"], c["residueKey"][2], c["residueKey"][1]) for c in diagram["contacts"]}
        # Imatinib's hydrogen bonds to the hinge, the gatekeeper, the αC glutamate
        # and the DFG aspartate, and the stacking on the P-loop tyrosine.
        self.assertLessEqual({
            ("hbond", "MET", 318), ("hbond", "THR", 315), ("hbond", "GLU", 286),
            ("hbond", "ASP", 381), ("hbond", "ILE", 360), ("pi", "TYR", 253),
        }, contacts)
        self.assertEqual(len(diagram["scene"]["scene"]["structures"][0]["atoms"]), 37)

    def test_rejects_unknown_rules_and_ligands(self):
        self.assertEqual(self.run_engine(ligand=None, rules={"partners": "bogus"}),
                         {"ok": False, "error": "Invalid diagram rule partners='bogus'"})
        self.assertEqual(self.run_engine(ligand="GDP_A_1", rules=SCHRODINGER),
                         {"ok": False, "error": "ligand GDP_A_1 not found"})


if __name__ == "__main__":
    unittest.main()
