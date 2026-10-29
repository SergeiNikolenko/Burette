/** Browser workbench coordinates and unit-cell vectors are in angstrom. */
export type Vec3 = [number, number, number];
export type MolecularAtom = { element: string; x: number; y: number; z: number };
export type UnitCell = [Vec3, Vec3, Vec3];
export type MolecularBond = { a: number; b: number; order: number };

export type MolecularForceField = 'MMFF94' | 'MMFF94s' | 'UFF';

export type MinimizerMethod = 'lbfgs' | 'fire' | 'abc-fire' | 'hybrid';

export type InputConstraint = { kind: "freeze" | "distance" | "angle" | "dihedral"; atoms: number[] };
