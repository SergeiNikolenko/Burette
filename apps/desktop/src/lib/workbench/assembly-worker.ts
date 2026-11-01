import { listBiologicalAssemblies, materializeBiologicalAssembly } from "../molecular-workbench/biological-assembly";
import type { AssemblyRequest } from "./assembly-task";

self.onmessage = async ({ data }: MessageEvent<AssemblyRequest>) => {
  try {
    const result = data.action === "assemblies" ? await listBiologicalAssemblies(data.text, data.format)
      : await materializeBiologicalAssembly(data.text, data.format, data.assemblyId, data.modelNumber);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
