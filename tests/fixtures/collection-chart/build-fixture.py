# Usage: python3 tests/fixtures/collection-chart/build-fixture.py <moses-properties.csv> <out.sdf>
import csv, hashlib, sys
from collections import Counter
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, rdMolDescriptors
RDLogger.DisableLog('rdApp.*')
rows = list(csv.DictReader(open(sys.argv[1])))
out = []
kept = []
for row in rows:
    mol = Chem.MolFromSmiles(row['smiles'])
    if mol is None:
        continue
    AllChem.Compute2DCoords(mol)
    rings = rdMolDescriptors.CalcNumRings(mol)
    halogens = sorted({a.GetSymbol() for a in mol.GetAtoms() if a.GetSymbol() in ('F', 'Cl', 'Br', 'I')})
    halogen = '+'.join(halogens) if halogens else 'none'
    lines = Chem.MolToMolBlock(mol).split('\n')
    lines[0] = row['name']
    lines[1] = '  Burette fixture'
    out.append('\n'.join(lines) + f"> <MolWt>\n{row['Molecular weight']}\n\n> <SLogP>\n{row['SLogP']}\n\n> <TPSA>\n{row['TPSA']}\n\n> <Rings>\n{rings}\n\n> <Halogen>\n{halogen}\n\n$$$$\n")
    kept.append((row['name'], rings, halogen))
data = ''.join(out)
open(sys.argv[2], 'w').write(data)
print(len(rows), 'rows read,', len(kept), 'records written,', len(data), 'bytes', hashlib.sha256(data.encode()).hexdigest())
print(Counter(k[2] for k in kept))
print(Counter(k[1] for k in kept))
