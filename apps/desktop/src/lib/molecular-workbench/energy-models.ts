/** The energy models a structure can be optimized and evaluated with, in Avogadro's
 * recommendation order (GAFF, MMFF94, UFF, LJ, without GAFF). The Lennard-Jones model
 * follows Avogadro's calc/lennardjones.cpp, revision
 * cb0e94852889da9f7288bd1e58241e69990935a7 (BSD-3-Clause), with its Alvarez van der
 * Waals radii (core/elementdata.h). See docs/third-party/avogadro-LICENSE. */
import type { EnergyEvaluator } from './optimization';
import type { MolecularAtom, MolecularForceField, Vec3 } from './types';

export type EnergyModel = {
  id: MolecularForceField; name: string;
  /** Elements the model has parameters for; null accepts every element. */
  elements: ReadonlySet<string> | null;
  /** Typed from the bond graph with every hydrogen explicit. */
  graph: boolean;
};

// MMFF94 covers organic molecules and the common counter-ions.
const MMFF_ELEMENTS = new Set('H C N O F Si P S Cl Br I Li Na K Mg Ca Fe Cu Zn'.split(' '));
// Alvarez, Dalton Trans. 42, 8617 (2013), Å, for elements 1–118 in order.
const VDW_RADII: Readonly<Record<string, number>> = Object.fromEntries(
  ('H 1.2 He 1.43 Li 2.12 Be 1.98 B 1.91 C 1.77 N 1.66 O 1.5 F 1.46 Ne 1.58 Na 2.5 Mg 2.51 Al 2.25 Si 2.19 P 1.9 S 1.89 Cl 1.82 Ar 1.83 '
  + 'K 2.73 Ca 2.62 Sc 2.58 Ti 2.46 V 2.42 Cr 2.45 Mn 2.45 Fe 2.44 Co 2.4 Ni 2.4 Cu 2.38 Zn 2.39 Ga 2.32 Ge 2.29 As 1.88 Se 1.82 Br 1.86 Kr 2.25 '
  + 'Rb 3.21 Sr 2.84 Y 2.75 Zr 2.52 Nb 2.56 Mo 2.45 Tc 2.44 Ru 2.46 Rh 2.44 Pd 2.15 Ag 2.53 Cd 2.49 In 2.43 Sn 2.42 Sb 2.47 Te 1.99 I 2.04 Xe 2.06 '
  + 'Cs 3.48 Ba 3.03 La 2.98 Ce 2.88 Pr 2.92 Nd 2.95 Pm 2.9 Sm 2.87 Eu 2.83 Gd 2.79 Tb 2.87 Dy 2.81 Ho 2.83 Er 2.79 Tm 2.8 Yb 2.74 Lu 2.63 '
  + 'Hf 2.53 Ta 2.57 W 2.49 Re 2.48 Os 2.41 Ir 2.29 Pt 2.32 Au 2.45 Hg 2.47 Tl 2.6 Pb 2.54 Bi 2.5 Po 2.5 At 2.5 Rn 2.5 Fr 2.5 Ra 2.8 '
  + 'Ac 2.93 Th 2.88 Pa 2.71 U 2.82 Np 2.81 Pu 2.83 Am 3.05 Cm 3.38 Bk 3.05 Cf 3 Es 3 Fm 3 Md 3 No 3 Lr 3 Rf 3 Db 3 Sg 3 Bh 3 Hs 3 Mt 3 '
  + 'Ds 3 Rg 3 Cn 3 Nh 3 Fl 3 Mc 3 Lv 3 Ts 3 Og 3').match(/\S+ \S+/g)!.map(pair => { const [symbol, radius] = pair.split(' '); return [symbol, Number(radius)]; }));
// UFF (Rappé et al. 1992) parameterizes elements 1–103.
const UFF_ELEMENTS = new Set(Object.keys(VDW_RADII).slice(0, 103));

export const ENERGY_MODELS: readonly EnergyModel[] = [
  { id: 'MMFF94', name: 'MMFF94', elements: MMFF_ELEMENTS, graph: true },
  { id: 'MMFF94s', name: 'MMFF94s', elements: MMFF_ELEMENTS, graph: true },
  { id: 'UFF', name: 'UFF', elements: UFF_ELEMENTS, graph: true },
  { id: 'LJ', name: 'Lennard-Jones', elements: null, graph: false },
];
const RECOMMENDED = ['MMFF94', 'UFF'] as const;
/** A model, or the recommended one for the structure being optimized. */
export type EnergyModelChoice = MolecularForceField | 'auto';

export const energyModel = (id: MolecularForceField) => ENERGY_MODELS.find(model => model.id === id)!;

/** Why `id` cannot describe these atoms, or null. Graph typing failures (an atom
 * MMFF cannot type, missing hydrogens) are reported when the model runs. */
export function energyModelUnavailable(id: MolecularForceField, atoms: readonly Pick<MolecularAtom, 'element'>[]): string | null {
  const model = energyModel(id), missing = model.elements && [...new Set(atoms.map(atom => atom.element))].filter(element => !model.elements!.has(element));
  if (id === 'LJ') return atoms.some(atom => !(atom.element in VDW_RADII)) ? 'Lennard-Jones needs real elements.' : null;
  return missing?.length ? `${model.name} has no parameters for ${missing.join(', ')}.` : null;
}

/** The first of MMFF94 and UFF with parameters for every element, else Lennard-Jones. */
export function recommendedEnergyModel(atoms: readonly Pick<MolecularAtom, 'element'>[]): MolecularForceField {
  return RECOMMENDED.find(id => !energyModelUnavailable(id, atoms)) ?? 'LJ';
}

/** The model Automatic runs on a parsed structure. Lennard-Jones repels bonded atoms
 * to van der Waals contact, so it is chosen only for structures without bonds
 * (clusters, noble gases); a bonded structure neither graph field describes is an
 * error. UFF can still refuse an atom its typer does not recognize when it runs. */
export function resolveEnergyModel(choice: EnergyModelChoice, structure: { atoms: readonly Pick<MolecularAtom, 'element'>[]; bonds: readonly unknown[]; graphComplete: boolean }): MolecularForceField {
  if (choice !== 'auto') return choice;
  if (!structure.bonds.length) return 'LJ';
  if (!structure.graphComplete) throw new Error('XYZ does not specify bond orders or charges. Provide SMILES or SDF before this calculation, or choose Lennard-Jones for a non-bonded cluster.');
  const field = RECOMMENDED.find(id => !energyModelUnavailable(id, structure.atoms));
  if (!field) throw new Error(`${energyModelUnavailable('UFF', structure.atoms)} Choose Lennard-Jones for a non-bonded cluster.`);
  return field;
}

const KJ_PER_KCAL = 4.184, DEPTH = 100 / KJ_PER_KCAL, EXPONENT = 6, CLOSEST = 0.1;

/** E = ε Σ_{i<j} [(σ/r)¹² − 2(σ/r)⁶] over every pair, bonded or not, with σ the sum
 * of van der Waals radii and ε = 100 kJ/mol; r is clamped at 0.1 Å. kcal/mol. */
export function createLennardJonesEvaluator(elements: readonly string[]): EnergyEvaluator {
  const radii = elements.map(element => VDW_RADII[element]);
  if (radii.some(radius => radius === undefined)) throw new Error('Lennard-Jones needs real elements.');
  const evaluate = (atoms: MolecularAtom[], gradient?: Vec3[]) => {
    if (atoms.length !== radii.length || atoms.some((atom, i) => atom.element !== elements[i])) throw new Error('Energy coordinates must preserve molecular atom identities.');
    let energy = 0;
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      const delta: Vec3 = [atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z];
      const r = Math.max(Math.hypot(...delta), CLOSEST), ratio = ((radii[i] + radii[j]) / r) ** EXPONENT;
      energy += DEPTH * (ratio * ratio - 2 * ratio);
      if (!gradient) continue;
      const scale = -2 * DEPTH * EXPONENT * ratio * (ratio - 1) / (r * r);
      for (let axis = 0; axis < 3; axis++) { gradient[i][axis] += scale * delta[axis]; gradient[j][axis] -= scale * delta[axis]; }
    }
    return energy;
  };
  return {
    energy: atoms => evaluate(atoms),
    gradient(atoms) { const gradient = atoms.map((): Vec3 => [0, 0, 0]); evaluate(atoms, gradient); return gradient; },
    dispose() {},
  };
}
