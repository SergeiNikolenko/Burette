"""Psi4 fixtures and their reference values, from one run of Psi4's own Python API.

Run with Psi4 1.11 (conda-forge): `python generate.py`. Each calculation writes its
standard output file (`<name>.out`, the fixture) and stores the values Psi4 itself holds
in memory (energies per optimization step, wavefunction eigenvalues and occupations,
frequencies, IR intensities, normal coordinates, Hessian, charges, dipole) in
`psi4-reference.json`. The text parser under test never sees these values.
"""
import json
import numpy as np
import psi4

DEBYE = psi4.constants.dipmom_au2debye
reference = {}
WATER = """
0 1
O   0.000000   0.000000   0.130000
H   0.000000   0.790000  -0.470000
H   0.000000  -0.790000  -0.470000
"""


def wavefunction(wfn):
    return {
        "alpha": np.asarray(wfn.epsilon_a().to_array(dense=True)).tolist(),
        "beta": np.asarray(wfn.epsilon_b().to_array(dense=True)).tolist(),
        "nalpha": wfn.nalpha(), "nbeta": wfn.nbeta(), "same_ab": wfn.same_a_b_orbs(),
    }


def start(name):
    psi4.core.clean()
    psi4.core.clean_options()
    psi4.set_output_file(f"{name}.out", False)
    psi4.set_num_threads(2)
    psi4.set_memory("1 GB")


start("water-opt-freq")
water = psi4.geometry(WATER)
psi4.set_options({"basis": "6-31G*"})
energy, wfn, history = psi4.optimize("scf", return_wfn=True, return_history=True)
steps = {"energies": [float(e) for e in history["energy"]],
         "coordinates_bohr": [np.asarray(c.to_array() if hasattr(c, "to_array") else c).tolist() for c in history["coordinates"]]}
energy, wfn = psi4.frequency("scf", return_wfn=True, molecule=water)
psi4.oeprop(wfn, "MULLIKEN_CHARGES", "LOWDIN_CHARGES", "DIPOLE")
vib = wfn.frequency_analysis
reference["water-opt-freq.out"] = {
    "optimization": steps, "final_energy": float(energy), "final_geometry_bohr": np.asarray(water.geometry().to_array()).tolist(),
    "orbitals": wavefunction(wfn), "hessian": np.asarray(wfn.hessian().to_array()).tolist(),
    "masses": [water.mass(i) for i in range(water.natom())],
    "frequencies": np.asarray(vib["omega"].data).real.tolist(), "imaginary": np.asarray(vib["omega"].data).imag.tolist(),
    "ir_km_mol": np.asarray(vib["IR_intensity"].data).tolist(),
    "normal_coordinates": np.asarray(vib["x"].data).tolist(),
    "mulliken": np.asarray(wfn.variable("MULLIKEN CHARGES")).ravel().tolist(),
    "lowdin": np.asarray(wfn.variable("LOWDIN CHARGES")).ravel().tolist(),
    "dipole_debye": (np.asarray(wfn.variable("SCF DIPOLE")) * DEBYE).ravel().tolist(),
}

start("oh-uhf")
oh = psi4.geometry("""
0 2
O 0.0 0.0 0.0
H 0.0 0.0 0.97
""")
psi4.set_options({"basis": "6-31G*", "reference": "uhf"})
energy, wfn = psi4.energy("scf", return_wfn=True)
psi4.oeprop(wfn, "MULLIKEN_CHARGES", "DIPOLE")
reference["oh-uhf.out"] = {"final_energy": float(energy), "orbitals": wavefunction(wfn),
                           "mulliken": np.asarray(wfn.variable("MULLIKEN CHARGES")).ravel().tolist(),
                           "dipole_debye": (np.asarray(wfn.variable("SCF DIPOLE")) * DEBYE).ravel().tolist()}

start("water-scf-fail")
psi4.geometry(WATER)
psi4.set_options({"basis": "6-31G*", "maxiter": 3, "fail_on_maxiter": True})
try:
    psi4.energy("scf")
    failed = False
except psi4.SCFConvergenceError:
    failed = True
reference["water-scf-fail.out"] = {"failed": failed}

with open("psi4-reference.json", "w") as handle:
    json.dump(reference, handle, indent=1, sort_keys=True)
    handle.write("\n")
