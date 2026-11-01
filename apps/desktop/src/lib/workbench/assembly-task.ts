import type { AssemblyFormat, listBiologicalAssemblies, materializeBiologicalAssembly } from "../molecular-workbench/biological-assembly";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type AssemblyRequest = { action: "assemblies"; text: string; format: AssemblyFormat }
  | { action: "assembly"; text: string; format: AssemblyFormat; assemblyId: string; modelNumber: string };
export type AssemblyResults = { assemblies: Awaited<ReturnType<typeof listBiologicalAssemblies>>; assembly: Awaited<ReturnType<typeof materializeBiologicalAssembly>> };

/** Assembly parsing and expansion stay in a private, cancellable worker. */
export function runAssemblyTask<T extends AssemblyRequest>(request: T, options: WorkerTaskOptions = {}): Promise<AssemblyResults[T["action"]]> {
  if (request.text.length > 20_000_000) return Promise.reject(new Error("Assembly input exceeds 20 MB."));
  return runWorkerTask(() => new Worker(new URL("./assembly-worker.ts", import.meta.url), { type: "module" }), request, options);
}
