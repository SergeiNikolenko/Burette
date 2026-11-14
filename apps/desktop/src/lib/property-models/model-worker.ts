import { buildPropertyModel, type PropertyModelRequest } from "./build";

const PROGRESS_INTERVAL_MS = 100;

self.onmessage = ({ data }: MessageEvent<PropertyModelRequest>) => {
  try {
    let reported = 0;
    const result = buildPropertyModel(data, (fraction) => {
      const now = Date.now();
      if (now - reported < PROGRESS_INTERVAL_MS) return;
      reported = now;
      self.postMessage({ progress: fraction });
    });
    self.postMessage({ ok: true, result }, { transfer: [result.predictions.buffer] });
  } catch (error) {
    self.postMessage({ ok: false, error: (error instanceof Error ? error.message : "The model could not be built.").slice(0, 512) });
  }
};
