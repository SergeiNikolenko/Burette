"""Independent crystal fixtures and references for Burette's crystal tools.

Every structure below is built from published crystallographic parameters with
pymatgen and written by pymatgen, ASE or by hand (CONTCAR, duplicate-site CIF),
so no file and no reference value comes from Burette's code. The references
use spglib (space groups, standardization, Niggli), pymatgen (cells, supercells,
powder XRD, molecular point groups) and ASE (periodic bonds, pair distances).

Regenerate from the repository root on a Linux host:
  uv run --isolated --no-project --python 3.12 \
    --with pymatgen==2026.10.24 --with spglib==2.8.0 --with ase==3.26.0 \
    python tests/fixtures/crystals/generate-reference.py
The versions actually used are recorded in reference.json ("generator").
"""

import datetime
import json
import math
import pathlib
import platform
import socket

import ase
import ase.io
import numpy as np
import pymatgen.core
import spglib
from ase import Atoms
from ase.data import covalent_radii
from ase.neighborlist import NeighborList, neighbor_list
from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.core import Lattice, Molecule, Structure
from pymatgen.io.ase import AseAtomsAdaptor
from pymatgen.io.cif import CifParser, CifWriter
from pymatgen.io.vasp import Poscar
from pymatgen.symmetry.analyzer import PointGroupAnalyzer

HERE = pathlib.Path(__file__).parent
(HERE / "molecules").mkdir(exist_ok=True)


def r(value, digits=10):
    return float(round(float(value), digits))


# --- Fixtures ---------------------------------------------------------------------------

# Urea, P-42_1m: Swaminathan, Craven & McMullan, Acta Cryst. B40, 300 (1984), neutron, 123 K.
urea = Structure.from_spacegroup(
    113, Lattice.tetragonal(5.565, 4.684), ["C", "O", "N", "H", "H"],
    [[0, 0.5, 0.3260], [0, 0.5, 0.5953], [0.1459, 0.6459, 0.1766], [0.2575, 0.7575, 0.2827], [0.1441, 0.6441, -0.0380]])
# Rutile TiO2, P4_2/mnm: Baur & Khan, Acta Cryst. B27, 2133 (1971).
rutile = Structure.from_spacegroup(136, Lattice.tetragonal(4.594, 2.959), ["Ti", "O"], [[0, 0, 0], [0.3048, 0.3048, 0]])
# Alpha quartz, P3_2 21: Levien, Prewitt & Weidner, Am. Mineral. 65, 920 (1980). The paper's
# origin lies on the twofold axis along a at z = 0; the ITA setting has it at z = 1/6.
quartz = Structure.from_spacegroup(154, Lattice.hexagonal(4.9134, 5.4052), ["Si", "O"], [[0.4697, 0, 1 / 6], [0.4135, 0.2669, 0.1191 + 1 / 6]])
assert quartz.composition.reduced_formula == "SiO2" and len(quartz) == 9, quartz.composition
assert abs(min(quartz.get_distance(0, j) for j in range(3, 9)) - 1.61) < 0.02
# Diamond-structure silicon, a = 5.431 A: fcc translations plus the (1/4, 1/4, 1/4) basis, written in P1.
fcc = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]]
silicon = Structure(Lattice.cubic(5.431), ["Si"] * 8, fcc + [[x + 0.25 for x in p] for p in fcc])

(HERE / "urea.cif").write_text(str(CifWriter(urea, symprec=0.01)))
(HERE / "rutile.cif").write_text(str(CifWriter(rutile, symprec=0.01)))
(HERE / "quartz.cif").write_text(str(CifWriter(quartz, symprec=0.01)))
Poscar(silicon, comment="Si diamond a=5.431").write_file(HERE / "si.poscar")

# Rutile as a CONTCAR with selective dynamics, Cartesian positions and a negative
# (volume) scale: the lattice is written divided by 1.3 and VASP rescales it.
shrink = 1.3
flags = ["T T F", "F F F", "T T T", "T F T", "F T T", "T T T"]
contcar = ["rutile relaxed", f"{-rutile.volume:.10f}"]
contcar += [" ".join(f"{v / shrink:.12f}" for v in row) for row in rutile.lattice.matrix]
species = [site.specie.symbol for site in rutile]
blocks = []
for element in species:
    if blocks and blocks[-1][0] == element:
        blocks[-1][1] += 1
    else:
        blocks.append([element, 1])
contcar += [" ".join(b[0] for b in blocks), " ".join(str(b[1]) for b in blocks), "Selective dynamics", "Cartesian"]
contcar += [" ".join(f"{v / shrink:.12f}" for v in site.coords) + " " + flags[i] for i, site in enumerate(rutile)]
(HERE / "CONTCAR").write_text("\n".join(contcar) + "\n")

# A triclinic P1 cell with one water and one methanol molecule; the file is wrapped
# into [0, 1), so the methanol is split across the a and c faces.
triclinic_cell = Lattice.from_parameters(7.1, 8.3, 9.2, 78, 83, 71).matrix
water = [("O", [0.0, 0.0, 0.0]), ("H", [0.7572, 0.5865, 0.0]), ("H", [-0.7572, 0.5865, 0.0])]
methanol = [("C", [0.0, 0.0, 0.0]), ("O", [1.4246, 0.0, 0.0]), ("H", [1.7431, 0.9049, 0.0]),
            ("H", [-0.3633, -1.0277, 0.0]), ("H", [-0.3633, 0.5138, 0.8900]), ("H", [-0.3633, 0.5138, -0.8900])]
water_origin = np.array([0.45, 0.4, 0.5]) @ triclinic_cell
methanol_origin = np.array([0.97, 0.55, 0.985]) @ triclinic_cell
symbols = [s for s, _ in water] + [s for s, _ in methanol]
positions = [np.array(p) + water_origin for _, p in water] + [np.array(p) + methanol_origin for _, p in methanol]
triclinic = Atoms(symbols=symbols, positions=positions, cell=triclinic_cell, pbc=True)
triclinic.wrap()
ase.io.write(HERE / "triclinic-molecule.xyz", triclinic, format="extxyz", columns=["symbols", "positions"])

# Rock salt in P1 with the boundary duplicates some exporters list (sites at 1.0).
duplicates = []
for x, y, z in fcc:
    duplicates.append(("Na", (x, y, z)))
    duplicates.append(("Cl", ((x + 0.5) % 1, (y + 0.5) % 1, (z + 0.5) % 1)))
extra_na = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 1), (0, 1, 1), (1, 1, 1), (1, 0.5, 0.5), (0.5, 1, 0.5), (0.5, 0.5, 1)]
extra_cl = [(0.5, 1, 0), (0.5, 0, 1), (0.5, 1, 1), (1, 0.5, 0), (0, 0.5, 1), (1, 0.5, 1), (1, 0, 0.5), (0, 1, 0.5), (1, 1, 0.5)]
rows = duplicates + [("Na", p) for p in extra_na] + [("Cl", p) for p in extra_cl]
cif = ["data_NaCl_with_boundary_copies", "_cell_length_a 5.6402", "_cell_length_b 5.6402", "_cell_length_c 5.6402",
       "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90", "_symmetry_space_group_name_H-M 'P 1'",
       "loop_", "_symmetry_equiv_pos_as_xyz", "'x, y, z'", "loop_", "_atom_site_label", "_atom_site_type_symbol",
       "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy"]
counts = {"Na": 0, "Cl": 0}
for element, point in rows:
    counts[element] += 1
    cif.append(f"{element}{counts[element]} {element} {point[0]:.4f} {point[1]:.4f} {point[2]:.4f} 1")
(HERE / "nacl-duplicates.cif").write_text("\n".join(cif) + "\n")


# --- References ----------------------------------------------------------------------------

def read(name):
    path = HERE / name
    if name == "nacl-duplicates.cif":
        # pymatgen's CIF parser sums the occupancy of coinciding sites; ASE keeps the rows.
        structure = AseAtomsAdaptor.get_structure(ase.io.read(path, format="cif"))
        structure = Structure(structure.lattice, structure.species, structure.frac_coords % 1.0)
    elif name.endswith(".cif"):
        structure = CifParser(path).parse_structures(primitive=False)[0]
    elif name.endswith(".xyz"):
        structure = AseAtomsAdaptor.get_structure(ase.io.read(path, format="extxyz"))
    else:
        structure = Poscar.from_file(path).structure
    structure.merge_sites(tol=1e-3, mode="delete")
    return structure


def spglib_cell(structure):
    return (structure.lattice.matrix, structure.frac_coords, [site.specie.Z for site in structure])


def parameters(matrix):
    lattice = Lattice(matrix)
    return {"a": r(lattice.a), "b": r(lattice.b), "c": r(lattice.c), "alpha": r(lattice.alpha), "beta": r(lattice.beta), "gamma": r(lattice.gamma)}


def symmetry(structure):
    cell = spglib_cell(structure)
    result = {}
    for symprec in [1e-5, 1e-3, 0.01, 0.1]:
        dataset = spglib.get_symmetry_dataset(cell, symprec=symprec)
        entry = {
            "number": int(dataset.number), "hallNumber": int(dataset.hall_number), "international": dataset.international,
            "operations": int(len(dataset.rotations)), "wyckoffs": list(dataset.wyckoffs),
            "equivalentAtoms": [int(v) for v in dataset.equivalent_atoms],
        }
        for primitive in [False, True]:
            for idealize in [True, False]:
                lattice, positions, numbers = spglib.standardize_cell(cell, to_primitive=primitive, no_idealize=not idealize, symprec=symprec)
                entry[f"{'primitive' if primitive else 'conventional'}{'Idealized' if idealize else 'Raw'}"] = {
                    "parameters": parameters(lattice), "volume": r(abs(np.linalg.det(lattice))), "atomCount": int(len(numbers)),
                }
        result[str(symprec)] = entry
    return result


def niggli(matrix):
    reduced = spglib.niggli_reduce(matrix, eps=1e-5)
    return {"parameters": parameters(reduced), "volume": r(abs(np.linalg.det(reduced)))}


def periodic_bonds(structure):
    atoms = AseAtomsAdaptor.get_atoms(structure)
    # Avogadro's and Open Babel's rule: bonded when d < r_i + r_j + 0.45 A (covalent radii).
    neighbors = NeighborList([covalent_radii[n] + 0.225 for n in atoms.numbers], self_interaction=False, bothways=False, skin=0.0)
    neighbors.update(atoms)
    bonds = []
    for i in range(len(atoms)):
        indices, offsets = neighbors.get_neighbors(i)
        for j, offset in zip(indices, offsets):
            bonds.append([int(i), int(j), [int(v) for v in offset]])
    # Fragments through periodic images; a fragment whose image offsets disagree around a
    # cycle is an infinite (periodic) network rather than a finite molecule.
    adjacency = {i: [] for i in range(len(atoms))}
    for i, j, offset in bonds:
        adjacency[i].append((j, np.array(offset)))
        adjacency[j].append((i, -np.array(offset)))
    image, fragments = {}, []
    for start in range(len(atoms)):
        if start in image:
            continue
        image[start] = np.zeros(3, int)
        members, periodic, queue = [start], False, [start]
        while queue:
            i = queue.pop()
            for j, offset in adjacency[i]:
                expected = image[i] + offset
                if j not in image:
                    image[j] = expected
                    members.append(j)
                    queue.append(j)
                elif not np.array_equal(image[j], expected):
                    periodic = True
        fragments.append({"atoms": sorted(int(v) for v in members), "periodic": periodic})
    return {"cutoffs": "d < r_i + r_j + 0.45 A with ase.data.covalent_radii (Cordero 2008)", "bonds": bonds, "fragments": fragments}


def pair_distribution(structure, r_max=6.0, width=0.1):
    atoms = AseAtomsAdaptor.get_atoms(structure)
    i, j, d = neighbor_list("ijd", atoms, cutoff=r_max + 1e-9, self_interaction=False)
    keep = d < r_max
    i, j, d = i[keep], j[keep], d[keep]
    bins = int(round(r_max / width))
    index = np.floor(d / width).astype(int)
    symbols = atoms.get_chemical_symbols()
    elements = sorted(set(symbols), key=symbols.index)
    shells = [4 / 3 * math.pi * (((k + 1) * width) ** 3 - (k * width) ** 3) for k in range(bins)]
    volume = atoms.get_volume()
    total = np.bincount(index, minlength=bins)
    result = {"rMax": r_max, "binWidth": width, "volume": r(volume), "total": [int(v) for v in total], "partial": {}}
    n = len(atoms)
    result["gTotal"] = [r(volume * total[k] / (n * n * shells[k])) for k in range(bins)]
    for a in elements:
        for b in elements:
            mask = np.array([symbols[x] == a and symbols[y] == b for x, y in zip(i, j)], bool)
            counts = np.bincount(index[mask], minlength=bins)
            na, nb = symbols.count(a), symbols.count(b)
            result["partial"][f"{a}-{b}"] = {
                "counts": [int(v) for v in counts],
                "g": [r(volume * counts[k] / (na * nb * shells[k])) for k in range(bins)],
            }
    return result


def xrd(structure):
    pattern = XRDCalculator(wavelength=1.5405929).get_pattern(structure, scaled=True, two_theta_range=(10, 90))
    return [{
        "twoTheta": r(x, 8), "d": r(d, 8), "relativeIntensity": r(y, 6),
        "multiplicity": int(sum(f["multiplicity"] for f in families)), "families": [list(f["hkl"]) for f in families],
    } for x, y, d, families in zip(pattern.x, pattern.y, pattern.d_hkls, pattern.hkls)]


fixtures = {}
for name in ["urea.cif", "rutile.cif", "quartz.cif", "si.poscar", "CONTCAR", "triclinic-molecule.xyz", "nacl-duplicates.cif"]:
    structure = read(name)
    matrix = structure.lattice.matrix
    entry = {
        "cell": [[r(v) for v in row] for row in matrix], "parameters": parameters(matrix), "volume": r(structure.volume),
        "atomCount": len(structure), "formula": structure.composition.formula,
        "sites": [{"element": site.specie.symbol, "fractional": [r(v) for v in site.frac_coords]} for site in structure],
        "spglib": symmetry(structure),
        "niggli": niggli(matrix),
        "supercell_2x2x1": {"atomCount": len(structure) * 4, "volume": r(structure.copy().make_supercell([2, 2, 1]).volume)},
        # vesta=True is the a-along-x, b-in-xy orientation Avogadro rotates to.
        "standardOrientation": [[r(v) for v in row] for row in Lattice.from_parameters(*structure.lattice.parameters, vesta=True).matrix],
        "scaledVolume": {"volume": r(structure.volume * 1.2), "cell": [[r(v) for v in row] for row in structure.lattice.scale(structure.volume * 1.2).matrix]},
    }
    # A new cell keeping fractional coordinates, and one keeping Cartesian coordinates.
    edited = Lattice.from_parameters(6.0, 5.8, 4.9, 88, 92, 95, vesta=True)
    keep_fractional = Structure(edited, structure.species, structure.frac_coords)
    keep_cartesian = Structure(edited, structure.species, structure.cart_coords, coords_are_cartesian=True)
    entry["editedCell"] = {
        "cell": [[r(v) for v in row] for row in edited.matrix],
        "fractionalPolicy": [[r(v) for v in site.coords] for site in keep_fractional],
        "cartesianPolicyFractional": [[r(v) for v in site.frac_coords] for site in keep_cartesian],
    }
    if name in ["urea.cif", "rutile.cif", "quartz.cif", "triclinic-molecule.xyz"]:
        entry["periodicBonds"] = periodic_bonds(structure)
    if name in ["urea.cif", "rutile.cif", "quartz.cif"]:
        entry["pairDistribution"] = pair_distribution(structure)
        entry["xrd"] = xrd(structure)
    fixtures[name] = entry


def molecule(name, items):
    mol = Molecule([s for s, _ in items], [p for _, p in items])
    mol.to(filename=str(HERE / "molecules" / f"{name}.xyz"))
    return {"file": f"molecules/{name}.xyz", "schoenflies": PointGroupAnalyzer(mol, tolerance=0.3).sch_symbol}


t = 1.089 / math.sqrt(3)
benzene = []
for k in range(6):
    angle = k * math.pi / 3
    benzene += [("C", [1.397 * math.cos(angle), 1.397 * math.sin(angle), 0]), ("H", [2.481 * math.cos(angle), 2.481 * math.sin(angle), 0])]
molecules = {
    "water": molecule("water", [("O", [0, 0, 0.1173]), ("H", [0, 0.7572, -0.4692]), ("H", [0, -0.7572, -0.4692])]),
    "ammonia": molecule("ammonia", [("N", [0, 0, 0.1162]), ("H", [0, 0.9397, -0.2711]), ("H", [0.8138, -0.4699, -0.2711]), ("H", [-0.8138, -0.4699, -0.2711])]),
    "methane": molecule("methane", [("C", [0, 0, 0])] + [("H", [t * x, t * y, t * z]) for x, y, z in [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]]]),
    "benzene": molecule("benzene", benzene),
    "ethylene": molecule("ethylene", [("C", [0, 0, 0.6695]), ("C", [0, 0, -0.6695]), ("H", [0, 0.9289, 1.2321]), ("H", [0, -0.9289, 1.2321]), ("H", [0, 0.9289, -1.2321]), ("H", [0, -0.9289, -1.2321])]),
    "sulfur-hexafluoride": molecule("sulfur-hexafluoride", [("S", [0, 0, 0])] + [("F", [1.564 * x, 1.564 * y, 1.564 * z]) for x, y, z in [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]]),
    "carbon-dioxide": molecule("carbon-dioxide", [("C", [0, 0, 0]), ("O", [0, 0, 1.162]), ("O", [0, 0, -1.162])]),
    "hydrogen-cyanide": molecule("hydrogen-cyanide", [("H", [0, 0, -1.064]), ("C", [0, 0, 0]), ("N", [0, 0, 1.156])]),
    "hypochlorous-acid": molecule("hypochlorous-acid", [("O", [0, 0, 0]), ("H", [0.97, 0, 0]), ("Cl", [-0.2992, 1.6626, 0])]),
    "bromochlorofluoromethane": molecule("bromochlorofluoromethane", [("C", [0, 0, 0]), ("H", [0.31, 0.27, 1.02]), ("F", [1.29, 0.12, -0.41]), ("Cl", [-0.77, 1.46, -0.63]), ("Br", [-0.92, -1.53, -0.71])]),
}

reference = {
    "generator": {
        "python": platform.python_version(), "pymatgen": pymatgen.core.__version__, "spglib": spglib.__version__, "ase": ase.__version__,
        "numpy": np.__version__, "host": socket.gethostname(), "date": datetime.date.today().isoformat(),
        "xrdConvention": "pymatgen XRDCalculator: |F|^2 with Lorentz-polarization (1 + cos^2 2theta) / (sin^2 theta cos theta), no Debye-Waller factor, scaled so the strongest peak is 100",
        "pairDistributionConvention": "ordered pairs (i, j, image) with 0 < d < rMax in half-open bins [k dr, (k+1) dr); self pair excluded, self images included; g_AB = V n_AB / (N_A N_B dV_k)",
    },
    "fixtures": fixtures,
    "molecules": molecules,
}
(HERE / "reference.json").write_text(json.dumps(reference, separators=(",", ":")) + "\n")
print(json.dumps({name: {str(k): v["number"] for k, v in entry["spglib"].items()} for name, entry in fixtures.items()}))
