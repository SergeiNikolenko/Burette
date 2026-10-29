import type { MolecularAtom, MolecularBond, UnitCell } from "../molecular-workbench/types";
import { serializeXyz } from "../molecular-workbench/xyz";

export const HARTREE_EV = 27.211386245988;
export const HARTREE_KCAL_MOL = 627.509474;
export const HARTREE_KJ_MOL = 2625.499639;

/** Energy differences in the units chemists compare them in; `digits` keeps sub-kcal resolution in each. */
export const ENERGY_UNITS = {
  "kcal/mol": { factor: HARTREE_KCAL_MOL, digits: 2 },
  "kJ/mol": { factor: HARTREE_KJ_MOL, digits: 2 },
  eV: { factor: HARTREE_EV, digits: 4 },
  Eh: { factor: 1, digits: 6 },
} as const;
export type EnergyUnit = keyof typeof ENERGY_UNITS;

export function fileStem(name: string) {
  return (name.split("/").pop() || "structure").replace(/\.[^.]+$/u, "") || "structure";
}

/**
 * MOL/SDF text with explicit bonds. V2000 holds 999 atoms; larger graphs use V3000.
 * Metal–ligand edges are written as V3000 coordination bonds (type 9), never as covalent bonds.
 */
export function sdfFromGraph(atoms: MolecularAtom[], bonds: MolecularBond[], title: string, coordination: { a: number; b: number }[] = []) {
  const name = title.replace(/[\r\n]/gu, " ").slice(0, 80);
  const order = (bond: MolecularBond) => bond.order === 1.5 ? 4 : bond.order;
  const coordinate = (value: number) => value.toFixed(4);
  if (atoms.length <= 999 && bonds.length <= 999 && coordination.length === 0) {
    const pad = (value: string | number, width: number) => String(value).padStart(width);
    const lines = [name, "  Burette           3D", "", `${pad(atoms.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`];
    for (const atom of atoms) lines.push(`${pad(coordinate(atom.x), 10)}${pad(coordinate(atom.y), 10)}${pad(coordinate(atom.z), 10)} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
    for (const bond of bonds) lines.push(`${pad(bond.a + 1, 3)}${pad(bond.b + 1, 3)}${pad(order(bond), 3)}  0  0  0  0`);
    return `${lines.join("\n")}\nM  END\n$$$$\n`;
  }
  const lines = [name, "  Burette           3D", "", "  0  0  0     0  0            999 V3000", "M  V30 BEGIN CTAB", `M  V30 COUNTS ${atoms.length} ${bonds.length + coordination.length} 0 0 0`, "M  V30 BEGIN ATOM"];
  atoms.forEach((atom, index) => lines.push(`M  V30 ${index + 1} ${atom.element} ${coordinate(atom.x)} ${coordinate(atom.y)} ${coordinate(atom.z)} 0`));
  lines.push("M  V30 END ATOM", "M  V30 BEGIN BOND");
  bonds.forEach((bond, index) => lines.push(`M  V30 ${index + 1} ${order(bond)} ${bond.a + 1} ${bond.b + 1}`));
  coordination.forEach((bond, index) => lines.push(`M  V30 ${bonds.length + index + 1} 9 ${bond.a + 1} ${bond.b + 1}`));
  lines.push("M  V30 END BOND", "M  V30 END CTAB");
  return `${lines.join("\n")}\nM  END\n$$$$\n`;
}

/** Extended XYZ keeps the cell in the comment line so later builders and exports can read it back. */
export function extendedXyz(atoms: MolecularAtom[], cell: UnitCell, title: string) {
  const lattice = cell.flat().map((value) => value.toFixed(6)).join(" ");
  return serializeXyz(atoms, `Lattice="${lattice}" Properties=species:S:1:pos:R:3 ${title}`.trim());
}

export function multiFrameXyz(frames: { atoms: MolecularAtom[]; comment: string }[]) {
  return frames.map((frame) => serializeXyz(frame.atoms, frame.comment).replace(/\n?$/u, "\n")).join("");
}

/**
 * Atom metadata the coordinate-and-bond writer above cannot carry. Builders that
 * re-serialize a molecule refuse such input instead of exporting a different compound.
 */
export function unsupportedAtomMetadata(molfile: string) {
  if (/\bCHG=-?[1-9]/u.test(molfile) || /^M {2}CHG/mu.test(molfile)) return "formal charges";
  if (/\bMASS=\d/u.test(molfile) || /^M {2}ISO/mu.test(molfile)) return "isotope labels";
  if (/\bRAD=[1-9]/u.test(molfile) || /^M {2}RAD/mu.test(molfile)) return "radicals";
  return null;
}

/** OCL writes a bare V3000 molfile; an SDF record needs its terminator. */
export function sdfRecord(molfile: string) {
  return `${molfile.replace(/\s*$/u, "")}\n$$$$\n`;
}

/**
 * MMFF94 energy and per-atom forces (force = −dE/dr) as CSV, one row per atom and frame.
 * Units are in the header so the numbers stay interpretable outside Burette.
 */
export function forcesCsv(elements: string[], frames: { energy: number; forces: [number, number, number][] }[]) {
  const rows = ["frame,atom,element,energy_kcal_mol,fx_kcal_mol_A,fy_kcal_mol_A,fz_kcal_mol_A"];
  frames.forEach((frame, index) => frame.forces.forEach((force, atom) => {
    rows.push([index + 1, atom + 1, elements[atom], frame.energy.toFixed(6), ...force.map((value) => value.toFixed(6))].join(","));
  }));
  return `${rows.join("\n")}\n`;
}

export function atomLabel(atoms: { element: string }[], index: number) {
  return `${atoms[index]?.element ?? "?"}${index + 1}`;
}
