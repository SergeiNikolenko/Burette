import type { VibrationalMode } from "../molecular-workbench/scientific-types";
import type { plotVibrationalSpectrum, VibrationalPlotKind, VibrationalPlotOptions } from "../molecular-workbench/vibrational-spectrum-plot";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type VibrationalSpectrumRequest = { modes: VibrationalMode[]; kind: VibrationalPlotKind; options: VibrationalPlotOptions };

export function computeVibrationalSpectrum(request: VibrationalSpectrumRequest, task: WorkerTaskOptions = {}): Promise<ReturnType<typeof plotVibrationalSpectrum>> {
  if (task.signal?.aborted) return Promise.reject(new DOMException("Spectrum calculation cancelled.", "AbortError"));
  if (request.modes.length > 10_000) return Promise.reject(new Error("Spectrum exceeds 10000 source modes."));
  // Do not clone displacement vectors into a scalar-spectrum worker.
  const modes = request.modes.map(({ index, frequencyCm1, intensityKmMol, ramanActivityAngstrom4Amu }) => ({ index, frequencyCm1, intensityKmMol, ramanActivityAngstrom4Amu }));
  return runWorkerTask(() => new Worker(new URL("./vibrational-spectrum-worker.ts", import.meta.url), { type: "module" }),
    { modes, kind: request.kind, options: request.options }, { timeoutMs: 60_000, ...task });
}
