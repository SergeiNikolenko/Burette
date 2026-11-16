# Water B3LYP/6-31G* single point; density and electrostatic potential cubes on one 24-point grid,
# 6 bohr beyond the atoms so the 0.0004 e/bohr^3 surface closes inside it, and the cation's density on
# the same grid for difference densities.
from pyscf import gto, dft
from pyscf.tools import cubegen
mol = gto.M(atom="O 0 0 0.1173; H 0 0.7572 -0.4692; H 0 -0.7572 -0.4692", basis="6-31g*", unit="Angstrom")
mf = dft.RKS(mol); mf.xc = "b3lyp"; mf.kernel()
dm = mf.make_rdm1()
cubegen.density(mol, "water-density.cube", dm, nx=24, ny=24, nz=24, margin=6.0)
cubegen.mep(mol, "water-potential.cube", dm, nx=24, ny=24, nz=24, margin=6.0)
cation = dft.UKS(gto.M(atom=mol.atom, basis="6-31g*", unit="Angstrom", charge=1, spin=1)); cation.xc = "b3lyp"; cation.kernel()
cation_dm = cation.make_rdm1()
cubegen.density(cation.mol, "water-cation-density.cube", cation_dm[0] + cation_dm[1], nx=24, ny=24, nz=24, margin=6.0)
