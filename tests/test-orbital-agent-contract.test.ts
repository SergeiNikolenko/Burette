import { expect, test } from "bun:test";
import { validateWorkbenchRequest, WORKBENCH_LIMITS } from "../scripts/workbench-agent-contract.mjs";

test("one shared bounded request schema rejects unsupported jobs, ambiguous IDs and invalid orbital parameters before dispatch", () => {
  const revision = `sha256-${"a".repeat(64)}`;
  const square = { origin: [0, 0, 0], axes: [[0.2, 0, 0], [0, 0.2, 0], [0, 0, 0.2]], dimensions: [100, 100, 100] };
  for (const request of [
    { operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind: "molecular_dynamics" } },
    { operation: "frames" }, { operation: "status", jobId: "one", operationId: "two" },
    { operation: "submit", operationId: "a", job: { kind: "orbital_cube", params: { field: "orbital", orbitalIndex: 0 } } },
    { operation: "orbitals", limit: 101 }, { operation: "observe", unknown: "x" },
    ...[{ field: "orbital" }, { field: "density", orbitalIndex: 0 }, { field: "orbital", orbitalIndex: -1 }, { field: "density", paddingAngstrom: 11 }, { field: "density", spacingAngstrom: 0.01 }, { field: "density", spacingAngstrom: 0.05 },
      { field: "density", spacingAngstrom: 0.2, grid: square }, { field: "density", grid: { ...square, dimensions: [101, 100, 100] } },
      { field: "density", grid: { ...square, axes: square.axes.slice(1) } }, { field: "density", grid: { ...square, dimensions: [2, 2, 1.5] } },
      { field: "density", grid: { ...square, spacing: 1 } }, { field: "density", grid: { ...square, origin: [0, 0, Number.NaN] } }]
      .map(params => ({ operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind: "orbital_cube", params } })),
  ]) expect(validateWorkbenchRequest({ type: "workbench", ...request }).ok).toBe(false);
  expect(validateWorkbenchRequest({ type: "workbench", operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind: "orbital_cube", params: { field: "density", grid: square } } }))
    .toMatchObject({ ok: true, request: { job: { params: { field: "density", grid: square } } } });
  expect(validateWorkbenchRequest({ type: "workbench", operation: "observe", unknown: "x".repeat(WORKBENCH_LIMITS.requestBytes) })).toMatchObject({ ok: false, error: { code: "REQUEST_TOO_LARGE" } });
});
