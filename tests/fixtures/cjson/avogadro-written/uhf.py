# Triplet CH2, UHF/STO-3G, written as Molden for avowrite.
from pyscf import gto, scf
from pyscf.tools import molden
mol = gto.M(atom="C 0 0 0.1; H 0 0.99 -0.42; H 0 -0.99 -0.42", basis="sto-3g", spin=2, unit="Angstrom")
molden.from_scf(scf.UHF(mol).run(conv_tol=1e-10), "ch2-triplet-uhf.molden")
