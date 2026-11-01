import { ELEMENT_SYMBOLS } from "./elements";
import type { MolecularAtom, UnitCell, Vec3 } from "./types";

/**
 * VASP POSCAR/CONTCAR structures (VASP 5 layout with a species line, or VASP 4
 * with the species named in the comment line, as pymatgen accepts them).
 *
 * The universal scale multiplies the lattice and Cartesian positions; a negative
 * scale is the target cell volume in Å³, and three scales multiply the lattice
 * vectors' x, y and z components (VASP 6). Direct positions are fractional in the
 * unscaled-shape lattice and therefore follow it. Selective-dynamics flags are kept
 * per atom. Velocity and predictor-corrector blocks after the positions are ignored.
 */

export type PoscarStructure = {
  title: string;
  atoms: MolecularAtom[];
  cell: UnitCell;
  /** Per atom x, y, z "may move" flags when the file declares Selective dynamics. */
  selectiveDynamics: [boolean, boolean, boolean][] | null;
};

const MAX_ATOMS = 100_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/u;

function numbers(line: string | undefined, count: number, what: string) {
  const fields = (line ?? "").trim().split(/\s+/u).slice(0, count);
  if (fields.length !== count || fields.some(field => !NUMBER.test(field))) throw new Error(`The POSCAR ${what} must have ${count} numbers.`);
  return fields.map(field => {
    const value = Number(field.replace(/[dD]/u, "e"));
    if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error(`The POSCAR ${what} is out of range.`);
    return value;
  });
}

const determinant = ([a, b, c]: UnitCell) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
const symbol = (name: string) => {
  // POTCAR-style names such as "Fe_pv" or "O_s" name the element before the underscore.
  const element = name.split(/[_/.]/u)[0];
  return /^[A-Z][a-z]?$/u.test(element) && ELEMENT_SYMBOLS.includes(element) ? element : null;
};

export function readPoscar(text: string): PoscarStructure {
  if (text.length > 20_000_000 || text.includes("\0")) throw new Error("POSCAR input exceeds 20 MB or contains binary data.");
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const title = (lines[0] ?? "").trim();
  const scale = numbers(lines[1], (lines[1] ?? "").trim().split(/\s+/u).length >= 3 ? 3 : 1, "scale");
  const raw = [2, 3, 4].map(index => numbers(lines[index], 3, "lattice vector")) as UnitCell;
  if (Math.abs(determinant(raw)) < 1e-8) throw new Error("The POSCAR lattice vectors are not independent.");
  let factors: Vec3;
  if (scale.length === 3) {
    if (!scale.every(value => value > 0)) throw new Error("Three POSCAR scale factors must be positive.");
    factors = scale as Vec3;
  } else if (scale[0] > 0) factors = [scale[0], scale[0], scale[0]];
  else if (scale[0] < 0) {
    const factor = Math.cbrt(-scale[0] / Math.abs(determinant(raw)));
    factors = [factor, factor, factor];
  } else throw new Error("The POSCAR scale factor cannot be zero.");
  const cell = raw.map(vector => vector.map((value, axis) => value * factors[axis])) as UnitCell;

  let cursor = 5;
  let names: string[] | null = null;
  const first = (lines[cursor] ?? "").trim().split(/\s+/u);
  if (first.length && first.every(field => !/^\d+$/u.test(field))) {
    names = first;
    cursor++;
  }
  const countFields = (lines[cursor] ?? "").trim().split(/\s+/u);
  if (!countFields.length || countFields.some(field => !/^\d+$/u.test(field))) throw new Error("The POSCAR atom counts are missing.");
  const counts = countFields.map(Number);
  cursor++;
  if (!names) {
    // VASP 4: species come from the POTCAR; pymatgen reads them from the comment line.
    const fromTitle = title.split(/\s+/u).filter(Boolean);
    if (fromTitle.length < counts.length || !fromTitle.slice(0, counts.length).every(symbol)) {
      throw new Error("This POSCAR does not name its elements. Add the element line above the atom counts.");
    }
    names = fromTitle.slice(0, counts.length);
  }
  if (names.length !== counts.length) throw new Error("The POSCAR element and count lines differ in length.");
  const elements = names.map(name => {
    const element = symbol(name);
    if (!element) throw new Error(`The POSCAR names an unknown element: ${name.slice(0, 16)}.`);
    return element;
  });
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < 1 || total > MAX_ATOMS) throw new Error(`A POSCAR must hold 1–${MAX_ATOMS} atoms.`);

  let mode = (lines[cursor] ?? "").trim();
  const selective = /^s/iu.test(mode);
  if (selective) mode = (lines[++cursor] ?? "").trim();
  if (!/^[dcks]/iu.test(mode)) throw new Error("The POSCAR must state Direct or Cartesian coordinates.");
  const cartesian = /^[ck]/iu.test(mode);
  cursor++;

  const atoms: MolecularAtom[] = [];
  const flags: [boolean, boolean, boolean][] = [];
  const species = elements.flatMap((element, index) => Array.from({ length: counts[index] }, () => element));
  for (let index = 0; index < total; index++) {
    const line = lines[cursor + index];
    const point = numbers(line, 3, `position ${index + 1}`) as Vec3;
    if (selective) {
      const fields = line.trim().split(/\s+/u).slice(3, 6);
      if (fields.length !== 3 || fields.some(field => !/^[TF]/iu.test(field))) throw new Error(`POSCAR position ${index + 1} lacks its selective-dynamics flags.`);
      flags.push(fields.map(field => /^T/iu.test(field)) as [boolean, boolean, boolean]);
    }
    const [x, y, z] = cartesian
      ? point.map((value, axis) => value * factors[axis])
      : [0, 1, 2].map(axis => point[0] * cell[0][axis] + point[1] * cell[1][axis] + point[2] * cell[2][axis]);
    atoms.push({ element: species[index], x, y, z });
  }
  return { title, atoms, cell, selectiveDynamics: selective ? flags : null };
}

const text = (value: number) => (Object.is(value, -0) ? "0" : String(value));

/**
 * VASP 5 POSCAR with unit scale and Direct coordinates. Consecutive atoms of one
 * element form one species block, so atom order is preserved exactly (an element
 * may appear in several blocks, which VASP accepts).
 */
export function writePoscar(structure: { title: string; atoms: MolecularAtom[]; cell: UnitCell; selectiveDynamics?: [boolean, boolean, boolean][] | null }) {
  const { atoms, cell } = structure;
  if (!atoms.length || atoms.length > MAX_ATOMS) throw new Error(`A POSCAR must hold 1–${MAX_ATOMS} atoms.`);
  const flags = structure.selectiveDynamics;
  if (flags && flags.length !== atoms.length) throw new Error("Selective-dynamics flags do not match the atoms.");
  const volume = determinant(cell);
  if (!Number.isFinite(volume) || Math.abs(volume) < 1e-8) throw new Error("The cell must contain three independent lattice vectors.");
  const blocks: { element: string; count: number }[] = [];
  for (const atom of atoms) {
    if (!ELEMENT_SYMBOLS.includes(atom.element)) throw new Error(`POSCAR cannot store element ${atom.element}.`);
    const last = blocks[blocks.length - 1];
    if (last?.element === atom.element) last.count++;
    else blocks.push({ element: atom.element, count: 1 });
  }
  // Cramer's rule on rows: f solves f · cell = r.
  const fractional = (point: Vec3) => [0, 1, 2].map(axis => {
    const replaced = cell.map((vector, index) => (index === axis ? point : vector)) as UnitCell;
    return determinant(replaced) / volume;
  });
  const lines = [
    structure.title.replace(/[\r\n]+/gu, " ").trim() || "Burette",
    "1.0",
    ...cell.map(vector => vector.map(text).join(" ")),
    blocks.map(block => block.element).join(" "),
    blocks.map(block => block.count).join(" "),
    ...(flags ? ["Selective dynamics"] : []),
    "Direct",
    ...atoms.map((atom, index) => [...fractional([atom.x, atom.y, atom.z]).map(text), ...(flags ? flags[index].map(flag => (flag ? "T" : "F")) : [])].join(" ")),
  ];
  return `${lines.join("\n")}\n`;
}

/** File names VASP itself uses, with or without a suffix such as CONTCAR_relaxed or POSCAR.vasp. */
export function isPoscarFileName(name: string) {
  const base = name.split("/").pop() ?? "";
  return /\.(?:vasp|poscar)$/iu.test(base) || /^(?:POSCAR|CONTCAR)(?:[._-].*)?$/u.test(base);
}
