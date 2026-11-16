import { buildMetalComplex } from "../molecular-workbench/metal-complex";
import { sdfFromGraph } from "./formats";
import type { MetalComplexBuildRequest, MetalComplexBuildResult } from "./metal-complex-task";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<MetalComplexBuildRequest>) => void; postMessage: (message: unknown) => void };
scope.onmessage = ({ data }) => {
  try {
    if (data.format !== "sdf" && data.format !== "mol") throw new Error("Write the complex as SDF or MOL.");
    const complex = buildMetalComplex(data), { atoms, bonds, coordination } = complex;
    const sdf = sdfFromGraph(atoms, bonds, complex.name, coordination, atoms.map(atom => atom.charge));
    const result: MetalComplexBuildResult = { text: data.format === "sdf" ? sdf : sdf.replace(/\$\$\$\$\n$/u, ""), format: data.format, name: complex.name,
      atomCount: atoms.length, bondCount: bonds.length + coordination.length, formula: complex.formula, charge: complex.charge,
      coordinationNumber: coordination.length, geometry: data.geometry, graph: { atoms, bonds, coordination } };
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Could not build the complex." });
  }
};
