import { plotScientificSpectrum } from "../molecular-workbench/scientific-spectra-plot";
import type { ScientificSpectrumRequest } from "./scientific-spectrum-task";

self.onmessage = ({ data }: MessageEvent<ScientificSpectrumRequest>) => {
  try {
    const plot = plotScientificSpectrum(data.data, data.selection, data.options);
    // Keep the exact numeric grid; the display envelope retains both signed extrema
    // of each channel in 256 bins, with <=1026 SVG vertices instead of 200000.
    const indices = new Set<number>([0, plot.positions.length - 1]);
    const width = Math.max(1, Math.ceil(plot.positions.length / 256));
    for (let first = 0; first < plot.positions.length; first += width) {
      const end = Math.min(first + width, plot.positions.length);
      for (const values of [plot.smoothed, plot.raw]) {
        let low = first, high = first;
        for (let index = first + 1; index < end; index++) {
          if (values[index] < values[low]) low = index;
          if (values[index] > values[high]) high = index;
        }
        indices.add(low); indices.add(high);
      }
    }
    const renderIndices = Uint32Array.from([...indices].sort((a, b) => a - b));
    self.postMessage({ ok: true, result: { ...plot, renderIndices } }, { transfer: [plot.positions.buffer, plot.smoothed.buffer, plot.raw.buffer, renderIndices.buffer] });
  } catch (error) {
    self.postMessage({ ok: false, error: (error instanceof Error ? error.message : "Spectrum calculation failed.").slice(0, 512) });
  }
};
