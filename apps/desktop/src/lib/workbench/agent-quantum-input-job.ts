import { generateQuantumInput, QUANTUM_INPUT_DEFAULTS } from "../molecular-workbench/input-export";
import { isPdbDocument, readPdbAtoms } from "./structure";
import type { AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

const MIME_TYPES = { inp: "text/plain", gjf: "chemical/x-gaussian-input", dat: "text/plain" } as Record<string, string>;
// The dialog's atoms: the workbench source, or the first model of a PDB.
const atomsOf = (snapshot: Snapshot) => snapshot.source?.atoms ?? (isPdbDocument(snapshot.document) ? readPdbAtoms(snapshot.text) : null);

/** Export input file for agents: the source revision as an ORCA, Gaussian, Psi4 or CP2K input; nothing runs. */
export const quantumInputJob: AgentJobRunner<"quantum_input"> = {
  unavailable: snapshot => snapshot.source || isPdbDocument(snapshot.document) ? null : "Open a MOL, SDF, XYZ, PDB, CIF or quantum output to write an input file.",
  async run(input, { program, method, basis, periodic, ...options }, { stem, artifact }) {
    const atoms = atomsOf(input);
    if (!atoms) throw new Error("The source has no atoms to write.");
    const chosen = { method: method ?? QUANTUM_INPUT_DEFAULTS[program].method, basis: basis ?? QUANTUM_INPUT_DEFAULTS[program].basis };
    const cell = program === "cp2k" && periodic ? input.source?.cell ?? undefined : undefined;
    const { extension, text } = generateQuantumInput(atoms, { engine: program, ...chosen, ...options, cell });
    return { summary: { program, ...chosen, task: options.task, coordinates: options.coordinates, atomCount: atoms.length, periodic: Boolean(cell) },
      artifacts: [await artifact("input", `${stem}.${extension}`, MIME_TYPES[extension] ?? "text/plain", text)] };
  },
};
