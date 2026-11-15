"""Independent references for the metal-complex builder; see README.md for the exact command.

Reads Burette's samples/*.sdf back with RDKit and Open Babel, measures coordination spheres in
COD crystal structures with gemmi, and the Avogadro 2 center templates. Writes reference.json.
"""
import itertools, json, math, pathlib, platform, sys, urllib.request

import gemmi
from openbabel import openbabel as ob, pybel
from rdkit import Chem, rdBase
from rdkit.Chem.rdMolDescriptors import CalcMolFormula

here = pathlib.Path(__file__).parent
cache = pathlib.Path(sys.argv[1])
avogadro = pathlib.Path(sys.argv[2])  # avogadrolibs checkout
avogadro_commit = sys.argv[3]
complexes = json.loads((here / "complexes.json").read_text())
ob.obErrorLog.SetOutputLevel(0)


def angle(u, v):
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(a * b for a, b in zip(u, v)) / math.hypot(*u) / math.hypot(*v)))))


def sphere(vectors):
    return {"distances": sorted(round(math.hypot(*v), 3) for v in vectors),
            "angles": sorted(round(angle(u, v), 2) for u, v in itertools.combinations(vectors, 2))}


def rdkit_readback(path):
    mol = Chem.MolFromMolFile(str(path), removeHs=False)
    metal = next(atom for atom in mol.GetAtoms() if atom.GetIdx() == 0)
    dative = [bond for bond in mol.GetBonds() if bond.GetBondType() == Chem.BondType.DATIVE]
    conformer, origin = mol.GetConformer(), mol.GetConformer().GetAtomPosition(0)
    donors = [bond.GetBeginAtomIdx() for bond in dative if bond.GetEndAtomIdx() == 0]
    vectors = [tuple(conformer.GetAtomPosition(i) - origin) for i in donors]
    ligands = Chem.RWMol(mol)
    ligands.RemoveAtom(0)
    fragments = []
    for fragment in Chem.GetMolFrags(ligands.GetMol(), asMols=True, sanitizeFrags=True):
        Chem.RemoveStereochemistry(fragment)  # 3D perception assigns spurious P/C=C stereo next to the removed metal
        fragments.append(Chem.MolToSmiles(Chem.RemoveHs(fragment)))
    fragments.sort()
    return {"formula": CalcMolFormula(mol), "charge": Chem.GetFormalCharge(mol), "atoms": mol.GetNumAtoms(), "bonds": mol.GetNumBonds(),
            "dative": len(dative), "donorToMetal": len(donors), "metal": metal.GetSymbol(), "metalCharge": metal.GetFormalCharge(),
            "ligandSmiles": fragments, **sphere(vectors)}


def openbabel_readback(path):
    mol = next(pybel.readfile("sdf", str(path))).OBMol
    return {"formula": mol.GetFormula(), "charge": mol.GetTotalCharge(), "atoms": mol.NumAtoms(), "bonds": mol.NumBonds(),
            "coordination": sum(1 for bond in ob.OBMolBondIter(mol) if bond.GetBondOrder() == 9)}


def crystal_spheres(spec):
    path = cache / f"{spec['cod']}.cif"
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(f"https://www.crystallography.net/cod/{spec['cod']}.cif", timeout=120).read())
    structure = gemmi.read_small_structure(str(path))
    operations = [gemmi.Op(text) for text in structure.symops] or list(structure.spacegroup.operations())
    metal = spec["metal"]
    spheres = []
    for site in structure.sites:
        if site.element.name != metal or site.occ < 0.99:
            continue
        center, vectors, seen, donors = structure.cell.orthogonalize(site.fract), [], set(), {}
        for other in structure.sites:
            if other.element.name not in spec["donors"]:
                continue
            for operation in operations:
                image = [value % 1 - site_value % 1 + site_value for value, site_value in zip(operation.apply_to_xyz([other.fract.x, other.fract.y, other.fract.z]), (site.fract.x, site.fract.y, site.fract.z))]
                for shift in itertools.product((-1, 0, 1), repeat=3):
                    point = structure.cell.orthogonalize(gemmi.Fractional(*(image[i] + shift[i] for i in range(3))))
                    key = tuple(round(value, 3) for value in (point.x, point.y, point.z))
                    if 0.5 < point.dist(center) <= spec["cutoff"] and key not in seen:
                        seen.add(key)
                        vectors.append((point.x - center.x, point.y - center.y, point.z - center.z))
                        donors.setdefault(other.element.name, []).append(round(point.dist(center), 3))
        spheres.append({"site": site.label, **sphere(vectors), "donorDistances": {element: sorted(values) for element, values in sorted(donors.items())}})
    return {"cod": spec["cod"], "structure": spec["structure"], "spheres": spheres}


centers = {}
for name, geometry in [("2-lin", "linear"), ("3-tpl", "trigonal-planar"), ("4-tet", "tetrahedral"), ("4-sqp", "square-planar"),
                       ("5-tbp", "trigonal-bipyramidal"), ("5-spy", "square-pyramidal"), ("6-oct", "octahedral"),
                       ("6-tpr", "trigonal-prismatic"), ("7-pbp", "pentagonal-bipyramidal"), ("8-sqa", "square-antiprismatic")]:
    data = json.loads((avogadro / "avogadro/qtplugins/templatetool/centers" / f"{name}.cjson").read_text())
    coords, numbers = data["atoms"]["coords"]["3d"], data["atoms"]["elements"]["number"]
    metal = next(i for i, number in enumerate(numbers) if number != 1)
    vectors = [tuple(coords[3 * i + a] - coords[3 * metal + a] for a in range(3)) for i, number in enumerate(numbers) if i != metal]
    centers[geometry] = {"file": f"avogadro/qtplugins/templatetool/centers/{name}.cjson", "angles": sphere(vectors)["angles"]}

radii = {}
for symbol in ["Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd",
               "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Mg", "Al", "Ga"]:
    radii[symbol] = ob.GetCovalentRad(Chem.GetPeriodicTable().GetAtomicNumber(symbol))

result = {"tools": {"python": platform.python_version(), "rdkit": rdBase.rdkitVersion, "openbabel": ob.OBReleaseVersion(), "gemmi": gemmi.__version__},
          "avogadrolibs": avogadro_commit, "openbabelCovalentRadii": radii, "avogadroCenters": centers, "complexes": {}}
for name, entry in complexes.items():
    sample = here / "samples" / f"{name}.sdf"
    record = {"rdkit": rdkit_readback(sample), "openbabel": openbabel_readback(sample)}
    if "crystal" in entry:
        record["crystal"] = crystal_spheres({**entry["crystal"], "metal": entry["options"]["metal"]})
    result["complexes"][name] = record
(here / "reference.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
