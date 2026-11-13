import { coulombPotentialGrid, vanDerWaalsField } from "./electrostatic-potential";
import { evaluateQuantumGrid } from "./gaussian";
import { harmonicModes } from "./normal-modes";
import type { QuantumWorkerRequest, QuantumWorkerResponse } from "./quantum-client";

self.addEventListener("message", (event: MessageEvent<QuantumWorkerRequest>) => {
  const request = event.data;
  try {
    if (request?.type === "harmonic-modes") {
      const response: QuantumWorkerResponse = { type: "modes-result", modes: harmonicModes(request.atoms, request.hessian) };
      self.postMessage(response);
      return;
    }
    if (request?.type === "electrostatic-potential") {
      const potential = coulombPotentialGrid(request.atoms, request.charges), surface = vanDerWaalsField(request.atoms, potential);
      const response: QuantumWorkerResponse = { type: "potential-result", potential, surface };
      self.postMessage(response, { transfer: [potential.values.buffer, surface.values.buffer] });
      return;
    }
    if (request?.type !== "evaluate-field") throw new Error("Unsupported quantum worker request.");
    const grid = evaluateQuantumGrid(request.document, request.field, request.options);
    const response: QuantumWorkerResponse = { type: "field-result", grid };
    self.postMessage(response, { transfer: [grid.values.buffer] });
  } catch (error) {
    const response: QuantumWorkerResponse = { type: "field-error", error: (error instanceof Error ? error.message : "Quantum field evaluation failed.").slice(0, 512) };
    self.postMessage(response);
  }
});
