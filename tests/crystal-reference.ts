import { readFileSync } from "node:fs";
import type { MolecularAtom, UnitCell, Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";

/** Independent references from tests/fixtures/crystals/generate-reference.py (pymatgen, spglib, ASE). */
export type ReferenceSite = { element: string; fractional: Vec3 };
export type ReferenceFixture = {
  cell: UnitCell; parameters: Record<"a" | "b" | "c" | "alpha" | "beta" | "gamma", number>; volume: number; atomCount: number; formula: string;
  sites: ReferenceSite[];
  spglib: Record<string, {
    number: number; hallNumber: number; international: string; operations: number; wyckoffs: string[]; equivalentAtoms: number[];
  } & Record<"conventionalIdealized" | "conventionalRaw" | "primitiveIdealized" | "primitiveRaw", { parameters: ReferenceFixture["parameters"]; volume: number; atomCount: number }>>;
  niggli: { parameters: ReferenceFixture["parameters"]; volume: number };
  supercell_2x2x1: { atomCount: number; volume: number };
  standardOrientation: UnitCell;
  scaledVolume: { volume: number; cell: UnitCell };
  editedCell: { cell: UnitCell; fractionalPolicy: Vec3[]; cartesianPolicyFractional: Vec3[] };
  periodicBonds?: { bonds: [number, number, Vec3][]; fragments: { atoms: number[]; periodic: boolean }[] };
  pairDistribution?: { rMax: number; binWidth: number; volume: number; total: number[]; gTotal: number[]; partial: Record<string, { counts: number[]; g: number[] }> };
  xrd?: { twoTheta: number; d: number; relativeIntensity: number; multiplicity: number; families: Vec3[] }[];
};

export const fixtureText = (name: string) => readFileSync(new URL(`fixtures/crystals/${name}`, import.meta.url), "utf8");
export const reference = JSON.parse(fixtureText("reference.json")) as {
  generator: Record<string, string>;
  fixtures: Record<string, ReferenceFixture>;
  molecules: Record<string, { file: string; schoenflies: string }>;
};

const det = ([a, b, c]: UnitCell) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
/** Fractional coordinates by Cramer's rule, independent of the code under test. */
export const fractional = (point: Vec3, cell: UnitCell) => [0, 1, 2].map(axis => det(cell.map((vector, index) => index === axis ? point : vector) as UnitCell) / det(cell)) as Vec3;

/**
 * Pairs each atom with the reference site at the same fractional position modulo the
 * lattice, and the whole-cell shift between them (ours = reference + shift).
 */
export function matchSites(atoms: readonly MolecularAtom[], cell: UnitCell, sites: readonly ReferenceSite[], tolerance = 1e-5) {
  const used = new Set<number>();
  return atoms.map((atom, index) => {
    const f = fractional([atom.x, atom.y, atom.z], cell);
    const match = sites.findIndex((site, k) => !used.has(k) && site.element === atom.element && site.fractional.every((value, axis) => { const d = f[axis] - value; return Math.abs(d - Math.round(d)) < tolerance; }));
    if (match < 0) throw new Error(`Atom ${index + 1} (${atom.element}) has no reference site.`);
    used.add(match);
    return { site: match, shift: f.map((value, axis) => Math.round(value - sites[match].fractional[axis])) as Vec3 };
  });
}

/** One canonical key per undirected periodic bond. */
export function bondKey(a: number, b: number, image: readonly number[]) {
  const forward = a < b || (a === b && (image[0] > 0 || (image[0] === 0 && (image[1] > 0 || (image[1] === 0 && image[2] > 0)))));
  return forward ? `${a}-${b}:${image.join(",")}` : `${b}-${a}:${image.map(value => -value || 0).join(",")}`;
}
