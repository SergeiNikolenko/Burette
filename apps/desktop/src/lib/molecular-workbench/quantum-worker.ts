import { evaluateQuantumGrid } from "./gaussian";
import type { QuantumWorkerRequest, QuantumWorkerResponse } from "./quantum-client";

self.addEventListener("message", (event: MessageEvent<QuantumWorkerRequest>) => {
  const request = event.data;
  try {
    if (request?.type !== "evaluate-field") throw new Error("Unsupported quantum worker request.");
    const grid = evaluateQuantumGrid(request.document, request.field, request.options);
    const response: QuantumWorkerResponse = { type: "field-result", grid };
    self.postMessage(response, { transfer: [grid.values.buffer] });
  } catch (error) {
    const response: QuantumWorkerResponse = { type: "field-error", error: (error instanceof Error ? error.message : "Quantum field evaluation failed.").slice(0, 512) };
    self.postMessage(response);
  }
});
