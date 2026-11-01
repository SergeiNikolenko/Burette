import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Molecule } from 'openchemlib';
import { adjustHydrogensForPh, generateFromSmiles, removeHydrogens, type ProtonationResult } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';
import { parseMolecule, snapshotMolecule, type MolecularStructure } from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';

type State = { charge: number; hydrogens: number[]; charges: number[] };
type Reference = { name: string; smiles: string; elements: string[]; bonds: [number, number][]; symmetry: number[]; references: Record<string, Record<'openbabel' | 'dimorphite', State>> };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/protonation/${name}`, import.meta.url), 'utf8'));
const references: { pH: number[]; molecules: Reference[] } = fixture('protonation-references.json');
const disagreements: Record<string, string> = fixture('disagreements.json');

const charges = (structure: MolecularStructure) => {
  const mol = Molecule.fromMolfile(structure.molfile);
  return structure.atoms.map((_, i) => mol.getAtomCharge(structure.atomMap?.[i] ?? i));
};
const neighbours = (structure: MolecularStructure, i: number) => structure.bonds.flatMap(b => b.a === i ? [b.b] : b.b === i ? [b.a] : []);
/** The protonation state of the input heavy atoms, read from the output graph through its provenance. */
function state({ structure }: ProtonationResult, heavy: number): State {
  const index = Array.from({ length: heavy }, (_, i) => structure.sourceAtomIndices.indexOf(i)), q = charges(structure);
  return { charge: q.reduce((a, b) => a + b, 0), hydrogens: index.map(j => neighbours(structure, j).filter(k => structure.atoms[k].element === 'H').length), charges: index.map(j => q[j]) };
}
// Atoms of one element-graph symmetry class may exchange H/charge between equivalent drawings.
const microstate = (symmetry: number[], s: State) => ({ charge: s.charge, atoms: symmetry.map((c, i) => `${c}:${s.hydrogens[i]}:${s.charges[i]}`).sort() });
type Atom = MolecularStructure['atoms'][number];
const distance = (a: Atom, b: Atom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angle = (a: Atom, center: Atom, b: Atom) => {
  const u = [a.x - center.x, a.y - center.y, a.z - center.z], v = [b.x - center.x, b.y - center.y, b.z - center.z];
  return Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI;
};

describe('pH protonation against Open Babel 3.1.1 and Dimorphite-DL 2.1.0', () => {
  test('every disagreement with either reference is documented, and every documented one still occurs', async () => {
    const found: string[] = [];
    for (const molecule of references.molecules) {
      const source = generateFromSmiles(molecule.smiles);
      expect(source.atoms.slice(0, molecule.elements.length).map(a => a.element)).toEqual(molecule.elements);
      const heavyBonds = source.bonds.filter(b => b.a < molecule.elements.length && b.b < molecule.elements.length).map(b => [Math.min(b.a, b.b), Math.max(b.a, b.b)]);
      expect(heavyBonds.sort((x, y) => x[0] - y[0] || x[1] - y[1])).toEqual(molecule.bonds);
      for (const pH of references.pH) {
        const result = await adjustHydrogensForPh(source, pH), ours = microstate(molecule.symmetry, state(result, molecule.elements.length));
        for (const tool of ['openbabel', 'dimorphite'] as const) {
          if (JSON.stringify(ours) !== JSON.stringify(microstate(molecule.symmetry, molecule.references[pH.toFixed(1)][tool]))) found.push(`${molecule.name}@${pH}/${tool}`);
        }
      }
    }
    expect(found.sort()).toEqual(Object.keys(disagreements).sort());
  }, 120_000);

  test('implicit and explicit hydrogen inputs reach the same state; heavy atoms never move; new H are bonded at physical lengths', async () => {
    // Neutron-diffraction X–H means (Allen et al., J. Chem. Soc. Perkin Trans. 2 1987, S1).
    const ideal: Record<string, number> = { C: 1.09, N: 1.01, O: 0.97, S: 1.34 };
    for (const molecule of references.molecules) {
      const full = generateFromSmiles(molecule.smiles), heavy = removeHydrogens(full);
      const a = await adjustHydrogensForPh(full, 7.4), b = await adjustHydrogensForPh(heavy, 7.4);
      expect(microstate(molecule.symmetry, state(b, molecule.elements.length))).toEqual(microstate(molecule.symmetry, state(a, molecule.elements.length)));
      for (const [input, { structure }] of [[full, a], [heavy, b]] as const) {
        structure.atoms.forEach((atom, i) => {
          const source = structure.sourceAtomIndices[i];
          if (source >= 0) { expect(atom).toEqual(input.atoms[source]); return; }
          const parent = neighbours(structure, i);
          expect(atom.element).toBe('H'); expect(parent).toHaveLength(1);
          const p = structure.atoms[parent[0]], others = neighbours(structure, parent[0]).filter(k => k !== i);
          expect(Math.abs(distance(atom, p) - ideal[p.element])).toBeLessThan(.06);
          const angles = others.map(k => angle(atom, p, structure.atoms[k]));
          // At unstrained tetrahedral centres (e.g. a new N+–H) H stays near 109.5°; sp2 centres keep H in their plane.
          const tetrahedral = others.every((k, m) => others.slice(m + 1).every(l => Math.abs(angle(structure.atoms[k], p, structure.atoms[l]) - 109.47) < 6));
          if (others.length === 3 && tetrahedral) for (const value of angles) expect(Math.abs(value - 109.47)).toBeLessThan(6);
          const sp2 = structure.bonds.some(x => (x.a === parent[0] || x.b === parent[0]) && x.order > 1);
          if (others.length === 2 && sp2) expect(Math.abs(angles[0] + angles[1] + angle(structure.atoms[others[0]], p, structure.atoms[others[1]]) - 360)).toBeLessThan(2);
        });
        expect(new Set(structure.sourceAtomIndices.filter(i => i >= 0)).size).toBe(structure.sourceAtomIndices.filter(i => i >= 0).length);
        expect(structure.atoms.filter(x => x.element === 'H').length).toBe(state({ structure } as ProtonationResult, molecule.elements.length).hydrogens.reduce((x, y) => x + y, 0));
      }
    }
  }, 120_000);
});

describe('protonation chemistry', () => {
  const at = async (smiles: string, pH: number) => adjustHydrogensForPh(generateFromSmiles(smiles), pH);
  const idcode = (result: ProtonationResult) => Molecule.fromMolfile(result.structure.molfile).getIDCode();
  test('the expected zwitterions keep the specified stereocentre', async () => {
    expect(idcode(await at('C[C@H](N)C(=O)O', 7.4))).toBe(Molecule.fromSmiles('C[C@H]([NH3+])C([O-])=O').getIDCode());
    expect(idcode(await at('OC(=O)C1=CN(C2CC2)c2cc(N3CCNCC3)c(F)cc2C1=O', 7.4))).toBe(Molecule.fromSmiles('[O-]C(=O)C1=CN(C2CC2)c2cc(N3CC[NH2+]CC3)c(F)cc2C1=O').getIDCode());
    expect(idcode(await at('N[C@@H](Cc1c[nH]cn1)C(=O)O', 2))).toBe(Molecule.fromSmiles('[NH3+][C@@H](Cc1c[nH]c[nH+]1)C(O)=O').getIDCode());
  });
  test('changes name the group, the crossed pKa and the output atom', async () => {
    const result = await at('OP(=O)(O)O', 7.4);
    expect(result.changes.map(({ group, pKa, change }) => ({ group, pKa, change }))).toEqual([
      { group: 'phosphoric-acid', pKa: 2.16, change: 'deprotonated' }, { group: 'phosphoric-acid', pKa: 7.21, change: 'deprotonated' },
    ]);
    for (const change of result.changes) {
      expect(result.structure.atoms[change.atom].element).toBe('O'); expect(charges(result.structure)[change.atom]).toBe(-1);
    }
  });
  test('explicit charges of the modelled groups are re-assigned; permanent and other charges stay', async () => {
    expect(idcode(await at('CC(=O)[O-]', 2))).toBe(Molecule.fromSmiles('CC(=O)O').getIDCode());
    expect(idcode(await at('[NH3+]CC([O-])=O', 12))).toBe(Molecule.fromSmiles('NCC([O-])=O').getIDCode());
    for (const smiles of ['C[N+](C)(C)C', '[O-][N+](=O)c1ccccc1', 'C[n+]1ccccc1', 'CC(N)=O']) for (const pH of [0, 14]) {
      const result = await at(smiles, pH);
      expect(result.changes).toEqual([]); expect(idcode(result)).toBe(Molecule.fromSmiles(smiles).getIDCode());
    }
  });
  test('a second pass changes nothing, and pH 2 → 12 → 2 returns to the pH 2 state', async () => {
    const source = generateFromSmiles('NC(=N)NCCC[C@H](N)C(=O)O');
    const first = await adjustHydrogensForPh(source, 7.4), again = await adjustHydrogensForPh(first.structure, 7.4);
    expect(again.changes).toEqual([]); expect(again.structure.atoms).toEqual(first.structure.atoms);
    const low = await adjustHydrogensForPh(source, 2), back = await adjustHydrogensForPh((await adjustHydrogensForPh(low.structure, 12)).structure, 2);
    expect(idcode(back)).toBe(idcode(low));
  });
  test('deprotonating explicit H removes those atoms and reports exact provenance', async () => {
    const source = generateFromSmiles('CC(=O)O'), result = await adjustHydrogensForPh(source, 7.4);
    const kept = result.structure.sourceAtomIndices;
    expect(result.structure.atoms.length).toBe(source.atoms.length - 1); expect(kept).not.toContain(-1);
    const removed = source.atoms.map((_, i) => i).filter(i => !kept.includes(i));
    expect(removed).toHaveLength(1);
    expect(neighbours(source, removed[0]).map(i => source.atoms[i].element)).toEqual(['O']);
  });
  test('bounded change list, atom budget and pH range fail or truncate explicitly without changing the input', async () => {
    const acids = Molecule.fromSmiles(Array.from({ length: 42 }, () => 'OP(=O)(O)O').join('.'));
    const many = await adjustHydrogensForPh(snapshotMolecule(acids), 7.4);
    expect(many.changes).toHaveLength(64); expect(many.omittedChanges).toBe(20); expect(many.structure.atoms).toHaveLength(252);
    const amines = snapshotMolecule(Molecule.fromSmiles(Array.from({ length: 50 }, () => 'CN').join('.')));
    const before = structuredClone(amines);
    await expect(adjustHydrogensForPh(amines, 7.4)).rejects.toThrow('1–256 atoms');
    expect(amines).toEqual(before);
    for (const pH of [-0.1, 14.1, Number.NaN]) await expect(adjustHydrogensForPh(amines, pH)).rejects.toThrow('pH from 0 to 14');
    const water = parseMolecule('3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n', 'xyz');
    await expect(adjustHydrogensForPh({ ...water, graphComplete: false }, 7.4)).rejects.toThrow('bond orders');
  });
  test('the chemistry worker runs the protonate action', async () => {
    const molecule = generateFromSmiles('NCC(=O)O');
    const result = await runChemistryTask({ action: 'protonate', molecule, pH: 7.4 });
    expect(result.pH).toBe(7.4); expect(result.changes.map(c => c.group).sort()).toEqual(['carboxylic-acid', 'primary-amine']);
    expect(charges(result.structure).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
