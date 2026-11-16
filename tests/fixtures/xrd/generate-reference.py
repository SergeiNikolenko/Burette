"""Independent powder-diffraction reference for tests/test-powder-xrd.test.ts.

pymatgen's XRDCalculator shares no code or scattering-factor table with Gemmi:
it uses its own Mott-Bethe-fitted atomic scattering parameters, enumerates
reflections itself and applies the same Lorentz-polarization factor
(1 + cos^2 2theta) / (sin^2 theta cos theta). No Debye-Waller factors.

Regenerate from the repository root:
  uv run --isolated --no-project --with pymatgen==2026.10.24 \
    python tests/fixtures/xrd/generate-reference.py
"""

import json
import pathlib

import pymatgen
from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.core import Lattice, Structure
from pymatgen.io.cif import CifWriter

HERE = pathlib.Path(__file__).parent
CU_KA1 = 1.5405929
MO_KA1 = 0.7093171


def fcc(a, species, basis):
    translations = [(0, 0, 0), (0, 0.5, 0.5), (0.5, 0, 0.5), (0.5, 0.5, 0)]
    sites = [(element, [(t[i] + b[i]) % 1 for i in range(3)]) for element, b in zip(species, basis) for t in translations]
    return Structure(Lattice.cubic(a), [s for s, _ in sites], [p for _, p in sites])


nacl = fcc(5.6402, ["Na", "Cl"], [(0, 0, 0), (0.5, 0.5, 0.5)])
diamond = fcc(3.56679, ["C", "C"], [(0, 0, 0), (0.25, 0.25, 0.25)])
# A deliberately oblique triclinic P1 cell with three different elements.
triclinic = Structure(
    Lattice.from_parameters(4.1, 5.3, 6.2, 77.0, 84.0, 69.0),
    ["Fe", "O", "Si"],
    [[0.1, 0.2, 0.3], [0.62, 0.41, 0.17], [0.33, 0.78, 0.69]],
)


def pattern(structure, wavelength, two_theta_range):
    result = XRDCalculator(wavelength=wavelength).get_pattern(structure, scaled=True, two_theta_range=two_theta_range)
    return [
        {
            "twoTheta": float(x),
            "d": float(d),
            "relativeIntensity": float(y),
            "multiplicity": int(sum(family["multiplicity"] for family in families)),
            "families": [list(family["hkl"]) for family in families],
        }
        for x, y, d, families in zip(result.x, result.y, result.d_hkls, result.hkls)
    ]


def lattice(structure):
    return [[float(v) for v in row] for row in structure.lattice.matrix]


def sites(structure):
    return [{"element": site.specie.symbol, "fractional": [float(v) for v in site.frac_coords]} for site in structure]


cases = {
    "nacl-cu": (nacl, CU_KA1, (10, 90)),
    "nacl-mo": (nacl, MO_KA1, (5, 60)),
    "diamond-cu": (diamond, CU_KA1, (10, 140)),
    "triclinic-cu": (triclinic, CU_KA1, (10, 80)),
}
reference = {
    "generator": f"pymatgen {pymatgen.core.__version__} XRDCalculator",
    "cases": {
        name: {
            "wavelength": wavelength,
            "twoThetaMin": tt[0],
            "twoThetaMax": tt[1],
            "lattice": lattice(structure),
            "sites": sites(structure),
            "peaks": pattern(structure, wavelength, tt),
        }
        for name, (structure, wavelength, tt) in cases.items()
    },
}
(HERE / "pymatgen-reference.json").write_text(json.dumps(reference, indent=1) + "\n")

# Symmetrized CIFs: the CIF reader must expand these operations to the full cell.
for name, structure in {"nacl-fm3m": nacl, "diamond-fd3m": diamond}.items():
    (HERE / f"{name}.cif").write_text(str(CifWriter(structure, symprec=1e-3)))
print("wrote", ", ".join(sorted(cases)))
