import type { MolecularAtom, UnitCell, InputConstraint } from "./types";
import { ELEMENT_SYMBOLS as elements } from "./elements";
import { cartesianToFractional } from "./crystal";
import { resolveZmatrixDocument, type ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import { zmatrixDocumentFromAtoms } from "../../../../../scripts/zmatrix-export.mjs";

export type QuantumEngine = "orca" | "gaussian" | "psi4" | "cp2k";
export type CoordinateStyle = "cartesian" | "zmatrix";
export type QuantumTask = "energy" | "optimize" | "frequencies" | "optimize-frequencies" | "transition-state";
export type SolventModel = "cpcm" | "smd";
export type Dispersion = "d3bj" | "d4";
export type ScfConvergence = "tight" | "very-tight";
export type { InputConstraint } from "./types";
export type QuantumInputOptions = {
  engine: QuantumEngine; charge: number; multiplicity: number; method: string; basis: string;
  task?: QuantumTask; constraints?: InputConstraint[]; cell?: UnitCell;
  coordinates?: CoordinateStyle;
  /** The Z-matrix the user wrote for these atoms; without it one is built in atom order. */
  definition?: ZmatrixDocument;
  /** Gaussian's title line; a comment in the other programs. */
  title?: string;
  solvation?: { model: SolventModel; solvent: Solvent };
  dispersion?: Dispersion;
  scf?: ScfConvergence;
  /** Parallel processes or threads; CP2K takes them from mpirun. */
  cores?: number;
  /** Total memory in MB; ORCA's per-core %maxcore keeps a quarter in reserve. */
  memory?: number;
  /** Gaussian checkpoint file name. */
  checkpoint?: string;
};

/** Each program's spelling of the common solvents; a missing entry is a solvent the program's model does not list. */
export const SOLVENTS = {
  water: { label: "Water", orca: "water", gaussian: "Water", psi4: "Water" },
  methanol: { label: "Methanol", orca: "methanol", gaussian: "Methanol", psi4: "Methanol" },
  ethanol: { label: "Ethanol", orca: "ethanol", gaussian: "Ethanol", psi4: "Ethanol" },
  acetonitrile: { label: "Acetonitrile", orca: "acetonitrile", gaussian: "Acetonitrile", psi4: "Acetonitrile" },
  acetone: { label: "Acetone", orca: "acetone", gaussian: "Acetone", psi4: "Acetone" },
  dmso: { label: "DMSO", orca: "dmso", gaussian: "DiMethylSulfoxide", psi4: "DMSO" },
  dmf: { label: "DMF", orca: "dmf", gaussian: "N,N-DiMethylFormamide" },
  thf: { label: "THF", orca: "thf", gaussian: "TetraHydroFuran", psi4: "THF" },
  dichloromethane: { label: "Dichloromethane", orca: "dichloromethane", gaussian: "Dichloromethane", psi4: "Methylenechloride" },
  chloroform: { label: "Chloroform", orca: "chloroform", gaussian: "Chloroform", psi4: "Chloroform" },
  toluene: { label: "Toluene", orca: "toluene", gaussian: "Toluene", psi4: "Toluene" },
  benzene: { label: "Benzene", orca: "benzene", gaussian: "Benzene", psi4: "Benzene" },
  hexane: { label: "Hexane", orca: "hexane", gaussian: "n-Hexane" },
} satisfies Record<string, { label: string; orca: string; gaussian: string; psi4?: string }>;
export type Solvent = keyof typeof SOLVENTS;

/** What each program's generated input can express. */
export const QUANTUM_INPUT_FEATURES: Record<QuantumEngine, { tasks: QuantumTask[]; solvation: SolventModel[]; dispersion: Dispersion[]; resources: boolean }> = {
  orca: { tasks: ["energy", "optimize", "frequencies", "optimize-frequencies", "transition-state"], solvation: ["cpcm", "smd"], dispersion: ["d3bj", "d4"], resources: true },
  gaussian: { tasks: ["energy", "optimize", "frequencies", "optimize-frequencies", "transition-state"], solvation: ["cpcm", "smd"], dispersion: ["d3bj"], resources: true },
  psi4: { tasks: ["energy", "optimize", "frequencies", "optimize-frequencies", "transition-state"], solvation: ["cpcm"], dispersion: ["d3bj", "d4"], resources: true },
  cp2k: { tasks: ["energy", "optimize", "frequencies"], solvation: [], dispersion: ["d3bj"], resources: false },
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
  const { engine, charge, multiplicity, method, basis, task = "energy", constraints = [], title, solvation, dispersion, scf, cores, memory, checkpoint } = options;
  const features = QUANTUM_INPUT_FEATURES[engine];
  if (!features?.tasks.includes(task)) throw new Error("Unsupported engine or calculation task.");
  const solvent = solvation ? (SOLVENTS[solvation.solvent] as Partial<Record<QuantumEngine, string>> | undefined)?.[engine] : undefined;
  if (solvation && (!features.solvation.includes(solvation.model) || !solvent)) throw new Error("This program does not offer that solvent model or solvent.");
  if (dispersion && !features.dispersion.includes(dispersion)) throw new Error("This program does not offer that dispersion correction.");
  if (scf && scf !== "tight" && scf !== "very-tight") throw new Error("Unsupported SCF convergence.");
  if ((cores !== undefined || memory !== undefined) && !features.resources) throw new Error("CP2K takes cores and memory from its launcher.");
  if (cores !== undefined && (!Number.isInteger(cores) || cores < 1 || cores > 1024)) throw new Error("Choose 1–1024 cores.");
  if (memory !== undefined && (!Number.isInteger(memory) || memory < 100 || memory > 10_000_000 || memory * 0.75 < (cores ?? 1))) throw new Error("Choose at least 100 MB of memory, and at least 2 MB per core.");
  if (title !== undefined && (!title.trim() || !/^[^\x00-\x1f\x7f]{1,80}$/.test(title))) throw new Error("The title must be one line of up to 80 characters.");
  if (checkpoint !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/.test(checkpoint)) throw new Error("The checkpoint name may use letters, digits, dots, dashes and underscores.");
  if (!Number.isInteger(charge) || Math.abs(charge) > 100 || !Number.isInteger(multiplicity) || multiplicity < 1 || multiplicity > 101) throw new Error("Choose an integer charge and positive spin multiplicity.");
  const electrons = atoms.reduce((sum, atom) => sum + elements.indexOf(atom.element) + 1, 0) - charge;
  if (electrons < 1 || multiplicity - 1 > electrons || (electrons - multiplicity + 1) % 2) throw new Error("The charge and multiplicity are inconsistent with the electron count.");
  if (![method, basis].every(value => /^[A-Za-z0-9][A-Za-z0-9_+*(),.\/-]{0,79}$/.test(value))) throw new Error("Method and basis must be single valid keywords.");
  if (constraints.length && task !== "optimize" && task !== "optimize-frequencies") throw new Error("Constraints require a geometry optimization.");
  for (const constraint of constraints) {
    const count = { freeze: 1, distance: 2, angle: 3, dihedral: 4 }[constraint.kind];
    if (!count || constraint.atoms.length !== count || new Set(constraint.atoms).size !== count || constraint.atoms.some(index => !Number.isInteger(index) || index < 0 || index >= atoms.length)) throw new Error("A constraint references invalid atom indices.");
  }
  const coordinates = atoms.map(atom => `${atom.element} ${number(atom.x)} ${number(atom.y)} ${number(atom.z)}`).join("\n");
  if (options.coordinates === "zmatrix" && !ZMATRIX_ENGINES.includes(engine)) throw new Error("CP2K reads Cartesian coordinates only.");
  const zmatrix = options.coordinates === "zmatrix" ? zmatrixGeometry(atoms, options, constraints) : null;
  const solventModel = solvation?.model === "smd" ? "SMD" : "CPCM";
  if (engine === "orca") {
    const keywords = { energy: "SP", optimize: "Opt", frequencies: "Freq", "optimize-frequencies": "Opt Freq", "transition-state": "OptTS Freq" }[task];
    // `! CPCM(...)` plus `smd true` reads the same in ORCA 5 and 6.
    const extras = [dispersion && { d3bj: "D3BJ", d4: "D4" }[dispersion], scf && { tight: "TightSCF", "very-tight": "VeryTightSCF" }[scf], solvation && `CPCM(${solvent})`].filter(Boolean);
    const lines = constraints.map(constraint => `    { ${{ freeze: "C", distance: "B", angle: "A", dihedral: "D" }[constraint.kind]} ${constraint.atoms.join(" ")} C }`);
    const geom = [task === "transition-state" ? "  Calc_Hess true" : "", lines.length ? `  Constraints\n${lines.join("\n")}\n  end` : ""].filter(Boolean);
    const blocks = [cores ? `%pal nprocs ${cores} end` : "", memory ? `%maxcore ${Math.floor(memory * 0.75 / (cores ?? 1))}` : "",
      solvation?.model === "smd" ? `%cpcm\n  smd true\n  SMDsolvent "${solvent}"\nend` : "", geom.length ? `%geom\n${geom.join("\n")}\nend` : ""].filter(Boolean);
    return { extension: "inp", text: `${title ? `# ${title}\n` : ""}! ${[method, basis, keywords, ...extras].join(" ")}\n${blocks.map(block => `${block}\n`).join("")}\n* ${zmatrix ? "gzmt" : "xyz"} ${charge} ${multiplicity}\n${zmatrix?.lines ?? coordinates}\n*\n` };
  }
  if (engine === "gaussian") {
    const opt = constraints.length ? "Opt=ModRedundant" : "Opt";
    const keywords = { energy: "SP", optimize: opt, frequencies: "Freq", "optimize-frequencies": `${opt} Freq`, "transition-state": "Opt=(TS,CalcFC,NoEigenTest) Freq" }[task];
    const route = [`${method}/${basis}`, keywords, dispersion && "EmpiricalDispersion=GD3BJ", scf && { tight: "SCF=Tight", "very-tight": "SCF=VeryTight" }[scf],
      solvation && `SCRF=(${solventModel},Solvent=${solvent})`].filter(Boolean).join(" ");
    const link0 = [checkpoint && `%chk=${checkpoint}`, cores && `%nprocshared=${cores}`, memory && `%mem=${memory}MB`].filter(Boolean);
    const lines = constraints.map(constraint => `${{ freeze: "X", distance: "B", angle: "A", dihedral: "D" }[constraint.kind]} ${constraint.atoms.map(index => index + 1).join(" ")} F`);
    // Variables follow the geometry after a blank line, then the ModRedundant section.
    const variables = zmatrix?.variables.length ? `${zmatrix.variables.join("\n")}\n\n` : "";
    return { extension: "gjf", text: `${link0.map(line => `${line}\n`).join("")}#p ${route}\n\n${title ?? "Burette calculation"}\n\n${charge} ${multiplicity}\n${zmatrix?.lines ?? coordinates}\n\n${variables}${lines.length ? `${lines.join("\n")}\n\n` : ""}` };
  }
  if (engine === "psi4") {
    const settings = new Map<string, string[]>();
    for (const constraint of constraints) {
      const key = { freeze: "frozen_cartesian", distance: "frozen_distance", angle: "frozen_bend", dihedral: "frozen_dihedral" }[constraint.kind];
      settings.set(key, [...(settings.get(key) ?? []), constraint.atoms.map(index => index + 1).join(" ") + (constraint.kind === "freeze" ? " xyz" : "")]);
    }
    const optking = [...[...settings].map(([key, entries]) => `  ${key} = "${entries.join(" ")}"`), ...(task === "transition-state" ? ["  opt_type ts", "  full_hess_every 0"] : [])];
    const convergence = scf && { tight: "1e-8", "very-tight": "1e-10" }[scf];
    const extra = [...(convergence ? [`  e_convergence ${convergence}`, `  d_convergence ${convergence}`] : []), ...(solvation ? ["  pcm true", "  pcm_scf_type total"] : [])];
    const pcm = solvation ? `\npcm = {\n  Units = Angstrom\n  Medium {\n    SolverType = CPCM\n    Solvent = ${solvent}\n  }\n  Cavity {\n    RadiiSet = UFF\n    Type = GePol\n    Scaling = False\n    Area = 0.3\n    Mode = Implicit\n  }\n}\n` : "";
    const name = `'${method}${dispersion ? `-${dispersion}` : ""}'`;
    const actions = { energy: ["energy"], optimize: ["optimize"], frequencies: ["frequency"], "optimize-frequencies": ["optimize", "frequency"], "transition-state": ["optimize", "frequency"] }[task];
    const header = [title && `# ${title}`, memory && `memory ${memory} MB`, cores && `set_num_threads(${cores})`].filter(Boolean);
    const geometry = zmatrix ? [zmatrix.lines, ...zmatrix.variables.map(assignment => assignment.replace("=", " = "))].join("\n") : coordinates;
    return { extension: "dat", text: `${header.length ? `${header.join("\n")}\n\n` : ""}molecule molecule {\n${charge} ${multiplicity}\n${geometry}\nunits angstrom\nno_com\nno_reorient\nsymmetry c1\n}\n\nset {\n  basis ${basis}\n  reference ${multiplicity === 1 ? "rhf" : "uhf"}\n${extra.map(line => `${line}\n`).join("")}}\n${pcm}${optking.length ? `\nset optking {\n${optking.join("\n")}\n}\n` : ""}\n${actions.map(action => `${action}(${name})`).join("\n")}\n` };
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
  const runType = ({ energy: "ENERGY", optimize: "GEO_OPT", frequencies: "VIBRATIONAL_ANALYSIS" } as Partial<Record<QuantumTask, string>>)[task];
  const vdw = dispersion ? `      &VDW_POTENTIAL\n        POTENTIAL_TYPE PAIR_POTENTIAL\n        &PAIR_POTENTIAL\n          TYPE DFTD3(BJ)\n          PARAMETER_FILE_NAME dftd3.dat\n          REFERENCE_FUNCTIONAL ${method.toUpperCase()}\n        &END PAIR_POTENTIAL\n      &END VDW_POTENTIAL\n` : "";
  return { extension: "inp", text: `${title ? `# ${title}\n` : ""}&GLOBAL\n  PROJECT burette\n  RUN_TYPE ${runType}\n&END GLOBAL\n&FORCE_EVAL\n  METHOD Quickstep\n  &DFT\n    BASIS_SET_FILE_NAME BASIS_MOLOPT\n    POTENTIAL_FILE_NAME GTH_POTENTIALS\n    CHARGE ${charge}\n    MULTIPLICITY ${multiplicity}\n    UKS ${multiplicity > 1 ? "TRUE" : "FALSE"}\n    &MGRID\n      CUTOFF 400\n    &END MGRID\n    &SCF\n      EPS_SCF ${scf ? { tight: "1.0E-7", "very-tight": "1.0E-8" }[scf] : "1.0E-6"}\n      MAX_SCF 100\n    &END SCF\n    &POISSON\n      PERIODIC ${cell ? "XYZ" : "NONE"}\n${cell ? "" : "      POISSON_SOLVER WAVELET\n"}    &END POISSON\n    &XC\n      &XC_FUNCTIONAL ${method.toUpperCase()}\n      &END XC_FUNCTIONAL\n${vdw}    &END XC\n  &END DFT\n  &SUBSYS\n    &CELL\n${cellLines}\n      PERIODIC ${cell ? "XYZ" : "NONE"}\n    &END CELL\n    &COORD\n${cpCoordinates.split("\n").map(line => `      ${line}`).join("\n")}\n    &END COORD\n${kinds}\n  &END SUBSYS\n&END FORCE_EVAL\n${frozen}` };
}
