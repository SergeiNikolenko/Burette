# Vibrational spectrum references

`orca-3.0.2-methane.hess` is the unchanged ORCA 3.0.2 methane output from
https://github.com/bskinn/opan/blob/0b1b21662df6/opan/test/resource/orca/test_orca_v3.0.2.hess
(MIT; opan-LICENSE.txt). Original mode indices, T-squared atomic units and Raman
activities/depolarization ratios are retained, including rigid-body rows.

The existing `gaussian16-water-raman.fchk` fixture and MolOP license are already
tracked; see fchk-readers.md for source and minimization provenance. Its Hessian
uses hartree/bohr^2, coordinates are converted to angstrom and masses use amu.
