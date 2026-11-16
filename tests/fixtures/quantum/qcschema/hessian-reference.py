"""Independent Hessian and harmonic frequencies for Burette's QCSchema Hessian reader.

PySCF (Apache-2.0) recomputes the analytic RHF/cc-pVDZ Hessian of the molecule in a QCSchema
AtomicResult written by Psi4 1.11 through QCEngine 0.52, and runs its own harmonic analysis with
the masses stored in the molecule. Psi4 used density fitting, so the two producers agree to the
fitting error, not to print precision. Usage (PySCF 2.14):

    python hessian-reference.py water-hf-hessian.json > hessian-reference.json
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from pyscf import gto, scf
from pyscf.hessian import thermo


def reference(path):
    data = json.loads(path.read_text())
    molecule = data["molecule"]
    geometry = np.array(molecule["geometry"]).reshape(-1, 3)
    mol = gto.M(atom=list(zip(molecule["symbols"], map(tuple, geometry))), unit="Bohr", basis=data["model"]["basis"], verbose=0)
    mf = scf.RHF(mol).run(conv_tol=1e-12)
    hessian = mf.Hessian().kernel()  # (atom, atom, 3, 3) Hartree/bohr^2
    square = hessian.transpose(0, 2, 1, 3).reshape(3 * mol.natm, 3 * mol.natm)
    analysis = thermo.harmonic_analysis(mol, hessian, mass=np.array(molecule["masses"]))
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "energyHartree": float(mf.e_tot),
        "hessian": square.ravel().tolist(),
        "frequenciesCm1": np.sort(analysis["freq_wavenumber"].real).tolist(),
    }


if __name__ == "__main__":
    print(json.dumps({Path(name).name: reference(Path(name)) for name in sys.argv[1:]}, indent=1, sort_keys=True))
