/** Browser workbench coordinates and unit-cell vectors are in angstrom. */
export type Vec3 = [number, number, number];
export type MolecularAtom = { element: string; x: number; y: number; z: number };
export type UnitCell = [Vec3, Vec3, Vec3];
export type MolecularBond = { a: number; b: number; order: number };

/** Energy models; see energy-models.ts for their elements and recommendation order. */
export type MolecularForceField = 'MMFF94' | 'MMFF94s' | 'UFF' | 'LJ';

export type MinimizerMethod = 'bfgs' | 'lbfgs' | 'fire' | 'abc-fire' | 'hybrid';

export type InputConstraint = { kind: "freeze" | "distance" | "angle" | "dihedral"; atoms: number[] };
