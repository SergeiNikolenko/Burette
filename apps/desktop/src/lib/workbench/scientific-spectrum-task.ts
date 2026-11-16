import { checkScientificSpectra, type ScientificSpectra } from "../molecular-workbench/scientific-spectra";
import { type plotScientificSpectrum, type SpectralPlotSelection, type SpectralPlotOptions } from "../molecular-workbench/scientific-spectra-plot";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type ScientificSpectrumRequest = { data: ScientificSpectra; selection: SpectralPlotSelection; options: SpectralPlotOptions };
export type ScientificSpectrumPlot = ReturnType<typeof plotScientificSpectrum> & { renderIndices: Uint32Array };

/** Clone only bounded source spectra. Every recalculation has an independently cancellable worker. */
export function computeScientificSpectrum(request: ScientificSpectrumRequest, task: WorkerTaskOptions = {}): Promise<ScientificSpectrumPlot> {
  if (task.signal?.aborted) return Promise.reject(new DOMException("Spectrum calculation cancelled.", "AbortError"));
  try { checkScientificSpectra(request.data); }
  catch (error) { return Promise.reject(error); }
  return runWorkerTask(() => new Worker(new URL("./scientific-spectrum-worker.ts", import.meta.url), { type: "module" }),
    { data: request.data, selection: request.selection, options: request.options }, { timeoutMs: 60_000, ...task });
}
