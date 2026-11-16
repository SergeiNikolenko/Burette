import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { addHydrogens, generateFromSmiles, getProperties, removeHydrogens } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import type { MolecularStructure } from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';
import { loadRDKitModule } from '../apps/desktop/src/lib/rdkit-module';

type Reference = { name: string; smiles: string; elements: string[]; bonds: [number, number][]; hydrogens: number[]; charge: number; formula: string; atomsWithHydrogens: number; atomsAfterRemoveHs: number };
const { molecules }: { molecules: Reference[] } = JSON.parse(readFileSync(new URL('./fixtures/protonation/hydrogen-references.json', import.meta.url), 'utf8'));
type Atom = MolecularStructure['atoms'][number];
const neighbours = (s: MolecularStructure, i: number) => s.bonds.flatMap(b => b.a === i ? [b.b] : b.b === i ? [b.a] : []);
const angle = (a: Atom, c: Atom, b: Atom) => {
  const u = [a.x - c.x, a.y - c.y, a.z - c.z], v = [b.x - c.x, b.y - c.y, b.z - c.z];
  return Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI;
};
// Hill order without the charge suffix, as RDKit's CalcMolFormula writes it.
const hill = (atoms: Atom[]) => {
  const count = new Map<string, number>(); atoms.forEach(a => count.set(a.element, (count.get(a.element) ?? 0) + 1));
  const order = [...count.keys()].sort((a, b) => (a === 'C' ? -2 : a === 'H' ? -1 : 0) - (b === 'C' ? -2 : b === 'H' ? -1 : 0) || a.localeCompare(b));
  return order.map(e => `${e}${count.get(e)! > 1 ? count.get(e) : ''}`).join('');
};
// Neutron-diffraction X–H means: Allen et al., J. Chem. Soc. Perkin Trans. 2 1987, S1 (Csp3 1.09, Csp2 1.08, Csp 1.06).
const ideal = (parent: string, maxOrder: number) => parent === 'C' ? [1.09, 1.08, 1.08, 1.06][Math.ceil(maxOrder) - 1] : { N: 1.01, O: 0.97 }[parent]!;

test('Add/Remove H match RDKit AddHs/RemoveHs counts and give ideal X–H geometry without moving heavy atoms or stereo', async () => {
  const rdkit = await loadRDKitModule();
  const canonical = (text: string) => { const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: true }))!; try { return mol.get_smiles(); } finally { mol.delete(); } };
  for (const molecule of molecules) {
    const heavy = removeHydrogens(generateFromSmiles(molecule.smiles)), n = molecule.elements.length;
    expect(heavy.atoms.map(a => a.element)).toEqual(molecule.elements);
    expect(heavy.bonds.map(b => [Math.min(b.a, b.b), Math.max(b.a, b.b)]).sort((x, y) => x[0] - y[0] || x[1] - y[1])).toEqual(molecule.bonds);
    const added = await addHydrogens(heavy);
    expect({ name: molecule.name, atoms: added.atoms.length, hydrogens: added.atoms.slice(0, n).map((_, i) => neighbours(added, i).filter(j => added.atoms[j].element === 'H').length), formula: hill(added.atoms), charge: getProperties(added).charge })
      .toEqual({ name: molecule.name, atoms: molecule.atomsWithHydrogens, hydrogens: molecule.hydrogens, formula: molecule.formula.replace(/[+-]\d*$/, ''), charge: molecule.charge });
    expect(added.atoms.slice(0, n)).toEqual(heavy.atoms);
    for (let i = n; i < added.atoms.length; i++) {
      const [p] = neighbours(added, i), others = neighbours(added, p).filter(j => j !== i), maxOrder = Math.max(...added.bonds.filter(b => b.a === p || b.b === p).map(b => b.order));
      const h = added.atoms[i], parent = added.atoms[p], angles = others.map(j => angle(h, parent, added.atoms[j]));
      expect(Math.abs(Math.hypot(h.x - parent.x, h.y - parent.y, h.z - parent.z) - ideal(parent.element, maxOrder))).toBeLessThan(.05);
      const heavyAngles = others.filter(j => j < n).flatMap((j, m, list) => list.slice(m + 1).map(k => angle(added.atoms[j], parent, added.atoms[k])));
      if (maxOrder === 3) expect(angles[0]).toBeGreaterThan(177);
      else if (maxOrder > 1 && others.length === 2) expect(Math.abs(angles[0] + angles[1] + angle(added.atoms[others[0]], parent, added.atoms[others[1]]) - 360)).toBeLessThan(1);
      else if (others.length === 3 && heavyAngles.every(value => Math.abs(value - 109.47) < 6)) for (const value of angles) expect(Math.abs(value - 109.47)).toBeLessThan(6);
      const pair = others.filter(j => j >= n), ring = others.filter(j => j < n);
      if (maxOrder === 1 && pair.length === 1 && ring.length === 2) {
        // An XH2 pair is mirror-symmetric about its Y–X–Y plane, also in strained rings.
        for (const y of ring) expect(Math.abs(angle(h, parent, added.atoms[y]) - angle(added.atoms[pair[0]], parent, added.atoms[y]))).toBeLessThan(.5);
        // Cyclopropane H–C–H: 114.5° (electron diffraction) to about 116° (microwave).
        if (molecule.name === 'cyclopropane') expect(Math.abs(angle(h, parent, added.atoms[pair[0]]) - 115.3)).toBeLessThan(2.5);
      }
    }
    const removed = removeHydrogens(added);
    expect(removed.atoms.length).toBe(molecule.atomsAfterRemoveHs);
    expect(removed.atoms).toEqual(heavy.atoms);
    // RDKit perceives stereo from the 3D coordinates; it must equal the SMILES that generated them.
    expect([canonical(added.molfile), canonical(removed.molfile)]).toEqual([canonical(molecule.smiles), canonical(molecule.smiles)]);
  }
}, 60_000);
