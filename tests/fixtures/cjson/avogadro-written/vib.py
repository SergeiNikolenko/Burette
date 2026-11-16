# Water HF/STO-3G: a geometry optimization with Hessians at the first and last step.
import numpy as np
from pyscf import gto, scf
from pyscf.geomopt.geometric_solver import optimize
from pyscf.hessian import thermo
BOHR = 0.52917721092
mol = gto.M(atom="O 0 0 0.10; H 0 0.84 -0.52; H 0 -0.70 -0.48", basis="sto-3g", unit="Angstrom", verbose=0)
steps = []
def record(envs): steps.append(envs["mol"].atom_coords(unit="Angstrom").copy())
optimize(scf.RHF(mol), callback=record, maxsteps=50)
geoms = [mol.atom_coords(unit="Angstrom")] + steps
picks = [0, len(geoms) // 3, 2 * len(geoms) // 3, len(geoms) - 1]
sets = [geoms[i] for i in picks]
def analysis(coords):
    m = mol.copy(); m.set_geom_(coords, unit="Angstrom")
    mf = scf.RHF(m).run(conv_tol=1e-11)
    result = thermo.harmonic_analysis(m, mf.Hessian().kernel())
    modes, ir = [], []
    for freq, mode in zip(result["freq_wavenumber"], result["norm_mode"]):
        step = 0.01
        def dipole(sign):
            d = m.copy(); d.set_geom_(m.atom_coords() + sign * step * mode, unit="Bohr")
            return scf.RHF(d).run(conv_tol=1e-11).dip_moment(unit="AU", verbose=0)
        ir.append(974.88 * float(np.sum(((dipole(1) - dipole(-1)) / (2 * step)) ** 2)))
        modes.append(mode / np.linalg.norm(mode))
    return np.real(result["freq_wavenumber"]), ir, modes
blocks = [(0, *analysis(sets[0])), (3, *analysis(sets[3]))]
with open("water-vib.txt", "w") as out:
    out.write(f"3 {len(sets)}\nO H H\n")
    for s in sets: out.write(" ".join(f"{v:.10f}" for v in s.ravel()) + "\n")
    out.write(f"{len(blocks)}\n")
    for conformer, freqs, ir, modes in blocks:
        out.write(f"{conformer} {len(freqs)}\n" + " ".join(f"{f:.6f}" for f in freqs) + "\n" + " ".join(f"{i:.6f}" for i in ir) + "\n")
        for mode in modes: out.write(" ".join(f"{v:.10f}" for v in np.asarray(mode).ravel()) + "\n")
for conformer, freqs, ir, _ in blocks: print(conformer, [round(f, 1) for f in freqs], [round(i, 2) for i in ir])
print("steps", len(geoms), "picked", picks)
