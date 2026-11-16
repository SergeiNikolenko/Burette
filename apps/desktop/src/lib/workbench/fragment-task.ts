import type { FragmentInsertion, FragmentSource } from "../molecular-workbench/fragment-source";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type FragmentInsertRequest = { molecule: MolecularStructure; fragment: FragmentSource; target: number | null };
export type { FragmentInsertion, FragmentSource };

/** Template resolution (library or SMILES conformer), site hydrogens and the graph merge run off the UI thread. */
export function runFragmentTask(request: FragmentInsertRequest, options: WorkerTaskOptions = {}): Promise<FragmentInsertion> {
  return runWorkerTask<FragmentInsertion>(() => new Worker(new URL("./fragment-worker.ts", import.meta.url), { type: "module" }), request, options);
}
