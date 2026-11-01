"""Generate Burette's QCSchema producer fixtures with QCEngine 0.52, Psi4 1.11 and optking 0.5.

    OMP_NUM_THREADS=2 python generate.py

Writes the AtomicResult/OptimizationResult JSON files beside this script, unchanged except for
dropping `stdout` and `provenance` routing noise (host names, scratch paths and timings).
"""
import json
from pathlib import Path

import qcengine
from qcelemental.models import AtomicInput, Molecule, OptimizationInput

HERE = Path(__file__).parent
WATER = Molecule(symbols=["O", "H", "H"], geometry=[0.0, 0.0, -0.1294, 0.0, -1.4941, 1.0274, 0.0, 1.4941, 1.0274], fix_com=True, fix_orientation=True)
HYDROXYL = Molecule(symbols=["O", "H"], geometry=[0.0, 0.0, 0.0, 0.0, 0.0, 1.8324], molecular_multiplicity=2, fix_com=True, fix_orientation=True)
CONFIG = {"ncores": 2, "memory": 2}


def write(name, result):
    data = json.loads(result.json())
    data.pop("stdout", None)
    for item in [data, *data.get("trajectory", [])]:
        item.pop("stdout", None)
        item.pop("provenance", None)
    (HERE / name).write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(name, data.get("success"))


def atomic(name, molecule, driver, method, basis, keywords=None, protocols=None):
    task = AtomicInput(molecule=molecule, driver=driver, model={"method": method, "basis": basis}, keywords=keywords or {}, protocols=protocols or {})
    result = qcengine.compute(task, "psi4", task_config=CONFIG, raise_error=True)
    write(name, result)


atomic("water-hf-hessian.json", WATER, "hessian", "hf", "cc-pvdz")
atomic("water-hf-ccpvdz-wavefunction.json", WATER, "energy", "hf", "cc-pvdz", protocols={"wavefunction": "orbitals_and_eigenvalues"})
atomic("water-hf-631gs-wavefunction.json", WATER, "energy", "hf", "6-31g*", keywords={"puream": False}, protocols={"wavefunction": "orbitals_and_eigenvalues"})
atomic("hydroxyl-uhf-wavefunction.json", HYDROXYL, "energy", "hf", "cc-pvdz", keywords={"reference": "uhf"}, protocols={"wavefunction": "orbitals_and_eigenvalues"})

for protocol in ("all", "final"):
    task = OptimizationInput(initial_molecule=WATER.copy(update={"geometry": [0.0, 0.0, -0.10, 0.0, -1.55, 1.05, 0.0, 1.55, 1.05]}),
                             input_specification={"driver": "gradient", "model": {"method": "hf", "basis": "sto-3g"}},
                             keywords={"program": "psi4"}, protocols={"trajectory": protocol})
    result = qcengine.compute_procedure(task, "optking", task_config=CONFIG, raise_error=True)
    write(f"water-optimization-trajectory-{protocol}.json", result)
