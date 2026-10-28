/** Browser workbench coordinates and unit-cell vectors are in angstrom. */
export type Vec3 = [number, number, number];
export type MolecularAtom = { element: string; x: number; y: number; z: number };
export type UnitCell = [Vec3, Vec3, Vec3];
export type MolecularBond = { a: number; b: number; order: number };
