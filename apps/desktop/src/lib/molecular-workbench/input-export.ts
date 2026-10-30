import type { MolecularAtom, UnitCell, InputConstraint } from "./types";
import { ELEMENT_SYMBOLS as elements } from "./elements";
import { cartesianToFractional } from "./crystal";

export type QuantumEngine = "orca" | "gaussian" | "psi4" | "cp2k";
export type { InputConstraint } from "./types";
export type QuantumInputOptions = {
  engine: QuantumEngine; charge: number; multiplicity: number; method: string; basis: string;
  task?: "energy" | "optimize" | "frequencies"; constraints?: InputConstraint[]; cell?: UnitCell;
};

const number = (value: number) => value.toFixed(8);

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
  if (engine === "orca") {
    const keywords = { energy: "SP", optimize: "Opt", frequencies: "Freq" }[task];
    const lines = constraints.map(constraint => `    { ${{ freeze: "C", distance: "B", angle: "A", dihedral: "D" }[constraint.kind]} ${constraint.atoms.join(" ")} C }`);
    return { extension: "inp", text: `! ${method} ${basis} ${keywords}\n${lines.length ? `%geom\n  Constraints\n${lines.join("\n")}\n  end\nend\n` : ""}\n* xyz ${charge} ${multiplicity}\n${coordinates}\n*\n` };
  }
  if (engine === "gaussian") {
    const keywords = { energy: "SP", optimize: constraints.length ? "Opt=ModRedundant" : "Opt", frequencies: "Freq" }[task];
    const lines = constraints.map(constraint => `${{ freeze: "X", distance: "B", angle: "A", dihedral: "D" }[constraint.kind]} ${constraint.atoms.map(index => index + 1).join(" ")} F`);
    return { extension: "gjf", text: `#p ${method}/${basis} ${keywords}\n\nBurette calculation\n\n${charge} ${multiplicity}\n${coordinates}\n\n${lines.length ? `${lines.join("\n")}\n\n` : ""}` };
  }
  if (engine === "psi4") {
    const settings = new Map<string, string[]>();
    for (const constraint of constraints) {
      const key = { freeze: "frozen_cartesian", distance: "frozen_distance", angle: "frozen_bend", dihedral: "frozen_dihedral" }[constraint.kind];
      settings.set(key, [...(settings.get(key) ?? []), constraint.atoms.map(index => index + 1).join(" ") + (constraint.kind === "freeze" ? " xyz" : "")]);
    }
    const frozen = [...settings].map(([key, entries]) => `  ${key} = "${entries.join(" ")}"`).join("\n");
    const action = { energy: "energy", optimize: "optimize", frequencies: "frequency" }[task];
    return { extension: "dat", text: `molecule molecule {\n${charge} ${multiplicity}\n${coordinates}\nunits angstrom\nno_com\nno_reorient\nsymmetry c1\n}\n\nset {\n  basis ${basis}\n  reference ${multiplicity === 1 ? "rhf" : "uhf"}\n}\n${frozen ? `\nset optking {\n${frozen}\n}\n` : ""}\n${action}('${method}')\n` };
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
