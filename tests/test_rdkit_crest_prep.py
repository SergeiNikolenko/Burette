"""Run with an RDKit-enabled Python; exercises the external CREST prep CLI."""

import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from rdkit import Chem
from rdkit.Chem import AllChem

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rdkit_crest_prep.py"


class CrestPrepTests(unittest.TestCase):
    def run_prep(self, source, suffix=".sdf"):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        input_path = directory / f"input{suffix}"
        output_path = directory / "prepared.sdf"
        input_path.write_text(source)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(input_path), str(output_path)],
            capture_output=True, text=True, timeout=30,
        )
        return result, output_path

    def test_preserves_charge_stereo_and_fragments_with_explicit_3d_hydrogens(self):
        for smiles in ("C[C@@H](O)C(=O)O", "C[NH2+]CC", "[Na+].O=C([O-])[C@H](N)C", "C[N+](=O)[O-]"):
            with self.subTest(smiles=smiles):
                original = Chem.MolFromSmiles(smiles)
                AllChem.Compute2DCoords(original)
                result, output = self.run_prep(Chem.MolToMolBlock(original) + "\n$$$$\n")
                self.assertEqual(result.returncode, 0, result.stderr)
                prepared = Chem.SDMolSupplier(str(output), removeHs=False)[0]
                self.assertIsNotNone(prepared)
                self.assertEqual(Chem.GetFormalCharge(prepared), Chem.GetFormalCharge(original))
                self.assertEqual(Chem.MolToSmiles(Chem.RemoveHs(prepared)), Chem.MolToSmiles(original))
                self.assertGreater(prepared.GetNumAtoms(), original.GetNumAtoms())
                self.assertTrue(prepared.GetConformer().Is3D())
                self.assertTrue(all(math.isfinite(value) for row in prepared.GetConformer().GetPositions() for value in row))

    def test_mol_input(self):
        original = Chem.MolFromSmiles("CCO")
        result, output = self.run_prep(Chem.MolToMolBlock(original), ".mol")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Chem.MolToSmiles(Chem.SDMolSupplier(str(output))[0]), "CCO")

    def test_invalid_valence_is_not_repaired_or_replaced_by_next_record(self):
        invalid = Chem.MolFromSmiles("C(C)(C)(C)(C)C", sanitize=False)
        valid = Chem.MolFromSmiles("CCO")
        source = Chem.MolToMolBlock(invalid) + "\n$$$$\n" + Chem.MolToMolBlock(valid) + "\n$$$$\n"
        result, output = self.run_prep(source)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not parse input molecule", result.stderr)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
