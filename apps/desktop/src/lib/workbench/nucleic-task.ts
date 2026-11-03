import { NUCLEIC_ACID_MAX_LENGTH, type NucleicAcidOptions, type NucleicStrand } from "../molecular-workbench/nucleic";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type NucleicBuildRequest = { sequence: string; options: NucleicAcidOptions };
/** Atoms and bonds in mmCIF row order, Kekulé bond orders and formal charges. */
export type NucleicBuildGraph = {
  atoms: { element: string; x: number; y: number; z: number; charge: number }[];
  bonds: { a: number; b: number; order: 1 | 2 | 3 }[];
};
export type NucleicBuildResult = {
  text: string;
  format: "mmcif";
  /** File stem of the document, e.g. "GATTACA-B-DNA-duplex-ideal". */
  name: string;
  sequence: string;
  atomCount: number;
  residueCount: number;
  charge: number;
  strands: NucleicStrand[];
  graph: NucleicBuildGraph;
};

/** Ideal-helix placement and mmCIF serialization off the UI thread. */
export function runNucleicTask(request: NucleicBuildRequest, options: WorkerTaskOptions = {}): Promise<NucleicBuildResult> {
  // Whitespace is ignored by the parser; this only bounds the message posted to the worker.
  if (request.sequence.length > 8 * NUCLEIC_ACID_MAX_LENGTH) return Promise.reject(new Error(`Use at most ${NUCLEIC_ACID_MAX_LENGTH} nucleotides per strand.`));
  return runWorkerTask<NucleicBuildResult>(() => new Worker(new URL("./nucleic-worker.ts", import.meta.url), { type: "module" }), request, options);
}
