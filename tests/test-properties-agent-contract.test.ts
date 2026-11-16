import { expect, test } from "bun:test";
import { validateWorkbenchRequest, workbenchContractSummary } from "../scripts/workbench-agent-contract.mjs";
const revision = `sha256-${"a".repeat(64)}`;
const submit = (params: unknown) => ({ type: "workbench", operation: "submit", operationId: "properties-1", expectedSourceRevision: revision, job: { kind: "properties", params } });
test("properties uses the shared request boundary and only the explicit optional charge model", () => {
  expect(validateWorkbenchRequest(submit({}))).toMatchObject({ ok: true, request: { job: { kind: "properties", params: {} } } });
  expect(validateWorkbenchRequest(submit({ chargeModel: "Gasteiger" }))).toMatchObject({ ok: true, request: { job: { kind: "properties", params: { chargeModel: "Gasteiger" } } } });
  for (const params of [{ chargeModel: "gasteiger" }, { chargeModel: null }, { chargeModel: "MMFF94" }, { addHydrogens: true }, { apply: true }, { atomIndices: [0] }, { forceField: "UFF" }, []]) {
    expect(validateWorkbenchRequest(submit(params))).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  }
  expect(validateWorkbenchRequest({ ...submit({}), expectedSourceRevision: undefined })).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  const contract = workbenchContractSummary();
  expect(contract.jobs.properties).toMatchObject({ params: { chargeModel: ["Gasteiger"] }, artifacts: [] });
  expect(contract.limits).toMatchObject({ activeJobs: 2, queuedJobs: 8, retainedJobs: 32, requestBytes: 256 * 1024, responseBytes: 64 * 1024 });
});
