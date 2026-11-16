import { gridsToCube, parseScientificFile } from "../molecular-workbench/quantum";
import type { CubeRequest } from "./cube-task";

self.onmessage = ({ data }: MessageEvent<CubeRequest>) => {
  try {
    const result = gridsToCube(data.grids, data.atoms);
    if (result.length > 16 * 1024 * 1024 || new TextEncoder().encode(result).byteLength > 16 * 1024 * 1024) throw new Error("Cube output exceeds the supported 16 MiB reader limit.");
    // Exported bytes must satisfy the same numeric and coordinate contract as reopening. A pair of
    // fields only goes to the scene, which checks it, and may hold more values than a reopened file.
    if (data.grids.length === 1) parseScientificFile("field.cube", result);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: (error instanceof Error ? error.message : "Cube serialization failed.").slice(0, 512) });
  }
};
