import type { MolecularAtom, UnitCell, InputConstraint } from "./types";
import { ELEMENT_SYMBOLS as elements } from "./elements";
import { cartesianToFractional } from "./crystal";
import { resolveZmatrixDocument, type ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import { zmatrixDocumentFromAtoms } from "../../../../../scripts/zmatrix-export.mjs";

export type QuantumEngine = "orca" | "gaussian" | "psi4" | "cp2k";
export type CoordinateStyle = "cartesian" | "zmatrix";
export type { InputConstraint } from "./types";
export type QuantumInputOptions = {
  engine: QuantumEngine; charge: number; multiplicity: number; method: string; basis: string;
  task?: "energy" | "optimize" | "frequencies"; constraints?: InputConstraint[]; cell?: UnitCell;
  coordinates?: CoordinateStyle;
  /** The Z-matrix the user wrote for these atoms; without it one is built in atom order. */
  definition?: ZmatrixDocument;
};
/** The method and basis Export input file starts each program with. */
export const QUANTUM_INPUT_DEFAULTS: Record<QuantumEngine, { method: string; basis: string }> = {
  orca: { method: "B3LYP", basis: "def2-SVP" },
  gaussian: { method: "B3LYP", basis: "6-31G(d)" },
  psi4: { method: "b3lyp", basis: "def2-svp" },
  cp2k: { method: "PBE", basis: "DZVP-MOLOPT-SR-GTH" },
};
/** Programs whose geometry can be a Z-matrix: Gaussian and Psi4 natively, ORCA as `* gzmt`. */
export const ZMATRIX_ENGINES: readonly QuantumEngine[] = ["orca", "gaussian", "psi4"];

const number = (value: number) => value.toFixed(8);

/** Z-matrix rows of the structure, as Avogadro's `$$zmat$$` block writes them: one
 * row per atom in atom order, references by row number. Gaussian and Psi4 keep the
 * definition's shared variables; ORCA reads numbers only. */
function zmatrixGeometry(atoms: MolecularAtom[], options: QuantumInputOptions, constraints: InputConstraint[]) {
  const definition = options.definition ?? zmatrixDocumentFromAtoms(atoms.map(atom => ({ element: atom.element, position: [atom.x, atom.y, atom.z] })));
  const real = definition.rows.filter(row => row.element !== "X");
  if (real.length !== atoms.length || real.some((row, i) => row.element !== atoms[i].element)) throw new Error("The Z-matrix does not match the structure's atoms.");
  // A dummy point shifts the row numbers that constraints would have to name.
  if (real.length !== definition.rows.length && constraints.length) throw new Error("This geometry needs a dummy point in its Z-matrix; export constraints with Cartesian coordinates.");
  const variables = options.engine !== "orca" ? definition.variables : [];
  const rows: { element: string; refs: number[]; values: (number | string)[] }[] = variables.length ? definition.rows : resolveZmatrixDocument(definition);
  const dummy = options.engine === "orca" ? "DA" : "X";
  const lines = rows.map(row => [row.element === "X" ? dummy : row.element, ...row.refs.flatMap((ref, i) => {
    const value = row.values[i];
    return [ref + 1, typeof value === "number" ? number(value) : value];
  })].join(" ")).join("\n");
  return { lines, variables: variables.map(({ name, value }) => `${name}=${number(value)}`) };
}

// Input-file generation only: these strings do not run a quantum-chemistry engine.
// Constraints freeze the current coordinate, using each engine's documented index convention.
export function generateQuantumInput(atoms: MolecularAtom[], options: QuantumInputOptions) {
  if (!atoms.length || atoms.length > 100_000 || atoms.some(atom => !elements.includes(atom.element) || ![atom.x, atom.y, atom.z].every(value => Number.isFinite(value) && Math.abs(value) < 1e6))) throw new Error("Provide 1–100000 atoms with valid elements and finite coordinates.");
  const { engine, charge, multiplicity, method, basis, task = "energy", constraints = [] } = options;
  if (!["orca", "gaussian", "psi4", "cp2k"].includes(engine) || !["energy", "optimize", "frequencies"].includes(task)) throw new Error("Unsupported engine or calculation task.");
  if (!Number.isInteger(charge) || Math.abs(charge) > 100 || !Number.isInteger(multiplicity) || multiplicity < 1 || multiplicity > 101) throw new Error("Choose an integer charge and positive spin multiplicity.");
  const electrons = atoms.reduce((sum, atom) => sum + elements.indexOf(atom.element) + 1, 0) - charge;
  if (electrons < 1 || multiplicity - 1 > electrons || (electrons - multiplicity + 1) % 2) throw new Error("The charge and multiplicity are inconsistent with the electron count.");
  if (![method, basis].every(value => /^[A-Za-z0-9][A-Za-z0-9_+*(),.\/-]{0,79}$/.test(value))) throw new Error("Method and basis must be single valid keywords.");
  if (constraints.length && task !== "optimize") throw new Error("Constraints require a geometry optimization.");
  for (const constraint of constraints) {
    const count = { freeze: 1, distance: 2, angle: 3, dihedral: 4 }[constraint.kind];
    if (!count || constraint.atoms.length !== count || new Set(constraint.atoms).size !== count || constraint.atoms.some(index => !Number.isInteger(index) || index < 0 || index >= atoms.length)) throw new Error("A constraint references invalid atom indices.");
  }
  const coordinates = atoms.map(atom => `${atom.element} ${number(atom.x)} ${number(atom.y)} ${number(atom.z)}`).join("\n");
  if (options.coordinates === "zmatrix" && !ZMATRIX_ENGINES.includes(engine)) throw new Error("CP2K reads Cartesian coordinates only.");
  const zmatrix = options.coordinates === "zmatrix" ? zmatrixGeometry(atoms, options, constraints) : null;
  if (engine === "orca") {
    const keywords = { energy: "SP", optimize: "Opt", frequencies: "Freq" }[task];
    const lines = constraints.map(constraint => `    { ${{ freeze: "C", distance: "B", angle: "A", dihedral: "D" }[constraint.kind]} ${constraint.atoms.join(" ")} C }`);
    return { extension: "inp", text: `! ${method} ${basis} ${keywords}\n${lines.length ? `%geom\n  Constraints\n${lines.join("\n")}\n  end\nend\n` : ""}\n* ${zmatrix ? "gzmt" : "xyz"} ${charge} ${multiplicity}\n${zmatrix?.lines ?? coordinates}\n*\n` };
  }
  if (engine === "gaussian") {
    const keywords = { energy: "SP", optimize: constraints.length ? "Opt=ModRedundant" : "Opt", frequencies: "Freq" }[task];
    const lines = constraints.map(constraint => `${{ freeze: "X", distance: "B", angle: "A", dihedral: "D" }[constraint.kind]} ${constraint.atoms.map(index => index + 1).join(" ")} F`);
    // Variables follow the geometry after a blank line, then the ModRedundant section.
    const variables = zmatrix?.variables.length ? `${zmatrix.variables.join("\n")}\n\n` : "";
    return { extension: "gjf", text: `#p ${method}/${basis} ${keywords}\n\nBurette calculation\n\n${charge} ${multiplicity}\n${zmatrix?.lines ?? coordinates}\n\n${variables}${lines.length ? `${lines.join("\n")}\n\n` : ""}` };
  }
  if (engine === "psi4") {
    const settings = new Map<string, string[]>();
    for (const constraint of constraints) {
      const key = { freeze: "frozen_cartesian", distance: "frozen_distance", angle: "frozen_bend", dihedral: "frozen_dihedral" }[constraint.kind];
      settings.set(key, [...(settings.get(key) ?? []), constraint.atoms.map(index => index + 1).join(" ") + (constraint.kind === "freeze" ? " xyz" : "")]);
    }
    const frozen = [...settings].map(([key, entries]) => `  ${key} = "${entries.join(" ")}"`).join("\n");
    const action = { energy: "energy", optimize: "optimize", frequencies: "frequency" }[task];
    const geometry = zmatrix ? [zmatrix.lines, ...zmatrix.variables.map(assignment => assignment.replace("=", " = "))].join("\n") : coordinates;
    return { extension: "dat", text: `molecule molecule {\n${charge} ${multiplicity}\n${geometry}\nunits angstrom\nno_com\nno_reorient\nsymmetry c1\n}\n\nset {\n  basis ${basis}\n  reference ${multiplicity === 1 ? "rhf" : "uhf"}\n}\n${frozen ? `\nset optking {\n${frozen}\n}\n` : ""}\n${action}('${method}')\n` };
  }
  if (constraints.some(constraint => constraint.kind !== "freeze")) throw new Error("CP2K export currently supports frozen atoms only.");
  if (!["PBE", "BLYP"].includes(method.toUpperCase())) throw new Error("CP2K export supports PBE and BLYP with matching GTH pseudopotentials.");
  const cell = options.cell;
  if (cell && (cell.length !== 3 || cell.some(vector => vector.length !== 3 || !vector.every(Number.isFinite)))) throw new Error("CP2K requires finite cell vectors.");
  if (cell) cartesianToFractional([0, 0, 0], cell);
  const axes = ["x", "y", "z"] as const;
  const mins = axes.map(axis => atoms.reduce((min, atom) => Math.min(min, atom[axis]), Infinity));
  const lengths = axes.map((axis, index) => atoms.reduce((max, atom) => Math.max(max, atom[axis]), -Infinity) - mins[index] + 12);
  const cpCoordinates = cell ? coordinates : atoms.map(atom => `${atom.element} ${number(atom.x - mins[0] + 6)} ${number(atom.y - mins[1] + 6)} ${number(atom.z - mins[2] + 6)}`).join("\n");
  const cellLines = cell ? cell.map((vector, index) => `      ${["A", "B", "C"][index]} ${vector.map(number).join(" ")}`).join("\n") : `      ABC ${lengths.map(number).join(" ")}`;
  const kinds = [...new Set(atoms.map(atom => atom.element))].map(element => `    &KIND ${element}\n      BASIS_SET ${basis}\n      POTENTIAL GTH-${method.toUpperCase()}\n    &END KIND`).join("\n");
  const frozen = constraints.length ? `\n&MOTION\n  &CONSTRAINT\n    &FIXED_ATOMS\n      LIST ${constraints.map(constraint => constraint.atoms[0] + 1).join(" ")}\n    &END FIXED_ATOMS\n  &END CONSTRAINT\n&END MOTION\n` : "";
  return { extension: "inp", text: `&GLOBAL\n  PROJECT burette\n  RUN_TYPE ${{ energy: "ENERGY", optimize: "GEO_OPT", frequencies: "VIBRATIONAL_ANALYSIS" }[task]}\n&END GLOBAL\n&FORCE_EVAL\n  METHOD Quickstep\n  &DFT\n    BASIS_SET_FILE_NAME BASIS_MOLOPT\n    POTENTIAL_FILE_NAME GTH_POTENTIALS\n    CHARGE ${charge}\n    MULTIPLICITY ${multiplicity}\n    UKS ${multiplicity > 1 ? "TRUE" : "FALSE"}\n    &MGRID\n      CUTOFF 400\n    &END MGRID\n    &SCF\n      EPS_SCF 1.0E-6\n      MAX_SCF 100\n    &END SCF\n    &POISSON\n      PERIODIC ${cell ? "XYZ" : "NONE"}\n${cell ? "" : "      POISSON_SOLVER WAVELET\n"}    &END POISSON\n    &XC\n      &XC_FUNCTIONAL ${method.toUpperCase()}\n      &END XC_FUNCTIONAL\n    &END XC\n  &END DFT\n  &SUBSYS\n    &CELL\n${cellLines}\n      PERIODIC ${cell ? "XYZ" : "NONE"}\n    &END CELL\n    &COORD\n${cpCoordinates.split("\n").map(line => `      ${line}`).join("\n")}\n    &END COORD\n${kinds}\n  &END SUBSYS\n&END FORCE_EVAL\n${frozen}` };
}
