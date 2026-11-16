import { computeQuantumGrid } from "../molecular-workbench/quantum-client";
import { serializeCube } from "./cube-task";
import type { AgentJobRunner } from "./agent-jobs";

export const orbitalCubeJob: AgentJobRunner<"orbital_cube"> = {
  unavailable(snapshot) {
    if (!snapshot.scientific?.basis?.length) return "This source has no Gaussian basis set (open an FCHK or Molden file).";
    return snapshot.scientific.orbitals.length ? null : "This source has no molecular orbitals.";
  },
  paramsUnavailable: (snapshot, params) => params.field === "orbital" && params.orbitalIndex! >= snapshot.scientific!.orbitals.length
    ? `orbitalIndex must be below ${snapshot.scientific!.orbitals.length}.` : null,
  async run(input, { field, orbitalIndex, spacingAngstrom, paddingAngstrom, grid: geometry }, { signal, timeoutMs, stem, artifact }) {
    const scientific = input.scientific!;
    const grid = await computeQuantumGrid(scientific, field === "orbital" ? { kind: "orbital", orbitalIndex: orbitalIndex! } : { kind: field }, { spacingAngstrom, paddingAngstrom, grid: geometry }, signal);
    let min = Infinity;
    let max = -Infinity;
    for (const value of grid.values) { if (value < min) min = value; if (value > max) max = value; }
    const cube = await serializeCube(grid, scientific.atoms, { signal, timeoutMs });
    const label = field === "orbital" ? `orbital-${orbitalIndex}` : field;
    return {
      summary: { field, orbitalIndex: orbitalIndex ?? null, dimensions: grid.dimensions, origin: grid.origin, axes: grid.axes, pointCount: grid.values.length, min, max },
      artifacts: [await artifact("cube", `${stem}-${label}.cube`, "chemical/x-cube", cube)],
    };
  },
};
