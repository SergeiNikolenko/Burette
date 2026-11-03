import { plotVibrationalSpectrum } from "../molecular-workbench/vibrational-spectrum-plot";
import type { VibrationalSpectrumRequest } from "./vibrational-spectrum-task";

self.onmessage = ({ data }: MessageEvent<VibrationalSpectrumRequest>) => {
  try {
    const plot = plotVibrationalSpectrum(data.modes, data.kind, data.options);
    self.postMessage({ ok: true, result: plot }, { transfer: [plot.wavenumbers.buffer, plot.smoothed.buffer, plot.raw.buffer] });
  } catch (error) {
    self.postMessage({ ok: false, error: (error instanceof Error ? error.message : "Spectrum calculation failed.").slice(0, 512) });
  }
};
