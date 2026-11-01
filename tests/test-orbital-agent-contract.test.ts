import { expect, test } from "bun:test";
import { validateWorkbenchRequest, WORKBENCH_LIMITS } from "../scripts/workbench-agent-contract.mjs";

test("one shared bounded request schema rejects unsupported jobs, ambiguous IDs and invalid orbital parameters before dispatch", () => {
  const revision = `sha256-${"a".repeat(64)}`;
  for (const request of [
    { operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind: "optimize" } },
    { operation: "atoms" }, { operation: "status", jobId: "one", operationId: "two" },
    { operation: "submit", operationId: "a", job: { kind: "orbital_cube", params: { field: "orbital", orbitalIndex: 0 } } },
    { operation: "orbitals", limit: 101 }, { operation: "observe", unknown: "x" },
    ...[{ field: "orbital" }, { field: "density", orbitalIndex: 0 }, { field: "orbital", orbitalIndex: -1 }, { field: "density", paddingAngstrom: 11 }, { field: "density", spacingAngstrom: 0.01 }]
      .map(params => ({ operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind: "orbital_cube", params } })),
  ]) expect(validateWorkbenchRequest({ type: "workbench", ...request }).ok).toBe(false);
  expect(validateWorkbenchRequest({ type: "workbench", operation: "observe", unknown: "x".repeat(WORKBENCH_LIMITS.requestBytes) })).toMatchObject({ ok: false, error: { code: "REQUEST_TOO_LARGE" } });
});
