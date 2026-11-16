import { Molecule } from 'openchemlib';

export type ProtonationGroup =
  | 'carboxylic-acid' | 'sulfonic-acid' | 'sulfuric-acid' | 'phosphoric-acid' | 'phosphate-monoester' | 'phosphate-diester'
  | 'phosphonic-acid' | 'phosphinic-acid' | 'tetrazole' | 'phenol' | 'aliphatic-thiol' | 'aromatic-thiol'
  | 'ammonia' | 'primary-amine' | 'secondary-amine' | 'tertiary-amine' | 'aniline' | 'pyridine' | 'imidazole' | 'amidine' | 'guanidine';
/** `atom` indexes the molecule after the change; `pKa` is the step that pH crossed. */
export type ProtonationChange = { atom: number; group: ProtonationGroup; pKa: number; change: 'protonated' | 'deprotonated' };

// Aqueous pKa (25 °C) of each group's parent compound; successive steps for
// polyprotic centres. Sources per row: docs/hydrogen-protonation.md.
const PKA: Record<ProtonationGroup, readonly number[]> = {
  'carboxylic-acid': [4.76], 'sulfonic-acid': [-1.9], 'sulfuric-acid': [-3, 1.99],
  'phosphoric-acid': [2.16, 7.21, 12.32], 'phosphate-monoester': [1.54, 6.31], 'phosphate-diester': [1.29],
  'phosphonic-acid': [2.38, 7.74], 'phosphinic-acid': [3.08], tetrazole: [4.90], phenol: [9.99],
  'aliphatic-thiol': [10.61], 'aromatic-thiol': [6.62], ammonia: [9.25], 'primary-amine': [10.66], 'secondary-amine': [10.73],
  'tertiary-amine': [9.80], aniline: [4.60], pyridine: [5.23], imidazole: [6.99], amidine: [12.4], guanidine: [13.6],
};

type Site = { group: ProtonationGroup; acid: boolean; atoms: number[] };

/**
 * Sets every recognised ionisable site to its majority state at `pH`, treating
 * each site independently by its group pKa (protonated iff pH < pKa). Polyprotic
 * P/S centres deprotonate one acidic O per crossed step. Charged forms of the same
 * groups are recognised and re-assigned; all other charges stay. A proton removed
 * from an explicit H deletes that H atom; added protons become implicit H for the
 * caller to place. Mutates `mol` and returns the changes in its final indices.
 */
export function assignProtonationStates(mol: Molecule, pH: number): ProtonationChange[] {
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const n = mol.getAllAtoms(), rings = mol.getRingSet();
  const z = (a: number) => mol.getAtomicNo(a), q = (a: number) => mol.getAtomCharge(a), h = (a: number) => mol.getAllHydrogens(a);
  const heavy = (a: number) => Array.from({ length: mol.getAllConnAtoms(a) }, (_, j) => ({ atom: mol.getConnAtom(a, j), order: mol.getConnBondOrder(a, j) })).filter(x => z(x.atom) > 1);
  const sp3 = (a: number) => !mol.isAromaticAtom(a) && mol.getAtomPi(a) === 0;
  const aromaticRings = (a: number, size?: number) => Array.from({ length: rings.getSize() }, (_, r) => r).filter(r => rings.isAromatic(r) && rings.isAtomMember(r, a) && (!size || rings.getRingSize(r) === size));
  const hetero = (r: number) => rings.getRingAtoms(r).filter(i => z(i) !== 6);
  // Benzenoid only: hydroxy/amino heteroaromatics protonate on ring N or tautomerise.
  const carbocyclic = (a: number) => aromaticRings(a).every(r => !hetero(r).length);
  // Neutral with H, or the conjugate base with one H fewer and charge −1.
  const acidic = (a: number) => (q(a) === 0 && h(a) > 0) || (q(a) === -1 && h(a) === 0);
  const terminalO = (x: { atom: number; order: number }, order: number) => z(x.atom) === 8 && x.order === order && heavy(x.atom).length === 1;
  const sites: Site[] = [];
  for (let a = 0; a < n; a++) {
    const nb = heavy(a), element = z(a);
    if (element === 6 && q(a) === 0 && !mol.isAromaticAtom(a)) {
      const oxo = nb.filter(x => terminalO(x, 2) && q(x.atom) === 0), hydroxy = nb.filter(x => terminalO(x, 1) && acidic(x.atom));
      if (oxo.length === 1 && hydroxy.length === 1 && nb.length <= 3 && nb.every(x => x === oxo[0] || x === hydroxy[0] || z(x.atom) === 6)) sites.push({ group: 'carboxylic-acid', acid: true, atoms: [hydroxy[0].atom] });
      const imino = nb.filter(x => z(x.atom) === 7 && x.order === 2), amino = nb.filter(x => z(x.atom) === 7 && x.order === 1);
      const iminoOk = imino.length === 1 && (() => {
        const nd = imino[0].atom, others = heavy(nd).filter(x => x.atom !== a);
        // Oximes, hydrazones, acyl and biguanide-bridging imines are not amidine bases.
        return others.every(x => z(x.atom) === 6 && (sp3(x.atom) || mol.isAromaticAtom(x.atom))) && ((q(nd) === 0 && h(nd) + others.length === 1) || (q(nd) === 1 && h(nd) > 0 && h(nd) + others.length === 2));
      })();
      if (iminoOk && amino.length && nb.length <= 3 && amino.every(x => q(x.atom) === 0 && !mol.isAromaticAtom(x.atom)) && nb.every(x => z(x.atom) === 7 || z(x.atom) === 6)) {
        sites.push({ group: amino.length === 2 ? 'guanidine' : 'amidine', acid: false, atoms: [imino[0].atom] });
      }
    } else if ((element === 15 || element === 16) && q(a) === 0 && nb.length === 4) {
      const oxo = nb.filter(x => terminalO(x, 2) && q(x.atom) === 0), acids = nb.filter(x => terminalO(x, 1) && acidic(x.atom)).map(x => x.atom);
      const esters = nb.filter(x => z(x.atom) === 8 && x.order === 1 && heavy(x.atom).length === 2).length, carbons = nb.filter(x => z(x.atom) === 6 && x.order === 1).length;
      const group: ProtonationGroup | null = !acids.length ? null : element === 16
        ? (oxo.length === 2 ? (acids.length === 2 ? 'sulfuric-acid' : acids.length === 1 ? 'sulfonic-acid' : null) : null)
        : oxo.length !== 1 ? null
        : acids.length === 3 ? 'phosphoric-acid'
        : acids.length === 2 && esters === 1 ? 'phosphate-monoester' : acids.length === 1 && esters === 2 ? 'phosphate-diester'
        : acids.length === 2 && carbons === 1 ? 'phosphonic-acid' : acids.length === 1 && carbons === 2 ? 'phosphinic-acid' : null;
      if (group) sites.push({ group, acid: true, atoms: acids });
    } else if (element === 8 || element === 16) {
      if (nb.length !== 1 || nb[0].order !== 1 || !acidic(a)) continue;
      const c = nb[0].atom;
      if (z(c) !== 6) continue;
      if (element === 8 && mol.isAromaticAtom(c) && carbocyclic(c)) sites.push({ group: 'phenol', acid: true, atoms: [a] });
      if (element === 16 && (mol.isAromaticAtom(c) ? carbocyclic(c) : sp3(c))) sites.push({ group: mol.isAromaticAtom(c) ? 'aromatic-thiol' : 'aliphatic-thiol', acid: true, atoms: [a] });
    } else if (element === 7 && mol.isAromaticAtom(a)) {
      const ring5 = aromaticRings(a, 5)[0], ring6 = aromaticRings(a, 6)[0];
      if (ring5 !== undefined && hetero(ring5).length === 4 && hetero(ring5).every(i => z(i) === 7) && nb.length === 2 && ((q(a) === 0 && h(a) === 1) || (q(a) === -1 && h(a) === 0))) {
        sites.push({ group: 'tetrazole', acid: true, atoms: [a] });
        continue;
      }
      // A ring N with two ring neighbours and no lone-pair donor role: neutral without H, or protonated.
      if (nb.length !== 2 || !((q(a) === 0 && h(a) === 0) || (q(a) === 1 && h(a) === 1))) continue;
      if (ring6 !== undefined && hetero(ring6).length === 1) sites.push({ group: 'pyridine', acid: false, atoms: [a] });
      else if (ring5 !== undefined && hetero(ring5).length === 2 && hetero(ring5).every(i => z(i) === 7)) {
        const other = hetero(ring5).find(i => i !== a)!;
        // 1,3-diazole: the partner N shares one ring carbon and is the pyrrole-type N (or the other NH of
        // imidazolium). Benzo-fusion keeps imidazole basicity; purine-type fusion to an aza ring does not.
        const bridged = heavy(other).some(x => heavy(a).some(y => y.atom === x.atom));
        const pyrrole = q(other) === 0 && heavy(other).length + h(other) === 3;
        const fused = rings.getRingAtoms(ring5).some(i => aromaticRings(i).some(r => r !== ring5 && hetero(r).length > 0));
        if (bridged && pyrrole && !fused) sites.push({ group: 'imidazole', acid: false, atoms: [a] });
      }
    } else if (element === 7 && mol.getAtomPi(a) === 0) {
      const valence = nb.length + h(a);
      if (!((q(a) === 0 && valence === 3) || (q(a) === 1 && h(a) > 0 && valence === 4)) || nb.some(x => z(x.atom) !== 6)) continue;
      const aryl = nb.filter(x => mol.isAromaticAtom(x.atom));
      // Amides, enamines, amidine N and N on any other unsaturated carbon are not amine bases.
      if (nb.some(x => !mol.isAromaticAtom(x.atom) && mol.getAtomPi(x.atom) > 0)) continue;
      if (aryl.length === 1 && carbocyclic(aryl[0].atom)) sites.push({ group: 'aniline', acid: false, atoms: [a] });
      else if (!aryl.length) sites.push({ group: (['ammonia', 'primary-amine', 'secondary-amine', 'tertiary-amine'] as const)[nb.length], acid: false, atoms: [a] });
    }
  }
  // Plan from the unmodified graph first: charge changes invalidate OCL's valence helpers.
  const changes: ProtonationChange[] = [], deletions: number[] = [];
  for (const { group, acid, atoms } of sites) {
    const steps = PKA[group], target = steps.filter(pKa => pH >= pKa).length;
    // Deprotonated atoms: acids at −1, bases neutral. Keep already-correct atoms; change the lowest indices.
    const isDeprotonated = (a: number) => acid ? q(a) === -1 : q(a) === 0;
    let current = atoms.filter(isDeprotonated).length;
    for (const a of atoms) {
      if (current < target && !isDeprotonated(a)) {
        // A proton held as implicit H disappears with the charge change; an explicit one is deleted (plain H first).
        if (!mol.getImplicitHydrogens(a)) {
          const explicit = Array.from({ length: mol.getAllConnAtoms(a) }, (_, j) => mol.getConnAtom(a, j)).filter(i => z(i) === 1);
          deletions.push(explicit.find(i => mol.isSimpleHydrogen(i)) ?? explicit[0]);
        }
        changes.push({ atom: a, group, pKa: steps[current++], change: 'deprotonated' });
      } else if (current > target && isDeprotonated(a)) changes.push({ atom: a, group, pKa: steps[--current], change: 'protonated' });
    }
  }
  for (const { atom, change } of changes) mol.setAtomCharge(atom, q(atom) + (change === 'protonated' ? 1 : -1));
  if (!deletions.length) return changes;
  const map = mol.deleteAtoms(deletions);
  return changes.map(change => ({ ...change, atom: map[change.atom] }));
}
